import { describe, expect, it } from 'vitest';
import { CURATED_GLOBAL_POOL } from '../src/lib/curated';
import {
	buildClassicShareText,
	buildWordleShareText,
	CURATED_POOL_SIZE,
	evaluateClassicGuess,
	evaluateWordleAttempt,
	getDailyPuzzleNumber,
	matchAnimeTitle,
	normalizeTitle,
	scoreEpisodeProximity
} from '../src/lib/scoring';
import { filterWatchedEpisodes } from '../src/lib/server/anizip';
import { isAllowedImageUrl } from '../src/lib/server/imageHost';
import { sealPayload, unsealPayload } from '../src/lib/server/token';
import type { EpisodeReveal } from '../src/lib/types';

const SAMPLE_REVEAL: EpisodeReveal = {
	anilistId: 154587,
	titleRomaji: 'Sousou no Frieren',
	titleEnglish: "Frieren: Beyond Journey's End",
	episodeNumber: 3,
	totalEpisodes: 28,
	episodeTitle: 'Killing Magic',
	airDate: '2023-09-29',
	overview: 'Frieren confronts Qual.',
	seasonYear: 2023,
	studio: 'MADHOUSE',
	coverImage: null,
	imageUrl: '/api/image/test',
	anilistUrl: 'https://anilist.co/anime/154587'
};

describe('normalizeTitle & matchAnimeTitle', () => {
	it('handles backticks, punctuation, diacritics, Unicode × vs x, and trailing years', () => {
		expect(normalizeTitle('Frieren: Beyond Journey`s End')).toBe(
			normalizeTitle("Frieren: Beyond Journey's End")
		);
		expect(normalizeTitle('Steins;Gate')).toBe('steins gate');
		expect(normalizeTitle('Pokémon')).toBe('pokemon');
		expect(normalizeTitle('HUNTER×HUNTER (2011)')).toBe('hunter x hunter');
		expect(normalizeTitle('Hunter x Hunter')).toBe('hunter x hunter');
		expect(normalizeTitle('SPY×FAMILY')).toBe('spy x family');
		expect(normalizeTitle('SPY x FAMILY')).toBe('spy x family');
		expect(normalizeTitle('【Oshi no Ko】')).toBe('oshi no ko');
		expect(normalizeTitle('Kono Subarashii Sekai ni Shukufuku o! 3')).toBe(
			normalizeTitle('Kono Subarashii Sekai ni Shukufuku wo! 3')
		);
		expect(normalizeTitle('Mahou Shoujo Madoka☆Magica')).toBe(
			normalizeTitle('Maho Shojo Madoka Magica')
		);
		expect(normalizeTitle('Yuu☆Yuu☆Hakusho')).toBe(normalizeTitle('Yu Yu Hakusho'));
		expect(normalizeTitle('Tokyo Ghoul √A')).toBe(normalizeTitle('Tokyo Ghoul Root A'));
	});

	it('matches exact aliases including HxH, Spy x Family, KonoSuba o/wo, and detects franchises', () => {
		const targets = ['Sousou no Frieren', 'Frieren: Beyond Journey`s End'];
		const franchise = ['Sousou no Frieren 2nd Season'];

		expect(matchAnimeTitle("Frieren: Beyond Journey's End", targets, franchise)).toBe('exact');
		expect(matchAnimeTitle('sousou no frieren', targets, franchise)).toBe('exact');
		expect(matchAnimeTitle('Sousou no Frieren 2nd Season', targets, franchise)).toBe('franchise');
		expect(matchAnimeTitle('Steins;Gate', targets, franchise)).toBe('wrong');

		expect(matchAnimeTitle('Hunter x Hunter', ['HUNTER×HUNTER (2011)'], [])).toBe('exact');
		expect(matchAnimeTitle('SPY x FAMILY', ['SPY×FAMILY'], [])).toBe('exact');
		expect(matchAnimeTitle('Oshi no Ko', ['【Oshi no Ko】'], [])).toBe('exact');
		expect(
			matchAnimeTitle(
				'Kono Subarashii Sekai ni Shukufuku o! 3',
				['Kono Subarashii Sekai ni Shukufuku wo! 3'],
				[]
			)
		).toBe('exact');

		// Symmetric franchise matching across sequel numbering and colon subtitles, while truncated words score wrong
		expect(matchAnimeTitle('Dr. Stone', ['Dr. STONE: SCIENCE FUTURE Part 3'], [])).toBe(
			'franchise'
		);
		expect(matchAnimeTitle('Overlord', ['Overlord III'], [])).toBe('franchise');
		expect(matchAnimeTitle('Overlord III', ['Overlord'], [])).toBe('franchise');
		expect(matchAnimeTitle('Overlord II', ['Overlord III'], [])).toBe('franchise');
		expect(matchAnimeTitle('Bleach', ['Bleach: Sennen Kessen-hen'], [])).toBe('franchise');
		expect(matchAnimeTitle('Bleach: Sennen Kessen-hen', ['Bleach'], [])).toBe('franchise');
		expect(matchAnimeTitle('Mushoku', ['Mushoku Tensei: Isekai Ittara Honki Dasu'], [])).toBe(
			'wrong'
		);
	});
});

describe('scoreEpisodeProximity', () => {
	it('awards 500 for exact match and decays smoothly with distance', () => {
		expect(scoreEpisodeProximity(3, 3, 28)).toEqual({
			points: 500,
			distance: 0,
			label: 'Exact episode'
		});

		const off1 = scoreEpisodeProximity(4, 3, 28);
		const off2 = scoreEpisodeProximity(5, 3, 28);
		const off15 = scoreEpisodeProximity(18, 3, 28);

		expect(off1.points).toBeGreaterThan(off2.points);
		expect(off2.points).toBeGreaterThan(off15.points);
		expect(off1.label).toBe('1 episode off');
		expect(off2.label).toBe('2 episodes off');
	});

	it('scales more forgivingly for long-running shows than 12-ep cours', () => {
		const shortShow = scoreEpisodeProximity(8, 3, 12);
		const longShow = scoreEpisodeProximity(8, 3, 148);
		expect(longShow.points).toBeGreaterThan(shortShow.points);
	});
});

describe('evaluateClassicGuess', () => {
	it('awards 1000 for exact anime and episode, 0 for skip, partial for franchise', () => {
		const exact = evaluateClassicGuess({
			mode: 'classic',
			guessedTitle: 'Sousou no Frieren',
			guessedEpisode: 3,
			skipped: false,
			targetTitles: ['Sousou no Frieren'],
			franchiseTitles: ['Sousou no Frieren 2nd Season'],
			reveal: SAMPLE_REVEAL
		});
		expect(exact.totalPoints).toBe(1000);

		const franchise = evaluateClassicGuess({
			mode: 'classic',
			guessedTitle: 'Sousou no Frieren 2nd Season',
			guessedEpisode: 3,
			skipped: false,
			targetTitles: ['Sousou no Frieren'],
			franchiseTitles: ['Sousou no Frieren 2nd Season'],
			reveal: SAMPLE_REVEAL
		});
		expect(franchise.animeMatch).toBe('franchise');
		expect(franchise.animePoints).toBe(200);
		expect(franchise.episodePoints).toBe(0);

		const skip = evaluateClassicGuess({
			mode: 'classic',
			guessedTitle: '',
			guessedEpisode: null,
			skipped: true,
			targetTitles: ['Sousou no Frieren'],
			franchiseTitles: [],
			reveal: SAMPLE_REVEAL
		});
		expect(skip.totalPoints).toBe(0);
	});
});

describe('evaluateWordleAttempt & share text', () => {
	it('gives higher/lower directional hints and marks solved only when both match', () => {
		const miss = evaluateWordleAttempt({
			attemptNumber: 1,
			guessedTitle: 'Mushoku Tensei',
			guessedEpisode: 10,
			guessedYear: 2021,
			targetTitles: ['Sousou no Frieren'],
			franchiseTitles: [],
			actualEpisode: 3,
			actualYear: 2023,
			totalEpisodes: 28
		});
		expect(miss.animeStatus).toBe('miss');
		expect(miss.yearStatus).toBe('close');
		expect(miss.yearDirection).toBe('up');
		expect(miss.episodeDirection).toBe('down');
		expect(miss.solved).toBe(false);

		const exact = evaluateWordleAttempt({
			attemptNumber: 2,
			guessedTitle: 'Sousou no Frieren',
			guessedEpisode: 3,
			guessedYear: 2023,
			targetTitles: ['Sousou no Frieren'],
			franchiseTitles: [],
			actualEpisode: 3,
			actualYear: 2023,
			totalEpisodes: 28
		});
		expect(exact.solved).toBe(true);
		expect(exact.animeStatus).toBe('hit');
		expect(exact.episodeStatus).toBe('hit');

		const share = buildWordleShareText({
			puzzleNumber: getDailyPuzzleNumber('2026-11-27'),
			scopeLabel: 'Global Daily',
			attempts: [miss, exact],
			won: true
		});
		expect(share).toContain('2/5');
		expect(share).toContain('✅');
		expect(share).toContain('episode-guesser.karczma.moe');

		// Give-up row (episodeDirection === null) must NOT emit a checkmark
		const giveUpShare = buildWordleShareText({
			puzzleNumber: 1,
			scopeLabel: 'Global Daily',
			attempts: [
				{
					attemptNumber: 1,
					guessedTitle: 'Gave up',
					guessedEpisode: 0,
					guessedYear: null,
					animeStatus: 'miss',
					yearStatus: 'miss',
					yearDirection: null,
					episodeStatus: 'miss',
					episodeDirection: null,
					solved: false
				}
			],
			won: false
		});
		expect(giveUpShare).toContain('🏳️');
		expect(giveUpShare).not.toContain('✅');

		// Wrong anime with exact episode number must NOT emit ✅ (solved), uses 🎯 instead
		const wrongAnimeExactEpShare = buildWordleShareText({
			puzzleNumber: 2,
			scopeLabel: 'Global Daily',
			attempts: [
				{
					attemptNumber: 1,
					guessedTitle: 'Steins;Gate',
					guessedEpisode: 3,
					guessedYear: 2011,
					animeStatus: 'miss',
					yearStatus: 'miss',
					yearDirection: 'up',
					episodeStatus: 'close',
					episodeDirection: 'exact',
					solved: false
				}
			],
			won: false
		});
		expect(wrongAnimeExactEpShare).toContain('🎯');
		expect(wrongAnimeExactEpShare).not.toContain('✅');

		const classicShare = buildClassicShareText({
			username: 'sampleplayer',
			rounds: [
				{
					roundIndex: 0,
					result: evaluateClassicGuess({
						mode: 'classic',
						guessedTitle: 'Sousou no Frieren',
						guessedEpisode: 3,
						skipped: false,
						targetTitles: ['Sousou no Frieren'],
						franchiseTitles: [],
						reveal: SAMPLE_REVEAL
					})
				}
			]
		});
		expect(classicShare).toContain('1,000 / 1,000');
	});
});

describe('spoiler protection, curated pool integrity, image allowlist & tokens', () => {
	it('caps watching shows to watched progress while allowing full completed shows', () => {
		const eps = [1, 2, 3, 4, 5, 6].map((n) => ({
			episodeNumber: n,
			title: `Ep ${n}`,
			airDate: null,
			overview: null,
			image: `https://artworks.thetvdb.com/ep${n}.jpg`
		}));

		expect(filterWatchedEpisodes(eps, 3, false).map((e) => e.episodeNumber)).toEqual([1, 2, 3]);
		expect(filterWatchedEpisodes(eps, 3, true).map((e) => e.episodeNumber)).toEqual([
			1, 2, 3, 4, 5, 6
		]);
	});

	it('has unique valid curated IDs matching their cover URLs (including Your Lie in April = 20665)', () => {
		const ids = new Set<number>();
		for (const item of CURATED_GLOBAL_POOL) {
			expect(ids.has(item.id)).toBe(false);
			ids.add(item.id);
			if (item.coverImage) {
				const coverIdMatch = item.coverImage.match(/\/bx(\d+)-/);
				if (coverIdMatch) {
					expect(Number(coverIdMatch[1])).toBe(item.id);
				}
			}
		}
		const ylia = CURATED_GLOBAL_POOL.find((x) => x.titleRomaji === 'Shigatsu wa Kimi no Uso');
		expect(ylia?.id).toBe(20665);
		expect(CURATED_GLOBAL_POOL.length).toBe(CURATED_POOL_SIZE);
		expect(CURATED_GLOBAL_POOL.length).toBeGreaterThanOrEqual(200);
	});

	it('restricts image proxy hosts and protocols strictly', () => {
		expect(isAllowedImageUrl('https://artworks.thetvdb.com/banners/v4/ep.jpg')).toBe(true);
		expect(isAllowedImageUrl('http://127.0.0.1/secret.jpg')).toBe(false);
		expect(isAllowedImageUrl('file:///etc/passwd')).toBe(false);
		expect(isAllowedImageUrl('https://evil.example.com/x.jpg')).toBe(false);
	});

	it('seals and unseals tokens and rejects tampered tokens', () => {
		const token = sealPayload({ anilistId: 154587, ep: 3 });
		expect(unsealPayload<{ anilistId: number; ep: number }>(token)).toEqual({
			anilistId: 154587,
			ep: 3
		});

		const tampered = token.slice(0, -2) + (token.endsWith('AA') ? 'BB' : 'AA');
		expect(unsealPayload(tampered)).toBeNull();
	});
});
