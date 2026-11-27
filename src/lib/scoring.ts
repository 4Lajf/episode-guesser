import type {
	ClassicGuessResponse,
	CompletedClassicRound,
	Direction,
	EpisodeReveal,
	TileStatus,
	WordleAttemptFeedback
} from './types';

export const WORDLE_ZOOM_STEPS = [4.0, 2.8, 2.0, 1.4, 1.0] as const;
export const WORDLE_MAX_ATTEMPTS = 5;
export const CLASSIC_ROUNDS = 5;
export const UNLIMITED_MAX_LIVES = 3;
export const CURATED_POOL_SIZE = 1000;
export const CURATED_COMPACT_POOL_SIZE = 249;

export const DAILY_EPOCH_DATE = '2025-11-27';
const DAILY_EPOCH_MS = Date.UTC(2025, 10, 27);

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
		.replace(/√/g, ' root ')
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
 * Extracts a canonical franchise root from a title by stripping colon-separated subtitles
 * and trailing sequel/season/part/roman-numeral indicators so symmetric franchise matching
 * works both ways ("Overlord" <-> "Overlord III", "Bleach" <-> "Bleach: Thousand-Year Blood War",
 * "Dr. Stone" <-> "Dr. STONE: SCIENCE FUTURE Part 3") without matching truncated partial words
 * like "Mushoku" against "Mushoku Tensei: Isekai Ittara Honki Dasu".
 */
const SEQUEL_SUFFIX_RE =
	/(?:\s+(?:the\s+final(?:\s+season)?|final\s+season|season\s*\d+|\d+(?:st|nd|rd|th)\s+season|part\s*\d+|cour\s*\d+|shippuden|brotherhood|zero|movie|ova|specials?|ii|iii|iv|v|vi|vii|s\d+|\d+))+$/i;

function extractFranchiseRoot(raw: string): string {
	const colonIdx = raw.indexOf(':');
	const beforeColon = colonIdx >= 4 ? raw.slice(0, colonIdx) : raw;
	const normBase = normalizeTitle(beforeColon);
	const stripped = normBase.replace(SEQUEL_SUFFIX_RE, '').trim();
	return stripped.length >= 5 ? stripped : normBase;
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

	// Symmetric franchise root match (e.g. "Overlord" <-> "Overlord III", "Bleach" <-> "Bleach: ...")
	const guessRoot = extractFranchiseRoot(guess);
	if (guessRoot.length >= 5) {
		for (const rawTarget of targetTitles) {
			const targetRoot = extractFranchiseRoot(rawTarget);
			if (targetRoot.length >= 5 && targetRoot === guessRoot) {
				return 'franchise';
			}
		}
	}

	// Prefix fallback for same-franchise season subtitles (requiring full target title or multi-word >= 6 chars)
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
	const scale = Math.max(3.6, Math.min(26, total * 0.18));
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
			episodeStatus = Math.abs(epDiff) <= closeThreshold ? 'close' : 'miss';
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

export function isValidDailyArchiveDate(
	dateStr: string,
	todayUtc: string = getTodayUtcDate()
): boolean {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return false;
	const parsed = new Date(`${dateStr}T00:00:00Z`);
	if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== dateStr) {
		return false;
	}
	return dateStr >= DAILY_EPOCH_DATE && dateStr <= todayUtc;
}

export function shiftUtcDate(dateStr: string, deltaDays: number): string {
	const d = new Date(`${dateStr}T00:00:00Z`);
	d.setUTCDate(d.getUTCDate() + deltaDays);
	return d.toISOString().slice(0, 10);
}

export function listDailyDatesDescending(todayUtc: string = getTodayUtcDate()): string[] {
	const dates: string[] = [];
	const cur = new Date(`${todayUtc}T00:00:00Z`);
	const start = new Date(`${DAILY_EPOCH_DATE}T00:00:00Z`);
	while (cur >= start) {
		dates.push(cur.toISOString().slice(0, 10));
		cur.setUTCDate(cur.getUTCDate() - 1);
	}
	return dates;
}

export function buildWordleShareText(params: {
	puzzleNumber: number;
	scopeLabel?: string;
	attempts: WordleAttemptFeedback[];
	won: boolean;
}): string {
	const { puzzleNumber, attempts, won } = params;
	const scoreStr = won ? `${attempts.length}/${WORDLE_MAX_ATTEMPTS}` : `X/${WORDLE_MAX_ATTEMPTS}`;
	const gaveUp = attempts.some((a) => Boolean(a.gaveUp));
	const animeHitAttempt = attempts.find((a) => a.animeStatus === 'hit')?.attemptNumber ?? null;
	const hasFranchiseHit = attempts.some((a) => a.animeStatus === 'close');
	const points = calculateDailyLeaderboardPoints({
		won,
		gaveUp,
		attemptsUsed: attempts.length,
		animeHitAttempt,
		hasFranchiseHit
	});
	const tile = (status: TileStatus) => {
		if (status === 'hit') return '🟩';
		if (status === 'close') return '🟨';
		return '⬛';
	};

	const lines = attempts.map((a) => `${tile(a.animeStatus)}${tile(a.yearStatus)}${tile(a.episodeStatus)}`);

	return [
		`Episode Guesser #${puzzleNumber} — ${scoreStr} · ${points.toLocaleString('en-US')} pts`,
		...lines,
		'<https://episode-guesser.karczma.moe>'
	].join('\n');
}

export function buildClassicShareText(params: {
	username?: string;
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
		`Episode Guesser Classic — ${total.toLocaleString('en-US')} / ${max.toLocaleString('en-US')}`,
		bars,
		'<https://episode-guesser.karczma.moe>'
	].join('\n');
}

export function buildUnlimitedShareText(params: {
	username?: string;
	rounds: CompletedClassicRound[];
	peakStreak: number;
}): string {
	const total = params.rounds.reduce((sum, r) => sum + r.result.totalPoints, 0);
	const bars = params.rounds
		.slice(0, 20)
		.map((r) => {
			if (r.result.animeMatch === 'exact' && r.result.totalPoints >= 800) return '🟩';
			if (r.result.animeMatch === 'exact' || r.result.animeMatch === 'franchise') return '🟨';
			return '🟥';
		})
		.join('');
	const overflow = params.rounds.length > 20 ? ` +${params.rounds.length - 20}` : '';

	return [
		`Episode Guesser Unlimited — ${total.toLocaleString('en-US')} pts · ${params.rounds.length} ${params.rounds.length === 1 ? 'frame' : 'frames'} · Streak ${params.peakStreak}`,
		`${bars}${overflow}`,
		'<https://episode-guesser.karczma.moe>'
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

export function getNextClassicRankHint(totalScore: number, maxScore: number): string {
	if (maxScore <= 0) return '';
	const tiers: Array<{ ratio: number; name: string }> = [
		{ ratio: 0.4, name: 'In-Betweener' },
		{ ratio: 0.6, name: 'Layout Artist' },
		{ ratio: 0.78, name: 'Episode Director' },
		{ ratio: 0.92, name: 'Key Animator' }
	];
	for (const tier of tiers) {
		const threshold = Math.round(tier.ratio * maxScore);
		if (totalScore < threshold) {
			return `Next rank: ${tier.name} at ${threshold.toLocaleString('en-US')} pts`;
		}
	}
	return 'Top rank achieved';
}

/**
 * Calculates Daily Leaderboard points on a 0–1,000 scale:
 * - Solved in 1..5 guesses: 1000 / 850 / 700 / 550 / 400 base points
 *   plus +25 pts for each attempt earlier the anime itself was identified
 *   (strictly preserving fewer total guesses > more total guesses).
 * - Unsolved (missed episode after finding anime): 200..300 pts (or 150 if gave up after finding anime).
 * - Same franchise hit without finding the exact anime: 100 pts.
 */
export function calculateDailyLeaderboardPoints(params: {
	won: boolean;
	gaveUp: boolean;
	attemptsUsed: number;
	animeHitAttempt: number | null;
	hasFranchiseHit?: boolean;
}): number {
	const attempts = Math.min(WORDLE_MAX_ATTEMPTS, Math.max(1, Math.round(params.attemptsUsed)));
	if (params.won) {
		const solveBase = [1000, 850, 700, 550, 400][attempts - 1] ?? 400;
		const hitAt = params.animeHitAttempt ?? attempts;
		const earlyAnimeBonus = Math.max(0, attempts - hitAt) * 25;
		return Math.min(1000, solveBase + earlyAnimeBonus);
	}
	if (params.animeHitAttempt !== null && params.animeHitAttempt >= 1) {
		if (params.gaveUp) return 150;
		return 200 + Math.max(0, WORDLE_MAX_ATTEMPTS - params.animeHitAttempt) * 25;
	}
	if (params.hasFranchiseHit) return 100;
	return 0;
}
