import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { CURATED_GLOBAL_POOL } from '$lib/curated';
import { dropdownDedupeKey, normalizeTitle } from '$lib/scoring';
import { getCachedAnisongDbTitles } from './anisongdb';

const OFFLINE_DB_URL =
	'https://github.com/manami-project/anime-offline-database/releases/latest/download/anime-offline-database-minified.json';
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days (offline DB updates weekly)
const FAILURE_BACKOFF_MS = 10 * 60 * 1000; // 10 minutes
const CACHE_FILE = join(process.cwd(), '.cache', 'anime-catalog.json');

const ANILIST_URL_RE = /^https?:\/\/anilist\.co\/anime\/(\d+)/i;
const LATIN_TITLE_RE = /^[\u0020-\u007E\u00A0-\u024F\u2018-\u201F\u00D7\u2606\u3010\u3011]+$/;

interface RawOfflineEntry {
	sources?: string[];
	title?: string;
	type?: string;
	status?: string;
	animeSeason?: { year?: number | null };
	synonyms?: string[];
	relatedAnime?: string[];
}

export interface CatalogMatch {
	id: number;
	year: number | null;
	relatedIds: number[];
}

// Compact disk-serialized tuple: [anilistId, year, relatedIds, normalizedAliases]
type CompactCatalogRow = [number, number | null, number[], string[]];

interface PersistedCatalog {
	v: 1;
	fetchedAt: number;
	dropdownTitles: string[];
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
			parsed?.v === 1 &&
			Array.isArray(parsed.dropdownTitles) &&
			parsed.dropdownTitles.length > 0 &&
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

function distillOfflineDatabase(rawEntries: RawOfflineEntry[]): PersistedCatalog {
	const dropdownByKey = new Map<string, string>();
	const rows: CompactCatalogRow[] = [];

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

		const normAliases = new Set<string>();
		const primary = entry.title?.trim() ?? '';
		const isPlayableType =
			entry.type === 'TV' ||
			entry.type === 'MOVIE' ||
			entry.type === 'OVA' ||
			entry.type === 'ONA' ||
			entry.type === 'SPECIAL';

		if (primary) {
			const normPrimary = normalizeTitle(primary);
			if (normPrimary) normAliases.add(normPrimary);
			if (isPlayableType) {
				const dk = dropdownDedupeKey(primary);
				if (dk && !dropdownByKey.has(dk)) dropdownByKey.set(dk, primary);
			}
		}

		let addedDropdownSynonyms = 0;
		for (const rawSyn of entry.synonyms ?? []) {
			const syn = rawSyn?.trim();
			if (!syn || syn.length < 2 || syn.length > 90) continue;
			const normSyn = normalizeTitle(syn);
			if (!normSyn) continue;
			normAliases.add(normSyn);

			// Add clean Latin/English synonyms (e.g. "Attack on Titan", "Demon Slayer: Kimetsu no Yaiba")
			// to the global dropdown so English search works equally for every player without pool leakage.
			if (
				isPlayableType &&
				addedDropdownSynonyms < 2 &&
				syn.length >= 4 &&
				LATIN_TITLE_RE.test(syn) &&
				!/^[A-Z0-9]{2,5}$/.test(syn)
			) {
				const dk = dropdownDedupeKey(syn);
				if (dk && !dropdownByKey.has(dk)) {
					dropdownByKey.set(dk, syn);
					addedDropdownSynonyms++;
				}
			}
		}

		if (normAliases.size > 0) {
			rows.push([alId, year, Array.from(relatedSet).slice(0, 12), Array.from(normAliases)]);
		}
	}

	const dropdownTitles = Array.from(dropdownByKey.values()).sort((a, b) =>
		a.localeCompare(b, 'en', { sensitivity: 'base' })
	);

	return {
		v: 1,
		fetchedAt: Date.now(),
		dropdownTitles,
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
 * Returns the unified global autocomplete title list (anime-offline-database Romaji + English
 * merged with AnisongDB). Identical for every player — never includes user-list-only titles.
 */
export async function getGlobalAutocompleteTitles(): Promise<{ titles: string[]; cachedAt: number }> {
	hydrateMemoryIfNeeded();
	const now = Date.now();

	if (!catalog) {
		triggerBackgroundRefresh();
		// On cold boot, wait up to 8s for offline DB so the first request gets full English + Romaji
		if (inflight) {
			await Promise.race([inflight, new Promise((r) => setTimeout(r, 8_000))]);
		}
	} else if (now - catalog.fetchedAt >= CACHE_TTL_MS) {
		triggerBackgroundRefresh();
	}

	const anisong = await getCachedAnisongDbTitles();

	const byKey = new Map<string, string>();
	if (catalog) {
		for (const t of catalog.dropdownTitles) {
			const k = dropdownDedupeKey(t);
			if (k && !byKey.has(k)) byKey.set(k, t);
		}
	}
	for (const t of anisong.titles) {
		const k = dropdownDedupeKey(t);
		if (k && !byKey.has(k)) byKey.set(k, t);
	}
	// Always ensure curated global pool titles are included globally for all players
	for (const item of CURATED_GLOBAL_POOL) {
		for (const t of [item.titleRomaji, item.titleEnglish]) {
			if (!t) continue;
			const k = dropdownDedupeKey(t);
			if (k && !byKey.has(k)) byKey.set(k, t);
		}
	}

	const titles = Array.from(byKey.values()).sort((a, b) =>
		a.localeCompare(b, 'en', { sensitivity: 'base' })
	);

	const cachedAt = catalog ? catalog.fetchedAt : anisong.cachedAt;
	return { titles, cachedAt };
}

/**
 * Instant, zero-quota lookup of an anime's AniList ID, release year, and related franchise IDs
 * from the in-memory anime-offline-database index.
 */
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
	return catalog?.dropdownTitles.length ?? 0;
}
