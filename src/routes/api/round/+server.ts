import { randomUUID } from 'node:crypto';
import { json } from '@sveltejs/kit';
import { CURATED_GLOBAL_POOL } from '$lib/curated';
import {
	getDailyPuzzleNumber,
	getTodayUtcDate,
	WORDLE_MAX_ATTEMPTS,
	WORDLE_ZOOM_STEPS
} from '$lib/scoring';
import { fetchAniListProfile, sanitizeStatuses } from '$lib/server/anilist';
import { getDailyRecord, saveDailyRecord } from '$lib/server/dailyStore';
import { pickRoundFromPool } from '$lib/server/picker';
import type { GameMode, ListStatus, RoundPayload } from '$lib/types';
import type { RequestHandler } from './$types';

const PLAYER_COOKIE = 'eg_pid';

export const POST: RequestHandler = async ({ request, cookies, url }) => {
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

	let playerId = cookies.get(PLAYER_COOKIE);
	if (!playerId) {
		playerId = randomUUID();
		cookies.set(PLAYER_COOKIE, playerId, {
			path: '/',
			httpOnly: true,
			sameSite: 'lax',
			secure: url.protocol === 'https:',
			maxAge: 60 * 60 * 24 * 365
		});
	}

	try {
		let pool = CURATED_GLOBAL_POOL;
		let scopeLabel = 'Global Daily';
		let scopeKey = 'global';
		let seedKey = 'global';

		if (!useGlobalPool) {
			const cleanStatuses = sanitizeStatuses(body.statuses);
			const includeSingleEp = Boolean(body.includeSingleEp);
			const profile = await fetchAniListProfile({
				username,
				statuses: cleanStatuses,
				includeSingleEp
			});
			pool = profile.pool;
			scopeLabel = `${profile.username}'s list`;
			seedKey = `anilist:${profile.username.toLowerCase()}`;
			scopeKey = `user:${profile.username.toLowerCase()}:${cleanStatuses.slice().sort().join(',')}:${includeSingleEp ? '1' : '0'}`;
		}

		const todayUtc = getTodayUtcDate();

		// Server-enforced Daily session: return existing in-progress/completed record instead of minting a fresh reset
		if (mode === 'daily') {
			const existing = getDailyRecord(playerId, todayUtc, scopeKey);
			if (existing) {
				const restored: RoundPayload = {
					roundToken: existing.roundToken,
					dailyStateToken: existing.dailyStateToken,
					imageUrl: existing.currentImageUrl,
					mode: 'daily',
					dailyMeta: {
						date: todayUtc,
						puzzleNumber: getDailyPuzzleNumber(todayUtc),
						scopeLabel,
						maxAttempts: WORDLE_MAX_ATTEMPTS,
						zoomSteps: [...WORDLE_ZOOM_STEPS]
					},
					dailyRestore: {
						attempts: existing.attempts,
						finished: existing.finished,
						won: existing.won,
						...(existing.finished && existing.reveal ? { reveal: existing.reveal } : {})
					}
				};
				return json(restored);
			}
		}

		const seed = mode === 'daily' ? `episode-guesser-daily:${todayUtc}:${seedKey}` : undefined;

		const picked = await pickRoundFromPool({
			pool,
			mode,
			excludeMediaIds: mode === 'daily' ? [] : excludeMediaIds,
			seed
		});

		if (mode === 'daily' && picked.dailyStateToken) {
			saveDailyRecord(playerId, {
				date: todayUtc,
				scopeKey,
				roundId: picked.roundId,
				roundToken: picked.roundToken,
				dailyStateToken: picked.dailyStateToken,
				currentImageUrl: picked.imageUrl,
				attempts: [],
				usedKeys: [],
				finished: false,
				won: false,
				updatedAt: Date.now()
			});
		}

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
