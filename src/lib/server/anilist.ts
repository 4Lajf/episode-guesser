import { normalizeTitle } from '$lib/scoring';
import type { AniListProfile, AnimePoolItem, ListStatus } from '$lib/types';

const ANILIST_ENDPOINT = 'https://graphql.anilist.co';
const PROFILE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const YEAR_TTL_MS = 24 * 60 * 60 * 1000;

interface CachedEntry<T> {
	data: T;
	expiresAt: number;
}

const profileCache = new Map<string, CachedEntry<AniListProfile>>();
const titleYearCache = new Map<string, CachedEntry<number | null>>();

const USER_LIST_QUERY = `
query ($userName: String!, $statuses: [MediaListStatus]) {
  User(name: $userName) {
    name
    avatar {
      medium
    }
  }
  MediaListCollection(userName: $userName, type: ANIME, status_in: $statuses) {
    lists {
      status
      entries {
        mediaId
        progress
        status
        media {
          id
          episodes
          format
          seasonYear
          startDate {
            year
          }
          title {
            romaji
            english
            native
          }
          synonyms
          genres
          coverImage {
            large
          }
          studios(isMain: true) {
            nodes {
              name
            }
          }
          relations {
            edges {
              relationType
              node {
                type
                title {
                  romaji
                  english
                }
              }
            }
          }
        }
      }
    }
  }
}
`;

const TITLE_YEAR_QUERY = `
query ($search: String!) {
  Media(search: $search, type: ANIME) {
    seasonYear
    startDate {
      year
    }
    title {
      romaji
      english
      native
    }
    synonyms
  }
}
`;

interface RawMediaListEntry {
	mediaId: number;
	progress: number;
	status: ListStatus;
	media: {
		id: number;
		episodes: number | null;
		format: string | null;
		seasonYear: number | null;
		startDate: { year: number | null } | null;
		title: {
			romaji: string;
			english: string | null;
			native: string | null;
		};
		synonyms: string[] | null;
		genres: string[] | null;
		coverImage: { large: string | null } | null;
		studios: { nodes: Array<{ name: string }> } | null;
		relations: {
			edges: Array<{
				relationType: string;
				node: {
					type: string;
					title: { romaji: string | null; english: string | null };
				} | null;
			}>;
		} | null;
	};
}

const VALID_STATUSES = new Set<ListStatus>([
	'COMPLETED',
	'CURRENT',
	'PAUSED',
	'DROPPED',
	'REPEATING'
]);

const FRANCHISE_RELATIONS = new Set([
	'PREQUEL',
	'SEQUEL',
	'PARENT',
	'SIDE_STORY',
	'ALTERNATIVE',
	'SPIN_OFF',
	'SUMMARY'
]);

export function sanitizeStatuses(raw: string[] | undefined): ListStatus[] {
	if (!raw || raw.length === 0) return ['COMPLETED', 'CURRENT'];
	const filtered = raw.filter((s): s is ListStatus => VALID_STATUSES.has(s as ListStatus));
	return filtered.length > 0 ? Array.from(new Set(filtered)) : ['COMPLETED', 'CURRENT'];
}

export async function fetchAniListProfile(params: {
	username: string;
	statuses?: ListStatus[];
	includeSingleEp?: boolean;
	forceRefresh?: boolean;
}): Promise<AniListProfile> {
	const username = params.username.trim();
	if (!username || username.length > 64) {
		throw new Error('Enter a valid AniList username.');
	}

	const statuses = sanitizeStatuses(params.statuses);
	const includeSingleEp = Boolean(params.includeSingleEp);
	const cacheKey = `${username.toLowerCase()}|${statuses.slice().sort().join(',')}|${includeSingleEp}`;

	const cached = profileCache.get(cacheKey);
	if (!params.forceRefresh && cached && cached.expiresAt > Date.now()) {
		return cached.data;
	}

	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), 14_000);

	try {
		const res = await fetch(ANILIST_ENDPOINT, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Accept: 'application/json'
			},
			body: JSON.stringify({
				query: USER_LIST_QUERY,
				variables: { userName: username, statuses }
			}),
			signal: controller.signal
		});

		if (res.status === 429) {
			throw new Error('AniList rate limit reached. Wait a few seconds and try again.');
		}

		let json: {
			data?: {
				User?: { name: string; avatar?: { medium?: string | null } };
				MediaListCollection?: {
					lists: Array<{ status: ListStatus; entries: RawMediaListEntry[] }>;
				};
			};
			errors?: Array<{ message: string; status?: number }>;
		};

		try {
			json = await res.json();
		} catch {
			if (!res.ok) {
				throw new Error(`AniList returned HTTP ${res.status}. Try again shortly.`);
			}
			throw new Error('AniList returned an unexpected response.');
		}

		if (json.errors && json.errors.length > 0) {
			const msg = json.errors[0].message || 'AniList request failed.';
			if (/not found|private/i.test(msg)) {
				throw new Error(`AniList user "${username}" was not found or their list is private.`);
			}
			throw new Error(msg);
		}

		if (!res.ok) {
			throw new Error(`AniList request failed (HTTP ${res.status}).`);
		}

		const user = json.data?.User;
		const lists = json.data?.MediaListCollection?.lists ?? [];
		if (!user) {
			throw new Error(`AniList user "${username}" was not found.`);
		}

		const seen = new Map<number, AnimePoolItem>();
		let totalEntries = 0;

		for (const list of lists) {
			for (const entry of list.entries ?? []) {
				totalEntries++;
				const m = entry.media;
				if (!m || !m.id || !m.title?.romaji) continue;
				if (m.format === 'MUSIC') continue;

				const entryStatus = entry.status || list.status;
				const watched =
					entryStatus === 'COMPLETED' || entryStatus === 'REPEATING'
						? Math.max(entry.progress || 0, m.episodes || 0)
						: entry.progress || 0;

				// Spoiler protection: never pick shows with 0 watched episodes
				if (watched < 1) continue;

				// Exclude 1-episode movies/specials unless opted in
				if (!includeSingleEp) {
					if (m.format === 'MOVIE') continue;
					if (m.episodes !== null && m.episodes <= 1) continue;
					if (watched < 2 && entryStatus === 'COMPLETED') continue;
				}

				const franchiseTitles: string[] = [];
				for (const edge of m.relations?.edges ?? []) {
					if (
						edge.node?.type === 'ANIME' &&
						FRANCHISE_RELATIONS.has(edge.relationType)
					) {
						if (edge.node.title.romaji) franchiseTitles.push(edge.node.title.romaji);
						if (edge.node.title.english) franchiseTitles.push(edge.node.title.english);
					}
				}

				const existing = seen.get(m.id);
				if (!existing || watched > existing.progress) {
					seen.set(m.id, {
						id: m.id,
						episodes: m.episodes,
						progress: watched,
						status: entryStatus,
						format: m.format,
						seasonYear: m.seasonYear ?? m.startDate?.year ?? null,
						titleRomaji: m.title.romaji,
						titleEnglish: m.title.english,
						titleNative: m.title.native,
						synonyms: m.synonyms ?? [],
						franchiseTitles,
						genres: m.genres ?? [],
						studio: m.studios?.nodes?.[0]?.name ?? null,
						coverImage: m.coverImage?.large ?? null
					});
				}
			}
		}

		const pool = Array.from(seen.values());
		const titleSet = new Set<string>();
		for (const show of pool) {
			titleSet.add(show.titleRomaji);
			if (show.titleEnglish) titleSet.add(show.titleEnglish);
		}

		const profile: AniListProfile = {
			username: user.name,
			avatar: user.avatar?.medium ?? null,
			totalEntries,
			eligibleShows: pool.length,
			isGlobalPool: false,
			statuses,
			includeSingleEp,
			titlesForDropdown: Array.from(titleSet),
			pool
		};

		if (profileCache.size > 150) {
			const oldestKey = profileCache.keys().next().value;
			if (oldestKey) profileCache.delete(oldestKey);
		}
		profileCache.set(cacheKey, { data: profile, expiresAt: Date.now() + PROFILE_TTL_MS });

		return profile;
	} finally {
		clearTimeout(timer);
	}
}

export async function lookupAnimeYearByTitle(title: string): Promise<number | null> {
	const normQuery = normalizeTitle(title);
	if (!normQuery) return null;

	const cached = titleYearCache.get(normQuery);
	if (cached && cached.expiresAt > Date.now()) {
		return cached.data;
	}

	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), 5_000);
	try {
		const res = await fetch(ANILIST_ENDPOINT, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
			body: JSON.stringify({
				query: TITLE_YEAR_QUERY,
				variables: { search: title.trim() }
			}),
			signal: controller.signal
		});
		if (!res.ok) return null;
		const json = (await res.json()) as {
			data?: {
				Media?: {
					seasonYear?: number | null;
					startDate?: { year?: number | null };
					title?: { romaji?: string | null; english?: string | null; native?: string | null };
					synonyms?: string[] | null;
				};
			};
		};
		const media = json.data?.Media;
		if (!media) return null;

		// Verify the returned AniList entry actually corresponds to the guessed title
		const candidates = [
			media.title?.romaji,
			media.title?.english,
			media.title?.native,
			...(media.synonyms ?? [])
		]
			.filter((x): x is string => Boolean(x))
			.map(normalizeTitle);

		const matches = candidates.some(
			(c) => c === normQuery || (normQuery.length >= 4 && (c.includes(normQuery) || normQuery.includes(c)))
		);
		const year = matches ? (media.seasonYear ?? media.startDate?.year ?? null) : null;

		if (titleYearCache.size > 500) {
			const first = titleYearCache.keys().next().value;
			if (first) titleYearCache.delete(first);
		}
		titleYearCache.set(normQuery, { data: year, expiresAt: Date.now() + YEAR_TTL_MS });
		return year;
	} catch {
		return null;
	} finally {
		clearTimeout(timer);
	}
}
