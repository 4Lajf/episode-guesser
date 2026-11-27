import type { VnReveal, VnUiSubMode } from '$lib/types';

export interface SealedVnRoundSecret {
	typ: 'vn-round';
	v: 1;
	roundId: string;
	subMode: VnUiSubMode;
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
	reveal: VnReveal;
}

export interface SealedVnState {
	typ: 'vn-state';
	v: 1;
	roundId: string;
	subMode: VnUiSubMode;
	playerId: string;
	dailyDate?: string;
	attemptsUsed: number;
	finished: boolean;
	usedKeys: string[];
}
