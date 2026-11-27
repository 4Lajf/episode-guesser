import { accessSync, constants } from 'node:fs';
import { join } from 'node:path';
import { json } from '@sveltejs/kit';
import { getCatalogTitleCount } from '$lib/server/animeCatalog';
import { getAnisongDbCacheCount } from '$lib/server/anisongdb';
import { getDailyStoreCount } from '$lib/server/dailyStore';
import { getTotalLeaderboardEntries } from '$lib/server/leaderboardStore';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async () => {
	let cacheWritable = false;
	try {
		accessSync(join(process.cwd(), '.cache'), constants.W_OK);
		cacheWritable = true;
	} catch {
		cacheWritable = false;
	}

	return json({
		status: 'ok',
		cacheWritable,
		cachedTitles: Math.max(getCatalogTitleCount(), getAnisongDbCacheCount()),
		dailyRecords: getDailyStoreCount(),
		leaderboardEntries: getTotalLeaderboardEntries(),
		timestamp: new Date().toISOString()
	});
};
