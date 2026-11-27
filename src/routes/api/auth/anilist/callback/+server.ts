import { redirect } from '@sveltejs/kit';
import {
	consumeOAuthStateCookie,
	getAniListOAuthConfig,
	getAniListRedirectUri,
	PLAYER_COOKIE,
	setAuthUserCookie
} from '$lib/server/auth';
import { getDailyRecord, listPlayerDailyRecords, saveDailyRecord } from '$lib/server/dailyStore';
import { hasLeaderboardEntry, recordDailyLeaderboardResult } from '$lib/server/leaderboardStore';
import type { SealedDailyState, SealedRoundSecret } from '$lib/server/picker';
import { sealPayload, unsealPayload } from '$lib/server/token';
import type { AuthUser } from '$lib/types';
import type { RequestHandler } from './$types';

const VIEWER_QUERY = `
query {
  Viewer {
    id
    name
    siteUrl
    avatar {
      medium
    }
  }
}
`;

export const GET: RequestHandler = async ({ cookies, url }) => {
	const cfg = getAniListOAuthConfig();
	if (!cfg) {
		throw redirect(302, '/?auth_error=not_configured');
	}

	const oauthErr = url.searchParams.get('error');
	if (oauthErr) {
		throw redirect(302, '/?auth_error=cancelled');
	}

	const code = url.searchParams.get('code')?.trim() || '';
	const state = url.searchParams.get('state')?.trim() || '';
	const stateData = consumeOAuthStateCookie(cookies, state);
	if (!code || !stateData) {
		throw redirect(302, '/?auth_error=invalid_state');
	}

	let accessToken = '';
	try {
		const tokenRes = await fetch('https://anilist.co/api/v2/oauth/token', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Accept: 'application/json'
			},
			body: JSON.stringify({
				grant_type: 'authorization_code',
				client_id: cfg.clientId,
				client_secret: cfg.clientSecret,
				redirect_uri: getAniListRedirectUri(url.origin),
				code
			})
		});
		if (!tokenRes.ok) {
			throw redirect(302, '/?auth_error=token_exchange_failed');
		}
		const tokenJson = (await tokenRes.json()) as { access_token?: string };
		accessToken = tokenJson.access_token || '';
		if (!accessToken) {
			throw redirect(302, '/?auth_error=token_exchange_failed');
		}
	} catch (err) {
		if (err && typeof err === 'object' && 'status' in err) throw err;
		throw redirect(302, '/?auth_error=token_exchange_failed');
	}

	let authUser: AuthUser;
	try {
		const viewerRes = await fetch('https://graphql.anilist.co', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Accept: 'application/json',
				Authorization: `Bearer ${accessToken}`
			},
			body: JSON.stringify({ query: VIEWER_QUERY })
		});
		if (!viewerRes.ok) {
			throw redirect(302, '/?auth_error=viewer_failed');
		}
		const viewerJson = (await viewerRes.json()) as {
			data?: {
				Viewer?: {
					id: number;
					name: string;
					siteUrl?: string | null;
					avatar?: { medium?: string | null } | null;
				};
			};
		};
		const v = viewerJson.data?.Viewer;
		if (!v || typeof v.id !== 'number' || !v.name) {
			throw redirect(302, '/?auth_error=viewer_failed');
		}
		authUser = {
			anilistUserId: v.id,
			username: v.name,
			avatar: v.avatar?.medium ?? null,
			siteUrl: v.siteUrl || `https://anilist.co/user/${encodeURIComponent(v.name)}`
		};
	} catch (err) {
		if (err && typeof err === 'object' && 'status' in err) throw err;
		throw redirect(302, '/?auth_error=viewer_failed');
	}

	setAuthUserCookie(cookies, authUser, url.protocol === 'https:');

	// Seamlessly claim any guest Daily progress (today + archive days!) into the verified AniList account
	// for any dates this AniList account hasn't played yet.
	const guestPid = cookies.get(PLAYER_COOKIE);
	const authPlayerId = `al:${authUser.anilistUserId}`;

	if (guestPid) {
		const guestRecords = listPlayerDailyRecords(guestPid, 'global');
		for (const guestRec of guestRecords) {
			const existingAuthRec = getDailyRecord(authPlayerId, guestRec.date, 'global');
			if (existingAuthRec) continue;
			const unsealedRound = unsealPayload<SealedRoundSecret>(guestRec.roundToken);
			const unsealedState = unsealPayload<SealedDailyState>(guestRec.dailyStateToken);
			if (!unsealedRound || !unsealedState) continue;

			const migratedRoundToken = sealPayload<SealedRoundSecret>({
				...unsealedRound,
				playerId: authPlayerId
			});
			const migratedStateToken = sealPayload<SealedDailyState>({
				...unsealedState,
				playerId: authPlayerId
			});
			saveDailyRecord(authPlayerId, {
				...guestRec,
				roundToken: migratedRoundToken,
				dailyStateToken: migratedStateToken
			});
			if (guestRec.finished && !hasLeaderboardEntry(guestRec.date, authUser.anilistUserId)) {
				recordDailyLeaderboardResult({
					date: guestRec.date,
					user: authUser,
					attempts: guestRec.attempts,
					won: guestRec.won,
					startedAt: unsealedRound.createdAt,
					completedAt: guestRec.updatedAt
				});
			}
		}
	}

	const dest = new URL(stateData.returnTo, url.origin);
	dest.searchParams.set('logged_in', '1');
	throw redirect(302, `${dest.pathname}${dest.search}`);
};
