import { json } from '@sveltejs/kit';
import { getCachedAnisongDbTitles } from '$lib/server/anisongdb';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url, setHeaders }) => {
	const { titles, cachedAt } = await getCachedAnisongDbTitles();
	const q = url.searchParams.get('q')?.trim().toLowerCase() ?? '';
	const limitParam = Number(url.searchParams.get('limit') ?? '25');
	const limit = Number.isFinite(limitParam) ? Math.min(Math.max(1, limitParam), 100) : 25;

	setHeaders({
		'cache-control': 'public, max-age=3600, stale-while-revalidate=86400'
	});

	if (q) {
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

	return json({ titles, total: titles.length, cachedAt });
};
