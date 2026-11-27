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

const store = new Map<string, DailyServerRecord>();

function makeKey(playerId: string, date: string, scopeKey: string): string {
	return `${playerId}|${date}|${scopeKey}`;
}

function pruneOld(): void {
	if (store.size < MAX_RECORDS) return;
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
	pruneOld();
	const key = makeKey(playerId, record.date, record.scopeKey);
	store.set(key, { ...record, updatedAt: Date.now() });
}
