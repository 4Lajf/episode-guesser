import { json } from '@sveltejs/kit';
import { getTodayUtcDate } from '$lib/scoring';
import { getEffectiveDailyPlayerId } from '$lib/server/auth';
import { listPlayerVnDailyRecords } from '$lib/server/vnDailyStore';
import { getVnLeaderboardCountsByDate } from '$lib/server/vnLeaderboardStore';
import type { ArchiveDayStatus, VnArchiveDaySummary, VnArchivePayload } from '$lib/types';
import {
	getVnDailyPuzzleNumber,
	listVnDailyDatesDescending,
	VN_DAILY_EPOCH_DATE
} from '$lib/vnScoring';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ cookies }) => {
	const todayUtc = getTodayUtcDate();
	const dates = listVnDailyDatesDescending(todayUtc);
	const playerId = getEffectiveDailyPlayerId(cookies);

	const recordByDate = new Map<string, ReturnType<typeof listPlayerVnDailyRecords>[number]>();
	if (playerId) {
		for (const rec of listPlayerVnDailyRecords(playerId)) {
			recordByDate.set(rec.date, rec);
		}
	}

	const lbCounts = getVnLeaderboardCountsByDate();
	let solvedCount = 0;
	let playedCount = 0;

	const days: VnArchiveDaySummary[] = dates.map((date) => {
		const rec = recordByDate.get(date);
		let status: ArchiveDayStatus = 'unplayed';
		let attemptsUsed = 0;
		if (rec) {
			attemptsUsed = rec.attempts.length;
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
			} else if (rec.attempts.length > 0) {
				status = 'in_progress';
			}
		}

		const lb = lbCounts.get(date);
		return {
			date,
			puzzleNumber: getVnDailyPuzzleNumber(date),
			status,
			attemptsUsed,
			leaderboardCount: lb?.total ?? 0,
			leaderboardSolved: lb?.solved ?? 0
		};
	});

	const payload: VnArchivePayload = {
		today: todayUtc,
		startDate: VN_DAILY_EPOCH_DATE,
		totalDays: days.length,
		solvedCount,
		playedCount,
		days
	};

	return json(payload, { headers: { 'cache-control': 'no-store' } });
};
