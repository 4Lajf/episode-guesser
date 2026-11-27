import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { CURATED_GLOBAL_POOL } from '$lib/curated';
import { normalizeTitle } from '$lib/scoring';
import type { AutocompleteEntry } from '$lib/types';
import { getCachedAnisongDbTitles } from './anisongdb';

export type { AutocompleteEntry };

const OFFLINE_DB_URL =
	'https://github.com/manami-project/anime-offline-database/releases/latest/download/anime-offline-database-minified.json';
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const FAILURE_BACKOFF_MS = 10 * 60 * 1000; // 10 minutes
const CACHE_FILE = join(process.cwd(), '.cache', 'anime-catalog-v3.json');

const ANILIST_URL_RE = /^https?:\/\/anilist\.co\/anime\/(\d+)/i;
const LATIN_TITLE_RE = /^[\u0020-\u007E\u00A0-\u024F\u2018-\u201F\u00D7\u2606\u3010\u3011√]+$/;

// Filter out commercials, PVs, summaries, recaps, shorts, music videos, and foreign-language
// non-English/non-Romaji synonyms so the dropdown stays crisp and duplicate-free.
const JUNK_TITLE_RE =
	/\b(cm|cms|pv|pvs|preview|recap|summary|digest|shorts?|mini anime|pilot|picture drama|manner movie|commercial|promo|specials?|episode \d+|music video)\b/i;

const FOREIGN_SYNONYM_RE =
	/(?:\b(?:der|die|das|und|mit|für|ein|eine|pel[ií]cula|teoria|caos|temporada|epis[oó]dio|storia|stagione|guerrieri|chasseur|chevalier|monde|l['’]attaque|l['’]attacco|les|des|aux|une|del|los|las|para|com|por|czy|jest|oraz|jak|wśród)\b|[äöüßçñãõ])/i;

interface RawOfflineEntry {
	sources?: string[];
	title?: string;
	type?: string;
	episodes?: number;
	status?: string;
	animeSeason?: { year?: number | null };
	synonyms?: string[];
	relatedAnime?: string[];
	tags?: string[];
}

export interface CatalogMatch {
	id: number;
	year: number | null;
	relatedIds: number[];
}

// Compact disk-serialized lookup tuple: [anilistId, year, relatedIds, normalizedAliases]
type CompactCatalogRow = [number, number | null, number[], string[]];

interface PersistedCatalog {
	v: 3;
	fetchedAt: number;
	entries: AutocompleteEntry[];
	rows: CompactCatalogRow[];
}

let catalog: PersistedCatalog | null = null;
let lookupMap: Map<string, CatalogMatch> | null = null;
let inflight: Promise<PersistedCatalog | null> | null = null;
let lastFailedAt = 0;

function extractAnilistId(url: string): number | null {
	const m = url.match(ANILIST_URL_RE);
	return m ? Number(m[1]) : null;
}

function buildLookupMap(rows: CompactCatalogRow[]): Map<string, CatalogMatch> {
	const map = new Map<string, CatalogMatch>();
	for (const [id, year, relatedIds, aliases] of rows) {
		const entry: CatalogMatch = { id, year, relatedIds };
		for (const norm of aliases) {
			if (norm && !map.has(norm)) {
				map.set(norm, entry);
			}
		}
	}
	return map;
}

function readDiskCatalog(): PersistedCatalog | null {
	if (process.env.VITEST) return null;
	try {
		if (!existsSync(CACHE_FILE)) return null;
		const parsed = JSON.parse(readFileSync(CACHE_FILE, 'utf8')) as PersistedCatalog;
		if (
			parsed?.v === 3 &&
			Array.isArray(parsed.entries) &&
			parsed.entries.length > 0 &&
			Array.isArray(parsed.rows) &&
			typeof parsed.fetchedAt === 'number'
		) {
			return parsed;
		}
	} catch {
		// ignore corrupt disk cache
	}
	return null;
}

async function writeDiskCatalog(entry: PersistedCatalog): Promise<void> {
	if (process.env.VITEST) return;
	try {
		await mkdir(dirname(CACHE_FILE), { recursive: true });
		const tmp = `${CACHE_FILE}.${process.pid}.tmp`;
		await writeFile(tmp, JSON.stringify(entry), 'utf8');
		await rename(tmp, CACHE_FILE);
	} catch {
		try {
			mkdirSync(dirname(CACHE_FILE), { recursive: true });
			const tmp = `${CACHE_FILE}.${process.pid}.tmp`;
			writeFileSync(tmp, JSON.stringify(entry), 'utf8');
			renameSync(tmp, CACHE_FILE);
		} catch {
			// non-fatal
		}
	}
}

function isCleanSearchAlias(syn: string, primaryNorm: string): boolean {
	if (syn.length < 3 || syn.length > 85) return false;
	if (!LATIN_TITLE_RE.test(syn)) return false;
	if (JUNK_TITLE_RE.test(syn)) return false;
	if (FOREIGN_SYNONYM_RE.test(syn)) return false;
	// Reject noisy single lowercase words like "violet"
	if (syn === syn.toLowerCase() && !syn.includes(' ') && syn.length < 10) return false;
	const norm = normalizeTitle(syn);
	if (!norm || norm === primaryNorm) return false;
	return true;
}

function distillOfflineDatabase(rawEntries: RawOfflineEntry[]): PersistedCatalog {
	const entryByAnilistId = new Map<number, AutocompleteEntry>();
	const seenDropdownKeys = new Set<string>();
	const rows: CompactCatalogRow[] = [];

	// Seed curated global pool canonical romaji + English titles first so major shows always
	// have clean canonical titles and accurate episode counts
	const curatedById = new Map(CURATED_GLOBAL_POOL.map((item) => [item.id, item]));

	for (const entry of rawEntries) {
		if (!entry || entry.status === 'UPCOMING') continue;
		const sources = entry.sources ?? [];
		let alId: number | null = null;
		for (const src of sources) {
			const parsed = extractAnilistId(src);
			if (parsed) {
				alId = parsed;
				break;
			}
		}
		if (!alId) continue;

		const year =
			typeof entry.animeSeason?.year === 'number' && entry.animeSeason.year > 1900
				? entry.animeSeason.year
				: null;

		const relatedSet = new Set<number>();
		for (const rel of entry.relatedAnime ?? []) {
			const relId = extractAnilistId(rel);
			if (relId && relId !== alId) relatedSet.add(relId);
		}

		const curated = curatedById.get(alId);
		const primary = (curated?.titleRomaji || entry.title || '').trim();
		const normPrimary = normalizeTitle(primary);

		const normAliases = new Set<string>();
		if (normPrimary) normAliases.add(normPrimary);
		if (curated?.titleEnglish) {
			const n = normalizeTitle(curated.titleEnglish);
			if (n) normAliases.add(n);
		}
		for (const rawSyn of entry.synonyms ?? []) {
			const syn = rawSyn?.trim();
			if (!syn || syn.length < 2 || syn.length > 90) continue;
			const n = normalizeTitle(syn);
			if (n) normAliases.add(n);
		}

		if (normAliases.size > 0) {
			rows.push([alId, year, Array.from(relatedSet).slice(0, 12), Array.from(normAliases)]);
		}

		// Decide whether this AniList entry belongs in the playable dropdown (one row per show!)
		const tags = new Set((entry.tags ?? []).map((t) => t.toLowerCase()));
		const isMusicOrAd =
			tags.has('advertisement') ||
			tags.has('commercial') ||
			(tags.has('music') && entry.type !== 'TV' && entry.type !== 'MOVIE');
		const isDropdownType =
			entry.type === 'TV' ||
			entry.type === 'MOVIE' ||
			entry.type === 'ONA' ||
			(entry.type === 'OVA' && (entry.episodes ?? 0) >= 2);

		if (
			!curated &&
			(!isDropdownType ||
				isMusicOrAd ||
				!primary ||
				JUNK_TITLE_RE.test(primary) ||
				(primary === primary.toLowerCase() && /[a-z]/.test(primary)))
		) {
			continue;
		}

		if (!primary || entryByAnilistId.has(alId)) continue;
		// Preserve distinct year-disambiguated remakes (e.g. "Hunter x Hunter" vs "Hunter x Hunter (2011)")
		const dk = primary.toLowerCase().replace(/\s+/g, ' ').trim();
		if (!dk || seenDropdownKeys.has(dk)) continue;
		seenDropdownKeys.add(dk);

		// Collect up to 6 clean Latin search aliases (English titles + nicknames) uniformly across
		// ALL shows so searching English titles works everywhere without leaking pool membership.
		const extraSearchAliases: string[] = [];
		const seenAliasNorm = new Set<string>([normPrimary]);
		const rawCandidates: string[] = [];
		if (curated?.titleEnglish) rawCandidates.push(curated.titleEnglish);
		if (curated?.synonyms) rawCandidates.push(...curated.synonyms);
		if (entry.synonyms) rawCandidates.push(...entry.synonyms);

		for (const rawSyn of rawCandidates) {
			const syn = rawSyn?.trim();
			if (!syn || !isCleanSearchAlias(syn, normPrimary)) continue;
			const n = normalizeTitle(syn);
			if (!n || seenAliasNorm.has(n)) continue;
			seenAliasNorm.add(n);
			extraSearchAliases.push(syn);
			if (extraSearchAliases.length >= 6) break;
		}

		const epCount =
			curated?.episodes ??
			(typeof entry.episodes === 'number' && entry.episodes > 0 ? entry.episodes : undefined);

		entryByAnilistId.set(alId, {
			t: primary,
			...(epCount ? { ep: epCount } : {}),
			...(extraSearchAliases.length > 0 ? { s: extraSearchAliases } : {})
		});
	}

	// Ensure every curated show exists even if offline DB omitted it
	for (const item of CURATED_GLOBAL_POOL) {
		if (entryByAnilistId.has(item.id)) continue;
		const normPrimary = normalizeTitle(item.titleRomaji);
		const aliases: string[] = [];
		if (item.titleEnglish && normalizeTitle(item.titleEnglish) !== normPrimary) {
			aliases.push(item.titleEnglish);
		}
		entryByAnilistId.set(item.id, {
			t: item.titleRomaji,
			...(item.episodes ? { ep: item.episodes } : {}),
			...(aliases.length > 0 ? { s: aliases } : {})
		});
	}

	const entries = Array.from(entryByAnilistId.values()).sort((a, b) =>
		a.t.localeCompare(b.t, 'en', { sensitivity: 'base' })
	);

	return {
		v: 3,
		fetchedAt: Date.now(),
		entries,
		rows
	};
}

async function fetchOfflineDatabase(): Promise<PersistedCatalog> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), 30_000);
	try {
		const res = await fetch(OFFLINE_DB_URL, {
			headers: {
				Accept: 'application/json',
				'User-Agent': 'episode-guesser.karczma.moe/1.0'
			},
			signal: controller.signal
		});
		if (!res.ok) throw new Error(`anime-offline-database HTTP ${res.status}`);
		const json = (await res.json()) as { data?: RawOfflineEntry[] };
		if (!Array.isArray(json?.data)) throw new Error('Invalid anime-offline-database payload');
		const distilled = distillOfflineDatabase(json.data);
		catalog = distilled;
		lookupMap = buildLookupMap(distilled.rows);
		void writeDiskCatalog(distilled);
		return distilled;
	} finally {
		clearTimeout(timer);
	}
}

function hydrateMemoryIfNeeded(): void {
	if (catalog) return;
	const disk = readDiskCatalog();
	if (disk) {
		catalog = disk;
		lookupMap = buildLookupMap(disk.rows);
	}
}

function triggerBackgroundRefresh(): void {
	if (process.env.VITEST || inflight) return;
	const now = Date.now();
	if (!catalog && lastFailedAt > 0 && now - lastFailedAt < FAILURE_BACKOFF_MS) return;

	inflight = fetchOfflineDatabase()
		.then((res) => {
			lastFailedAt = 0;
			return res;
		})
		.catch(() => {
			lastFailedAt = Date.now();
			return catalog;
		})
		.finally(() => {
			inflight = null;
		});
}

/**
 * Returns one deduplicated autocomplete entry per anime (canonical title + optional English alias
 * + episode count + clean nicknames). Strictly global — never leaks user list membership.
 */
export async function getGlobalAutocompleteCatalog(): Promise<{
	entries: AutocompleteEntry[];
	titles: string[];
	cachedAt: number;
}> {
	hydrateMemoryIfNeeded();
	const now = Date.now();

	if (!catalog) {
		triggerBackgroundRefresh();
		if (inflight) {
			await Promise.race([inflight, new Promise((r) => setTimeout(r, 8_000))]);
		}
	} else if (now - catalog.fetchedAt >= CACHE_TTL_MS) {
		triggerBackgroundRefresh();
	}

	if (catalog && catalog.entries.length > 0) {
		return {
			entries: catalog.entries,
			titles: catalog.entries.map((e) => e.t),
			cachedAt: catalog.fetchedAt
		};
	}

	// Cold fallback to AnisongDB + curated pool if GitHub Releases is temporarily unreachable
	const anisong = await getCachedAnisongDbTitles();
	const byKey = new Map<string, AutocompleteEntry>();

	for (const item of CURATED_GLOBAL_POOL) {
		const k = item.titleRomaji.toLowerCase().replace(/\s+/g, ' ').trim();
		if (!k || byKey.has(k)) continue;
		const aliases: string[] = [];
		if (
			item.titleEnglish &&
			normalizeTitle(item.titleEnglish) !== normalizeTitle(item.titleRomaji)
		) {
			aliases.push(item.titleEnglish);
		}
		byKey.set(k, {
			t: item.titleRomaji,
			...(item.episodes ? { ep: item.episodes } : {}),
			...(aliases.length > 0 ? { s: aliases } : {})
		});
	}

	for (const raw of anisong.titles) {
		if (JUNK_TITLE_RE.test(raw)) continue;
		const k = raw.toLowerCase().replace(/\s+/g, ' ').trim();
		if (k && !byKey.has(k)) byKey.set(k, { t: raw });
	}

	const entries = Array.from(byKey.values()).sort((a, b) =>
		a.t.localeCompare(b.t, 'en', { sensitivity: 'base' })
	);

	return {
		entries,
		titles: entries.map((e) => e.t),
		cachedAt: anisong.cachedAt
	};
}

export function lookupCatalogByTitle(rawTitle: string): CatalogMatch | null {
	hydrateMemoryIfNeeded();
	if (!catalog && !inflight) {
		triggerBackgroundRefresh();
	}
	if (!lookupMap) return null;
	const norm = normalizeTitle(rawTitle);
	if (!norm) return null;
	return lookupMap.get(norm) ?? null;
}

export function getCatalogTitleCount(): number {
	hydrateMemoryIfNeeded();
	return catalog?.entries.length ?? 0;
}
