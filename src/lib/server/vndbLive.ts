import { createHash } from 'node:crypto';
import type { VnAutocompleteEntry } from '$lib/types';
import type { VnCatalogEntry, VnPoolItem, VnScreenItem } from './vnCatalog';

const VNDB_BASE = 'https://api.vndb.org/kana';
const USER_CACHE_TTL_MS = 15 * 60 * 1000;
const SEARCH_CACHE_TTL_MS = 10 * 60 * 1000;
const VN_META_CACHE_TTL_MS = 60 * 60 * 1000;
const MAX_USER_PAGES = 10; // Up to 1,000 VNs per user list

export const VNDB_LABEL_OPTIONS = [
	{ id: 2, label: 'Finished' },
	{ id: 1, label: 'Playing' },
	{ id: 3, label: 'Stalled' },
	{ id: 4, label: 'Dropped' },
	{ id: 7, label: 'Voted' }
] as const;

const ALLOWED_LABEL_IDS = new Set([1, 2, 3, 4, 7]);

export function sanitizeVndbLabels(input: unknown): number[] {
	if (!Array.isArray(input)) return [2, 1];
	const clean = Array.from(
		new Set(input.map((x) => Number(x)).filter((n) => ALLOWED_LABEL_IDS.has(n)))
	);
	return clean.length > 0 ? clean : [2, 1];
}

interface CachedUserPool {
	userId: string;
	username: string;
	totalEntries: number;
	labelIds: number[];
	pool: VnPoolItem[];
	expiresAt: number;
}

interface RawVndbVn {
	id: string;
	title: string;
	alttitle?: string | null;
	aliases?: string[];
	titles?: Array<{ lang: string; title: string; main?: boolean }>;
	released?: string | null;
	length?: number | null;
	length_minutes?: number | null;
	rating?: number | null;
	votecount?: number | null;
	developers?: Array<{ name?: string | null }>;
	tags?: Array<{ name: string; rating?: number; spoiler?: number; category?: string }>;
	relations?: Array<{ id: string; relation: string; title?: string }>;
	screenshots?: Array<{
		id: string;
		url: string;
		dims?: [number, number];
		sexual?: number;
		violence?: number;
		release?: { languages?: Array<{ lang: string }> };
	}>;
}

const userPoolCache = new Map<string, CachedUserPool>();
const liveSearchCache = new Map<string, { entries: VnAutocompleteEntry[]; expiresAt: number }>();
const runtimeVnMetaCache = new Map<string, { entry: VnCatalogEntry; expiresAt: number }>();

function parseYear(released?: string | null): number | null {
	if (!released || typeof released !== 'string') return null;
	const m = released.match(/^(\d{4})/);
	if (!m) return null;
	const y = Number(m[1]);
	return y >= 1980 && y <= 2030 ? y : null;
}

function approxLengthMinutes(lengthBucket?: number | null, lengthMinutes?: number | null): number {
	if (typeof lengthMinutes === 'number' && lengthMinutes >= 15) return Math.round(lengthMinutes);
	const fallback: Record<number, number> = { 1: 90, 2: 360, 3: 1200, 4: 2400, 5: 3900 };
	return (lengthBucket && fallback[lengthBucket]) || 900;
}

function pickEnglishTitle(vn: RawVndbVn): string | null {
	const titles = Array.isArray(vn.titles) ? vn.titles : [];
	const enMain = titles.find((t) => t.lang === 'en' && t.main)?.title;
	if (enMain && enMain.toLowerCase() !== vn.title.toLowerCase()) return enMain;
	const enAny = titles.find((t) => t.lang === 'en')?.title;
	if (enAny && enAny.toLowerCase() !== vn.title.toLowerCase()) return enAny;
	return null;
}

function pickSfwScreens(vn: RawVndbVn): VnScreenItem[] {
	const raw = Array.isArray(vn.screenshots) ? vn.screenshots : [];
	const sfw = raw.filter((s) => {
		if (!s?.url || !s.url.startsWith('https://t.vndb.org/')) return false;
		const sexual = typeof s.sexual === 'number' ? s.sexual : 0;
		const violence = typeof s.violence === 'number' ? s.violence : 0;
		const w = Array.isArray(s.dims) ? s.dims[0] : 0;
		const h = Array.isArray(s.dims) ? s.dims[1] : 0;
		return sexual < 0.35 && violence < 0.5 && w >= 480 && h >= 270;
	});

	return sfw
		.map((s) => {
			const langs = (s.release?.languages || []).map((l) => l.lang);
			const hasEn = langs.includes('en');
			const w = s.dims?.[0] ?? 800;
			const h = s.dims?.[1] ?? 600;
			let score = (hasEn ? 30 : 0) + (w >= 1280 ? 20 : w >= 800 ? 10 : 0);
			if (w / Math.max(1, h) >= 1.25 && w / Math.max(1, h) <= 1.85) score += 8;
			return { id: s.id, url: s.url, w, h, lang: hasEn ? 'en' : langs[0] || 'ja', score };
		})
		.sort((a, b) => b.score - a.score)
		.slice(0, 4)
		.map(({ id, url, w, h, lang }) => ({ id, url, w, h, lang }));
}

function rawVnToCatalogEntry(vn: RawVndbVn): VnCatalogEntry {
	const year = parseYear(vn.released);
	const enTitle = pickEnglishTitle(vn);
	const lengthMinutes = approxLengthMinutes(vn.length, vn.length_minutes);
	const lengthBucket =
		typeof vn.length === 'number' && vn.length >= 1 && vn.length <= 5 ? vn.length : 3;
	const developers = Array.from(
		new Set((vn.developers || []).map((d) => d?.name?.trim()).filter((x): x is string => Boolean(x)))
	).slice(0, 3);
	const aliases = Array.from(
		new Set(
			[
				...(Array.isArray(vn.aliases) ? vn.aliases : []),
				...(Array.isArray(vn.titles)
					? vn.titles.filter((t) => t.lang === 'en' || t.lang === 'ja').map((t) => t.title)
					: [])
			]
				.map((s) => (typeof s === 'string' ? s.trim() : ''))
				.filter(
					(s) =>
						s.length >= 2 &&
						s.length <= 90 &&
						s.toLowerCase() !== vn.title.toLowerCase() &&
						(!enTitle || s.toLowerCase() !== enTitle.toLowerCase())
				)
		)
	).slice(0, 4);
	const franchiseIds = Array.from(
		new Set(
			(vn.relations || [])
				.filter(
					(r) =>
						r?.id &&
						['seq', 'preq', 'fan', 'side', 'ser', 'alt', 'orig', 'set'].includes(r.relation)
				)
				.map((r) => r.id)
		)
	);

	return {
		id: vn.id,
		t: vn.title,
		...(enTitle ? { a: enTitle } : {}),
		...(aliases.length ? { s: aliases } : {}),
		y: year,
		lm: lengthMinutes,
		lb: lengthBucket,
		d: developers,
		...(franchiseIds.length ? { f: franchiseIds } : {})
	};
}

function rawVnToPoolItem(vn: RawVndbVn): VnPoolItem | null {
	const screens = pickSfwScreens(vn);
	if (screens.length === 0) return null;
	const year = parseYear(vn.released) ?? 2010;
	const enTitle = pickEnglishTitle(vn);
	const lengthMinutes = approxLengthMinutes(vn.length, vn.length_minutes);
	const lengthBucket =
		typeof vn.length === 'number' && vn.length >= 1 && vn.length <= 5 ? vn.length : 3;
	const developers = Array.from(
		new Set((vn.developers || []).map((d) => d?.name?.trim()).filter((x): x is string => Boolean(x)))
	).slice(0, 3);
	const aliases = Array.from(
		new Set(
			[
				...(Array.isArray(vn.aliases) ? vn.aliases : []),
				...(Array.isArray(vn.titles)
					? vn.titles.filter((t) => t.lang === 'en' || t.lang === 'ja').map((t) => t.title)
					: [])
			]
				.map((s) => (typeof s === 'string' ? s.trim() : ''))
				.filter(
					(s) =>
						s.length >= 2 &&
						s.length <= 90 &&
						s.toLowerCase() !== vn.title.toLowerCase() &&
						(!enTitle || s.toLowerCase() !== enTitle.toLowerCase())
				)
		)
	).slice(0, 4);

	const tags = Array.isArray(vn.tags) ? vn.tags : [];
	const isNvl = tags.some((t) => t.name === 'NVL' && (t.rating ?? 0) >= 1.5);
	const nonSpoilerTags = tags
		.filter(
			(t) =>
				t.spoiler === 0 &&
				(t.category === 'cont' || t.category === 'tech') &&
				(t.rating ?? 0) >= 2.0 &&
				!/protagonist|heroine|hero|19\d0s|20\d0s/i.test(t.name)
		)
		.sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0))
		.slice(0, 4)
		.map((t) => t.name);

	const franchiseIds = Array.from(
		new Set(
			(vn.relations || [])
				.filter(
					(r) =>
						r?.id &&
						['seq', 'preq', 'fan', 'side', 'ser', 'alt', 'orig', 'set'].includes(r.relation)
				)
				.map((r) => r.id)
		)
	);

	return {
		id: vn.id,
		title: vn.title,
		enTitle,
		aliases,
		year,
		released: vn.released || String(year),
		lengthMinutes,
		lengthBucket,
		rating: typeof vn.rating === 'number' ? Number((vn.rating / 10).toFixed(2)) : null,
		votecount: vn.votecount ?? 0,
		developers: developers.length > 0 ? developers : ['Unknown'],
		isNvl,
		tags: nonSpoilerTags,
		franchiseIds,
		screens
	};
}

function cacheRuntimeVn(entry: VnCatalogEntry): void {
	if (runtimeVnMetaCache.size > 4000) {
		const oldest = runtimeVnMetaCache.keys().next().value;
		if (oldest) runtimeVnMetaCache.delete(oldest);
	}
	runtimeVnMetaCache.set(entry.id, { entry, expiresAt: Date.now() + VN_META_CACHE_TTL_MS });
}

export function getCachedRuntimeVn(id: string): VnCatalogEntry | null {
	const hit = runtimeVnMetaCache.get(id);
	if (!hit || hit.expiresAt < Date.now()) return null;
	return hit.entry;
}

async function vndbHeaders(token?: string): Promise<Record<string, string>> {
	const h: Record<string, string> = {
		'Content-Type': 'application/json',
		'User-Agent': 'episode-guesser.karczma.moe/2.0'
	};
	const cleanTok = token?.trim();
	if (cleanTok) {
		h.Authorization = `token ${cleanTok}`;
	}
	return h;
}

export async function resolveVndbUser(
	usernameOrId: string,
	token?: string
): Promise<{ userId: string; username: string }> {
	const clean = usernameOrId.trim();
	const headers = await vndbHeaders(token);

	if (!clean && token?.trim()) {
		const res = await fetch(`${VNDB_BASE}/authinfo`, { headers });
		if (!res.ok) throw new Error('Invalid VNDB API token.');
		const info = (await res.json()) as { id?: string; username?: string };
		if (!info.id || !info.username) throw new Error('Could not resolve VNDB user from token.');
		return { userId: info.id, username: info.username };
	}

	if (!clean) {
		throw new Error('Enter a VNDB username or user ID (e.g. u2).');
	}

	const res = await fetch(`${VNDB_BASE}/user?q=${encodeURIComponent(clean)}`, { headers });
	if (!res.ok) {
		throw new Error('VNDB user lookup failed. Please try again in a moment.');
	}
	const data = (await res.json()) as Record<string, { id: string; username: string } | null>;
	const match = data[clean] ?? Object.values(data).find((v) => v && v.id);
	if (!match) {
		throw new Error(`VNDB user "${clean}" was not found.`);
	}
	return { userId: match.id, username: match.username };
}

export async function fetchVndbUserPool(params: {
	usernameOrId: string;
	labelIds?: number[];
	token?: string;
}): Promise<{
	userId: string;
	username: string;
	totalEntries: number;
	labelIds: number[];
	pool: VnPoolItem[];
}> {
	const labelIds = sanitizeVndbLabels(params.labelIds);
	const resolved = await resolveVndbUser(params.usernameOrId, params.token);

	const tokHash = params.token?.trim()
		? createHash('sha256').update(params.token.trim()).digest('hex').slice(0, 12)
		: 'pub';
	const cacheKey = `${resolved.userId}|${labelIds.slice().sort().join(',')}|${tokHash}`;

	const cached = userPoolCache.get(cacheKey);
	if (cached && cached.expiresAt > Date.now()) {
		return {
			userId: cached.userId,
			username: cached.username,
			totalEntries: cached.totalEntries,
			labelIds: cached.labelIds,
			pool: cached.pool
		};
	}

	const headers = await vndbHeaders(params.token);
	const labelFilter =
		labelIds.length === 1
			? ['label', '=', labelIds[0]]
			: ['or', ...labelIds.map((id) => ['label', '=', id])];

	const pool: VnPoolItem[] = [];
	const seenIds = new Set<string>();
	let totalEntries = 0;

	for (let page = 1; page <= MAX_USER_PAGES; page++) {
		const res = await fetch(`${VNDB_BASE}/ulist`, {
			method: 'POST',
			headers,
			body: JSON.stringify({
				user: resolved.userId,
				filters: labelFilter,
				fields:
					'id, labels{id}, vn{id, title, alttitle, aliases, titles{lang,title,main}, released, length, length_minutes, rating, votecount, developers{name}, tags{name,rating,spoiler,category}, relations{id,relation,title}, screenshots{id,url,dims,sexual,violence,release{languages{lang}}}}',
				sort: 'vote',
				reverse: true,
				results: 100,
				page
			})
		});

		if (res.status === 404 || res.status === 403) {
			throw new Error(
				`Could not read ${resolved.username}'s VNDB list. Make sure the list is public or provide a read-only VNDB token.`
			);
		}
		if (res.status === 429) {
			throw new Error('VNDB rate limit reached briefly — wait a few seconds and try again.');
		}
		if (!res.ok) {
			throw new Error(`VNDB list fetch failed (${res.status}).`);
		}

		const data = (await res.json()) as {
			more?: boolean;
			results?: Array<{ id: string; vn?: RawVndbVn }>;
		};
		const rows = data.results || [];
		totalEntries += rows.length;

		for (const row of rows) {
			const rawVn = row.vn;
			if (!rawVn || !rawVn.id || seenIds.has(rawVn.id)) continue;
			seenIds.add(rawVn.id);
			cacheRuntimeVn(rawVnToCatalogEntry(rawVn));
			const item = rawVnToPoolItem(rawVn);
			if (item) pool.push(item);
		}

		if (!data.more) break;
	}

	if (pool.length === 0) {
		throw new Error(
			totalEntries === 0
				? `${resolved.username} has no public VNs matching the selected labels (${labelIds.join(', ')}).`
				: `Found ${totalEntries} VNs on ${resolved.username}'s list, but none have SFW screenshots on VNDB.`
		);
	}

	if (userPoolCache.size > 150) {
		const first = userPoolCache.keys().next().value;
		if (first) userPoolCache.delete(first);
	}
	userPoolCache.set(cacheKey, {
		userId: resolved.userId,
		username: resolved.username,
		totalEntries,
		labelIds,
		pool,
		expiresAt: Date.now() + USER_CACHE_TTL_MS
	});

	return {
		userId: resolved.userId,
		username: resolved.username,
		totalEntries,
		labelIds,
		pool
	};
}

export async function searchVndbLive(query: string): Promise<VnAutocompleteEntry[]> {
	const clean = query.trim();
	if (clean.length < 2) return [];
	const key = clean.toLowerCase();
	const cached = liveSearchCache.get(key);
	if (cached && cached.expiresAt > Date.now()) return cached.entries;

	try {
		const res = await fetch(`${VNDB_BASE}/vn`, {
			method: 'POST',
			headers: await vndbHeaders(),
			body: JSON.stringify({
				filters: ['search', '=', clean],
				fields:
					'id, title, alttitle, aliases, titles{lang,title,main}, released, length, length_minutes, developers{name}, relations{id,relation}',
				sort: 'votecount',
				reverse: true,
				results: 15
			})
		});
		if (!res.ok) return [];
		const data = (await res.json()) as { results?: RawVndbVn[] };
		const entries: VnAutocompleteEntry[] = [];
		for (const raw of data.results || []) {
			if (!raw?.id || !raw.title) continue;
			const cat = rawVnToCatalogEntry(raw);
			cacheRuntimeVn(cat);
			entries.push({
				id: cat.id,
				t: cat.t,
				...(cat.a ? { a: cat.a } : {}),
				...(cat.s ? { s: cat.s } : {})
			});
		}
		if (liveSearchCache.size > 500) {
			const oldest = liveSearchCache.keys().next().value;
			if (oldest) liveSearchCache.delete(oldest);
		}
		liveSearchCache.set(key, { entries, expiresAt: Date.now() + SEARCH_CACHE_TTL_MS });
		return entries;
	} catch {
		return [];
	}
}

export async function lookupVnByIdLive(vnId: string): Promise<VnCatalogEntry | null> {
	if (!/^v\d+$/.test(vnId)) return null;
	const cached = getCachedRuntimeVn(vnId);
	if (cached) return cached;

	try {
		const res = await fetch(`${VNDB_BASE}/vn`, {
			method: 'POST',
			headers: await vndbHeaders(),
			body: JSON.stringify({
				filters: ['id', '=', vnId],
				fields:
					'id, title, alttitle, aliases, titles{lang,title,main}, released, length, length_minutes, developers{name}, relations{id,relation}',
				results: 1
			})
		});
		if (!res.ok) return null;
		const data = (await res.json()) as { results?: RawVndbVn[] };
		const raw = data.results?.[0];
		if (!raw) return null;
		const cat = rawVnToCatalogEntry(raw);
		cacheRuntimeVn(cat);
		return cat;
	} catch {
		return null;
	}
}
