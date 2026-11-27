import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CURATED_GLOBAL_POOL } from '$lib/curated';

const ANISONGDB_URL = 'https://anisongdb.com/api/anime_name_autocomplete';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const FAILURE_BACKOFF_MS = 5 * 60 * 1000; // 5 minutes negative cache on cold outage
const CACHE_FILE = join(process.cwd(), '.cache', 'anisongdb-titles.json');

interface TitleCache {
	titles: string[];
	fetchedAt: number;
}

let memoryCache: TitleCache | null = null;
let inflight: Promise<string[]> | null = null;
let lastFailedAt = 0;

function dedupeAndSort(raw: unknown[]): string[] {
	const set = new Set<string>();
	for (const item of raw) {
		if (typeof item === 'string') {
			const trimmed = item.trim();
			if (trimmed) set.add(trimmed);
		}
	}
	return Array.from(set).sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }));
}

function readDiskCache(): TitleCache | null {
	try {
		if (!existsSync(CACHE_FILE)) return null;
		const parsed = JSON.parse(readFileSync(CACHE_FILE, 'utf8')) as TitleCache;
		if (Array.isArray(parsed?.titles) && parsed.titles.length > 0 && typeof parsed.fetchedAt === 'number') {
			return parsed;
		}
	} catch {
		// ignore corrupt disk cache
	}
	return null;
}

function writeDiskCache(entry: TitleCache): void {
	try {
		mkdirSync(join(process.cwd(), '.cache'), { recursive: true });
		writeFileSync(CACHE_FILE, JSON.stringify(entry), 'utf8');
	} catch {
		// non-fatal
	}
}

async function fetchFromUpstream(): Promise<string[]> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), 12_000);
	try {
		const res = await fetch(ANISONGDB_URL, {
			headers: {
				Accept: 'application/json',
				'User-Agent': 'episode-guesser.karczma.moe/1.0'
			},
			signal: controller.signal
		});
		if (!res.ok) throw new Error(`AnisongDB HTTP ${res.status}`);
		const json = (await res.json()) as unknown;
		if (!Array.isArray(json)) throw new Error('AnisongDB returned non-array payload');
		const titles = dedupeAndSort(json);
		const entry: TitleCache = { titles, fetchedAt: Date.now() };
		memoryCache = entry;
		writeDiskCache(entry);
		return titles;
	} finally {
		clearTimeout(timer);
	}
}

function getFallbackTitles(): string[] {
	const fallback = new Set<string>();
	for (const item of CURATED_GLOBAL_POOL) {
		fallback.add(item.titleRomaji);
		if (item.titleEnglish) fallback.add(item.titleEnglish);
	}
	return Array.from(fallback).sort((a, b) => a.localeCompare(b));
}

export async function getCachedAnisongDbTitles(): Promise<{ titles: string[]; cachedAt: number }> {
	const now = Date.now();

	if (!memoryCache) {
		const disk = readDiskCache();
		if (disk) memoryCache = disk;
	}

	if (memoryCache && now - memoryCache.fetchedAt < CACHE_TTL_MS) {
		return { titles: memoryCache.titles, cachedAt: memoryCache.fetchedAt };
	}

	// Stale-while-revalidate if we already have stale data
	if (memoryCache && memoryCache.titles.length > 0) {
		if (!inflight) {
			inflight = fetchFromUpstream()
				.catch(() => memoryCache!.titles)
				.finally(() => {
					inflight = null;
				});
		}
		return { titles: memoryCache.titles, cachedAt: memoryCache.fetchedAt };
	}

	if (!memoryCache && lastFailedAt > 0 && now - lastFailedAt < FAILURE_BACKOFF_MS) {
		return { titles: getFallbackTitles(), cachedAt: 0 };
	}

	if (!inflight) {
		inflight = fetchFromUpstream().finally(() => {
			inflight = null;
		});
	}

	try {
		const titles = await inflight;
		lastFailedAt = 0;
		return { titles, cachedAt: memoryCache?.fetchedAt ?? Date.now() };
	} catch {
		lastFailedAt = Date.now();
		const titles = getFallbackTitles();
		return { titles, cachedAt: 0 };
	}
}

export function getAnisongDbCacheCount(): number {
	if (!memoryCache) {
		const disk = readDiskCache();
		if (disk) memoryCache = disk;
	}
	return memoryCache?.titles.length ?? 0;
}
