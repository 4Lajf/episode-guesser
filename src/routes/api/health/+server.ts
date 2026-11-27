import { json } from '@sveltejs/kit';
import { getCatalogTitleCount } from '$lib/server/animeCatalog';
import { getAnisongDbCacheCount } from '$lib/server/anisongdb';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async () => {
	return json({
		status: 'ok',
		cachedTitles: Math.max(getCatalogTitleCount(), getAnisongDbCacheCount()),
		timestamp: new Date().toISOString()
	});
};
