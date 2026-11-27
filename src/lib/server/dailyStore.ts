import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { EpisodeReveal, WordleAttemptFeedback } from '$lib/types';

export interface DailyServerRecord {
	date: string;
	scopeKey: string;
	roundId: string;
	roundToken: string;
	dailyStateToken: string;
	currentImageUrl: string;
	attempts: WordleAttemptFeedback[];
	usedKeys: string[];
	finished: boolean;
	won: boolean;
	reveal?: EpisodeReveal;
	updatedAt: number;
}

const MAX_RECORDS = 10_000;
const RECORD_TTL_MS = 36 * 60 * 60 * 1000;
const STORE_DIR = join(process.cwd(), '.cache');
const STORE_FILE = join(STORE_DIR, 'daily-store.json');
const FLUSH_DELAY_MS = 1_500;

const store = new Map<string, DailyServerRecord>();
let hydrated = false;
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let shutdownHooked = false;

function ensureShutdownHooks(): void {
	if (shutdownHooked) return;
	shutdownHooked = true;
	const flushOnExit = () => {
		if (flushTimer) {
			clearTimeout(flushTimer);
			flushToDiskNow();
		}
	};
	process.once('SIGTERM', flushOnExit);
	process.once('SIGINT', flushOnExit);
	process.once('beforeExit', flushOnExit);
}

function hydrateFromDisk(): void {
	if (hydrated) return;
	hydrated = true;
	try {
		if (!existsSync(STORE_FILE)) return;
		const parsed = JSON.parse(readFileSync(STORE_FILE, 'utf8')) as Record<string, DailyServerRecord>;
		const now = Date.now();
		for (const [k, v] of Object.entries(parsed)) {
			if (v && typeof v.updatedAt === 'number' && now - v.updatedAt <= RECORD_TTL_MS) {
				store.set(k, v);
			}
		}
	} catch {
		// ignore corrupt disk store
	}
}

function flushToDiskNow(): void {
	flushTimer = null;
	try {
		mkdirSync(STORE_DIR, { recursive: true });
		const obj: Record<string, DailyServerRecord> = {};
		for (const [k, v] of store) {
			obj[k] = v;
		}
		const tmpPath = `${STORE_FILE}.${process.pid}.tmp`;
		writeFileSync(tmpPath, JSON.stringify(obj), 'utf8');
		renameSync(tmpPath, STORE_FILE);
	} catch {
		// non-fatal
	}
}

function schedulePersist(): void {
	ensureShutdownHooks();
	if (flushTimer) return;
	flushTimer = setTimeout(flushToDiskNow, FLUSH_DELAY_MS);
	if (typeof flushTimer === 'object' && 'unref' in flushTimer) {
		flushTimer.unref();
	}
}

function makeKey(playerId: string, date: string, scopeKey: string): string {
	return `${playerId}|${date}|${scopeKey}`;
}

function pruneOld(): void {
	const now = Date.now();
	for (const [k, v] of store) {
		if (now - v.updatedAt > RECORD_TTL_MS) {
			store.delete(k);
		}
	}
	while (store.size >= MAX_RECORDS) {
		const first = store.keys().next().value;
		if (!first) break;
		store.delete(first);
	}
}

export function getDailyRecord(
	playerId: string,
	date: string,
	scopeKey: string
): DailyServerRecord | null {
	hydrateFromDisk();
	const key = makeKey(playerId, date, scopeKey);
	const rec = store.get(key);
	if (!rec) return null;
	if (Date.now() - rec.updatedAt > RECORD_TTL_MS) {
		store.delete(key);
		return null;
	}
	return rec;
}

export function saveDailyRecord(playerId: string, record: DailyServerRecord): void {
	hydrateFromDisk();
	pruneOld();
	const key = makeKey(playerId, record.date, record.scopeKey);
	store.set(key, { ...record, updatedAt: Date.now() });
	schedulePersist();
}

export function clearDailyStoreForTests(): void {
	if (flushTimer) {
		clearTimeout(flushTimer);
		flushTimer = null;
	}
	store.clear();
	hydrated = true;
}
