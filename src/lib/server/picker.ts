import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { WORDLE_ZOOM_STEPS } from '$lib/scoring';
import type { AnimePoolItem, EpisodeReveal, GameMode } from '$lib/types';
import { fetchAniZipEpisodes, filterWatchedEpisodes } from './anizip';
import { getBakedDailyPick } from './dailyArchive';
import { sealPayload } from './token';

export interface CropSpec {
	scale: number;
	originX: number;
	originY: number;
}

export interface VnUiCropSpec {
	stage: 1 | 2 | 3 | 4 | 5;
	isNvl: boolean;
}

export interface SealedImageSecret {
	typ: 'image';
	url: string;
	exp: number;
	crop?: CropSpec;
	vnUi?: VnUiCropSpec;
}

export interface SealedRoundSecret {
	typ: 'round';
	v: 1;
	roundId: string;
	mode: GameMode;
	createdAt: number;
	rawImageUrl: string;
	originX: number;
	originY: number;
	targetTitles: string[];
	franchiseTitles: string[];
	reveal: EpisodeReveal;
	dailyDate?: string;
	scopeKey?: string;
	playerId?: string;
}

export interface SealedDailyState {
	typ: 'daily';
	v: 1;
	roundId: string;
	dailyDate: string;
	scopeKey: string;
	playerId: string;
	attemptsUsed: number;
	finished: boolean;
	usedKeys: string[];
}

export const IMAGE_TOKEN_TTL_MS = 36 * 60 * 60 * 1000; // 36 hours (outlives a full UTC daily cycle)

export function mintImageUrl(rawUrl: string, crop?: CropSpec): string {
	const token = sealPayload<SealedImageSecret>({
		typ: 'image',
		url: rawUrl,
		exp: Date.now() + IMAGE_TOKEN_TTL_MS,
		...(crop && crop.scale > 1.01 ? { crop } : {})
	});
	return `/api/image/${token}`;
}

export function mintVnImageUrl(rawUrl: string, stage: 1 | 2 | 3 | 4 | 5, isNvl: boolean): string {
	const token = sealPayload<SealedImageSecret>({
		typ: 'image',
		url: rawUrl,
		exp: Date.now() + IMAGE_TOKEN_TTL_MS,
		...(stage < 5 ? { vnUi: { stage, isNvl } } : {})
	});
	return `/api/image/${token}`;
}

function seededRandom(seedStr: string): () => number {
	const digest = createHash('sha256').update(seedStr).digest();
	let state = digest.readUInt32BE(0) || 0x9e3779b9;
	return () => {
		state = (state + 0x6d2b79f5) | 0;
		let t = Math.imul(state ^ (state >>> 15), 1 | state);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

function shuffleWithRng<T>(items: T[], rng: () => number): T[] {
	const arr = items.slice();
	for (let i = arr.length - 1; i > 0; i--) {
		const j = Math.floor(rng() * (i + 1));
		[arr[i], arr[j]] = [arr[j], arr[i]];
	}
	return arr;
}

interface ResolvedDailyPick {
	rawImageUrl: string;
	originX: number;
	originY: number;
	targetTitles: string[];
	franchiseTitles: string[];
	reveal: Omit<EpisodeReveal, 'imageUrl'>;
	cachedAt: number;
}

const resolvedDailyPickCache = new Map<string, ResolvedDailyPick>();
const DAILY_PICK_TTL_MS = 36 * 60 * 60 * 1000;
let picksHydrated = false;
let picksFlushTimer: ReturnType<typeof setTimeout> | null = null;
let picksShutdownHooked = false;

function getPicksFile(): string {
	return process.env.DAILY_PICKS_PATH || join(process.cwd(), '.cache', 'daily-picks.json');
}

function isPicksMemoryOnly(): boolean {
	return Boolean(process.env.VITEST) && !process.env.DAILY_PICKS_PATH;
}

function hydrateDailyPicks(): void {
	if (picksHydrated) return;
	picksHydrated = true;
	if (isPicksMemoryOnly()) return;
	try {
		const file = getPicksFile();
		if (!existsSync(file)) return;
		const parsed = JSON.parse(readFileSync(file, 'utf8')) as Record<string, ResolvedDailyPick>;
		const now = Date.now();
		for (const [k, v] of Object.entries(parsed)) {
			if (v && typeof v.cachedAt === 'number' && now - v.cachedAt < DAILY_PICK_TTL_MS) {
				resolvedDailyPickCache.set(k, v);
			}
		}
	} catch {
		// ignore corrupt cache
	}
}

function serializeDailyPicks(): string {
	const now = Date.now();
	const obj: Record<string, ResolvedDailyPick> = {};
	for (const [k, v] of resolvedDailyPickCache) {
		if (now - v.cachedAt < DAILY_PICK_TTL_MS) {
			obj[k] = v;
		}
	}
	return JSON.stringify(obj);
}

function scheduleDailyPicksPersist(): void {
	if (isPicksMemoryOnly()) return;
	if (!picksShutdownHooked) {
		picksShutdownHooked = true;
		const flushSync = () => {
			if (!picksFlushTimer) return;
			clearTimeout(picksFlushTimer);
			picksFlushTimer = null;
			try {
				const file = getPicksFile();
				mkdirSync(dirname(file), { recursive: true });
				const tmp = `${file}.${process.pid}.tmp`;
				writeFileSync(tmp, serializeDailyPicks(), 'utf8');
				renameSync(tmp, file);
			} catch {
				// non-fatal
			}
		};
		process.once('SIGTERM', flushSync);
		process.once('SIGINT', flushSync);
		process.once('beforeExit', flushSync);
	}
	if (picksFlushTimer) return;
	picksFlushTimer = setTimeout(async () => {
		picksFlushTimer = null;
		try {
			const file = getPicksFile();
			await mkdir(dirname(file), { recursive: true });
			const tmp = `${file}.${process.pid}.tmp`;
			await writeFile(tmp, serializeDailyPicks(), 'utf8');
			await rename(tmp, file);
		} catch {
			// non-fatal
		}
	}, 1_500);
	if (typeof picksFlushTimer === 'object' && 'unref' in picksFlushTimer) {
		picksFlushTimer.unref();
	}
}

function sealDailyFromCachedPick(
	pick: ResolvedDailyPick,
	dailyBinding: { dailyDate: string; scopeKey: string; playerId: string }
) {
	const fullImageUrl = mintImageUrl(pick.rawImageUrl);
	const initialImageUrl = mintImageUrl(pick.rawImageUrl, {
		scale: WORDLE_ZOOM_STEPS[0],
		originX: pick.originX,
		originY: pick.originY
	});
	const roundId = randomUUID();
	const reveal: EpisodeReveal = { ...pick.reveal, imageUrl: fullImageUrl };

	const roundToken = sealPayload<SealedRoundSecret>({
		typ: 'round',
		v: 1,
		roundId,
		mode: 'daily',
		createdAt: Date.now(),
		rawImageUrl: pick.rawImageUrl,
		originX: pick.originX,
		originY: pick.originY,
		targetTitles: pick.targetTitles,
		franchiseTitles: pick.franchiseTitles,
		reveal,
		dailyDate: dailyBinding.dailyDate,
		scopeKey: dailyBinding.scopeKey,
		playerId: dailyBinding.playerId
	});

	const dailyStateToken = sealPayload<SealedDailyState>({
		typ: 'daily',
		v: 1,
		roundId,
		dailyDate: dailyBinding.dailyDate,
		scopeKey: dailyBinding.scopeKey,
		playerId: dailyBinding.playerId,
		attemptsUsed: 0,
		finished: false,
		usedKeys: []
	});

	return {
		roundId,
		roundToken,
		dailyStateToken,
		imageUrl: initialImageUrl,
		originX: pick.originX,
		originY: pick.originY
	};
}

export async function pickRoundFromPool(params: {
	pool: AnimePoolItem[];
	mode: GameMode;
	excludeMediaIds?: number[];
	seed?: string;
	dailyBinding?: {
		dailyDate: string;
		scopeKey: string;
		playerId: string;
	};
}): Promise<{
	roundId: string;
	roundToken: string;
	dailyStateToken?: string;
	imageUrl: string;
	originX: number;
	originY: number;
}> {
	const { pool, mode, excludeMediaIds = [], seed, dailyBinding } = params;
	if (pool.length === 0) {
		throw new Error('No eligible anime found in this list. Try including more list statuses.');
	}

	// Serve pre-generated 1-year archive picks instantaneously (0ms, zero upstream flakiness),
	// or reuse the persisted Daily pick for future dates so restarts never shift a day's Global Daily.
	if (mode === 'daily' && dailyBinding) {
		if (dailyBinding.scopeKey === 'global') {
			const baked = getBakedDailyPick(dailyBinding.dailyDate);
			if (baked) {
				return sealDailyFromCachedPick({ ...baked, cachedAt: Date.now() }, dailyBinding);
			}
		}
		hydrateDailyPicks();
		const dailyKey = `${dailyBinding.dailyDate}|${dailyBinding.scopeKey}`;
		const cachedPick = resolvedDailyPickCache.get(dailyKey);
		if (cachedPick && Date.now() - cachedPick.cachedAt < DAILY_PICK_TTL_MS) {
			return sealDailyFromCachedPick(cachedPick, dailyBinding);
		}
	}

	const rng = seed ? seededRandom(seed) : Math.random;
	const excluded = new Set(excludeMediaIds);
	let candidates = pool.filter((item) => !excluded.has(item.id));
	if (candidates.length === 0) {
		candidates = pool.slice();
	}

	if (seed) {
		candidates.sort((a, b) => a.id - b.id);
	}

	const ordered = shuffleWithRng(candidates, rng);
	const maxAttempts = Math.min(ordered.length, 12);
	const batchSize = seed ? 1 : 3;

	for (let start = 0; start < maxAttempts; start += batchSize) {
		const slice = ordered.slice(start, Math.min(start + batchSize, maxAttempts));
		const results = await Promise.all(
			slice.map(async (show) => {
				let anizip = await fetchAniZipEpisodes(show.id);
				if (!anizip && seed) {
					anizip = await fetchAniZipEpisodes(show.id);
				}
				return { show, anizip };
			})
		);

		for (const { show, anizip } of results) {
			if (!anizip) continue;

			const isCompleted = show.status === 'COMPLETED' || show.status === 'REPEATING';
			const eligibleEps = filterWatchedEpisodes(anizip.episodes, show.progress, isCompleted);
			if (eligibleEps.length === 0) continue;

			// In Daily mode, prefer modern TVDB v4 HD screencaps (/banners/v4/episode/) over legacy 400x225 stills
			// so zoomed-in Daily crops stay crisp.
			const hdEps =
				mode === 'daily'
					? eligibleEps.filter((ep) => ep.image.includes('/banners/v4/'))
					: eligibleEps;
			const pickPool = hdEps.length > 0 ? hdEps : eligibleEps;

			const epIndex = Math.floor(rng() * pickPool.length);
			const picked = pickPool[epIndex];

			const originX = Math.round(34 + rng() * 32);
			const originY = Math.round(34 + rng() * 32);

			const fullImageUrl = mintImageUrl(picked.image);
			const initialImageUrl =
				mode === 'daily'
					? mintImageUrl(picked.image, {
							scale: WORDLE_ZOOM_STEPS[0],
							originX,
							originY
						})
					: fullImageUrl;

			const targetTitles = Array.from(
				new Set(
					[
						show.titleRomaji,
						show.titleEnglish,
						show.titleNative,
						...show.synonyms,
						...anizip.titles
					].filter((t): t is string => Boolean(t && t.trim()))
				)
			);

			const totalEpisodes = Math.max(
				show.episodes || 0,
				anizip.maxEpisodeNumber,
				picked.episodeNumber
			);

			const reveal: EpisodeReveal = {
				anilistId: show.id,
				titleRomaji: show.titleRomaji,
				titleEnglish: show.titleEnglish,
				episodeNumber: picked.episodeNumber,
				totalEpisodes,
				episodeTitle: picked.title,
				airDate: picked.airDate,
				overview: picked.overview,
				seasonYear: show.seasonYear,
				studio: show.studio,
				coverImage: show.coverImage,
				imageUrl: fullImageUrl,
				anilistUrl: `https://anilist.co/anime/${show.id}`
			};

			const roundId = randomUUID();

			const roundToken = sealPayload<SealedRoundSecret>({
				typ: 'round',
				v: 1,
				roundId,
				mode,
				createdAt: Date.now(),
				rawImageUrl: picked.image,
				originX,
				originY,
				targetTitles,
				franchiseTitles: show.franchiseTitles,
				reveal,
				...(dailyBinding
					? {
							dailyDate: dailyBinding.dailyDate,
							scopeKey: dailyBinding.scopeKey,
							playerId: dailyBinding.playerId
						}
					: {})
			});

			const dailyStateToken =
				mode === 'daily' && dailyBinding
					? sealPayload<SealedDailyState>({
							typ: 'daily',
							v: 1,
							roundId,
							dailyDate: dailyBinding.dailyDate,
							scopeKey: dailyBinding.scopeKey,
							playerId: dailyBinding.playerId,
							attemptsUsed: 0,
							finished: false,
							usedKeys: []
						})
					: undefined;

			if (mode === 'daily' && dailyBinding) {
				const dailyKey = `${dailyBinding.dailyDate}|${dailyBinding.scopeKey}`;
				if (resolvedDailyPickCache.size > 500) {
					const first = resolvedDailyPickCache.keys().next().value;
					if (first) resolvedDailyPickCache.delete(first);
				}
				const { imageUrl: _omit, ...revealWithoutImg } = reveal;
				resolvedDailyPickCache.set(dailyKey, {
					rawImageUrl: picked.image,
					originX,
					originY,
					targetTitles,
					franchiseTitles: show.franchiseTitles,
					reveal: revealWithoutImg,
					cachedAt: Date.now()
				});
				scheduleDailyPicksPersist();
			}

			return {
				roundId,
				roundToken,
				dailyStateToken,
				imageUrl: initialImageUrl,
				originX,
				originY
			};
		}
	}

	throw new Error(
		'Could not find a show with episode screencaps right now. Try again or broaden your AniList filters.'
	);
}
