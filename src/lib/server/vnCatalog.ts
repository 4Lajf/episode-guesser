import { createHash } from 'node:crypto';
import { normalizeTitle } from '$lib/scoring';
import type { VnAutocompleteEntry, VnPoolSize } from '$lib/types';
import rawCatalog from './vnCatalog.json';

export interface VnScreenItem {
	id: string;
	url: string;
	w: number;
	h: number;
	lang: string;
}

export interface VnPoolItem {
	id: string;
	title: string;
	enTitle: string | null;
	aliases: string[];
	year: number;
	released: string;
	lengthMinutes: number;
	lengthBucket: number;
	rating: number | null;
	votecount: number;
	developers: string[];
	isNvl: boolean;
	tags: string[];
	quote?: string;
	franchiseIds: string[];
	screens: VnScreenItem[];
}

export interface VnCatalogEntry {
	id: string;
	t: string;
	a?: string;
	s?: string[];
	y: number | null;
	lm: number;
	lb: number;
	d: string[];
	f?: string[];
}

interface RawVnCatalog {
	generatedAt: string;
	poolCount: number;
	autocompleteCount: number;
	pool: VnPoolItem[];
	autocomplete: VnCatalogEntry[];
}

const catalog = rawCatalog as RawVnCatalog;

export const VN_POOL: VnPoolItem[] = catalog.pool;
export const VN_CATALOG_ENTRIES: VnCatalogEntry[] = catalog.autocomplete;

const byId = new Map<string, VnCatalogEntry>();
const byNormTitle = new Map<string, VnCatalogEntry>();

for (const entry of VN_CATALOG_ENTRIES) {
	byId.set(entry.id, entry);
	const names = [entry.t, ...(entry.a ? [entry.a] : []), ...(entry.s ?? [])];
	for (const name of names) {
		const norm = normalizeTitle(name);
		if (norm && !byNormTitle.has(norm)) {
			byNormTitle.set(norm, entry);
		}
	}
}

export const VN_PUBLIC_AUTOCOMPLETE: VnAutocompleteEntry[] = VN_CATALOG_ENTRIES.map((e) => ({
	id: e.id,
	t: e.t,
	...(e.a ? { a: e.a } : {}),
	...(e.s && e.s.length > 0 ? { s: e.s } : {})
}));

export function getGlobalVnPool(size: VnPoolSize = 1000): VnPoolItem[] {
	return size === 250 ? VN_POOL.slice(0, Math.min(250, VN_POOL.length)) : VN_POOL;
}

export function lookupVnById(id: string | null | undefined): VnCatalogEntry | null {
	if (!id) return null;
	return byId.get(id) ?? null;
}

export function lookupVnByTitle(title: string): VnCatalogEntry | null {
	const norm = normalizeTitle(title);
	if (!norm) return null;
	return byNormTitle.get(norm) ?? null;
}

export function getVnFranchiseTitles(vn: VnPoolItem): string[] {
	const out: string[] = [];
	for (const fid of vn.franchiseIds) {
		const rel = byId.get(fid);
		if (rel) {
			out.push(rel.t);
			if (rel.a) out.push(rel.a);
		}
	}
	return out;
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

// Deterministic permutation over the Top 400 VNs so all 366 archive days are 100% unique!
const DAILY_DECK: VnPoolItem[] = (() => {
	const top = VN_POOL.slice(0, Math.min(400, VN_POOL.length));
	const rng = seededRandom('episode-guesser-vn-ui-deck-v2');
	const arr = top.slice();
	for (let i = arr.length - 1; i > 0; i--) {
		const j = Math.floor(rng() * (i + 1));
		[arr[i], arr[j]] = [arr[j], arr[i]];
	}
	return arr;
})();

export function pickDailyVn(dateStr: string): { vn: VnPoolItem; screen: VnScreenItem } {
	const [y, m, d] = dateStr.split('-').map(Number);
	const epochMs = Date.UTC(2025, 10, 27);
	const ts = Date.UTC(y, (m || 1) - 1, d || 1);
	const dayIndex = Math.max(0, Math.floor((ts - epochMs) / 86_400_000));
	const vn = DAILY_DECK[dayIndex % DAILY_DECK.length];
	const rng = seededRandom(`episode-guesser-vn-ui-screen:${dateStr}:${vn.id}`);
	const screen = vn.screens[Math.floor(rng() * vn.screens.length)] ?? vn.screens[0];
	return { vn, screen };
}

export function pickVnFromPool(
	pool: VnPoolItem[],
	excludeIds: string[] = []
): { vn: VnPoolItem; screen: VnScreenItem } {
	const exclude = new Set(excludeIds);
	const candidates = pool.filter((v) => !exclude.has(v.id));
	const source = candidates.length > 0 ? candidates : pool;
	const vn = source[Math.floor(Math.random() * source.length)];
	const screen = vn.screens[Math.floor(Math.random() * vn.screens.length)] ?? vn.screens[0];
	return { vn, screen };
}

export function pickPracticeVn(
	excludeIds: string[] = [],
	size: VnPoolSize = 1000
): { vn: VnPoolItem; screen: VnScreenItem } {
	return pickVnFromPool(getGlobalVnPool(size), excludeIds);
}
