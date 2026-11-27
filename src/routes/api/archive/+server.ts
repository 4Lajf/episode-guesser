import { json } from '@sveltejs/kit';
import {
	DAILY_EPOCH_DATE,
	getDailyPuzzleNumber,
	getTodayUtcDate,
	listDailyDatesDescending
} from '$lib/scoring';
import { getEffectiveDailyPlayerId } from '$lib/server/auth';
import { listPlayerDailyRecords } from '$lib/server/dailyStore';
import { getLeaderboardCountsByDate } from '$lib/server/leaderboardStore';
import type { ArchiveDayStatus, ArchiveDaySummary, DailyArchivePayload } from '$lib/types';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ cookies }) => {
	const todayUtc = getTodayUtcDate();
	const dates = listDailyDatesDescending(todayUtc);
	const playerId = getEffectiveDailyPlayerId(cookies);

	const recordsByDate = new Map<string, ReturnType<typeof listPlayerDailyRecords>[number]>();
	if (playerId) {
		for (const rec of listPlayerDailyRecords(playerId, 'global')) {
			recordsByDate.set(rec.date, rec);
		}
	}

	const lbCounts = getLeaderboardCountsByDate();

	let solvedCount = 0;
	let playedCount = 0;

	const days: ArchiveDaySummary[] = dates.map((date) => {
		const rec = recordsByDate.get(date);
		const lb = lbCounts.get(date);
		let status: ArchiveDayStatus = 'unplayed';
		let attemptsUsed = 0;
		let animeHitAttempt: number | null = null;

		if (rec && rec.attempts.length > 0) {
			attemptsUsed = rec.attempts.length;
			animeHitAttempt = rec.attempts.find((a) => a.animeStatus === 'hit')?.attemptNumber ?? null;
			if (rec.finished) {
				playedCount++;
				if (rec.won) {
					status = 'won';
					solvedCount++;
				} else if (rec.attempts.some((a) => a.gaveUp)) {
					status = 'gave_up';
				} else {
					status = 'lost';
				}
			} else {
				status = 'in_progress';
			}
		}

		return {
			date,
			puzzleNumber: getDailyPuzzleNumber(date),
			status,
			attemptsUsed,
			animeHitAttempt,
			leaderboardCount: lb?.total ?? 0,
			leaderboardSolved: lb?.solved ?? 0
		};
	});

	const payload: DailyArchivePayload = {
		today: todayUtc,
		startDate: DAILY_EPOCH_DATE,
		totalDays: days.length,
		solvedCount,
		playedCount,
		days
	};

	return json(payload, {
		headers: {
			'cache-control': 'no-store'
		}
	});
};
