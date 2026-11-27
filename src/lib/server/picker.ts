import { createHash, randomUUID } from 'node:crypto';
import { WORDLE_ZOOM_STEPS } from '$lib/scoring';
import type { AnimePoolItem, EpisodeReveal, GameMode } from '$lib/types';
import { fetchAniZipEpisodes, filterWatchedEpisodes } from './anizip';
import { sealPayload } from './token';

export interface CropSpec {
	scale: number;
	originX: number;
	originY: number;
}

export interface SealedImageSecret {
	typ: 'image';
	url: string;
	exp: number;
	crop?: CropSpec;
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

	// Reuse the first resolved Daily pick for (date, scopeKey) so all players share the exact same Global Daily
	if (mode === 'daily' && dailyBinding) {
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
	const batchSize = seed ? 1 : 3; // Seeded Daily stays strictly deterministic; random modes probe 3 at a time for low latency

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

			const epIndex = Math.floor(rng() * eligibleEps.length);
			const picked = eligibleEps[epIndex];

			// Focal crop point for Daily Wordle server-side progressive zoom (34%..66%)
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
		'Could not find a show with episode screencaps on ani.zip after trying several titles. Try again or broaden your AniList filters.'
	);
}
