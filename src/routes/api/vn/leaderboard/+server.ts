import { json } from '@sveltejs/kit';
import { getTodayUtcDate } from '$lib/scoring';
import { getAuthUser, isAniListOAuthConfigured } from '$lib/server/auth';
import { getVnDailyLeaderboard } from '$lib/server/vnLeaderboardStore';
import { isValidVnDailyDate } from '$lib/vnScoring';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url, cookies }) => {
	const todayUtc = getTodayUtcDate();
	const requested = url.searchParams.get('date')?.trim();
	const date = requested && isValidVnDailyDate(requested, todayUtc) ? requested : todayUtc;
	const authUser = getAuthUser(cookies);
	const payload = getVnDailyLeaderboard(
		date,
		authUser?.anilistUserId ?? null,
		isAniListOAuthConfigured()
	);
	return json(payload, { headers: { 'cache-control': 'no-store' } });
};
