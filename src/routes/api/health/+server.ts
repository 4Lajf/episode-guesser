import { json } from '@sveltejs/kit';
import { getAnisongDbCacheCount } from '$lib/server/anisongdb';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async () => {
	return json({
		status: 'ok',
		cachedTitles: getAnisongDbCacheCount(),
		timestamp: new Date().toISOString()
	});
};
