import { randomUUID } from 'node:crypto';
import { json } from '@sveltejs/kit';
import { CURATED_GLOBAL_POOL, getGlobalPool } from '$lib/curated';
import {
	getDailyPuzzleNumber,
	getTodayUtcDate,
	isValidDailyArchiveDate,
	WORDLE_MAX_ATTEMPTS,
	WORDLE_ZOOM_STEPS
} from '$lib/scoring';
import { fetchAniListProfile, sanitizeStatuses } from '$lib/server/anilist';
import { getAuthUser, PLAYER_COOKIE } from '$lib/server/auth';
import { getDailyRecord } from '$lib/server/dailyStore';
import { pickRoundFromPool, type SealedRoundSecret } from '$lib/server/picker';
import { unsealPayload } from '$lib/server/token';
import type { GameMode, GlobalPoolSize, ListStatus, RoundPayload } from '$lib/types';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request, cookies, url }) => {
	let body: {
		username?: string;
		useGlobalPool?: boolean;
		globalPoolSize?: GlobalPoolSize;
		statuses?: ListStatus[];
		includeSingleEp?: boolean;
		mode?: GameMode;
		dailyDate?: string;
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
	// Daily frame is ALWAYS fixed to the Global Top 1,000 ranked pool
	const useGlobalPool = mode === 'daily' || Boolean(body.useGlobalPool) || !username;
	const globalPoolSize: GlobalPoolSize = body.globalPoolSize === 249 ? 249 : 1000;
	const excludeMediaIds = Array.isArray(body.excludeMediaIds)
		? body.excludeMediaIds.filter((id): id is number => typeof id === 'number')
		: [];

	let guestPid = cookies.get(PLAYER_COOKIE);
	if (!guestPid) {
		guestPid = randomUUID();
		cookies.set(PLAYER_COOKIE, guestPid, {
			path: '/',
			httpOnly: true,
			sameSite: 'lax',
			secure: url.protocol === 'https:',
			maxAge: 60 * 60 * 24 * 365
		});
	}

	const authUser = getAuthUser(cookies);
	const playerId = authUser ? `al:${authUser.anilistUserId}` : guestPid;

	try {
		let pool = mode === 'daily' ? CURATED_GLOBAL_POOL : getGlobalPool(globalPoolSize);
		const scopeLabel = 'Ranked · Top 1,000';
		const scopeKey = 'global';
		const seedKey = 'global';

		if (!useGlobalPool) {
			const cleanStatuses = sanitizeStatuses(body.statuses);
			const includeSingleEp = Boolean(body.includeSingleEp);
			const profile = await fetchAniListProfile({
				username,
				statuses: cleanStatuses,
				includeSingleEp
			});
			pool = profile.pool;
		}

		const todayUtc = getTodayUtcDate();
		let targetDate = todayUtc;
		if (mode === 'daily' && body.dailyDate) {
			const cleanDate = body.dailyDate.trim();
			if (!isValidDailyArchiveDate(cleanDate, todayUtc)) {
				return json(
					{ error: 'Requested archive date is out of range or in the future.' },
					{ status: 400 }
				);
			}
			targetDate = cleanDate;
		}
		const isArchive = targetDate !== todayUtc;
		const effectiveScopeLabel = isArchive ? 'Archive · Top 1,000' : scopeLabel;

		// Server-enforced Daily session: restore existing in-progress/completed record instead of minting a fresh reset.
		// Zero-attempt sessions are NOT persisted until the player submits their first guess, preventing
		// anonymous/cookie-less traffic from filling daily-store.json.
		if (mode === 'daily') {
			const existing = getDailyRecord(playerId, targetDate, scopeKey);
			const existingValid = existing ? unsealPayload<SealedRoundSecret>(existing.roundToken) : null;
			if (existing && existingValid && existingValid.typ === 'round') {
				const restored: RoundPayload = {
					roundToken: existing.roundToken,
					dailyStateToken: existing.dailyStateToken,
					imageUrl: existing.currentImageUrl,
					mode: 'daily',
					dailyMeta: {
						date: targetDate,
						puzzleNumber: getDailyPuzzleNumber(targetDate),
						scopeLabel: effectiveScopeLabel,
						isArchive,
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

		const seed = mode === 'daily' ? `episode-guesser-daily:${targetDate}:${seedKey}` : undefined;

		const picked = await pickRoundFromPool({
			pool,
			mode,
			excludeMediaIds: mode === 'daily' ? [] : excludeMediaIds,
			seed,
			...(mode === 'daily'
				? {
						dailyBinding: {
							dailyDate: targetDate,
							scopeKey,
							playerId
						}
					}
				: {})
		});

		const payload: RoundPayload = {
			roundToken: picked.roundToken,
			imageUrl: picked.imageUrl,
			mode,
			...(picked.dailyStateToken ? { dailyStateToken: picked.dailyStateToken } : {}),
			...(mode === 'daily'
				? {
						dailyMeta: {
							date: targetDate,
							puzzleNumber: getDailyPuzzleNumber(targetDate),
							scopeLabel: effectiveScopeLabel,
							isArchive,
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
