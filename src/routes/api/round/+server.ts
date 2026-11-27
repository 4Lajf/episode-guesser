import { json } from '@sveltejs/kit';
import { CURATED_GLOBAL_POOL } from '$lib/curated';
import {
	getDailyPuzzleNumber,
	getTodayUtcDate,
	WORDLE_MAX_ATTEMPTS,
	WORDLE_ZOOM_STEPS
} from '$lib/scoring';
import { fetchAniListProfile, sanitizeStatuses } from '$lib/server/anilist';
import { pickRoundFromPool } from '$lib/server/picker';
import type { GameMode, ListStatus, RoundPayload } from '$lib/types';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
	let body: {
		username?: string;
		useGlobalPool?: boolean;
		statuses?: ListStatus[];
		includeSingleEp?: boolean;
		mode?: GameMode;
		excludeMediaIds?: number[];
	};

	try {
		body = await request.json();
	} catch {
		return json({ error: 'Invalid JSON request body.' }, { status: 400 });
	}

	const mode: GameMode =
		body.mode === 'unlimited' || body.mode === 'daily' ? body.mode : 'classic';
	const username = body.username?.trim() ?? '';
	const useGlobalPool = Boolean(body.useGlobalPool) || !username;
	const excludeMediaIds = Array.isArray(body.excludeMediaIds)
		? body.excludeMediaIds.filter((id): id is number => typeof id === 'number')
		: [];

	try {
		let pool = CURATED_GLOBAL_POOL;
		let scopeLabel = 'Global Daily';
		let seedKey = 'global';

		if (!useGlobalPool) {
			const profile = await fetchAniListProfile({
				username,
				statuses: sanitizeStatuses(body.statuses),
				includeSingleEp: Boolean(body.includeSingleEp)
			});
			pool = profile.pool;
			scopeLabel = `${profile.username}'s list`;
			seedKey = `anilist:${profile.username.toLowerCase()}`;
		}

		const todayUtc = getTodayUtcDate();
		const seed = mode === 'daily' ? `episode-guesser-daily:${todayUtc}:${seedKey}` : undefined;

		const picked = await pickRoundFromPool({
			pool,
			mode,
			excludeMediaIds: mode === 'daily' ? [] : excludeMediaIds,
			seed
		});

		const payload: RoundPayload = {
			roundToken: picked.roundToken,
			imageUrl: picked.imageUrl,
			mode,
			...(picked.dailyStateToken ? { dailyStateToken: picked.dailyStateToken } : {}),
			...(mode === 'daily'
				? {
						dailyMeta: {
							date: todayUtc,
							puzzleNumber: getDailyPuzzleNumber(todayUtc),
							scopeLabel,
							originX: picked.originX,
							originY: picked.originY,
							maxAttempts: WORDLE_MAX_ATTEMPTS,
							zoomSteps: [...WORDLE_ZOOM_STEPS]
						}
					}
				: {})
		};

		return json(payload);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Failed to start round.';
		return json({ error: message }, { status: 400 });
	}
};
