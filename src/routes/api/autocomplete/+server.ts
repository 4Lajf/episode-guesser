import { gzipSync } from 'node:zlib';
import { json } from '@sveltejs/kit';
import { getCachedAnisongDbTitles } from '$lib/server/anisongdb';
import type { RequestHandler } from './$types';

let cachedGzipKey = -1;
let cachedGzipPayload: Uint8Array | null = null;

export const GET: RequestHandler = async ({ url, request, setHeaders }) => {
	const { titles, cachedAt } = await getCachedAnisongDbTitles();
	const q = url.searchParams.get('q')?.trim().toLowerCase() ?? '';
	const limitParam = Number(url.searchParams.get('limit') ?? '25');
	const limit = Number.isFinite(limitParam) ? Math.min(Math.max(1, limitParam), 100) : 25;

	const cacheControl =
		cachedAt > 0 ? 'public, max-age=3600, stale-while-revalidate=86400' : 'no-store';

	if (q) {
		setHeaders({ 'cache-control': cacheControl });
		const startsWith: string[] = [];
		const contains: string[] = [];
		for (const title of titles) {
			const lower = title.toLowerCase();
			if (lower.startsWith(q)) {
				startsWith.push(title);
			} else if (lower.includes(q)) {
				contains.push(title);
			}
			if (startsWith.length >= limit) break;
		}
		const matches = [...startsWith, ...contains].slice(0, limit);
		return json({ titles: matches, total: titles.length, cachedAt });
	}

	const acceptEnc = request.headers.get('accept-encoding') ?? '';
	if (acceptEnc.includes('gzip')) {
		if (!cachedGzipPayload || cachedGzipKey !== cachedAt) {
			cachedGzipPayload = new Uint8Array(
				gzipSync(Buffer.from(JSON.stringify({ titles, total: titles.length, cachedAt }), 'utf8'))
			);
			cachedGzipKey = cachedAt;
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
	return json({ titles, total: titles.length, cachedAt });
};
