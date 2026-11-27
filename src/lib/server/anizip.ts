import { isAllowedImageUrl } from './imageHost';

const ANIZIP_ENDPOINT = 'https://api.ani.zip/v1/episodes';
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

export interface AniZipEpisode {
	episodeNumber: number;
	title: string | null;
	airDate: string | null;
	overview: string | null;
	image: string;
}

export interface AniZipShowData {
	anilistId: number;
	titles: string[];
	episodes: AniZipEpisode[];
	maxEpisodeNumber: number;
}

interface CacheEntry {
	data: AniZipShowData | null;
	expiresAt: number;
}

const cache = new Map<number, CacheEntry>();

const NUMERIC_EP_RE = /^[1-9]\d*$/;

export async function fetchAniZipEpisodes(anilistId: number): Promise<AniZipShowData | null> {
	const cached = cache.get(anilistId);
	if (cached && cached.expiresAt > Date.now()) {
		return cached.data;
	}

	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), 9_000);

	try {
		const res = await fetch(`${ANIZIP_ENDPOINT}?anilist_id=${encodeURIComponent(anilistId)}`, {
			headers: {
				Accept: 'application/json',
				'User-Agent': 'episode-guesser.karczma.moe/1.0'
			},
			signal: controller.signal
		});

		if (!res.ok) {
			// Only negative-cache 404s; never cache transient 429/5xx upstream failures
			if (res.status === 404) {
				storeCache(anilistId, null, 15 * 60 * 1000);
			}
			return null;
		}

		const json = (await res.json()) as {
			titles?: Record<string, string>;
			episodes?: Record<
				string,
				{
					episodeNumber?: number;
					episode?: string;
					title?: Record<string, string>;
					airDate?: string;
					airdate?: string;
					overview?: string;
					summary?: string;
					image?: string;
				}
			>;
		};

		const titles = Object.values(json.titles ?? {}).filter(
			(v): v is string => typeof v === 'string' && v.trim().length > 0
		);

		const episodes: AniZipEpisode[] = [];
		let maxEpisodeNumber = 0;

		for (const [key, ep] of Object.entries(json.episodes ?? {})) {
			// Strictly numbered standard episodes (skip S1, C1, T1, P1, 0, etc.)
			if (!NUMERIC_EP_RE.test(key)) continue;
			const epNum = Number(key);
			if (!Number.isInteger(epNum) || epNum < 1) continue;
			if (epNum > maxEpisodeNumber) maxEpisodeNumber = epNum;

			if (!isAllowedImageUrl(ep.image)) continue;

			const epTitle = ep.title?.en || ep.title?.['x-jat'] || ep.title?.ja || null;
			const overview = (ep.overview || ep.summary || '')
				.replace(/\nSource:.*$/is, '')
				.trim();

			episodes.push({
				episodeNumber: epNum,
				title: epTitle ? epTitle.replace(/`/g, "'") : null,
				airDate: ep.airDate || ep.airdate || null,
				overview: overview ? overview.replace(/`/g, "'") : null,
				image: ep.image
			});
		}

		episodes.sort((a, b) => a.episodeNumber - b.episodeNumber);

		const data: AniZipShowData | null =
			episodes.length > 0 ? { anilistId, titles, episodes, maxEpisodeNumber } : null;

		storeCache(anilistId, data, data ? CACHE_TTL_MS : 30 * 60 * 1000);
		return data;
	} catch {
		return null;
	} finally {
		clearTimeout(timer);
	}
}

function storeCache(anilistId: number, data: AniZipShowData | null, ttlMs: number): void {
	if (cache.size > 1500) {
		const first = cache.keys().next().value;
		if (first !== undefined) cache.delete(first);
	}
	cache.set(anilistId, { data, expiresAt: Date.now() + ttlMs });
}

export function filterWatchedEpisodes(
	episodes: AniZipEpisode[],
	maxWatchedProgress: number,
	isCompleted: boolean
): AniZipEpisode[] {
	if (isCompleted) return episodes;
	return episodes.filter((ep) => ep.episodeNumber <= maxWatchedProgress);
}
