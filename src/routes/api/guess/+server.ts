import { json } from '@sveltejs/kit';
import { CURATED_GLOBAL_POOL } from '$lib/curated';
import {
	evaluateClassicGuess,
	evaluateWordleAttempt,
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
	if (!secret || secret.typ !== 'round' || secret.v !== 1 || Date.now() - secret.createdAt > ROUND_TTL_MS) {
		return json({ error: 'Round expired or invalid. Start a fresh frame.' }, { status: 400 });
	}

	const guessedTitle = typeof body.guessedTitle === 'string' ? body.guessedTitle.trim() : '';
	const parsedEp =
		body.guessedEpisode !== null && body.guessedEpisode !== undefined
			? Number(body.guessedEpisode)
			: null;
	const guessedEpisode =
		parsedEp !== null && Number.isFinite(parsedEp) && parsedEp >= 1 ? Math.round(parsedEp) : null;

	// Helper: enrich target/franchise titles via AniList ID lookup ONLY when the normalized
	// title matches the returned AniList entry EXACTLY (prevents partial free-text like "Mushoku"
	// from scoring exact points via AniList fuzzy search).
	async function resolveAniListFallback(
		currentTargets: string[],
		currentFranchise: string[]
	): Promise<{ targets: string[]; franchise: string[]; lookup?: AnimeLookupResult | null }> {
		if (!guessedTitle) return { targets: currentTargets, franchise: currentFranchise };
		const direct = matchAnimeTitle(guessedTitle, currentTargets, currentFranchise);
		if (direct === 'exact') return { targets: currentTargets, franchise: currentFranchise };

		const lookup = await lookupAnimeByTitle(guessedTitle);
		if (!lookup) return { targets: currentTargets, franchise: currentFranchise, lookup: null };

		if (lookup.exactTitleMatch) {
			if (lookup.id === secret!.reveal.anilistId) {
				return { targets: [...currentTargets, guessedTitle], franchise: currentFranchise, lookup };
			}
			if (direct === 'wrong' && lookup.relatedIds.includes(secret!.reveal.anilistId)) {
				return {
					targets: currentTargets,
					franchise: [...currentFranchise, guessedTitle],
					lookup
				};
			}
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

	// Daily Wordle evaluation — strictly bound to sealed playerId, dailyDate, scopeKey, and roundId
	if (!body.dailyStateToken || typeof body.dailyStateToken !== 'string') {
		return json({ error: 'Missing Daily session state. Reload the daily frame.' }, { status: 400 });
	}

	const dailyState = unsealPayload<SealedDailyState>(body.dailyStateToken);
	if (
		!dailyState ||
		dailyState.typ !== 'daily' ||
		dailyState.v !== 1 ||
		dailyState.roundId !== secret.roundId ||
		!secret.playerId ||
		!secret.dailyDate ||
		!secret.scopeKey ||
		dailyState.playerId !== secret.playerId ||
		dailyState.dailyDate !== secret.dailyDate ||
		dailyState.scopeKey !== secret.scopeKey
	) {
		return json({ error: 'Daily session mismatch. Reload the daily frame.' }, { status: 400 });
	}

	const cookiePid = cookies.get(PLAYER_COOKIE);
	if (!cookiePid || cookiePid !== dailyState.playerId) {
		return json(
			{ error: 'Daily session cookie missing or mismatched. Reload the daily frame.' },
			{ status: 403 }
		);
	}

	// Always read dailyDate & scopeKey exclusively from the sealed token (never from body or current clock)
	const { dailyDate, scopeKey, playerId } = dailyState;
	const serverRecord = getDailyRecord(playerId, dailyDate, scopeKey);

	if (serverRecord) {
		if (serverRecord.roundId !== secret.roundId) {
			return json({ error: 'Daily session out of sync. Reloading latest state.' }, { status: 409 });
		}
		if (serverRecord.finished || serverRecord.attempts.length >= WORDLE_MAX_ATTEMPTS) {
			return json({ error: 'This daily puzzle is already finished.' }, { status: 400 });
		}
		if (dailyState.attemptsUsed !== serverRecord.attempts.length) {
			return json({ error: 'Daily session out of sync. Reloading latest state.' }, { status: 409 });
		}
	} else if (dailyState.attemptsUsed > 0) {
		// Server store was cleared (e.g. ephemeral restart without persistent volume) while client holds mid-run token
		return json({ error: 'Daily session out of sync. Reloading latest state.' }, { status: 409 });
	}

	if (dailyState.finished || dailyState.attemptsUsed >= WORDLE_MAX_ATTEMPTS) {
		return json({ error: 'This daily puzzle is already finished.' }, { status: 400 });
	}

	const attemptNumber = dailyState.attemptsUsed + 1;
	const skipped = Boolean(body.skipped);
	const existingAttempts = serverRecord?.attempts ?? [];
	const usedKeys = serverRecord ? serverRecord.usedKeys : dailyState.usedKeys;

	if (skipped) {
		const nextStateToken = sealPayload<SealedDailyState>({
			typ: 'daily',
			v: 1,
			roundId: secret.roundId,
			dailyDate,
			scopeKey,
			playerId,
			attemptsUsed: WORDLE_MAX_ATTEMPTS,
			finished: true,
			usedKeys
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
			solved: false,
			gaveUp: true
		};

		saveDailyRecord(playerId, {
			date: dailyDate,
			scopeKey,
			roundId: secret.roundId,
			roundToken: body.roundToken,
			dailyStateToken: nextStateToken,
			currentImageUrl: secret.reveal.imageUrl,
			attempts: [...existingAttempts, giveUpAttempt],
			usedKeys,
			finished: true,
			won: false,
			reveal: secret.reveal,
			updatedAt: Date.now()
		});

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
		typ: 'daily',
		v: 1,
		roundId: secret.roundId,
		dailyDate,
		scopeKey,
		playerId,
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

	saveDailyRecord(playerId, {
		date: dailyDate,
		scopeKey,
		roundId: secret.roundId,
		roundToken: body.roundToken,
		dailyStateToken: nextStateToken,
		currentImageUrl: nextImageUrl,
		attempts: [...existingAttempts, attempt],
		usedKeys: nextUsedKeys,
		finished,
		won: attempt.solved,
		...(finished ? { reveal: secret.reveal } : {}),
		updatedAt: Date.now()
	});

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
