import { json } from '@sveltejs/kit';
import { getAuthUser, isAniListOAuthConfigured } from '$lib/server/auth';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ cookies }) => {
	const user = getAuthUser(cookies);
	return json({
		user,
		authConfigured: isAniListOAuthConfigured()
	});
};
