import { getTodayUtcDate, matchAnimeTitle, normalizeTitle } from './scoring';
import type { Direction, TileStatus, VnAttemptFeedback, VnCompletedSurvivalRound } from './types';

export const VN_MAX_ATTEMPTS = 5;
export const VN_SURVIVAL_MAX_LIVES = 3;
export const VN_SURVIVAL_STAGE_POINTS = [1000, 800, 600, 400, 200] as const;
export const VN_STAGE_LABELS = [
	'UI skin',
	'Full UI',
	'Half frame',
	'Wide frame',
	'Full frame'
] as const;

export const VN_DAILY_EPOCH_DATE = '2025-11-27';
const VN_DAILY_EPOCH_MS = Date.UTC(2025, 10, 27);

export function getVnDailyPuzzleNumber(dateStr: string): number {
	const [y, m, d] = dateStr.split('-').map(Number);
	const ts = Date.UTC(y, (m || 1) - 1, d || 1);
	return Math.max(1, Math.floor((ts - VN_DAILY_EPOCH_MS) / 86_400_000) + 1);
}

export function isValidVnDailyDate(
	dateStr: string,
	todayUtc: string = getTodayUtcDate()
): boolean {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return false;
	const parsed = new Date(`${dateStr}T00:00:00Z`);
	if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== dateStr) {
		return false;
	}
	return dateStr >= VN_DAILY_EPOCH_DATE && dateStr <= todayUtc;
}

export function listVnDailyDatesDescending(todayUtc: string = getTodayUtcDate()): string[] {
	const dates: string[] = [];
	const cur = new Date(`${todayUtc}T00:00:00Z`);
	const start = new Date(`${VN_DAILY_EPOCH_DATE}T00:00:00Z`);
	while (cur >= start) {
		dates.push(cur.toISOString().slice(0, 10));
		cur.setUTCDate(cur.getUTCDate() - 1);
	}
	return dates;
}

export function formatVnLength(minutes: number | null): string {
	if (minutes === null || !Number.isFinite(minutes) || minutes <= 0) return '—';
	if (minutes < 60) return `${Math.round(minutes)}m`;
	const hours = minutes / 60;
	if (hours < 10) return `${hours.toFixed(1).replace(/\.0$/, '')}h`;
	return `${Math.round(hours)}h`;
}

export function evaluateVnAttempt(params: {
	attemptNumber: number;
	guessedId: string | null;
	guessedTitle: string;
	guessedYear: number | null;
	guessedLengthMinutes: number | null;
	guessedLengthBucket: number | null;
	guessedDevelopers: string[];
	targetId: string;
	targetTitles: string[];
	targetFranchiseIds: string[];
	targetFranchiseTitles: string[];
	targetYear: number;
	targetLengthMinutes: number;
	targetLengthBucket: number;
	targetDevelopers: string[];
}): VnAttemptFeedback {
	const {
		attemptNumber,
		guessedId,
		guessedTitle,
		guessedYear,
		guessedLengthMinutes,
		guessedLengthBucket,
		guessedDevelopers,
		targetId,
		targetTitles,
		targetFranchiseIds,
		targetFranchiseTitles,
		targetYear,
		targetLengthMinutes,
		targetLengthBucket,
		targetDevelopers
	} = params;

	let vnStatus: TileStatus = 'miss';
	if (guessedId && guessedId === targetId) {
		vnStatus = 'hit';
	} else {
		const titleMatch = matchAnimeTitle(guessedTitle, targetTitles, targetFranchiseTitles);
		if (titleMatch === 'exact') {
			vnStatus = 'hit';
		} else if (
			(guessedId && targetFranchiseIds.includes(guessedId)) ||
			titleMatch === 'franchise'
		) {
			vnStatus = 'close';
		}
	}

	let yearStatus: TileStatus = 'miss';
	let yearDirection: Direction = null;
	if (guessedYear !== null) {
		const diff = targetYear - guessedYear;
		if (diff === 0) {
			yearStatus = 'hit';
			yearDirection = 'exact';
		} else {
			yearStatus = Math.abs(diff) <= 2 ? 'close' : 'miss';
			yearDirection = diff > 0 ? 'up' : 'down';
		}
	}

	let lengthStatus: TileStatus = 'miss';
	let lengthDirection: Direction = null;
	if (guessedLengthMinutes !== null && guessedLengthMinutes > 0) {
		const diff = targetLengthMinutes - guessedLengthMinutes;
		const relDiff = Math.abs(diff) / Math.max(targetLengthMinutes, 60);
		if (Math.abs(diff) <= 30 || relDiff <= 0.15) {
			lengthStatus = 'hit';
			lengthDirection = 'exact';
		} else if (
			relDiff <= 0.4 ||
			(guessedLengthBucket !== null && guessedLengthBucket === targetLengthBucket)
		) {
			lengthStatus = 'close';
			lengthDirection = diff > 0 ? 'up' : 'down';
		} else {
			lengthStatus = 'miss';
			lengthDirection = diff > 0 ? 'up' : 'down';
		}
	}

	const normTargetDevs = new Set(targetDevelopers.map(normalizeTitle).filter(Boolean));
	const studioHit = guessedDevelopers.some((d) => normTargetDevs.has(normalizeTitle(d)));
	const studioStatus: TileStatus = studioHit ? 'hit' : 'miss';

	const solved = vnStatus === 'hit';

	return {
		attemptNumber,
		guessedId,
		guessedTitle: guessedTitle.trim(),
		guessedYear,
		guessedLengthMinutes,
		guessedStudio: guessedDevelopers[0] ?? null,
		vnStatus,
		yearStatus,
		yearDirection,
		lengthStatus,
		lengthDirection,
		studioStatus,
		solved
	};
}

export function calculateVnPoints(attempts: VnAttemptFeedback[], won: boolean): number {
	const count = Math.min(VN_MAX_ATTEMPTS, Math.max(1, attempts.length));
	const hadFranchise = attempts.some((a) => a.vnStatus === 'close');
	const gaveUp = attempts.some((a) => Boolean(a.gaveUp));
	if (won) {
		const base = [1000, 850, 700, 550, 400][count - 1] ?? 400;
		const bonus = count > 1 && hadFranchise ? 50 : 0;
		return Math.min(1000, base + bonus);
	}
	if (hadFranchise && !gaveUp) return 200;
	if (hadFranchise) return 100;
	return 0;
}

export function scoreVnSurvivalRound(vnStatus: TileStatus, stageUsed: number): {
	points: number;
	lostLife: boolean;
} {
	if (vnStatus === 'hit') {
		const idx = Math.min(Math.max(0, stageUsed - 1), VN_SURVIVAL_STAGE_POINTS.length - 1);
		return { points: VN_SURVIVAL_STAGE_POINTS[idx], lostLife: false };
	}
	if (vnStatus === 'close') {
		return { points: 300, lostLife: false };
	}
	return { points: 0, lostLife: true };
}

export function buildVnShareText(params: {
	puzzleNumber?: number;
	isDaily: boolean;
	attempts: VnAttemptFeedback[];
	won: boolean;
}): string {
	const { puzzleNumber, isDaily, attempts, won } = params;
	const scoreStr = won ? `${attempts.length}/${VN_MAX_ATTEMPTS}` : `X/${VN_MAX_ATTEMPTS}`;
	const pts = calculateVnPoints(attempts, won);
	const tile = (status: TileStatus) => {
		if (status === 'hit') return '🟩';
		if (status === 'close') return '🟨';
		return '⬛';
	};
	const lines = attempts.map(
		(a) =>
			`${tile(a.vnStatus)}${tile(a.yearStatus)}${tile(a.lengthStatus)}${tile(a.studioStatus)}`
	);
	const header = isDaily
		? `Episode Guesser VN UI #${puzzleNumber ?? 1} — ${scoreStr} · ${pts.toLocaleString('en-US')} pts`
		: `Episode Guesser VN UI — ${scoreStr} · ${pts.toLocaleString('en-US')} pts`;

	return [header, ...lines, '<https://episode-guesser.karczma.moe/?mode=vn>'].join('\n');
}

export function buildVnSurvivalShareText(params: {
	rounds: VnCompletedSurvivalRound[];
	peakStreak: number;
}): string {
	const total = params.rounds.reduce((sum, r) => sum + r.points, 0);
	const bars = params.rounds
		.slice(0, 20)
		.map((r) => {
			if (r.vnStatus === 'hit') return '🟩';
			if (r.vnStatus === 'close') return '🟨';
			return '🟥';
		})
		.join('');
	const overflow = params.rounds.length > 20 ? ` +${params.rounds.length - 20}` : '';

	return [
		`Episode Guesser VN UI Survival — ${total.toLocaleString('en-US')} pts · ${params.rounds.length} ${params.rounds.length === 1 ? 'VN' : 'VNs'} · Streak ${params.peakStreak}`,
		`${bars}${overflow}`,
		'<https://episode-guesser.karczma.moe/?mode=vn>'
	].join('\n');
}
