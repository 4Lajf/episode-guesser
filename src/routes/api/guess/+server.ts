import { json } from '@sveltejs/kit';
import { CURATED_GLOBAL_POOL } from '$lib/curated';
import {
	evaluateClassicGuess,
	evaluateWordleAttempt,
	getTodayUtcDate,
	matchAnimeTitle,
	normalizeTitle,
	WORDLE_MAX_ATTEMPTS,
	WORDLE_ZOOM_STEPS
} from '$lib/scoring';
import {
	fetchAniListProfile,
	lookupAnimeByTitle,
	sanitizeStatuses,
	type AnimeLookupResult
} from '$lib/server/anilist';
import { getDailyRecord, saveDailyRecord } from '$lib/server/dailyStore';
import {
	mintImageUrl,
	type SealedDailyState,
	type SealedRoundSecret
} from '$lib/server/picker';
import { sealPayload, unsealPayload } from '$lib/server/token';
import type { ListStatus, WordleGuessResponse } from '$lib/types';
import type { RequestHandler } from './$types';

const ROUND_TTL_MS = 36 * 60 * 60 * 1000; // 36 hours
const PLAYER_COOKIE = 'eg_pid';

export const POST: RequestHandler = async ({ request, cookies }) => {
	let body: {
		roundToken?: string;
		dailyStateToken?: string;
		guessedTitle?: string;
		guessedEpisode?: number | null;
		skipped?: boolean;
		username?: string;
		statuses?: ListStatus[];
		includeSingleEp?: boolean;
	};

	try {
		body = await request.json();
	} catch {
		return json({ error: 'Invalid JSON request body.' }, { status: 400 });
	}

	if (!body.roundToken || typeof body.roundToken !== 'string') {
		return json({ error: 'Missing round token.' }, { status: 400 });
	}

	const secret = unsealPayload<SealedRoundSecret>(body.roundToken);
	if (!secret || secret.v !== 1 || Date.now() - secret.createdAt > ROUND_TTL_MS) {
		return json({ error: 'Round expired or invalid. Start a fresh frame.' }, { status: 400 });
	}

	const guessedTitle = typeof body.guessedTitle === 'string' ? body.guessedTitle.trim() : '';
	const parsedEp =
		body.guessedEpisode !== null && body.guessedEpisode !== undefined
			? Number(body.guessedEpisode)
			: null;
	const guessedEpisode =
		parsedEp !== null && Number.isFinite(parsedEp) && parsedEp >= 1 ? Math.round(parsedEp) : null;

	// Helper: enrich target/franchise titles via AniList ID lookup if normalized strings didn't match
	async function resolveAniListFallback(
		currentTargets: string[],
		currentFranchise: string[]
	): Promise<{ targets: string[]; franchise: string[]; lookup?: AnimeLookupResult | null }> {
		if (!guessedTitle) return { targets: currentTargets, franchise: currentFranchise };
		const direct = matchAnimeTitle(guessedTitle, currentTargets, currentFranchise);
		if (direct === 'exact') return { targets: currentTargets, franchise: currentFranchise };

		const lookup = await lookupAnimeByTitle(guessedTitle);
		if (!lookup) return { targets: currentTargets, franchise: currentFranchise, lookup: null };

		if (lookup.id === secret!.reveal.anilistId) {
			return { targets: [...currentTargets, guessedTitle], franchise: currentFranchise, lookup };
		}
		if (lookup.relatedIds.includes(secret!.reveal.anilistId)) {
			return { targets: currentTargets, franchise: [...currentFranchise, guessedTitle], lookup };
		}
		return { targets: currentTargets, franchise: currentFranchise, lookup };
	}

	// Classic / Unlimited evaluation
	if (secret.mode === 'classic' || secret.mode === 'unlimited') {
		const skipped = Boolean(body.skipped);
		if (!skipped && !guessedTitle) {
			return json(
				{ error: 'Pick an anime title before submitting, or skip the frame.' },
				{ status: 400 }
			);
		}

		const resolved = skipped
			? { targets: secret.targetTitles, franchise: secret.franchiseTitles }
			: await resolveAniListFallback(secret.targetTitles, secret.franchiseTitles);

		const result = evaluateClassicGuess({
			mode: secret.mode,
			guessedTitle,
			guessedEpisode,
			skipped,
			targetTitles: resolved.targets,
			franchiseTitles: resolved.franchise,
			reveal: secret.reveal
		});

		return json(result);
	}

	// Daily Wordle evaluation — strictly verified via sealed dailyStateToken + server cookie record
	if (!body.dailyStateToken || typeof body.dailyStateToken !== 'string') {
		return json({ error: 'Missing Daily session state. Reload the daily frame.' }, { status: 400 });
	}

	const dailyState = unsealPayload<SealedDailyState>(body.dailyStateToken);
	if (!dailyState || dailyState.v !== 1 || dailyState.roundId !== secret.roundId) {
		return json({ error: 'Daily session mismatch. Reload the daily frame.' }, { status: 400 });
	}

	const playerId = cookies.get(PLAYER_COOKIE);
	const todayUtc = getTodayUtcDate();
	const cleanStatuses = sanitizeStatuses(body.statuses);
	const includeSingleEp = Boolean(body.includeSingleEp);
	const scopeKey = body.username
		? `user:${body.username.trim().toLowerCase()}:${cleanStatuses.slice().sort().join(',')}:${includeSingleEp ? '1' : '0'}`
		: 'global';

	const serverRecord = playerId ? getDailyRecord(playerId, todayUtc, scopeKey) : null;
	if (serverRecord && serverRecord.roundId === secret.roundId) {
		if (serverRecord.finished || serverRecord.attempts.length >= WORDLE_MAX_ATTEMPTS) {
			return json({ error: 'This daily puzzle is already finished.' }, { status: 400 });
		}
		// Reject stale replayed state tokens
		if (dailyState.attemptsUsed !== serverRecord.attempts.length) {
			return json({ error: 'Daily session out of sync. Reloading latest state.' }, { status: 409 });
		}
	}

	if (dailyState.finished || dailyState.attemptsUsed >= WORDLE_MAX_ATTEMPTS) {
		return json({ error: 'This daily puzzle is already finished.' }, { status: 400 });
	}

	const attemptNumber = dailyState.attemptsUsed + 1;
	const skipped = Boolean(body.skipped);

	if (skipped) {
		const nextStateToken = sealPayload<SealedDailyState>({
			v: 1,
			roundId: secret.roundId,
			attemptsUsed: WORDLE_MAX_ATTEMPTS,
			finished: true,
			usedKeys: dailyState.usedKeys
		});

		const giveUpAttempt = {
			attemptNumber,
			guessedTitle: 'Gave up',
			guessedEpisode: 0,
			guessedYear: null,
			animeStatus: 'miss' as const,
			yearStatus: 'miss' as const,
			yearDirection: null,
			episodeStatus: 'miss' as const,
			episodeDirection: null,
			solved: false
		};

		if (playerId) {
			saveDailyRecord(playerId, {
				date: todayUtc,
				scopeKey,
				roundId: secret.roundId,
				roundToken: body.roundToken,
				dailyStateToken: nextStateToken,
				currentImageUrl: secret.reveal.imageUrl,
				attempts: [...(serverRecord?.attempts ?? []), giveUpAttempt],
				usedKeys: dailyState.usedKeys,
				finished: true,
				won: false,
				reveal: secret.reveal,
				updatedAt: Date.now()
			});
		}

		const res: WordleGuessResponse = {
			mode: 'daily',
			attempt: giveUpAttempt,
			finished: true,
			won: false,
			dailyStateToken: nextStateToken,
			nextImageUrl: secret.reveal.imageUrl,
			reveal: secret.reveal
		};
		return json(res);
	}

	if (!guessedTitle || guessedEpisode === null) {
		return json({ error: 'Enter both an anime title and an episode number.' }, { status: 400 });
	}

	const normGuess = normalizeTitle(guessedTitle);
	const guessKey = `${normGuess}#${guessedEpisode}`;
	const usedKeys = serverRecord?.roundId === secret.roundId ? serverRecord.usedKeys : dailyState.usedKeys;
	if (usedKeys.includes(guessKey)) {
		return json(
			{ error: `You already tried "${guessedTitle}" episode ${guessedEpisode}.` },
			{ status: 400 }
		);
	}

	const resolved = await resolveAniListFallback(secret.targetTitles, secret.franchiseTitles);

	// Resolve guessed anime's release year
	let guessedYear: number | null = null;

	if (resolved.targets.some((t) => normalizeTitle(t) === normGuess)) {
		guessedYear = secret.reveal.seasonYear;
	}

	if (guessedYear === null && resolved.lookup?.year) {
		guessedYear = resolved.lookup.year;
	}

	if (guessedYear === null && body.username) {
		try {
			const profile = await fetchAniListProfile({
				username: body.username,
				statuses: cleanStatuses,
				includeSingleEp
			});
			const found = profile.pool.find(
				(item) =>
					normalizeTitle(item.titleRomaji) === normGuess ||
					(item.titleEnglish && normalizeTitle(item.titleEnglish) === normGuess) ||
					item.synonyms.some((s) => normalizeTitle(s) === normGuess)
			);
			if (found?.seasonYear) guessedYear = found.seasonYear;
		} catch {
			// ignore lookup failure
		}
	}

	if (guessedYear === null) {
		const curatedHit = CURATED_GLOBAL_POOL.find(
			(item) =>
				normalizeTitle(item.titleRomaji) === normGuess ||
				(item.titleEnglish && normalizeTitle(item.titleEnglish) === normGuess)
		);
		if (curatedHit?.seasonYear) guessedYear = curatedHit.seasonYear;
	}

	if (guessedYear === null && resolved.lookup === undefined) {
		const looked = await lookupAnimeByTitle(guessedTitle);
		if (looked?.year) guessedYear = looked.year;
	}

	const attempt = evaluateWordleAttempt({
		attemptNumber,
		guessedTitle,
		guessedEpisode,
		guessedYear,
		targetTitles: resolved.targets,
		franchiseTitles: resolved.franchise,
		actualEpisode: secret.reveal.episodeNumber,
		actualYear: secret.reveal.seasonYear,
		totalEpisodes: secret.reveal.totalEpisodes
	});

	const finished = attempt.solved || attemptNumber >= WORDLE_MAX_ATTEMPTS;
	const nextUsedKeys = [...usedKeys, guessKey];

	const nextStateToken = sealPayload<SealedDailyState>({
		v: 1,
		roundId: secret.roundId,
		attemptsUsed: attemptNumber,
		finished,
		usedKeys: nextUsedKeys
	});

	let nextImageUrl: string;
	if (finished) {
		nextImageUrl = secret.reveal.imageUrl;
	} else {
		const nextZoom = WORDLE_ZOOM_STEPS[Math.min(attemptNumber, WORDLE_ZOOM_STEPS.length - 1)];
		nextImageUrl =
			nextZoom <= 1.01
				? secret.reveal.imageUrl
				: mintImageUrl(secret.rawImageUrl, {
						scale: nextZoom,
						originX: secret.originX,
						originY: secret.originY
					});
	}

	if (playerId) {
		saveDailyRecord(playerId, {
			date: todayUtc,
			scopeKey,
			roundId: secret.roundId,
			roundToken: body.roundToken,
			dailyStateToken: nextStateToken,
			currentImageUrl: nextImageUrl,
			attempts: [...(serverRecord?.attempts ?? []), attempt],
			usedKeys: nextUsedKeys,
			finished,
			won: attempt.solved,
			...(finished ? { reveal: secret.reveal } : {}),
			updatedAt: Date.now()
		});
	}

	const response: WordleGuessResponse = {
		mode: 'daily',
		attempt,
		finished,
		won: attempt.solved,
		dailyStateToken: nextStateToken,
		nextImageUrl,
		...(finished ? { reveal: secret.reveal } : {})
	};

	return json(response);
};
