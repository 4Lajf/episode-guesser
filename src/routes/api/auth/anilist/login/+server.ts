import { randomBytes } from 'node:crypto';
import { redirect } from '@sveltejs/kit';
import {
	getAniListOAuthConfig,
	getAniListRedirectUri,
	setOAuthStateCookie
} from '$lib/server/auth';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ cookies, url }) => {
	const cfg = getAniListOAuthConfig();
	if (!cfg) {
		throw redirect(302, '/?auth_error=not_configured');
	}

	const returnTo = url.searchParams.get('returnTo') || '/';
	const state = randomBytes(24).toString('base64url');
	setOAuthStateCookie(cookies, state, returnTo, url.protocol === 'https:');

	const authorizeUrl = new URL('https://anilist.co/api/v2/oauth/authorize');
	authorizeUrl.searchParams.set('client_id', cfg.clientId);
	authorizeUrl.searchParams.set('redirect_uri', getAniListRedirectUri(url.origin));
	authorizeUrl.searchParams.set('response_type', 'code');
	authorizeUrl.searchParams.set('state', state);

	throw redirect(302, authorizeUrl.toString());
};
