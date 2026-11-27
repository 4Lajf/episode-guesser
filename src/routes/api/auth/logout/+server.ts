import { json } from '@sveltejs/kit';
import { clearAuthUserCookie } from '$lib/server/auth';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ cookies }) => {
	clearAuthUserCookie(cookies);
	return json({ ok: true });
};
