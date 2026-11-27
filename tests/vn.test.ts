import { describe, expect, it } from 'vitest';
import { isAllowedImageUrl } from '../src/lib/server/imageHost';
import { unsealPayload } from '../src/lib/server/token';
import {
	getGlobalVnPool,
	lookupVnById,
	lookupVnByTitle,
	pickDailyVn,
	VN_CATALOG_ENTRIES,
	VN_POOL,
	VN_PUBLIC_AUTOCOMPLETE
} from '../src/lib/server/vnCatalog';
import { clearVnDailyStoreForTests } from '../src/lib/server/vnDailyStore';
import {
	clearVnLeaderboardStoreForTests,
	getVnDailyLeaderboard,
	recordVnLeaderboardResult
} from '../src/lib/server/vnLeaderboardStore';
import type { SealedVnRoundSecret } from '../src/lib/server/vnSession';
import {
	buildVnShareText,
	buildVnSurvivalShareText,
	calculateVnPoints,
	evaluateVnAttempt,
	formatVnLength,
	getVnDailyPuzzleNumber,
	isValidVnDailyDate,
	listVnDailyDatesDescending,
	scoreVnSurvivalRound,
	VN_DAILY_EPOCH_DATE,
	VN_MAX_ATTEMPTS
} from '../src/lib/vnScoring';
import { GET as vnArchiveGet } from '../src/routes/api/vn/archive/+server';
import { POST as vnGuessPost } from '../src/routes/api/vn/guess/+server';
import { POST as vnRevealStagePost } from '../src/routes/api/vn/reveal-stage/+server';
import { POST as vnRoundPost } from '../src/routes/api/vn/round/+server';

function makeCookies(initial: Record<string, string> = {}) {
	const jar = new Map<string, string>(Object.entries(initial));
	return {
		get: (name: string) => jar.get(name),
		set: (name: string, val: string) => {
			jar.set(name, val);
		},
		delete: (name: string) => {
			jar.delete(name);
		},
		jar
	};
}

describe('VN Interface Wordle complete catalog, archive & scoring', () => {
	it('loads 1,000 playable SFW VNs, Top 250 subset, quotes, and 5,000+ autocomplete entries', () => {
		expect(VN_POOL.length).toBe(1000);
		expect(getGlobalVnPool(250).length).toBe(250);
		expect(VN_CATALOG_ENTRIES.length).toBeGreaterThanOrEqual(5000);
		expect(VN_PUBLIC_AUTOCOMPLETE.length).toBe(VN_CATALOG_ENTRIES.length);

		const ids = new Set<string>();
		let withQuotes = 0;
		for (const vn of VN_POOL) {
			expect(ids.has(vn.id)).toBe(false);
			ids.add(vn.id);
			if (vn.quote) withQuotes++;
			expect(vn.screens.length).toBeGreaterThan(0);
			for (const s of vn.screens) {
				expect(isAllowedImageUrl(s.url)).toBe(true);
				expect(s.url.startsWith('https://t.vndb.org/')).toBe(true);
			}
		}
		expect(withQuotes).toBeGreaterThan(200);

		expect(lookupVnById('v2002')?.t).toBe('STEINS;GATE');
		expect(lookupVnByTitle('steins;gate')?.id).toBe('v2002');
		expect(lookupVnByTitle('Clannad')?.id).toBe('v4');

		// 366 unique daily archive puzzles
		const dates = listVnDailyDatesDescending('2026-11-27');
		expect(dates.length).toBe(366);
		expect(getVnDailyPuzzleNumber(VN_DAILY_EPOCH_DATE)).toBe(1);
		expect(getVnDailyPuzzleNumber('2026-11-27')).toBe(366);
		expect(isValidVnDailyDate('2026-11-28', '2026-11-27')).toBe(false);
		const seenDailyIds = new Set<string>();
		for (const d of dates) {
			const p = pickDailyVn(d);
			expect(seenDailyIds.has(p.vn.id)).toBe(false);
			seenDailyIds.add(p.vn.id);
		}
	});

	it('evaluates VN, franchise, year, length, studio, Survival scoring, leaderboard ties, and share text', () => {
		const franchiseMiss = evaluateVnAttempt({
			attemptNumber: 1,
			guessedId: 'v17102',
			guessedTitle: 'STEINS;GATE 0',
			guessedYear: 2015,
			guessedLengthMinutes: 2100,
			guessedLengthBucket: 4,
			guessedDevelopers: ['MAGES.'],
			targetId: 'v2002',
			targetTitles: ['STEINS;GATE'],
			targetFranchiseIds: ['v17102'],
			targetFranchiseTitles: ['STEINS;GATE 0'],
			targetYear: 2009,
			targetLengthMinutes: 2625,
			targetLengthBucket: 4,
			targetDevelopers: ['NITRO PLUS', 'MAGES.']
		});
		expect(franchiseMiss.vnStatus).toBe('close');
		expect(franchiseMiss.yearStatus).toBe('miss');
		expect(franchiseMiss.yearDirection).toBe('down');
		expect(franchiseMiss.lengthStatus).toBe('close');
		expect(franchiseMiss.lengthDirection).toBe('up');
		expect(franchiseMiss.studioStatus).toBe('hit');

		const win = evaluateVnAttempt({
			attemptNumber: 2,
			guessedId: 'v2002',
			guessedTitle: 'STEINS;GATE',
			guessedYear: 2009,
			guessedLengthMinutes: 2625,
			guessedLengthBucket: 4,
			guessedDevelopers: ['NITRO PLUS', 'MAGES.'],
			targetId: 'v2002',
			targetTitles: ['STEINS;GATE'],
			targetFranchiseIds: ['v17102'],
			targetFranchiseTitles: ['STEINS;GATE 0'],
			targetYear: 2009,
			targetLengthMinutes: 2625,
			targetLengthBucket: 4,
			targetDevelopers: ['NITRO PLUS', 'MAGES.']
		});
		expect(win.solved).toBe(true);
		expect(calculateVnPoints([franchiseMiss, win], true)).toBe(900);
		expect(formatVnLength(375)).toBe('6.3h');
		expect(formatVnLength(2625)).toBe('44h');

		expect(scoreVnSurvivalRound('hit', 1)).toEqual({ points: 1000, lostLife: false });
		expect(scoreVnSurvivalRound('hit', 3)).toEqual({ points: 600, lostLife: false });
		expect(scoreVnSurvivalRound('close', 2)).toEqual({ points: 300, lostLife: false });
		expect(scoreVnSurvivalRound('miss', 1)).toEqual({ points: 0, lostLife: true });

		// Leaderboard: higher points first, first-arrived keeps higher rank on tie
		clearVnLeaderboardStoreForTests();
		const date = '2026-11-27';
		recordVnLeaderboardResult({
			date,
			user: { anilistUserId: 1, username: 'First', avatar: null, siteUrl: 'https://anilist.co/user/First' },
			attempts: [win],
			won: true,
			completedAt: 1000
		});
		recordVnLeaderboardResult({
			date,
			user: { anilistUserId: 2, username: 'SecondTied', avatar: null, siteUrl: 'https://anilist.co/user/SecondTied' },
			attempts: [win],
			won: true,
			completedAt: 2000
		});
		recordVnLeaderboardResult({
			date,
			user: { anilistUserId: 3, username: 'TwoGuess', avatar: null, siteUrl: 'https://anilist.co/user/TwoGuess' },
			attempts: [franchiseMiss, win],
			won: true,
			completedAt: 500
		});
		const lb = getVnDailyLeaderboard(date, 2, true);
		expect(lb.entries.map((e) => e.username)).toEqual(['First', 'SecondTied', 'TwoGuess']);
		expect(lb.entries.map((e) => e.points)).toEqual([1000, 1000, 900]);
		expect(lb.me?.rank).toBe(2);
		clearVnLeaderboardStoreForTests();

		const share = buildVnShareText({
			puzzleNumber: 366,
			isDaily: true,
			attempts: [franchiseMiss, win],
			won: true
		});
		expect(share).toContain('VN UI #366 — 2/5 · 900 pts');
		expect(share).toContain('<https://episode-guesser.karczma.moe/?mode=vn>');

		const survShare = buildVnSurvivalShareText({
			peakStreak: 2,
			rounds: [
				{
					roundIndex: 0,
					stageUsed: 1,
					points: 1000,
					lostLife: false,
					vnStatus: 'hit',
					guessedTitle: 'STEINS;GATE',
					reveal: {
						id: 'v2002',
						title: 'STEINS;GATE',
						enTitle: null,
						year: 2009,
						released: '2009-10-15',
						lengthMinutes: 2625,
						lengthBucket: 4,
						rating: 9.02,
						developers: ['MAGES.'],
						isNvl: false,
						tags: [],
						imageUrl: '/api/image/x',
						vndbUrl: 'https://vndb.org/v2002'
					}
				}
			]
		});
		expect(survShare).toContain('Survival — 1,000 pts');
		expect(survShare).toContain('<https://episode-guesser.karczma.moe/?mode=vn>');
	});
});

describe('POST /api/vn/round, /api/vn/reveal-stage, /api/vn/guess & /api/vn/archive', () => {
	it('runs Daily, Archive, and Survival reveal-stage game loops end-to-end', async () => {
		clearVnDailyStoreForTests();
		const cookies = makeCookies();
		const roundUrl = new URL('https://episode-guesser.karczma.moe/api/vn/round');
		const guessUrl = new URL('https://episode-guesser.karczma.moe/api/vn/guess');
		const revealUrl = new URL('https://episode-guesser.karczma.moe/api/vn/reveal-stage');

		// 1. Daily round + restore + archive tracking
		const r1Res = await vnRoundPost({
			request: new Request(roundUrl, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ subMode: 'daily' })
			}),
			cookies,
			url: roundUrl
		} as never);
		const r1 = await r1Res.json();
		expect(r1.stage).toBe(1);
		const secret = unsealPayload<SealedVnRoundSecret>(r1.roundToken)!;
		const wrongVn = VN_POOL.find((v) => v.id !== secret.targetId)!;

		const g1Res = await vnGuessPost({
			request: new Request(guessUrl, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					roundToken: r1.roundToken,
					stateToken: r1.stateToken,
					guessedId: wrongVn.id,
					guessedTitle: wrongVn.title
				})
			}),
			cookies
		} as never);
		const g1 = await g1Res.json();
		expect(g1.nextStage).toBe(2);
		expect(g1.reveal).toBeUndefined();

		// Win on guess 2
		const g2Res = await vnGuessPost({
			request: new Request(guessUrl, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					roundToken: r1.roundToken,
					stateToken: g1.stateToken,
					guessedId: secret.targetId,
					guessedTitle: secret.reveal.title
				})
			}),
			cookies
		} as never);
		const g2 = await g2Res.json();
		expect(g2.won).toBe(true);
		expect(g2.nextStage).toBe(VN_MAX_ATTEMPTS);

		// Archive endpoint reports 1 solved
		const archRes = await vnArchiveGet({ cookies } as never);
		const arch = await archRes.json();
		expect(arch.solvedCount).toBe(1);
		expect(arch.days.length).toBeGreaterThanOrEqual(366);

		// 2. Survival mode: start at stage 1 -> reveal stage 2 -> guess exact -> 800 pts!
		const sRes = await vnRoundPost({
			request: new Request(roundUrl, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ subMode: 'survival' })
			}),
			cookies,
			url: roundUrl
		} as never);
		const sRound = await sRes.json();
		expect(sRound.subMode).toBe('survival');
		expect(sRound.stage).toBe(1);
		const sSecret = unsealPayload<SealedVnRoundSecret>(sRound.roundToken)!;

		const widenRes = await vnRevealStagePost({
			request: new Request(revealUrl, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					roundToken: sRound.roundToken,
					stateToken: sRound.stateToken
				})
			}),
			cookies
		} as never);
		const widened = await widenRes.json();
		expect(widened.stage).toBe(2);
		expect(widened.stagePoints).toBe(800);

		const sGuessRes = await vnGuessPost({
			request: new Request(guessUrl, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					roundToken: sRound.roundToken,
					stateToken: widened.stateToken,
					guessedId: sSecret.targetId,
					guessedTitle: sSecret.reveal.title
				})
			}),
			cookies
		} as never);
		const sGuess = await sGuessRes.json();
		expect(sGuess.won).toBe(true);
		expect(sGuess.pointsAwarded).toBe(800);
		expect(sGuess.lostLife).toBe(false);

		clearVnDailyStoreForTests();
	});
});
