import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
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

const MAX_RECORDS = 100_000;
const RECORD_TTL_MS = 400 * 24 * 60 * 60 * 1000; // Retain full 1-year archive + buffer
const FLUSH_DELAY_MS = 2_000;

const store = new Map<string, DailyServerRecord>();
let hydrated = false;
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let flushInFlight = false;
let dirtyAfterFlush = false;
let shutdownHooked = false;

function getStoreFile(): string {
	return process.env.DAILY_STORE_PATH || join(process.cwd(), '.cache', 'daily-store.json');
}

function isTestMemoryOnly(): boolean {
	return Boolean(process.env.VITEST) && !process.env.DAILY_STORE_PATH;
}

function serializeStore(): string {
	const obj: Record<string, DailyServerRecord> = {};
	for (const [k, v] of store) {
		obj[k] = v;
	}
	return JSON.stringify(obj);
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
		console.error('[dailyStore] failed to persist to disk:', err);
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

function hydrateFromDisk(): void {
	if (hydrated) return;
	hydrated = true;
	if (isTestMemoryOnly()) return;
	try {
		const storeFile = getStoreFile();
		if (!existsSync(storeFile)) return;
		const parsed = JSON.parse(readFileSync(storeFile, 'utf8')) as Record<string, DailyServerRecord>;
		const now = Date.now();
		for (const [k, v] of Object.entries(parsed)) {
			if (
				v &&
				typeof v.updatedAt === 'number' &&
				Array.isArray(v.attempts) &&
				v.attempts.length > 0 &&
				now - v.updatedAt <= RECORD_TTL_MS
			) {
				store.set(k, v);
			}
		}
	} catch {
		// ignore corrupt disk store
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
	// Never allocate disk/memory records for zero-attempt anonymous page views
	if (!record.finished && record.attempts.length === 0) return;
	hydrateFromDisk();
	pruneOld();
	const key = makeKey(playerId, record.date, record.scopeKey);
	store.set(key, { ...record, updatedAt: Date.now() });
	if (record.finished) {
		ensureShutdownHooks();
		if (flushTimer) {
			clearTimeout(flushTimer);
			flushTimer = null;
		}
		void flushToDiskAsync();
	} else {
		schedulePersist();
	}
}

export function getDailyStoreCount(): number {
	hydrateFromDisk();
	return store.size;
}

export function listPlayerDailyRecords(
	playerId: string,
	scopeKey = 'global'
): DailyServerRecord[] {
	hydrateFromDisk();
	const prefix = `${playerId}|`;
	const suffix = `|${scopeKey}`;
	const out: DailyServerRecord[] = [];
	const now = Date.now();
	for (const [k, rec] of store) {
		if (k.startsWith(prefix) && k.endsWith(suffix) && now - rec.updatedAt <= RECORD_TTL_MS) {
			out.push(rec);
		}
	}
	return out;
}

export function clearDailyStoreForTests(): void {
	if (flushTimer) {
		clearTimeout(flushTimer);
		flushTimer = null;
	}
	dirtyAfterFlush = false;
	store.clear();
	hydrated = true;
}
