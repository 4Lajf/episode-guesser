import { json } from '@sveltejs/kit';
import { normalizeTitle } from '$lib/scoring';
import { getEffectiveDailyPlayerId } from '$lib/server/auth';
import { mintVnImageUrl } from '$lib/server/picker';
import { sealPayload, unsealPayload } from '$lib/server/token';
import { lookupVnById, lookupVnByTitle } from '$lib/server/vnCatalog';
import { getVnDailyRecord, saveVnDailyRecord } from '$lib/server/vnDailyStore';
import type { SealedVnRoundSecret, SealedVnState } from '$lib/server/vnSession';
import type { VnAttemptFeedback, VnGuessResponse } from '$lib/types';
import { evaluateVnAttempt, VN_MAX_ATTEMPTS } from '$lib/vnScoring';
import type { RequestHandler } from './$types';

const inFlightVnSessions = new Set<string>();

export const POST: RequestHandler = async ({ request, cookies }) => {
	let body: {
		roundToken?: string;
		stateToken?: string;
		guessedId?: string | null;
		guessedTitle?: string;
		skipped?: boolean;
	};

	try {
		body = await request.json();
	} catch {
		return json({ error: 'Invalid JSON request body.' }, { status: 400 });
	}

	if (!body.roundToken || typeof body.roundToken !== 'string') {
		return json({ error: 'Missing VN round token.' }, { status: 400 });
	}
	if (!body.stateToken || typeof body.stateToken !== 'string') {
		return json({ error: 'Missing VN session state token.' }, { status: 400 });
	}

	const secret = unsealPayload<SealedVnRoundSecret>(body.roundToken);
	const state = unsealPayload<SealedVnState>(body.stateToken);
	if (
		!secret ||
		secret.typ !== 'vn-round' ||
		secret.v !== 1 ||
		!state ||
		state.typ !== 'vn-state' ||
		state.v !== 1 ||
		secret.roundId !== state.roundId ||
		secret.playerId !== state.playerId ||
		secret.subMode !== state.subMode
	) {
		return json({ error: 'VN session expired or mismatched. Reload the puzzle.' }, { status: 400 });
	}

	const effectivePid = getEffectiveDailyPlayerId(cookies);
	if (!effectivePid || effectivePid !== secret.playerId) {
		return json({ error: 'Session cookie mismatch. Reload the VN puzzle.' }, { status: 403 });
	}

	const lockKey = `${secret.playerId}|${secret.roundId}`;
	if (inFlightVnSessions.has(lockKey)) {
		return json({ error: 'A guess is already being checked for this puzzle.' }, { status: 409 });
	}
	inFlightVnSessions.add(lockKey);

	try {
		const isDaily = secret.subMode === 'daily' && Boolean(secret.dailyDate);
		const serverRec =
			isDaily && secret.dailyDate ? getVnDailyRecord(secret.playerId, secret.dailyDate) : null;

		if (isDaily && serverRec) {
			if (serverRec.roundId !== secret.roundId) {
				return json({ error: 'Daily VN session out of sync. Reloading.' }, { status: 409 });
			}
			if (serverRec.finished || serverRec.attempts.length >= VN_MAX_ATTEMPTS) {
				return json({ error: 'Today’s VN UI puzzle is already finished.' }, { status: 400 });
			}
			if (state.attemptsUsed !== serverRec.attempts.length) {
				return json({ error: 'Daily VN session out of sync. Reloading.' }, { status: 409 });
			}
		} else if (isDaily && state.attemptsUsed > 0) {
			return json({ error: 'Daily VN session out of sync. Reloading.' }, { status: 409 });
		}

		if (state.finished || state.attemptsUsed >= VN_MAX_ATTEMPTS) {
			return json({ error: 'This VN UI puzzle is already finished.' }, { status: 400 });
		}

		const attemptNumber = state.attemptsUsed + 1;
		const skipped = Boolean(body.skipped);
		const usedKeys = isDaily && serverRec ? serverRec.usedIds : state.usedKeys;

		if (skipped) {
			const giveUpAttempt: VnAttemptFeedback = {
				attemptNumber,
				guessedId: null,
				guessedTitle: 'Gave up',
				guessedYear: null,
				guessedLengthMinutes: null,
				guessedStudio: null,
				vnStatus: 'miss',
				yearStatus: 'miss',
				yearDirection: null,
				lengthStatus: 'miss',
				lengthDirection: null,
				studioStatus: 'miss',
				solved: false,
				gaveUp: true
			};

			const nextStateToken = sealPayload<SealedVnState>({
				typ: 'vn-state',
				v: 1,
				roundId: secret.roundId,
				subMode: secret.subMode,
				playerId: secret.playerId,
				...(secret.dailyDate ? { dailyDate: secret.dailyDate } : {}),
				attemptsUsed: attemptNumber,
				finished: true,
				usedKeys
			});

			if (isDaily && secret.dailyDate) {
				const prevAttempts = serverRec?.attempts ?? [];
				saveVnDailyRecord(secret.playerId, {
					date: secret.dailyDate,
					roundId: secret.roundId,
					roundToken: body.roundToken,
					stateToken: nextStateToken,
					currentStage: 5,
					currentImageUrl: secret.reveal.imageUrl,
					attempts: [...prevAttempts, giveUpAttempt],
					usedIds: usedKeys,
					finished: true,
					won: false,
					reveal: secret.reveal,
					updatedAt: Date.now()
				});
			}

			const response: VnGuessResponse = {
				attempt: giveUpAttempt,
				finished: true,
				won: false,
				nextStage: 5,
				nextImageUrl: secret.reveal.imageUrl,
				stateToken: nextStateToken,
				...(secret.hintTags.length > 0 ? { hintTags: secret.hintTags } : {}),
				reveal: secret.reveal
			};
			return json(response);
		}

		const rawTitle = (body.guessedTitle ?? '').trim().slice(0, 160);
		const matchedEntry =
			lookupVnById(body.guessedId) ?? (rawTitle ? lookupVnByTitle(rawTitle) : null);

		const displayTitle = matchedEntry?.t ?? rawTitle;
		if (!displayTitle) {
			return json({ error: 'Pick a visual novel before submitting.' }, { status: 400 });
		}

		const guessKey = matchedEntry ? matchedEntry.id : normalizeTitle(displayTitle);
		if (usedKeys.includes(guessKey)) {
			return json(
				{ error: 'You already guessed that visual novel. Try a different title.' },
				{ status: 400 }
			);
		}

		const attempt = evaluateVnAttempt({
			attemptNumber,
			guessedId: matchedEntry?.id ?? null,
			guessedTitle: displayTitle,
			guessedYear: matchedEntry?.y ?? null,
			guessedLengthMinutes: matchedEntry?.lm ?? null,
			guessedLengthBucket: matchedEntry?.lb ?? null,
			guessedDevelopers: matchedEntry?.d ?? [],
			targetId: secret.targetId,
			targetTitles: secret.targetTitles,
			targetFranchiseIds: secret.targetFranchiseIds,
			targetFranchiseTitles: secret.targetFranchiseTitles,
			targetYear: secret.targetYear,
			targetLengthMinutes: secret.targetLengthMinutes,
			targetLengthBucket: secret.targetLengthBucket,
			targetDevelopers: secret.targetDevelopers
		});

		const finished = attempt.solved || attemptNumber >= VN_MAX_ATTEMPTS;
		const nextStage = (finished ? 5 : Math.min(5, attemptNumber + 1)) as 1 | 2 | 3 | 4 | 5;
		const nextImageUrl =
			nextStage >= 5
				? secret.reveal.imageUrl
				: mintVnImageUrl(secret.rawImageUrl, nextStage, secret.isNvl);

		const nextUsedKeys = [...usedKeys, guessKey];
		const nextStateToken = sealPayload<SealedVnState>({
			typ: 'vn-state',
			v: 1,
			roundId: secret.roundId,
			subMode: secret.subMode,
			playerId: secret.playerId,
			...(secret.dailyDate ? { dailyDate: secret.dailyDate } : {}),
			attemptsUsed: attemptNumber,
			finished,
			usedKeys: nextUsedKeys
		});

		if (isDaily && secret.dailyDate) {
			const prevAttempts = serverRec?.attempts ?? [];
			saveVnDailyRecord(secret.playerId, {
				date: secret.dailyDate,
				roundId: secret.roundId,
				roundToken: body.roundToken,
				stateToken: nextStateToken,
				currentStage: nextStage,
				currentImageUrl: nextImageUrl,
				attempts: [...prevAttempts, attempt],
				usedIds: nextUsedKeys,
				finished,
				won: attempt.solved,
				...(finished ? { reveal: secret.reveal } : {}),
				updatedAt: Date.now()
			});
		}

		const hintTags =
			(attemptNumber >= 2 || finished) && secret.hintTags.length > 0
				? secret.hintTags
				: undefined;

		const response: VnGuessResponse = {
			attempt,
			finished,
			won: attempt.solved,
			nextStage,
			nextImageUrl,
			stateToken: nextStateToken,
			...(hintTags ? { hintTags } : {}),
			...(finished ? { reveal: secret.reveal } : {})
		};

		return json(response);
	} finally {
		inFlightVnSessions.delete(lockKey);
	}
};
