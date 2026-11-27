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
	url: string;
	exp: number;
	crop?: CropSpec;
}

export interface SealedRoundSecret {
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
	const maxAttempts = Math.min(ordered.length, 14);

	for (let i = 0; i < maxAttempts; i++) {
		const show = ordered[i];
		let anizip = await fetchAniZipEpisodes(show.id);
		// Retry once for seeded Daily picks so a transient hiccup doesn't diverge two players' Global Daily
		if (!anizip && seed) {
			anizip = await fetchAniZipEpisodes(show.id);
		}
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

		return {
			roundId,
			roundToken,
			dailyStateToken,
			imageUrl: initialImageUrl,
			originX,
			originY
		};
	}

	throw new Error(
		'Could not find a show with episode screencaps on ani.zip after trying several titles. Try again or broaden your AniList filters.'
	);
}
