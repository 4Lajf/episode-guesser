import type {
	ClassicGuessResponse,
	CompletedClassicRound,
	Direction,
	EpisodeReveal,
	TileStatus,
	WordleAttemptFeedback
} from './types';

export const WORDLE_ZOOM_STEPS = [2.2, 1.6, 1.3, 1.1, 1.0] as const;
export const WORDLE_MAX_ATTEMPTS = 5;
export const CLASSIC_ROUNDS = 5;

const DAILY_EPOCH_MS = Date.UTC(2026, 0, 1);

/**
 * Normalizes an anime title for fair comparison across AniList, AnisongDB, and ani.zip.
 * Handles backticks (ani.zip quirk), smart quotes, diacritics, Unicode × vs x,
 * Japanese romanization variants (wo↔o, ou/oo→o, uu→u), trailing year parentheticals
 * like "(2011)", punctuation, and case.
 */
export function normalizeTitle(raw: string): string {
	return raw
		.normalize('NFKD')
		.replace(/[\u0300-\u036f]/g, '')
		.replace(/\s*\(\d{4}\)\s*$/g, '')
		.replace(/×/g, ' x ')
		.replace(/[`'’‘"“”]/g, '')
		.replace(/[‐‑‒–—―]/g, ' ')
		.replace(/[^\p{L}\p{N}]+/gu, ' ')
		.replace(/\s+/g, ' ')
		.trim()
		.toLowerCase()
		.replace(/\bwo\b/g, 'o')
		.replace(/ou/g, 'o')
		.replace(/oo/g, 'o')
		.replace(/uu/g, 'u');
}

/**
 * Deduplication key for dropdown titles that preserves trailing "(YYYY)" release years
 * so remakes like "Hunter x Hunter (2011)" and "Fruits Basket (2019)" stay distinct.
 */
export function dropdownDedupeKey(raw: string): string {
	const yearMatch = raw.match(/\((\d{4})\)\s*$/);
	const base = normalizeTitle(raw);
	return yearMatch ? `${base} (${yearMatch[1]})` : base;
}

export function matchAnimeTitle(
	guess: string,
	targetTitles: string[],
	franchiseTitles: string[] = []
): 'exact' | 'franchise' | 'wrong' {
	const normGuess = normalizeTitle(guess);
	if (!normGuess) return 'wrong';

	const normTargets = new Set(targetTitles.map(normalizeTitle).filter(Boolean));
	if (normTargets.has(normGuess)) return 'exact';

	const normFranchise = new Set(franchiseTitles.map(normalizeTitle).filter(Boolean));
	if (normFranchise.has(normGuess)) return 'franchise';

	// Prefix fallback for same-franchise season subtitles (e.g. "Steins;Gate 0" vs "Steins;Gate",
	// "Dr. Stone" vs "Dr. STONE: SCIENCE FUTURE Part 3"), requiring the full target title or a
	// multi-word prefix (>= 6 chars) so single truncated words like "Mushoku" never score.
	if (normGuess.length >= 5) {
		for (const t of normTargets) {
			if (
				t.length >= 5 &&
				(normGuess.startsWith(`${t} `) ||
					(normGuess.includes(' ') && normGuess.length >= 6 && t.startsWith(`${normGuess} `)))
			) {
				return 'franchise';
			}
		}
	}

	return 'wrong';
}

export function scoreEpisodeProximity(
	guessedEpisode: number,
	actualEpisode: number,
	totalEpisodes: number
): { points: number; distance: number; label: string } {
	const cleanGuess = Math.max(1, Math.round(guessedEpisode));
	const distance = Math.abs(cleanGuess - actualEpisode);

	if (distance === 0) {
		return { points: 500, distance: 0, label: 'Exact episode' };
	}

	const total = Math.max(totalEpisodes, actualEpisode, 12);
	const scale = Math.max(2.2, Math.min(24, total * 0.14));
	const raw = Math.round(500 * Math.exp(-distance / scale));
	const points = raw < 15 ? 0 : raw;

	return {
		points,
		distance,
		label: distance === 1 ? '1 episode off' : `${distance} episodes off`
	};
}

export function evaluateClassicGuess(params: {
	mode: 'classic' | 'unlimited';
	guessedTitle: string;
	guessedEpisode: number | null;
	skipped: boolean;
	targetTitles: string[];
	franchiseTitles: string[];
	reveal: EpisodeReveal;
}): ClassicGuessResponse {
	const { mode, guessedTitle, guessedEpisode, skipped, targetTitles, franchiseTitles, reveal } =
		params;

	if (skipped) {
		return {
			mode,
			skipped: true,
			guessedTitle: '',
			guessedEpisode: null,
			animeMatch: 'wrong',
			animePoints: 0,
			episodePoints: 0,
			totalPoints: 0,
			episodeDistance: null,
			episodeLabel: 'Skipped',
			reveal
		};
	}

	const animeMatch = matchAnimeTitle(guessedTitle, targetTitles, franchiseTitles);
	const animePoints = animeMatch === 'exact' ? 500 : animeMatch === 'franchise' ? 200 : 0;

	let episodePoints = 0;
	let episodeDistance: number | null = null;
	let episodeLabel = 'Wrong anime';

	if (animeMatch === 'exact' && guessedEpisode !== null && Number.isFinite(guessedEpisode)) {
		const epScore = scoreEpisodeProximity(
			guessedEpisode,
			reveal.episodeNumber,
			reveal.totalEpisodes
		);
		episodePoints = epScore.points;
		episodeDistance = epScore.distance;
		episodeLabel = epScore.label;
	} else if (animeMatch === 'franchise') {
		episodeLabel = 'Right franchise, different entry';
	}

	return {
		mode,
		skipped: false,
		guessedTitle: guessedTitle.trim(),
		guessedEpisode,
		animeMatch,
		animePoints,
		episodePoints,
		totalPoints: animePoints + episodePoints,
		episodeDistance,
		episodeLabel,
		reveal
	};
}

export function evaluateWordleAttempt(params: {
	attemptNumber: number;
	guessedTitle: string;
	guessedEpisode: number;
	guessedYear: number | null;
	targetTitles: string[];
	franchiseTitles: string[];
	actualEpisode: number;
	actualYear: number | null;
	totalEpisodes: number;
}): WordleAttemptFeedback {
	const {
		attemptNumber,
		guessedTitle,
		guessedEpisode,
		guessedYear,
		targetTitles,
		franchiseTitles,
		actualEpisode,
		actualYear,
		totalEpisodes
	} = params;

	const match = matchAnimeTitle(guessedTitle, targetTitles, franchiseTitles);
	const animeStatus: TileStatus =
		match === 'exact' ? 'hit' : match === 'franchise' ? 'close' : 'miss';

	let yearStatus: TileStatus = 'miss';
	let yearDirection: Direction = null;
	if (guessedYear !== null && actualYear !== null) {
		const yearDiff = actualYear - guessedYear;
		if (yearDiff === 0) {
			yearStatus = 'hit';
			yearDirection = 'exact';
		} else {
			yearStatus = Math.abs(yearDiff) <= 2 ? 'close' : 'miss';
			yearDirection = yearDiff > 0 ? 'up' : 'down';
		}
	}

	const cleanEp = Math.max(1, Math.round(guessedEpisode));
	const epDiff = actualEpisode - cleanEp;
	const closeThreshold = Math.max(2, Math.min(6, Math.round(totalEpisodes * 0.1)));

	let episodeStatus: TileStatus = 'miss';
	let episodeDirection: Direction = null;

	if (animeStatus === 'hit') {
		if (epDiff === 0) {
			episodeStatus = 'hit';
			episodeDirection = 'exact';
		} else {
			episodeStatus = Math.abs(epDiff) <= closeThreshold ? 'close' : 'miss';
			episodeDirection = epDiff > 0 ? 'up' : 'down';
		}
	} else {
		if (epDiff === 0) {
			episodeStatus = 'close';
			episodeDirection = 'exact';
		} else {
			episodeStatus = 'miss';
			episodeDirection = epDiff > 0 ? 'up' : 'down';
		}
	}

	const solved = animeStatus === 'hit' && epDiff === 0;

	return {
		attemptNumber,
		guessedTitle: guessedTitle.trim(),
		guessedEpisode: cleanEp,
		guessedYear,
		animeStatus,
		yearStatus,
		yearDirection,
		episodeStatus,
		episodeDirection,
		solved
	};
}

export function getTodayUtcDate(now: Date = new Date()): string {
	return now.toISOString().slice(0, 10);
}

export function getDailyPuzzleNumber(dateStr: string): number {
	const [y, m, d] = dateStr.split('-').map(Number);
	const ts = Date.UTC(y, (m || 1) - 1, d || 1);
	return Math.max(1, Math.floor((ts - DAILY_EPOCH_MS) / 86_400_000) + 1);
}

export function buildWordleShareText(params: {
	puzzleNumber: number;
	scopeLabel: string;
	attempts: WordleAttemptFeedback[];
	won: boolean;
}): string {
	const { puzzleNumber, scopeLabel, attempts, won } = params;
	const scoreStr = won ? `${attempts.length}/${WORDLE_MAX_ATTEMPTS}` : `X/${WORDLE_MAX_ATTEMPTS}`;
	const tile = (status: TileStatus) => {
		if (status === 'hit') return '🟩';
		if (status === 'close') return '🟨';
		return '⬛';
	};
	const arrow = (dir: Direction) => {
		if (dir === 'up') return '⬆️';
		if (dir === 'down') return '⬇️';
		if (dir === 'exact') return '✅';
		return '🏳️';
	};

	const lines = attempts.map((a) => {
		const aTile = tile(a.animeStatus);
		const yTile = tile(a.yearStatus);
		const eTile = tile(a.episodeStatus);
		return `${aTile}${yTile}${eTile} ${arrow(a.episodeDirection)}`;
	});

	return [
		`Episode Guesser Daily #${puzzleNumber} (${scopeLabel}) — ${scoreStr}`,
		...lines,
		'https://episode-guesser.karczma.moe'
	].join('\n');
}

export function buildClassicShareText(params: {
	username: string;
	rounds: CompletedClassicRound[];
}): string {
	const total = params.rounds.reduce((sum, r) => sum + r.result.totalPoints, 0);
	const max = params.rounds.length * 1000;
	const bars = params.rounds
		.map((r) => {
			const p = r.result.totalPoints;
			if (p >= 800) return '🟩';
			if (p >= 450) return '🟨';
			return '⬛';
		})
		.join('');

	return [
		`Episode Guesser (${params.username}) — ${total.toLocaleString('en-US')} / ${max.toLocaleString('en-US')}`,
		bars,
		'https://episode-guesser.karczma.moe'
	].join('\n');
}

export function getClassicRank(totalScore: number, maxScore: number): string {
	const ratio = maxScore > 0 ? totalScore / maxScore : 0;
	if (ratio >= 0.92) return 'Key Animator';
	if (ratio >= 0.78) return 'Episode Director';
	if (ratio >= 0.6) return 'Layout Artist';
	if (ratio >= 0.4) return 'In-Betweener';
	return 'Fresh Viewer';
}
