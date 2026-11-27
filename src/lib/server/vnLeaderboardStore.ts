import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type {
	AuthUser,
	VnAttemptFeedback,
	VnDailyLeaderboardEntry,
	VnDailyLeaderboardPayload
} from '$lib/types';
import { calculateVnPoints, getVnDailyPuzzleNumber } from '$lib/vnScoring';

const MAX_DAYS_RETAINED = 500;
const MAX_RETURNED_ENTRIES = 50;
const FLUSH_DELAY_MS = 1_500;

const boardsByDate = new Map<string, Map<number, VnDailyLeaderboardEntry>>();
let hydrated = false;
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let flushInFlight = false;
let dirtyAfterFlush = false;
let shutdownHooked = false;

function getStoreFile(): string {
	return (
		process.env.VN_LEADERBOARD_STORE_PATH ||
		join(process.cwd(), '.cache', 'vn-daily-leaderboard.json')
	);
}

function isTestMemoryOnly(): boolean {
	return Boolean(process.env.VITEST) && !process.env.VN_LEADERBOARD_STORE_PATH;
}

function serializeStore(): string {
	const out: Record<string, VnDailyLeaderboardEntry[]> = {};
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
		console.error('[vnLeaderboardStore] failed to persist to disk:', err);
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
			VnDailyLeaderboardEntry[]
		>;
		for (const [date, entries] of Object.entries(parsed)) {
			if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Array.isArray(entries)) continue;
			const map = new Map<number, VnDailyLeaderboardEntry>();
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

export function compareVnLeaderboardEntries(
	a: VnDailyLeaderboardEntry,
	b: VnDailyLeaderboardEntry
): number {
	if (a.points !== b.points) return b.points - a.points;
	// First result recorded stays ahead on any tie
	return a.completedAt - b.completedAt;
}

export function recordVnLeaderboardResult(params: {
	date: string;
	user: AuthUser;
	attempts: VnAttemptFeedback[];
	won: boolean;
	completedAt?: number;
}): VnDailyLeaderboardEntry {
	hydrateFromDisk();
	let dayMap = boardsByDate.get(params.date);
	if (!dayMap) {
		dayMap = new Map<number, VnDailyLeaderboardEntry>();
		boardsByDate.set(params.date, dayMap);
	}

	const existing = dayMap.get(params.user.anilistUserId);
	if (existing) return existing;

	const gaveUp = params.attempts.some((a) => Boolean(a.gaveUp));
	const points = calculateVnPoints(params.attempts, params.won);

	const entry: VnDailyLeaderboardEntry = {
		anilistUserId: params.user.anilistUserId,
		username: params.user.username,
		avatar: params.user.avatar,
		siteUrl: params.user.siteUrl,
		won: params.won,
		gaveUp,
		attemptsUsed: params.attempts.length,
		points,
		completedAt: params.completedAt ?? Date.now(),
		tiles: params.attempts.map((a) => ({
			v: a.vnStatus,
			y: a.yearStatus,
			l: a.lengthStatus,
			s: a.studioStatus,
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

export function getVnLeaderboardCountsByDate(): Map<string, { total: number; solved: number }> {
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

export function getVnDailyLeaderboard(
	date: string,
	meAnilistUserId: number | null,
	authConfigured: boolean
): VnDailyLeaderboardPayload {
	hydrateFromDisk();
	const dayMap = boardsByDate.get(date);
	const allSorted = dayMap ? Array.from(dayMap.values()).sort(compareVnLeaderboardEntries) : [];

	let me: { rank: number; entry: VnDailyLeaderboardEntry } | null = null;
	if (meAnilistUserId !== null) {
		const idx = allSorted.findIndex((e) => e.anilistUserId === meAnilistUserId);
		if (idx !== -1) me = { rank: idx + 1, entry: allSorted[idx] };
	}

	return {
		date,
		puzzleNumber: getVnDailyPuzzleNumber(date),
		totalPlayers: allSorted.length,
		solvedCount: allSorted.filter((e) => e.won).length,
		entries: allSorted.slice(0, MAX_RETURNED_ENTRIES),
		me,
		authConfigured
	};
}

export function clearVnLeaderboardStoreForTests(): void {
	if (flushTimer) {
		clearTimeout(flushTimer);
		flushTimer = null;
	}
	dirtyAfterFlush = false;
	boardsByDate.clear();
	hydrated = true;
}
