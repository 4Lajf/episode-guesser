import { json } from '@sveltejs/kit';
import { CURATED_GLOBAL_POOL } from '$lib/curated';
import { fetchAniListProfile, sanitizeStatuses } from '$lib/server/anilist';
import type { AniListProfile } from '$lib/types';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url }) => {
	const username = url.searchParams.get('username')?.trim() ?? '';
	const modeGlobal = url.searchParams.get('global') === '1' || !username;
	const statusesParam = url.searchParams.get('statuses');
	const includeSingleEp = url.searchParams.get('includeSingleEp') === '1';
	const forceRefresh = url.searchParams.get('refresh') === '1';

	if (modeGlobal) {
		const titleSet = new Set<string>();
		for (const item of CURATED_GLOBAL_POOL) {
			titleSet.add(item.titleRomaji);
			if (item.titleEnglish) titleSet.add(item.titleEnglish);
		}
		const globalProfile: Omit<AniListProfile, 'pool'> = {
			username: 'Global Pool',
			avatar: null,
			totalEntries: CURATED_GLOBAL_POOL.length,
			eligibleShows: CURATED_GLOBAL_POOL.length,
			isGlobalPool: true,
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
					error: `No eligible multi-episode shows found for "${profile.username}" with the selected statuses.`
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
