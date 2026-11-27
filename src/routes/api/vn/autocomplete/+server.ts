import { json } from '@sveltejs/kit';
import { VN_PUBLIC_AUTOCOMPLETE } from '$lib/server/vnCatalog';
import { searchVndbLive } from '$lib/server/vndbLive';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url }) => {
	const liveQuery = url.searchParams.get('q')?.trim();
	if (liveQuery && liveQuery.length >= 2) {
		const entries = await searchVndbLive(liveQuery);
		return json(
			{ entries, source: 'vndb-live' },
			{ headers: { 'cache-control': 'public, max-age=300' } }
		);
	}

	return json(
		{ entries: VN_PUBLIC_AUTOCOMPLETE },
		{
			headers: {
				'cache-control': 'public, max-age=3600'
			}
		}
	);
};
