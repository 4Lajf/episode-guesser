import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { getDailyPuzzleNumber } from '$lib/scoring';
import type {
	AuthUser,
	DailyLeaderboardEntry,
	DailyLeaderboardPayload,
	WordleAttemptFeedback
} from '$lib/types';

const MAX_DAYS_RETAINED = 500;
const MAX_RETURNED_ENTRIES = 50;
const FLUSH_DELAY_MS = 1_500;

// Map<YYYY-MM-DD, Map<anilistUserId, DailyLeaderboardEntry>>
const boardsByDate = new Map<string, Map<number, DailyLeaderboardEntry>>();
let hydrated = false;
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let flushInFlight = false;
let dirtyAfterFlush = false;
let shutdownHooked = false;

function getStoreFile(): string {
	return (
		process.env.LEADERBOARD_STORE_PATH ||
		join(process.cwd(), '.cache', 'daily-leaderboard.json')
	);
}

function isTestMemoryOnly(): boolean {
	return Boolean(process.env.VITEST) && !process.env.LEADERBOARD_STORE_PATH;
}

function serializeStore(): string {
	const out: Record<string, DailyLeaderboardEntry[]> = {};
	for (const [date, map] of boardsByDate) {
		out[date] = Array.from(map.values());
	}
	return JSON.stringify(out);
}

function flushToDiskSync(): void {
	if (isTestMemoryOnly()) return;
	flushTimer = null;
	try {
		const storeFile = getStoreFile();
		mkdirSync(dirname(storeFile), { recursive: true });
		const tmpPath = `${storeFile}.${process.pid}.tmp`;
		writeFileSync(tmpPath, serializeStore(), 'utf8');
		renameSync(tmpPath, storeFile);
	} catch {
		// non-fatal
	}
}

async function flushToDiskAsync(): Promise<void> {
	if (isTestMemoryOnly()) return;
	flushTimer = null;
	if (flushInFlight) {
		dirtyAfterFlush = true;
		return;
	}
	flushInFlight = true;
	try {
		const storeFile = getStoreFile();
		await mkdir(dirname(storeFile), { recursive: true });
		const tmpPath = `${storeFile}.${process.pid}.tmp`;
		await writeFile(tmpPath, serializeStore(), 'utf8');
		await rename(tmpPath, storeFile);
	} catch (err) {
		console.error('[leaderboardStore] failed to persist to disk:', err);
	} finally {
		flushInFlight = false;
		if (dirtyAfterFlush) {
			dirtyAfterFlush = false;
			schedulePersist();
		}
	}
}

function ensureShutdownHooks(): void {
	if (shutdownHooked || isTestMemoryOnly()) return;
	shutdownHooked = true;
	const flushOnExit = () => {
		if (flushTimer || dirtyAfterFlush) {
			if (flushTimer) clearTimeout(flushTimer);
			flushToDiskSync();
		}
	};
	process.once('SIGTERM', flushOnExit);
	process.once('SIGINT', flushOnExit);
	process.once('beforeExit', flushOnExit);
}

function pruneOldDates(): void {
	const dates = Array.from(boardsByDate.keys()).sort().reverse();
	for (const oldDate of dates.slice(MAX_DAYS_RETAINED)) {
		boardsByDate.delete(oldDate);
	}
}

function hydrateFromDisk(): void {
	if (hydrated) return;
	hydrated = true;
	if (isTestMemoryOnly()) return;
	try {
		const storeFile = getStoreFile();
		if (!existsSync(storeFile)) return;
		const parsed = JSON.parse(readFileSync(storeFile, 'utf8')) as Record<
			string,
			DailyLeaderboardEntry[]
		>;
		for (const [date, entries] of Object.entries(parsed)) {
			if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Array.isArray(entries)) continue;
			const map = new Map<number, DailyLeaderboardEntry>();
			for (const entry of entries) {
				if (entry && typeof entry.anilistUserId === 'number' && entry.username) {
					map.set(entry.anilistUserId, entry);
				}
			}
			if (map.size > 0) boardsByDate.set(date, map);
		}
		pruneOldDates();
	} catch {
		// ignore corrupt disk file
	}
}

function schedulePersist(): void {
	if (isTestMemoryOnly()) return;
	ensureShutdownHooks();
	if (flushTimer) return;
	flushTimer = setTimeout(() => {
		void flushToDiskAsync();
	}, FLUSH_DELAY_MS);
	if (typeof flushTimer === 'object' && 'unref' in flushTimer) {
		flushTimer.unref();
	}
}

export function compareLeaderboardEntries(
	a: DailyLeaderboardEntry,
	b: DailyLeaderboardEntry
): number {
	// 1. Solved always beats unsolved
	if (a.won !== b.won) return a.won ? -1 : 1;

	if (a.won && b.won) {
		// 2. Fewer attempts (tighter zoom solve!) wins
		if (a.attemptsUsed !== b.attemptsUsed) return a.attemptsUsed - b.attemptsUsed;
		// 3. Faster solve duration (timezone-fair tiebreaker)
		if (a.solveMs !== b.solveMs) return a.solveMs - b.solveMs;
		return a.completedAt - b.completedAt;
	}

	// Unsolved comparison: played to end > gave up
	if (a.gaveUp !== b.gaveUp) return a.gaveUp ? 1 : -1;

	// Found the anime earlier > found later > never found
	const aHit = a.animeHitAttempt ?? 99;
	const bHit = b.animeHitAttempt ?? 99;
	if (aHit !== bHit) return aHit - bHit;

	if (a.solveMs !== b.solveMs) return a.solveMs - b.solveMs;
	return a.completedAt - b.completedAt;
}

export function recordDailyLeaderboardResult(params: {
	date: string;
	user: AuthUser;
	attempts: WordleAttemptFeedback[];
	won: boolean;
	startedAt?: number;
	completedAt?: number;
}): DailyLeaderboardEntry {
	hydrateFromDisk();
	let dayMap = boardsByDate.get(params.date);
	if (!dayMap) {
		dayMap = new Map<number, DailyLeaderboardEntry>();
		boardsByDate.set(params.date, dayMap);
	}

	// Immutable per (date, anilistUserId) once recorded so users cannot overwrite today's ranked score
	const existing = dayMap.get(params.user.anilistUserId);
	if (existing) return existing;

	const completedAt = params.completedAt ?? Date.now();
	const rawDuration = params.startedAt ? completedAt - params.startedAt : 0;
	const solveMs = Math.max(1_000, Math.min(rawDuration > 0 ? rawDuration : 60_000, 24 * 60 * 60 * 1000));
	const gaveUp = params.attempts.some((a) => Boolean(a.gaveUp));
	const animeHitAttempt = params.attempts.find((a) => a.animeStatus === 'hit')?.attemptNumber ?? null;

	const entry: DailyLeaderboardEntry = {
		anilistUserId: params.user.anilistUserId,
		username: params.user.username,
		avatar: params.user.avatar,
		siteUrl: params.user.siteUrl,
		won: params.won,
		gaveUp,
		attemptsUsed: params.attempts.length,
		animeHitAttempt,
		solveMs,
		completedAt,
		tiles: params.attempts.map((a) => ({
			a: a.animeStatus,
			y: a.yearStatus,
			e: a.episodeStatus,
			...(a.gaveUp ? { g: true } : {})
		}))
	};

	dayMap.set(params.user.anilistUserId, entry);
	pruneOldDates();
	ensureShutdownHooks();
	if (flushTimer) {
		clearTimeout(flushTimer);
		flushTimer = null;
	}
	void flushToDiskAsync();
	return entry;
}

export function getTotalLeaderboardEntries(): number {
	hydrateFromDisk();
	let total = 0;
	for (const map of boardsByDate.values()) total += map.size;
	return total;
}

export function hasLeaderboardEntry(date: string, anilistUserId: number): boolean {
	hydrateFromDisk();
	return Boolean(boardsByDate.get(date)?.has(anilistUserId));
}

export function getLeaderboardCountsByDate(): Map<string, { total: number; solved: number }> {
	hydrateFromDisk();
	const out = new Map<string, { total: number; solved: number }>();
	for (const [date, map] of boardsByDate) {
		let solved = 0;
		for (const e of map.values()) {
			if (e.won) solved++;
		}
		out.set(date, { total: map.size, solved });
	}
	return out;
}

export function getDailyLeaderboard(
	date: string,
	meAnilistUserId: number | null,
	authConfigured: boolean
): DailyLeaderboardPayload {
	hydrateFromDisk();
	const dayMap = boardsByDate.get(date);
	const allSorted = dayMap
		? Array.from(dayMap.values()).sort(compareLeaderboardEntries)
		: [];

	let me: { rank: number; entry: DailyLeaderboardEntry } | null = null;
	if (meAnilistUserId !== null) {
		const idx = allSorted.findIndex((e) => e.anilistUserId === meAnilistUserId);
		if (idx !== -1) {
			me = { rank: idx + 1, entry: allSorted[idx] };
		}
	}

	return {
		date,
		puzzleNumber: getDailyPuzzleNumber(date),
		totalPlayers: allSorted.length,
		solvedCount: allSorted.filter((e) => e.won).length,
		entries: allSorted.slice(0, MAX_RETURNED_ENTRIES),
		me,
		authConfigured
	};
}

export function clearLeaderboardStoreForTests(): void {
	if (flushTimer) {
		clearTimeout(flushTimer);
		flushTimer = null;
	}
	dirtyAfterFlush = false;
	boardsByDate.clear();
	hydrated = true;
}
