import { json } from '@sveltejs/kit';
import { getGlobalPool } from '$lib/curated';
import { fetchAniListProfile, sanitizeStatuses } from '$lib/server/anilist';
import type { AniListProfile, GlobalPoolSize } from '$lib/types';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url }) => {
	const username = url.searchParams.get('username')?.trim() ?? '';
	const modeGlobal = url.searchParams.get('global') === '1' || !username;
	const poolSizeParam = Number(url.searchParams.get('poolSize') || '1000');
	const globalPoolSize: GlobalPoolSize = poolSizeParam === 249 ? 249 : 1000;
	const statusesParam = url.searchParams.get('statuses');
	const includeSingleEp = url.searchParams.get('includeSingleEp') === '1';
	const forceRefresh = url.searchParams.get('refresh') === '1';

	if (modeGlobal) {
		const pool = getGlobalPool(globalPoolSize);
		const titleSet = new Set<string>();
		for (const item of pool) {
			titleSet.add(item.titleRomaji);
			if (item.titleEnglish) titleSet.add(item.titleEnglish);
		}
		const globalProfile: Omit<AniListProfile, 'pool'> = {
			username: globalPoolSize === 249 ? 'Global Top 249' : 'Global Top 1,000',
			avatar: null,
			totalEntries: pool.length,
			eligibleShows: pool.length,
			isGlobalPool: true,
			globalPoolSize,
			statuses: ['COMPLETED'],
			includeSingleEp: false,
			titlesForDropdown: Array.from(titleSet)
		};
		return json(globalProfile);
	}

	const statuses = sanitizeStatuses(
		statusesParam ? statusesParam.split(',').map((s) => s.trim().toUpperCase()) : undefined
	);

	try {
		const profile = await fetchAniListProfile({
			username,
			statuses,
			includeSingleEp,
			forceRefresh
		});

		if (profile.eligibleShows === 0) {
			return json(
				{
					error: includeSingleEp
						? `No eligible shows found for "${profile.username}" with the selected statuses.`
						: `No eligible multi-episode shows found for "${profile.username}" with the selected statuses.`
				},
				{ status: 404 }
			);
		}

		// Strip full pool from client response to keep payload compact & clean
		const { pool: _pool, ...publicProfile } = profile;
		return json(publicProfile);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Failed to load AniList profile.';
		return json({ error: message }, { status: 400 });
	}
};
