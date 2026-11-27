import type { VnReveal } from '$lib/types';

export interface SealedVnRoundSecret {
	typ: 'vn-round';
	v: 1;
	roundId: string;
	subMode: 'daily' | 'practice' | 'survival';
	playerId: string;
	dailyDate?: string;
	createdAt: number;
	rawImageUrl: string;
	isNvl: boolean;
	targetId: string;
	targetTitles: string[];
	targetFranchiseIds: string[];
	targetFranchiseTitles: string[];
	targetYear: number;
	targetLengthMinutes: number;
	targetLengthBucket: number;
	targetDevelopers: string[];
	hintTags: string[];
	hintQuote?: string | null;
	reveal: VnReveal;
}

export interface SealedVnState {
	typ: 'vn-state';
	v: 1;
	roundId: string;
	subMode: 'daily' | 'practice' | 'survival';
	playerId: string;
	dailyDate?: string;
	stage: 1 | 2 | 3 | 4 | 5;
	attemptsUsed: number;
	finished: boolean;
	usedKeys: string[];
}
