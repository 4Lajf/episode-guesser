import { beforeEach, describe, expect, it, vi } from 'vitest';
import { POST as guessPost } from '../src/routes/api/guess/+server';
import { clearDailyStoreForTests, saveDailyRecord } from '../src/lib/server/dailyStore';
import type { SealedDailyState, SealedRoundSecret } from '../src/lib/server/picker';
import { sealPayload } from '../src/lib/server/token';
import type { EpisodeReveal } from '../src/lib/types';

const REVEAL: EpisodeReveal = {
	anilistId: 108465,
	titleRomaji: 'Mushoku Tensei: Isekai Ittara Honki Dasu',
	titleEnglish: 'Mushoku Tensei: Jobless Reincarnation',
	episodeNumber: 4,
	totalEpisodes: 11,
	episodeTitle: 'Emergency Family Meeting',
	airDate: '2021-01-31',
	overview: 'Paul makes an announcement.',
	seasonYear: 2021,
	studio: 'Studio Bind',
	coverImage: null,
	imageUrl: '/api/image/full-frame',
	anilistUrl: 'https://anilist.co/anime/108465'
};

function makeCookies(pid?: string) {
	return {
		get: (name: string) => (name === 'eg_pid' ? pid : undefined)
	} as unknown as Parameters<typeof guessPost>[0]['cookies'];
}

function makeEvent(body: unknown, pid?: string) {
	return {
		request: new Request('http://localhost/api/guess', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(body)
		}),
		cookies: makeCookies(pid)
	} as unknown as Parameters<typeof guessPost>[0];
}

describe('POST /api/guess security & scoring invariants', () => {
	beforeEach(() => {
		clearDailyStoreForTests();
		vi.restoreAllMocks();
	});

	it('rejects tampered roundToken and dailyStateToken payloads', async () => {
		const res = await guessPost(
			makeEvent({
				roundToken: 'tampered.invalid.token',
				guessedTitle: 'Mushoku Tensei: Isekai Ittara Honki Dasu',
				guessedEpisode: 4
			})
		);
		expect(res.status).toBe(400);

		const roundToken = sealPayload<SealedRoundSecret>({
			typ: 'round',
			v: 1,
			roundId: 'round-1',
			mode: 'daily',
			createdAt: Date.now(),
			rawImageUrl: 'https://artworks.thetvdb.com/banners/v4/episode/1/screencap/a.jpg',
			originX: 50,
			originY: 50,
			targetTitles: [REVEAL.titleRomaji, REVEAL.titleEnglish!],
			franchiseTitles: [],
			reveal: REVEAL,
			dailyDate: '2026-11-27',
			scopeKey: 'global',
			playerId: 'player-1'
		});

		const badDaily = await guessPost(
			makeEvent(
				{
					roundToken,
					dailyStateToken: 'not-a-valid-sealed-token',
					guessedTitle: 'Steins;Gate',
					guessedEpisode: 2
				},
				'player-1'
			)
		);
		expect(badDaily.status).toBe(400);

		// Cross-type token confusion (passing a daily state token as roundToken) must be rejected
		const wrongTypeToken = sealPayload<SealedDailyState>({
			typ: 'daily',
			v: 1,
			roundId: 'round-1',
			dailyDate: '2026-11-27',
			scopeKey: 'global',
			playerId: 'player-1',
			attemptsUsed: 0,
			finished: false,
			usedKeys: []
		});
		const crossType = await guessPost(
			makeEvent({ roundToken: wrongTypeToken, guessedTitle: 'Steins;Gate', guessedEpisode: 1 })
		);
		expect(crossType.status).toBe(400);
	});

	it('enforces Daily attempt limit even if body username/statuses are altered or token is replayed', async () => {
		const pid = 'player-abc';
		const roundId = 'daily-round-1';
		const dailyDate = '2026-11-27';
		const scopeKey = 'user:4lajf:COMPLETED,CURRENT:0';

		const roundToken = sealPayload<SealedRoundSecret>({
			typ: 'round',
			v: 1,
			roundId,
			mode: 'daily',
			createdAt: Date.now(),
			rawImageUrl: 'https://artworks.thetvdb.com/banners/v4/episode/1/screencap/a.jpg',
			originX: 45,
			originY: 55,
			targetTitles: [REVEAL.titleRomaji, REVEAL.titleEnglish!],
			franchiseTitles: [],
			reveal: REVEAL,
			dailyDate,
			scopeKey,
			playerId: pid
		});

		const initialStateToken = sealPayload<SealedDailyState>({
			typ: 'daily',
			v: 1,
			roundId,
			dailyDate,
			scopeKey,
			playerId: pid,
			attemptsUsed: 0,
			finished: false,
			usedKeys: []
		});

		saveDailyRecord(pid, {
			date: dailyDate,
			scopeKey,
			roundId,
			roundToken,
			dailyStateToken: initialStateToken,
			currentImageUrl: '/api/image/crop1',
			attempts: [],
			usedKeys: [],
			finished: false,
			won: false,
			updatedAt: Date.now()
		});

		// Missing cookie must be rejected (403)
		const noCookieRes = await guessPost(
			makeEvent({
				roundToken,
				dailyStateToken: initialStateToken,
				guessedTitle: 'Steins;Gate',
				guessedEpisode: 1
			})
		);
		expect(noCookieRes.status).toBe(403);

		// Valid attempt 1 succeeds
		const g1 = await guessPost(
			makeEvent(
				{
					roundToken,
					dailyStateToken: initialStateToken,
					guessedTitle: 'Steins;Gate',
					guessedEpisode: 1
				},
				pid
			)
		);
		expect(g1.status).toBe(200);

		// Replaying initialStateToken while spoofing a different username in body MUST still fail with 409
		const replayRescoped = await guessPost(
			makeEvent(
				{
					roundToken,
					dailyStateToken: initialStateToken,
					guessedTitle: 'Cowboy Bebop',
					guessedEpisode: 2,
					username: 'some_other_user',
					statuses: ['DROPPED']
				},
				pid
			)
		);
		expect(replayRescoped.status).toBe(409);
	});

	it('does NOT award exact credit for partial free-text like "Mushoku" via AniList fuzzy search', async () => {
		// Mock AniList GraphQL fuzzy search returning Mushoku Tensei for partial query "Mushoku"
		vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
			new Response(
				JSON.stringify({
					data: {
						Media: {
							id: REVEAL.anilistId,
							seasonYear: 2021,
							startDate: { year: 2021 },
							title: {
								romaji: REVEAL.titleRomaji,
								english: REVEAL.titleEnglish,
								native: '無職転生'
							},
							synonyms: ['Mushoku Tensei']
						}
					}
				}),
				{ status: 200, headers: { 'content-type': 'application/json' } }
			)
		);

		const roundToken = sealPayload<SealedRoundSecret>({
			typ: 'round',
			v: 1,
			roundId: 'classic-1',
			mode: 'classic',
			createdAt: Date.now(),
			rawImageUrl: 'https://artworks.thetvdb.com/banners/v4/episode/1/screencap/a.jpg',
			originX: 50,
			originY: 50,
			targetTitles: [REVEAL.titleRomaji, REVEAL.titleEnglish!],
			franchiseTitles: [],
			reveal: REVEAL
		});

		const res = await guessPost(
			makeEvent({
				roundToken,
				guessedTitle: 'Mushoku',
				guessedEpisode: 4
			})
		);
		expect(res.status).toBe(200);
		const json = await res.json();
		expect(json.animeMatch).toBe('wrong');
		expect(json.animePoints).toBe(0);
		expect(json.episodePoints).toBe(0);
		expect(json.totalPoints).toBe(0);
	});
});
