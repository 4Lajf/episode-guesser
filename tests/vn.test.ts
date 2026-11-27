import { describe, expect, it } from 'vitest';
import { isAllowedImageUrl } from '../src/lib/server/imageHost';
import { unsealPayload } from '../src/lib/server/token';
import {
	lookupVnById,
	lookupVnByTitle,
	pickDailyVn,
	VN_CATALOG_ENTRIES,
	VN_POOL,
	VN_PUBLIC_AUTOCOMPLETE
} from '../src/lib/server/vnCatalog';
import { clearVnDailyStoreForTests } from '../src/lib/server/vnDailyStore';
import type { SealedVnRoundSecret } from '../src/lib/server/vnSession';
import {
	buildVnShareText,
	calculateVnPoints,
	evaluateVnAttempt,
	formatVnLength,
	getVnDailyPuzzleNumber,
	VN_MAX_ATTEMPTS
} from '../src/lib/vnScoring';
import { POST as vnGuessPost } from '../src/routes/api/vn/guess/+server';
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

describe('VN Interface Wordle catalog & scoring', () => {
	it('loads 400 playable SFW VNs and 1,500 autocomplete entries with valid VNDB URLs', () => {
		expect(VN_POOL.length).toBe(400);
		expect(VN_CATALOG_ENTRIES.length).toBe(1500);
		expect(VN_PUBLIC_AUTOCOMPLETE.length).toBe(1500);

		const ids = new Set<string>();
		for (const vn of VN_POOL) {
			expect(ids.has(vn.id)).toBe(false);
			ids.add(vn.id);
			expect(vn.screens.length).toBeGreaterThan(0);
			for (const s of vn.screens) {
				expect(isAllowedImageUrl(s.url)).toBe(true);
				expect(s.url.startsWith('https://t.vndb.org/')).toBe(true);
			}
		}

		expect(lookupVnById('v2002')?.t).toBe('STEINS;GATE');
		expect(lookupVnByTitle('steins;gate')?.id).toBe('v2002');
		expect(lookupVnByTitle('Clannad')?.id).toBe('v4');
	});

	it('evaluates VN, franchise, year, length, studio, points, and suppressed-embed share text', () => {
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
		expect(franchiseMiss.solved).toBe(false);

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
		expect(win.vnStatus).toBe('hit');
		expect(win.yearStatus).toBe('hit');
		expect(win.lengthStatus).toBe('hit');
		expect(win.studioStatus).toBe('hit');

		// 2nd-guess solve (850) + earlier franchise bonus (+50) = 900 pts
		expect(calculateVnPoints([franchiseMiss, win], true)).toBe(900);
		expect(formatVnLength(375)).toBe('6.3h');
		expect(formatVnLength(2625)).toBe('44h');
		expect(getVnDailyPuzzleNumber('2026-11-27')).toBe(1);

		const share = buildVnShareText({
			puzzleNumber: 1,
			isDaily: true,
			attempts: [franchiseMiss, win],
			won: true
		});
		expect(share).toContain('VN UI #1 — 2/5 · 900 pts');
		expect(share).toContain('🟨⬛🟨🟩\n🟩🟩🟩🟩');
		expect(share).toContain('<https://episode-guesser.karczma.moe/?mode=vn>');
	});
});

describe('POST /api/vn/round & /api/vn/guess complete game loop', () => {
	it('runs a full Daily VN UI game, persists restore state, enforces limits, and reveals only on finish', async () => {
		clearVnDailyStoreForTests();
		const cookies = makeCookies();
		const url = new URL('https://episode-guesser.karczma.moe/api/vn/round');

		// Start Daily VN UI round
		const roundRes = await vnRoundPost({
			request: new Request(url, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ subMode: 'daily' })
			}),
			cookies,
			url
		} as never);
		expect(roundRes.status).toBe(200);
		const roundData = await roundRes.json();
		expect(roundData.stage).toBe(1);
		expect(roundData.subMode).toBe('daily');
		expect(roundData.restore).toBeUndefined();
		expect(roundData.imageUrl).toMatch(/^\/api\/image\//);

		const secret = unsealPayload<SealedVnRoundSecret>(roundData.roundToken)!;
		expect(secret.typ).toBe('vn-round');

		// Pick a wrong VN that is NOT the target
		const wrongVn = VN_POOL.find((v) => v.id !== secret.targetId)!;
		const guessUrl = new URL('https://episode-guesser.karczma.moe/api/vn/guess');

		// Guess 1: wrong -> advances to stage 2, no reveal yet
		const g1Res = await vnGuessPost({
			request: new Request(guessUrl, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					roundToken: roundData.roundToken,
					stateToken: roundData.stateToken,
					guessedId: wrongVn.id,
					guessedTitle: wrongVn.title
				})
			}),
			cookies
		} as never);
		expect(g1Res.status).toBe(200);
		const g1 = await g1Res.json();
		expect(g1.finished).toBe(false);
		expect(g1.won).toBe(false);
		expect(g1.nextStage).toBe(2);
		expect(g1.reveal).toBeUndefined();

		// Duplicate guess is rejected
		const dupRes = await vnGuessPost({
			request: new Request(guessUrl, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					roundToken: roundData.roundToken,
					stateToken: g1.stateToken,
					guessedId: wrongVn.id,
					guessedTitle: wrongVn.title
				})
			}),
			cookies
		} as never);
		expect(dupRes.status).toBe(400);

		// Replayed stale stateToken is rejected (409)
		const replayRes = await vnGuessPost({
			request: new Request(guessUrl, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					roundToken: roundData.roundToken,
					stateToken: roundData.stateToken,
					guessedId: secret.targetId,
					guessedTitle: secret.reveal.title
				})
			}),
			cookies
		} as never);
		expect(replayRes.status).toBe(409);

		// Reloading /api/vn/round restores persisted progress at stage 2
		const restoreRes = await vnRoundPost({
			request: new Request(url, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ subMode: 'daily' })
			}),
			cookies,
			url
		} as never);
		const restored = await restoreRes.json();
		expect(restored.stage).toBe(2);
		expect(restored.restore?.attempts.length).toBe(1);
		expect(restored.restore?.finished).toBe(false);

		// Guess 2: exact target -> wins, stage 5 full frame, full reveal returned!
		const g2Res = await vnGuessPost({
			request: new Request(guessUrl, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					roundToken: restored.roundToken,
					stateToken: restored.stateToken,
					guessedId: secret.targetId,
					guessedTitle: secret.reveal.title
				})
			}),
			cookies
		} as never);
		expect(g2Res.status).toBe(200);
		const g2 = await g2Res.json();
		expect(g2.finished).toBe(true);
		expect(g2.won).toBe(true);
		expect(g2.nextStage).toBe(VN_MAX_ATTEMPTS);
		expect(g2.reveal?.id).toBe(secret.targetId);
		expect(g2.reveal?.vndbUrl).toBe(`https://vndb.org/${secret.targetId}`);

		// Post-finish guess is blocked
		const afterRes = await vnGuessPost({
			request: new Request(guessUrl, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					roundToken: restored.roundToken,
					stateToken: g2.stateToken,
					skipped: true
				})
			}),
			cookies
		} as never);
		expect(afterRes.status).toBe(400);

		// Daily pick is deterministic for same date
		expect(pickDailyVn('2026-11-27').vn.id).toBe(pickDailyVn('2026-11-27').vn.id);
		clearVnDailyStoreForTests();
	});
});
