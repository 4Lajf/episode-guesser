import { json } from '@sveltejs/kit';
import { CURATED_GLOBAL_POOL } from '$lib/curated';
import {
	evaluateClassicGuess,
	evaluateWordleAttempt,
	normalizeTitle,
	WORDLE_MAX_ATTEMPTS,
	WORDLE_ZOOM_STEPS
} from '$lib/scoring';
import { fetchAniListProfile, lookupAnimeYearByTitle, sanitizeStatuses } from '$lib/server/anilist';
import {
	mintImageUrl,
	type SealedDailyState,
	type SealedRoundSecret
} from '$lib/server/picker';
import { sealPayload, unsealPayload } from '$lib/server/token';
import type { ListStatus, WordleGuessResponse } from '$lib/types';
import type { RequestHandler } from './$types';

const ROUND_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export const POST: RequestHandler = async ({ request }) => {
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

	// Classic / Unlimited evaluation
	if (secret.mode === 'classic' || secret.mode === 'unlimited') {
		const skipped = Boolean(body.skipped);
		if (!skipped && !guessedTitle) {
			return json(
				{ error: 'Pick an anime title before submitting, or skip the frame.' },
				{ status: 400 }
			);
		}

		const result = evaluateClassicGuess({
			mode: secret.mode,
			guessedTitle,
			guessedEpisode,
			skipped,
			targetTitles: secret.targetTitles,
			franchiseTitles: secret.franchiseTitles,
			reveal: secret.reveal
		});

		return json(result);
	}

	// Daily Wordle evaluation — strictly verified via sealed dailyStateToken
	if (!body.dailyStateToken || typeof body.dailyStateToken !== 'string') {
		return json({ error: 'Missing Daily session state. Reload the daily frame.' }, { status: 400 });
	}

	const dailyState = unsealPayload<SealedDailyState>(body.dailyStateToken);
	if (!dailyState || dailyState.v !== 1 || dailyState.roundId !== secret.roundId) {
		return json({ error: 'Daily session mismatch. Reload the daily frame.' }, { status: 400 });
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

		const res: WordleGuessResponse = {
			mode: 'daily',
			attempt: {
				attemptNumber,
				guessedTitle: 'Gave up',
				guessedEpisode: 0,
				guessedYear: null,
				animeStatus: 'miss',
				yearStatus: 'miss',
				yearDirection: null,
				episodeStatus: 'miss',
				episodeDirection: null,
				solved: false
			},
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
	if (dailyState.usedKeys.includes(guessKey)) {
		return json(
			{ error: `You already tried "${guessedTitle}" episode ${guessedEpisode}.` },
			{ status: 400 }
		);
	}

	// Resolve guessed anime's release year
	let guessedYear: number | null = null;

	if (secret.targetTitles.some((t) => normalizeTitle(t) === normGuess)) {
		guessedYear = secret.reveal.seasonYear;
	}

	if (guessedYear === null && body.username) {
		try {
			const profile = await fetchAniListProfile({
				username: body.username,
				statuses: sanitizeStatuses(body.statuses),
				includeSingleEp: Boolean(body.includeSingleEp)
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

	if (guessedYear === null) {
		guessedYear = await lookupAnimeYearByTitle(guessedTitle);
	}

	const attempt = evaluateWordleAttempt({
		attemptNumber,
		guessedTitle,
		guessedEpisode,
		guessedYear,
		targetTitles: secret.targetTitles,
		franchiseTitles: secret.franchiseTitles,
		actualEpisode: secret.reveal.episodeNumber,
		actualYear: secret.reveal.seasonYear,
		totalEpisodes: secret.reveal.totalEpisodes
	});

	const finished = attempt.solved || attemptNumber >= WORDLE_MAX_ATTEMPTS;

	const nextStateToken = sealPayload<SealedDailyState>({
		v: 1,
		roundId: secret.roundId,
		attemptsUsed: attemptNumber,
		finished,
		usedKeys: [...dailyState.usedKeys, guessKey]
	});

	// Mint the next server-cropped image URL (or full uncropped frame when finished)
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
