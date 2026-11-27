import type { Cookies } from '@sveltejs/kit';
import type { AuthUser } from '$lib/types';
import { sealPayload, unsealPayload } from './token';

export const AUTH_COOKIE = 'eg_auth';
export const OAUTH_STATE_COOKIE = 'eg_oauth_state';
export const PLAYER_COOKIE = 'eg_pid';

const AUTH_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes

interface SealedAuthCookie {
	typ: 'auth';
	v: 1;
	anilistUserId: number;
	username: string;
	avatar: string | null;
	siteUrl: string;
	exp: number;
}

interface SealedOAuthState {
	typ: 'oauth_state';
	v: 1;
	state: string;
	returnTo: string;
	exp: number;
}

export function getAniListOAuthConfig(): { clientId: string; clientSecret: string } | null {
	const clientId = (process.env.ANILIST_CLIENT_ID || '').trim();
	const clientSecret = (process.env.ANILIST_CLIENT_SECRET || '').trim();
	if (!clientId || !clientSecret) return null;
	return { clientId, clientSecret };
}

export function isAniListOAuthConfigured(): boolean {
	return getAniListOAuthConfig() !== null;
}

export function getAniListRedirectUri(origin: string): string {
	const explicit = (process.env.ANILIST_REDIRECT_URI || '').trim();
	if (explicit) return explicit;
	return `${origin}/api/auth/anilist/callback`;
}

export function getAuthUser(cookies: Cookies): AuthUser | null {
	const raw = cookies.get(AUTH_COOKIE);
	if (!raw) return null;
	const parsed = unsealPayload<SealedAuthCookie>(raw);
	if (
		!parsed ||
		parsed.typ !== 'auth' ||
		parsed.v !== 1 ||
		typeof parsed.anilistUserId !== 'number' ||
		!parsed.username ||
		parsed.exp < Date.now()
	) {
		return null;
	}
	return {
		anilistUserId: parsed.anilistUserId,
		username: parsed.username,
		avatar: parsed.avatar ?? null,
		siteUrl: parsed.siteUrl || `https://anilist.co/user/${encodeURIComponent(parsed.username)}`
	};
}

export function setAuthUserCookie(cookies: Cookies, user: AuthUser, secure: boolean): void {
	const token = sealPayload<SealedAuthCookie>({
		typ: 'auth',
		v: 1,
		anilistUserId: user.anilistUserId,
		username: user.username,
		avatar: user.avatar,
		siteUrl: user.siteUrl,
		exp: Date.now() + AUTH_TTL_MS
	});
	cookies.set(AUTH_COOKIE, token, {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		secure,
		maxAge: Math.floor(AUTH_TTL_MS / 1000)
	});
}

export function clearAuthUserCookie(cookies: Cookies): void {
	cookies.delete(AUTH_COOKIE, { path: '/' });
}

export function setOAuthStateCookie(
	cookies: Cookies,
	state: string,
	returnTo: string,
	secure: boolean
): void {
	const safeReturn = returnTo.startsWith('/') && !returnTo.startsWith('//') ? returnTo : '/';
	const token = sealPayload<SealedOAuthState>({
		typ: 'oauth_state',
		v: 1,
		state,
		returnTo: safeReturn,
		exp: Date.now() + OAUTH_STATE_TTL_MS
	});
	cookies.set(OAUTH_STATE_COOKIE, token, {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		secure,
		maxAge: Math.floor(OAUTH_STATE_TTL_MS / 1000)
	});
}

export function consumeOAuthStateCookie(
	cookies: Cookies,
	expectedState: string
): { returnTo: string } | null {
	const raw = cookies.get(OAUTH_STATE_COOKIE);
	cookies.delete(OAUTH_STATE_COOKIE, { path: '/' });
	if (!raw || !expectedState) return null;
	const parsed = unsealPayload<SealedOAuthState>(raw);
	if (
		!parsed ||
		parsed.typ !== 'oauth_state' ||
		parsed.v !== 1 ||
		parsed.exp < Date.now() ||
		parsed.state !== expectedState
	) {
		return null;
	}
	return { returnTo: parsed.returnTo };
}

/**
 * Canonical player key for Daily Frame sessions:
 * - Authenticated AniList users use `al:<anilistUserId>` so progress & ranked leaderboard
 *   are bound to their verified AniList identity across devices.
 * - Guests use their HttpOnly `eg_pid` cookie.
 */
export function getEffectiveDailyPlayerId(cookies: Cookies): string | null {
	const auth = getAuthUser(cookies);
	if (auth) return `al:${auth.anilistUserId}`;
	return cookies.get(PLAYER_COOKIE) ?? null;
}
