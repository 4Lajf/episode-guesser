import { json } from '@sveltejs/kit';
import { VN_PUBLIC_AUTOCOMPLETE } from '$lib/server/vnCatalog';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async () => {
	return json(
		{ entries: VN_PUBLIC_AUTOCOMPLETE },
		{
			headers: {
				'cache-control': 'public, max-age=3600'
			}
		}
	);
};
