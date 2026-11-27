import { gzipSync } from 'node:zlib';
import { json } from '@sveltejs/kit';
import { getGlobalAutocompleteCatalog } from '$lib/server/animeCatalog';
import type { RequestHandler } from './$types';

let cachedGzipKey = '';
let cachedGzipPayload: Uint8Array | null = null;

export const GET: RequestHandler = async ({ url, request, setHeaders }) => {
	const { entries, titles, cachedAt } = await getGlobalAutocompleteCatalog();
	const q = url.searchParams.get('q')?.trim().toLowerCase() ?? '';
	const limitParam = Number(url.searchParams.get('limit') ?? '25');
	const limit = Number.isFinite(limitParam) ? Math.min(Math.max(1, limitParam), 100) : 25;

	const cacheControl =
		cachedAt > 0 ? 'public, max-age=3600, stale-while-revalidate=86400' : 'no-store';

	if (q) {
		setHeaders({ 'cache-control': cacheControl });
		const startsWith: string[] = [];
		const contains: string[] = [];
		for (const entry of entries) {
			const lowerT = entry.t.toLowerCase();
			const lowerA = entry.a?.toLowerCase() ?? '';
			if (lowerT.startsWith(q) || (lowerA && lowerA.startsWith(q))) {
				startsWith.push(entry.t);
			} else if (lowerT.includes(q) || (lowerA && lowerA.includes(q))) {
				contains.push(entry.t);
			}
			if (startsWith.length >= limit) break;
		}
		const matches = [...startsWith, ...contains].slice(0, limit);
		return json({ titles: matches, total: entries.length, cachedAt });
	}

	const acceptEnc = request.headers.get('accept-encoding') ?? '';
	if (acceptEnc.includes('gzip')) {
		const cacheSig = `${cachedAt}:${entries.length}`;
		if (!cachedGzipPayload || cachedGzipKey !== cacheSig) {
			cachedGzipPayload = new Uint8Array(
				gzipSync(Buffer.from(JSON.stringify({ entries, titles, total: entries.length, cachedAt }), 'utf8'))
			);
			cachedGzipKey = cacheSig;
		}
		return new Response(new Uint8Array(cachedGzipPayload), {
			status: 200,
			headers: {
				'content-type': 'application/json; charset=utf-8',
				'content-encoding': 'gzip',
				vary: 'Accept-Encoding',
				'cache-control': cacheControl
			}
		});
	}

	setHeaders({ 'cache-control': cacheControl, vary: 'Accept-Encoding' });
	return json({ entries, titles, total: entries.length, cachedAt });
};
