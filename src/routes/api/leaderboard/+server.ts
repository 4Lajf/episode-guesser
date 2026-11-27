import { json } from '@sveltejs/kit';
import { getTodayUtcDate } from '$lib/scoring';
import { getAuthUser, isAniListOAuthConfigured } from '$lib/server/auth';
import { getDailyLeaderboard } from '$lib/server/leaderboardStore';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ cookies, url }) => {
	const rawDate = url.searchParams.get('date')?.trim();
	const date = rawDate && /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? rawDate : getTodayUtcDate();
	const authUser = getAuthUser(cookies);

	return json(
		getDailyLeaderboard(date, authUser?.anilistUserId ?? null, isAniListOAuthConfigured()),
		{
			headers: {
				'cache-control': 'no-store'
			}
		}
	);
};
