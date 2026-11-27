import { json } from '@sveltejs/kit';
import { getGlobalVnPool } from '$lib/server/vnCatalog';
import { fetchVndbUserPool, sanitizeVndbLabels } from '$lib/server/vndbLive';
import type { VndbUserProfile, VnPoolSize } from '$lib/types';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
	let body: {
		username?: string;
		labelIds?: number[];
		token?: string;
		useGlobalPool?: boolean;
		poolSize?: VnPoolSize;
	};

	try {
		body = await request.json();
	} catch {
		return json({ error: 'Invalid JSON request body.' }, { status: 400 });
	}

	const poolSize: VnPoolSize = body.poolSize === 250 ? 250 : 1000;
	const username = (body.username ?? '').trim();
	const token = (body.token ?? '').trim();

	if (body.useGlobalPool || (!username && !token)) {
		const globalPool = getGlobalVnPool(poolSize);
		const profile: VndbUserProfile = {
			userId: 'global',
			username: poolSize === 250 ? 'Global Top 250' : 'Global Top 1,000',
			totalEntries: globalPool.length,
			eligibleVns: globalPool.length,
			labelIds: [2, 1],
			isGlobalPool: true,
			poolSize
		};
		return json(profile);
	}

	try {
		const cleanLabels = sanitizeVndbLabels(body.labelIds);
		const fetched = await fetchVndbUserPool({
			usernameOrId: username,
			labelIds: cleanLabels,
			token: token || undefined
		});

		const profile: VndbUserProfile = {
			userId: fetched.userId,
			username: fetched.username,
			totalEntries: fetched.totalEntries,
			eligibleVns: fetched.pool.length,
			labelIds: fetched.labelIds,
			isGlobalPool: false
		};
		return json(profile);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Could not load VNDB user list.';
		return json({ error: message }, { status: 400 });
	}
};
