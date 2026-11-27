import rawArchive from './dailyArchive.json';
import type { EpisodeReveal } from '$lib/types';

export interface BakedDailyPick {
	rawImageUrl: string;
	originX: number;
	originY: number;
	targetTitles: string[];
	franchiseTitles: string[];
	reveal: Omit<EpisodeReveal, 'imageUrl'>;
}

const archiveMap = rawArchive as Record<string, BakedDailyPick>;

export function getBakedDailyPick(date: string): BakedDailyPick | null {
	return archiveMap[date] ?? null;
}

export function getBakedArchiveCount(): number {
	return Object.keys(archiveMap).length;
}
