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
import { lookupCatalogByTitle } from '$lib/server/animeCatalog';
import { getAuthUser, getEffectiveDailyPlayerId } from '$lib/server/auth';
import { getDailyRecord, saveDailyRecord } from '$lib/server/dailyStore';
import { recordDailyLeaderboardResult } from '$lib/server/leaderboardStore';
import {
	mintImageUrl,
	type SealedDailyState,
	type SealedRoundSecret
} from '$lib/server/picker';
import { sealPayload, unsealPayload } from '$lib/server/token';
import type { ListStatus, WordleGuessResponse } from '$lib/types';
import type { RequestHandler } from './$types';

const ROUND_TTL_MS = 36 * 60 * 60 * 1000; // 36 hours
const MAX_CONSUMED_CLASSIC_ROUNDS = 10_000;

// Synchronous in-flight mutex per (playerId, dailyDate, scopeKey) prevents parallel requests
// with the same Daily state token from getting multiple feedbacks on a single attempt.
const inFlightDailySessions = new Set<string>();

// Bounded set of already-scored Classic/Unlimited roundIds so each round token is one-shot.
const consumedClassicRounds = new Set<string>();

function markClassicRoundConsumed(roundId: string): void {
	if (consumedClassicRounds.size >= MAX_CONSUMED_CLASSIC_ROUNDS) {
		const oldest = consumedClassicRounds.values().next().value;
		if (oldest) consumedClassicRounds.delete(oldest);
	}
	consumedClassicRounds.add(roundId);
}

export function _clearConsumedRoundsForTests(): void {
	consumedClassicRounds.clear();
}

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
	if (
		!secret ||
		secret.typ !== 'round' ||
		secret.v !== 1 ||
		Date.now() - secret.createdAt > ROUND_TTL_MS
	) {
		return json({ error: 'Round expired or invalid. Start a fresh frame.' }, { status: 400 });
	}

	const guessedTitle = typeof body.guessedTitle === 'string' ? body.guessedTitle.trim() : '';
	const parsedEp =
		body.guessedEpisode !== null && body.guessedEpisode !== undefined
			? Number(body.guessedEpisode)
			: null;
	const guessedEpisode =
		parsedEp !== null && Number.isFinite(parsedEp) && parsedEp >= 1 ? Math.round(parsedEp) : null;

	// Helper: enrich target/franchise titles via local offline catalog first (0ms, zero AniList quota),
	// then fall back to AniList ID lookup ONLY on exact normalized title match.
	async function resolveTitleMetadata(
		currentTargets: string[],
		currentFranchise: string[]
	): Promise<{
		targets: string[];
		franchise: string[];
		year: number | null;
		lookup?: AnimeLookupResult | null;
	}> {
		if (!guessedTitle) return { targets: currentTargets, franchise: currentFranchise, year: null };
		const direct = matchAnimeTitle(guessedTitle, currentTargets, currentFranchise);

		const catalogHit = lookupCatalogByTitle(guessedTitle);
		if (catalogHit) {
			if (direct === 'exact' || catalogHit.id === secret!.reveal.anilistId) {
				return {
					targets:
						direct === 'exact' ? currentTargets : [...currentTargets, guessedTitle],
					franchise: currentFranchise,
					year: catalogHit.year
				};
			}
			if (direct === 'wrong' && catalogHit.relatedIds.includes(secret!.reveal.anilistId)) {
				return {
					targets: currentTargets,
					franchise: [...currentFranchise, guessedTitle],
					year: catalogHit.year
				};
			}
			return { targets: currentTargets, franchise: currentFranchise, year: catalogHit.year };
		}

		if (direct === 'exact') {
			return { targets: currentTargets, franchise: currentFranchise, year: secret!.reveal.seasonYear };
		}

		const lookup = await lookupAnimeByTitle(guessedTitle);
		if (!lookup) {
			return { targets: currentTargets, franchise: currentFranchise, year: null, lookup: null };
		}

		if (lookup.exactTitleMatch) {
			if (lookup.id === secret!.reveal.anilistId) {
				return {
					targets: [...currentTargets, guessedTitle],
					franchise: currentFranchise,
					year: lookup.year,
					lookup
				};
			}
			if (direct === 'wrong' && lookup.relatedIds.includes(secret!.reveal.anilistId)) {
				return {
					targets: currentTargets,
					franchise: [...currentFranchise, guessedTitle],
					year: lookup.year,
					lookup
				};
			}
		}

		return { targets: currentTargets, franchise: currentFranchise, year: lookup.year, lookup };
	}

	// Classic / Unlimited evaluation (one-shot per roundId)
	if (secret.mode === 'classic' || secret.mode === 'unlimited') {
		const skipped = Boolean(body.skipped);
		if (!skipped && !guessedTitle) {
			return json(
				{ error: 'Pick an anime title before submitting, or skip the frame.' },
				{ status: 400 }
			);
		}

		if (consumedClassicRounds.has(secret.roundId)) {
			return json(
				{ error: 'This round was already scored. Load the next frame.' },
				{ status: 409 }
			);
		}
		markClassicRoundConsumed(secret.roundId);

		const resolved = skipped
			? { targets: secret.targetTitles, franchise: secret.franchiseTitles, year: null }
			: await resolveTitleMetadata(secret.targetTitles, secret.franchiseTitles);

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

	const effectivePid = getEffectiveDailyPlayerId(cookies);
	if (!effectivePid || effectivePid !== dailyState.playerId) {
		return json(
			{ error: 'Daily session cookie missing or mismatched. Reload the daily frame.' },
			{ status: 403 }
		);
	}

	const authUser = getAuthUser(cookies);

	const { dailyDate, scopeKey, playerId } = dailyState;
	const lockKey = `${playerId}|${dailyDate}|${scopeKey}`;

	// Synchronously claim the Daily session lock before any await
	if (inFlightDailySessions.has(lockKey)) {
		return json(
			{ error: 'A guess is already being checked for this daily puzzle.' },
			{ status: 409 }
		);
	}
	inFlightDailySessions.add(lockKey);

	try {
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

			const finalAttempts = [...existingAttempts, giveUpAttempt];
			const now = Date.now();
			saveDailyRecord(playerId, {
				date: dailyDate,
				scopeKey,
				roundId: secret.roundId,
				roundToken: body.roundToken,
				dailyStateToken: nextStateToken,
				currentImageUrl: secret.reveal.imageUrl,
				attempts: finalAttempts,
				usedKeys,
				finished: true,
				won: false,
				reveal: secret.reveal,
				updatedAt: now
			});

			if (authUser && scopeKey === 'global') {
				recordDailyLeaderboardResult({
					date: dailyDate,
					user: authUser,
					attempts: finalAttempts,
					won: false,
					startedAt: secret.createdAt,
					completedAt: now
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
		if (usedKeys.includes(guessKey)) {
			return json(
				{ error: `You already tried "${guessedTitle}" episode ${guessedEpisode}.` },
				{ status: 400 }
			);
		}

		const resolved = await resolveTitleMetadata(secret.targetTitles, secret.franchiseTitles);

		// Resolve guessed anime's release year (target -> offline catalog -> curated -> user list -> AniList)
		let guessedYear: number | null = resolved.year;

		if (guessedYear === null && resolved.targets.some((t) => normalizeTitle(t) === normGuess)) {
			guessedYear = secret.reveal.seasonYear;
		}

		if (guessedYear === null) {
			const curatedHit = CURATED_GLOBAL_POOL.find(
				(item) =>
					normalizeTitle(item.titleRomaji) === normGuess ||
					(item.titleEnglish && normalizeTitle(item.titleEnglish) === normGuess)
			);
			if (curatedHit?.seasonYear) guessedYear = curatedHit.seasonYear;
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

		const finalAttempts = [...existingAttempts, attempt];
		const now = Date.now();
		saveDailyRecord(playerId, {
			date: dailyDate,
			scopeKey,
			roundId: secret.roundId,
			roundToken: body.roundToken,
			dailyStateToken: nextStateToken,
			currentImageUrl: nextImageUrl,
			attempts: finalAttempts,
			usedKeys: nextUsedKeys,
			finished,
			won: attempt.solved,
			...(finished ? { reveal: secret.reveal } : {}),
			updatedAt: now
		});

		if (finished && authUser && scopeKey === 'global') {
			recordDailyLeaderboardResult({
				date: dailyDate,
				user: authUser,
				attempts: finalAttempts,
				won: attempt.solved,
				startedAt: secret.createdAt,
				completedAt: now
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
	} finally {
		inFlightDailySessions.delete(lockKey);
	}
};
