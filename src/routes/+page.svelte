<script lang="ts">
	import { onMount, tick } from 'svelte';
	import AppHeader from '$lib/components/AppHeader.svelte';
	import ClassicSummary from '$lib/components/ClassicSummary.svelte';
	import DailyBoard from '$lib/components/DailyBoard.svelte';
	import DailyZoomLadder from '$lib/components/DailyZoomLadder.svelte';
	import FrameLightbox from '$lib/components/FrameLightbox.svelte';
	import GuessConsole from '$lib/components/GuessConsole.svelte';
	import LightTable from '$lib/components/LightTable.svelte';
	import PlayerSetupModal from '$lib/components/PlayerSetupModal.svelte';
	import RoundReveal from '$lib/components/RoundReveal.svelte';
	import SessionBar from '$lib/components/SessionBar.svelte';
	import UnlimitedSummary from '$lib/components/UnlimitedSummary.svelte';
	import {
		CLASSIC_ROUNDS,
		CURATED_POOL_SIZE,
		getTodayUtcDate,
		normalizeTitle,
		UNLIMITED_MAX_LIVES,
		WORDLE_ZOOM_STEPS
	} from '$lib/scoring';
	import type {
		AutocompleteEntry,
		ClassicGuessResponse,
		CompletedClassicRound,
		EpisodeReveal,
		GameMode,
		ListStatus,
		RoundPayload,
		WordleAttemptFeedback,
		WordleGuessResponse
	} from '$lib/types';

	interface PublicProfile {
		username: string;
		avatar: string | null;
		totalEntries: number;
		eligibleShows: number;
		isGlobalPool: boolean;
		statuses: ListStatus[];
		includeSingleEp: boolean;
		titlesForDropdown: string[];
	}

	const STORAGE_USER_KEY = 'eg:anilist-config:v1';
	const STORAGE_RECENT_KEY = 'eg:recent-users:v1';
	const STORAGE_BEST_STREAK_KEY = 'eg:best-streak:v1';
	const STORAGE_BEST_SCORE_KEY = 'eg:unlimited-best-score:v1';
	const STORAGE_DAILY_SCOPE_KEY = 'eg:daily-global:v1';
	const STORAGE_DAILY_DONE_KEY = 'eg:daily-done:v1';

	let autocompleteEntries = $state<AutocompleteEntry[]>([]);

	let profile = $state<PublicProfile>({
		username: 'Global Pool',
		avatar: null,
		totalEntries: CURATED_POOL_SIZE,
		eligibleShows: CURATED_POOL_SIZE,
		isGlobalPool: true,
		statuses: ['COMPLETED', 'CURRENT'],
		includeSingleEp: false,
		titlesForDropdown: []
	});
	let profileLoading = $state(true);
	let setupOpen = $state(false);
	let setupLoading = $state(false);
	let setupError = $state<string | null>(null);
	let recentUsers = $state<string[]>([]);
	let nudgeDismissed = $state(false);
	let failedSavedUser = $state<{
		username: string;
		statuses: ListStatus[];
		includeSingleEp: boolean;
		reason: string;
	} | null>(null);

	let mode = $state<GameMode>('daily');
	let roundLoading = $state(false);
	let roundError = $state<string | null>(null);
	let roundNotice = $state<string | null>(null);
	let guessInlineError = $state<string | null>(null);
	let submitting = $state(false);
	let lightboxOpen = $state(false);
	let lightboxImage = $state<string | null>(null);
	let roundCounter = $state(0);
	let srAnnouncement = $state('');

	// Race protection across rapid mode / scope switches
	let roundRequestSeq = 0;
	let activeRoundAbort: AbortController | null = null;

	// Per-mode preserved rounds & reveals so switching tabs NEVER wipes an active run!
	let classicRound = $state<RoundPayload | null>(null);
	let classicReveal = $state<ClassicGuessResponse | null>(null);
	let classicRoundIndex = $state(0);
	let classicHistory = $state<CompletedClassicRound[]>([]);
	let classicScore = $state(0);
	let classicStreak = $state(0);
	let classicFinished = $state(false);
	let classicSeenIds = $state<number[]>([]);

	let unlimitedRound = $state<RoundPayload | null>(null);
	let unlimitedReveal = $state<ClassicGuessResponse | null>(null);
	let unlimitedCount = $state(0);
	let unlimitedScore = $state(0);
	let unlimitedStreak = $state(0);
	let unlimitedRunPeakStreak = $state(0);
	let unlimitedLives = $state(UNLIMITED_MAX_LIVES);
	let unlimitedHistory = $state<CompletedClassicRound[]>([]);
	let unlimitedFinished = $state(false);
	let unlimitedBestScore = $state(0);
	let unlimitedRunIsNewBest = $state(false);
	let bestStreak = $state(0);
	let unlimitedSeenIds = $state<number[]>([]);
	let recentMediaIds = $state<number[]>([]);

	let dailyRound = $state<RoundPayload | null>(null);
	let dailyUseGlobal = $state(false);
	let dailyStateToken = $state<string | null>(null);
	let dailyAttempts = $state<WordleAttemptFeedback[]>([]);
	let dailyFinished = $state(false);
	let dailyWon = $state(false);
	let dailyReveal = $state<EpisodeReveal | null>(null);
	let dailyLiveEpisode = $state(1);
	let dailyCompletedHint = $state(false);

	const currentRound = $derived(
		mode === 'classic' ? classicRound : mode === 'unlimited' ? unlimitedRound : dailyRound
	);

	const activeReveal = $derived(
		mode === 'classic' ? classicReveal : mode === 'unlimited' ? unlimitedReveal : null
	);

	const activeStreak = $derived(mode === 'classic' ? classicStreak : unlimitedStreak);

	// Strictly global autocomplete catalog (deduplicated per AniList ID from anime-offline-database + AnisongDB)
	// so the dropdown NEVER reveals whether any anime is on the active user's list or Global Pool.
	const dropdownEntries = $derived(autocompleteEntries);

	const dailyScopeHintKey = $derived.by(() => {
		const today = getTodayUtcDate();
		const useGlobal = profile.isGlobalPool || dailyUseGlobal;
		if (useGlobal) return `${today}|global`;
		return `${today}|user:${profile.username.toLowerCase()}`;
	});

	const activeRunWarning = $derived.by(() => {
		if (classicHistory.length > 0 && !classicFinished) {
			return `Changing accounts or list filters will reset your active Classic run (round ${Math.min(classicRoundIndex + 1, CLASSIC_ROUNDS)} of ${CLASSIC_ROUNDS}).`;
		}
		if (!unlimitedFinished && (unlimitedCount > 0 || unlimitedReveal)) {
			return `Changing accounts or list filters will reset your active Unlimited run (${unlimitedScore.toLocaleString('en-US')} pts, ${unlimitedLives} ${unlimitedLives === 1 ? 'life' : 'lives'} left).`;
		}
		return null;
	});

	function readDailyDoneHint(key: string): boolean {
		try {
			const raw = localStorage.getItem(STORAGE_DAILY_DONE_KEY);
			if (!raw) return false;
			const parsed = JSON.parse(raw) as Record<string, boolean>;
			return Boolean(parsed[key]);
		} catch {
			return false;
		}
	}

	function writeDailyDoneHint(key: string, done: boolean) {
		dailyCompletedHint = done;
		try {
			const raw = localStorage.getItem(STORAGE_DAILY_DONE_KEY);
			const parsed = raw ? (JSON.parse(raw) as Record<string, boolean>) : {};
			const todayPrefix = `${getTodayUtcDate()}|`;
			const next: Record<string, boolean> = {};
			for (const [k, v] of Object.entries(parsed)) {
				if (k.startsWith(todayPrefix) && v) next[k] = true;
			}
			if (done) next[key] = true;
			localStorage.setItem(STORAGE_DAILY_DONE_KEY, JSON.stringify(next));
		} catch {
			// ignore
		}
	}

	const dailyActiveStepIndex = $derived(
		dailyFinished
			? WORDLE_ZOOM_STEPS.length - 1
			: Math.min(dailyAttempts.length, WORDLE_ZOOM_STEPS.length - 1)
	);

	const dailyZoomScale = $derived(WORDLE_ZOOM_STEPS[dailyActiveStepIndex]);

	const dailyMatchedAttempt = $derived.by(() => {
		if (mode !== 'daily' || dailyFinished) return null;
		return dailyAttempts.find((a) => a.animeStatus === 'hit') ?? null;
	});

	const dailyAnimeHitAttempt = $derived(
		dailyAttempts.find((a) => a.animeStatus === 'hit')?.attemptNumber ?? null
	);

	const dailyEpisodeBounds = $derived.by(() => {
		let minEp = 1;
		let maxEp: number | null = null;
		for (const a of dailyAttempts) {
			if (a.guessedEpisode <= 0) continue;
			if (a.episodeDirection === 'exact') {
				minEp = a.guessedEpisode;
				maxEp = a.guessedEpisode;
			} else if (a.episodeDirection === 'up') {
				minEp = Math.max(minEp, a.guessedEpisode + 1);
			} else if (a.episodeDirection === 'down') {
				const cand = Math.max(1, a.guessedEpisode - 1);
				maxEp = maxEp === null ? cand : Math.min(maxEp, cand);
			}
		}
		if (maxEp !== null && minEp > maxEp) {
			minEp = 1;
			maxEp = null;
		}
		// Never spoil the last remaining episode or silently jump the episode input before the show is matched.
		const lastTriedEp = dailyAttempts.at(-1)?.guessedEpisode;
		const initialEp = lastTriedEp && lastTriedEp > 0 ? lastTriedEp : 1;

		let hint = '';
		if (dailyMatchedAttempt) {
			if (minEp > 1 && maxEp !== null) {
				hint =
					minEp === maxEp
						? 'You narrowed it down to one episode — check your arrows above.'
						: `The episode is between ${minEp} and ${maxEp}.`;
			} else if (maxEp !== null) {
				hint = `The episode is earlier than ${maxEp + 1}.`;
			} else if (minEp > 1) {
				hint = `The episode is later than ${minEp - 1}.`;
			} else {
				hint = 'Narrow down the episode number.';
			}
		}
		return { minEp, maxEp, initialEp, hint };
	});

	const activeImageUrl = $derived(activeReveal?.reveal.imageUrl ?? currentRound?.imageUrl ?? null);

	const celNote = $derived.by(() => {
		if (mode === 'daily') {
			if (dailyFinished) return 'Full 1.0× frame unlocked';
			if (dailyZoomScale <= 1.01) return 'Full 1.0× frame — final attempt';
			return `Zoom ${dailyZoomScale.toFixed(1)}×, wider after every miss`;
		}
		if (activeReveal) {
			return mode === 'classic'
				? `Round ${classicRoundIndex + 1} frame`
				: `Frame #${unlimitedCount + 1}`;
		}
		return '';
	});

	function syncModeUrl(nextMode: GameMode) {
		if (typeof window === 'undefined') return;
		const url = new URL(window.location.href);
		if (nextMode === 'daily') url.searchParams.delete('mode');
		else url.searchParams.set('mode', nextMode);
		window.history.replaceState({}, '', url.toString());
	}

	function setRoundForMode(targetMode: GameMode, payload: RoundPayload | null) {
		if (targetMode === 'classic') classicRound = payload;
		else if (targetMode === 'unlimited') unlimitedRound = payload;
		else dailyRound = payload;
	}

	function applyDailyStateFromPayload(payload: RoundPayload) {
		if (payload.dailyRestore) {
			dailyAttempts = payload.dailyRestore.attempts;
			dailyFinished = payload.dailyRestore.finished;
			dailyWon = payload.dailyRestore.won;
			dailyReveal = payload.dailyRestore.reveal ?? null;
			dailyStateToken = payload.dailyStateToken ?? null;
			writeDailyDoneHint(dailyScopeHintKey, payload.dailyRestore.finished);
			return;
		}

		dailyAttempts = [];
		dailyFinished = false;
		dailyWon = false;
		dailyReveal = null;
		dailyStateToken = payload.dailyStateToken ?? null;
		writeDailyDoneHint(dailyScopeHintKey, false);
	}

	function saveRecentUser(name: string) {
		const next = [name, ...recentUsers.filter((u) => u.toLowerCase() !== name.toLowerCase())].slice(
			0,
			5
		);
		recentUsers = next;
		try {
			localStorage.setItem(STORAGE_RECENT_KEY, JSON.stringify(next));
		} catch {
			// ignore
		}
	}

	async function loadAutocompleteTitles() {
		try {
			const res = await fetch('/api/autocomplete');
			if (!res.ok) return;
			const data = (await res.json()) as {
				entries?: AutocompleteEntry[];
				titles?: string[];
			};
			if (Array.isArray(data.entries) && data.entries.length > 0) {
				autocompleteEntries = data.entries;
			} else if (Array.isArray(data.titles)) {
				autocompleteEntries = data.titles.map((t) => ({ t }));
			}
		} catch {
			// keep empty until retry
		}
	}

	function recordRecentMedia(id: number) {
		recentMediaIds = [...recentMediaIds.filter((x) => x !== id), id].slice(-24);
	}

	function clearAllModeRuns() {
		classicRound = null;
		classicReveal = null;
		classicRoundIndex = 0;
		classicHistory = [];
		classicScore = 0;
		classicStreak = 0;
		classicFinished = false;
		classicSeenIds = [];

		unlimitedRound = null;
		unlimitedReveal = null;
		unlimitedCount = 0;
		unlimitedScore = 0;
		unlimitedStreak = 0;
		unlimitedRunPeakStreak = 0;
		unlimitedLives = UNLIMITED_MAX_LIVES;
		unlimitedHistory = [];
		unlimitedFinished = false;
		unlimitedRunIsNewBest = false;
		unlimitedSeenIds = [];
		recentMediaIds = [];

		dailyRound = null;
		dailyAttempts = [];
		dailyFinished = false;
		dailyWon = false;
		dailyReveal = null;
		dailyStateToken = null;
	}

	async function loadProfile(
		username: string | null,
		statuses: ListStatus[] = ['COMPLETED', 'CURRENT'],
		includeSingleEp = false,
		closeAfter = true,
		fallbackToGlobalOnError = false
	): Promise<boolean> {
		setupLoading = true;
		setupError = null;
		try {
			const params = new URLSearchParams();
			if (!username) {
				params.set('global', '1');
			} else {
				params.set('username', username);
				params.set('statuses', statuses.join(','));
				if (includeSingleEp) params.set('includeSingleEp', '1');
			}

			const res = await fetch(`/api/anilist?${params.toString()}`);
			const data = await res.json();
			if (!res.ok) {
				const errMsg = data.error || 'Could not load that AniList profile.';
				setupError = errMsg;
				if (fallbackToGlobalOnError && username) {
					failedSavedUser = { username, statuses, includeSingleEp, reason: errMsg };
					await loadProfile(null, ['COMPLETED', 'CURRENT'], false, true, false);
				}
				return false;
			}

			if (username) {
				failedSavedUser = null;
			}

			profile = data as PublicProfile;
			if (profile.isGlobalPool) {
				dailyUseGlobal = true;
			} else {
				try {
					dailyUseGlobal = localStorage.getItem(STORAGE_DAILY_SCOPE_KEY) === '1';
				} catch {
					dailyUseGlobal = false;
				}
			}

			if (!profile.isGlobalPool) {
				saveRecentUser(profile.username);
				try {
					localStorage.setItem(
						STORAGE_USER_KEY,
						JSON.stringify({
							username: profile.username,
							statuses: profile.statuses,
							includeSingleEp: profile.includeSingleEp
						})
					);
				} catch {
					// ignore
				}
			} else if (!failedSavedUser) {
				try {
					localStorage.removeItem(STORAGE_USER_KEY);
				} catch {
					// ignore
				}
			}

			dailyCompletedHint = readDailyDoneHint(dailyScopeHintKey);
			if (closeAfter) setupOpen = false;
			clearAllModeRuns();
			fetchRound(mode);
			return true;
		} catch {
			const errMsg = 'Network error while reaching AniList.';
			setupError = errMsg;
			if (fallbackToGlobalOnError && username) {
				failedSavedUser = { username, statuses, includeSingleEp, reason: errMsg };
				await loadProfile(null, ['COMPLETED', 'CURRENT'], false, true, false);
			}
			return false;
		} finally {
			setupLoading = false;
			profileLoading = false;
		}
	}

	async function fetchRound(targetMode: GameMode, notice: string | null = null) {
		const seq = ++roundRequestSeq;
		activeRoundAbort?.abort();
		const controller = new AbortController();
		activeRoundAbort = controller;

		roundLoading = true;
		roundError = null;
		roundNotice = notice;
		guessInlineError = null;
		if (targetMode === 'classic') classicReveal = null;
		else if (targetMode === 'unlimited') unlimitedReveal = null;
		setRoundForMode(targetMode, null);

		try {
			const useGlobalPool =
				profile.isGlobalPool || (targetMode === 'daily' && dailyUseGlobal);
			const excludeMediaIds =
				targetMode === 'classic'
					? Array.from(new Set([...classicSeenIds, ...recentMediaIds]))
					: targetMode === 'unlimited'
						? Array.from(new Set([...unlimitedSeenIds, ...recentMediaIds]))
						: [];

			const res = await fetch('/api/round', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					mode: targetMode,
					username: useGlobalPool ? undefined : profile.username,
					useGlobalPool,
					statuses: profile.statuses,
					includeSingleEp: profile.includeSingleEp,
					excludeMediaIds
				}),
				signal: controller.signal
			});

			const data = await res.json();

			if (seq !== roundRequestSeq || targetMode !== mode) return;

			if (!res.ok) {
				roundError = data.error || 'Could not fetch an episode screencap.';
				setRoundForMode(targetMode, null);
				return;
			}

			const payload = data as RoundPayload;
			setRoundForMode(targetMode, payload);
			roundCounter++;

			if (targetMode === 'daily' && payload.dailyMeta) {
				applyDailyStateFromPayload(payload);
			}
		} catch (err) {
			if (err instanceof Error && err.name === 'AbortError') return;
			if (seq !== roundRequestSeq) return;
			roundError = 'Network error while loading the next frame.';
			setRoundForMode(targetMode, null);
		} finally {
			if (seq === roundRequestSeq) {
				roundLoading = false;
			}
		}
	}

	function switchMode(nextMode: GameMode) {
		if (nextMode === mode) {
			if (
				!currentRound &&
				!roundLoading &&
				!(mode === 'classic' && classicFinished) &&
				!(mode === 'unlimited' && unlimitedFinished)
			) {
				fetchRound(mode);
			}
			return;
		}
		mode = nextMode;
		syncModeUrl(nextMode);
		roundError = null;
		guessInlineError = null;
		submitting = false;

		const hasExisting =
			nextMode === 'classic'
				? Boolean(classicRound || classicReveal || classicFinished)
				: nextMode === 'unlimited'
					? Boolean(unlimitedRound || unlimitedReveal || unlimitedFinished)
					: Boolean(dailyRound);

		if (!hasExisting) {
			fetchRound(nextMode);
		}
	}

	function restartClassicRun() {
		mode = 'classic';
		syncModeUrl('classic');
		classicRound = null;
		classicReveal = null;
		classicRoundIndex = 0;
		classicHistory = [];
		classicScore = 0;
		classicStreak = 0;
		classicFinished = false;
		classicSeenIds = [];
		fetchRound('classic');
	}

	function restartUnlimitedRun() {
		mode = 'unlimited';
		syncModeUrl('unlimited');
		unlimitedRound = null;
		unlimitedReveal = null;
		unlimitedCount = 0;
		unlimitedScore = 0;
		unlimitedStreak = 0;
		unlimitedRunPeakStreak = 0;
		unlimitedLives = UNLIMITED_MAX_LIVES;
		unlimitedHistory = [];
		unlimitedFinished = false;
		unlimitedRunIsNewBest = false;
		unlimitedSeenIds = [];
		fetchRound('unlimited');
	}

	function toggleDailyScope() {
		dailyUseGlobal = !dailyUseGlobal;
		try {
			localStorage.setItem(STORAGE_DAILY_SCOPE_KEY, dailyUseGlobal ? '1' : '0');
		} catch {
			// ignore
		}
		dailyRound = null;
		dailyAttempts = [];
		dailyFinished = false;
		dailyWon = false;
		dailyReveal = null;
		dailyStateToken = null;
		dailyCompletedHint = readDailyDoneHint(dailyScopeHintKey);
		fetchRound('daily');
	}

	async function submitGuess(guessedTitle: string, guessedEpisode: number, skipped = false) {
		if (!currentRound || submitting) return;

		const reqMode = mode;
		const reqToken = currentRound.roundToken;
		const reqSeq = roundRequestSeq;
		guessInlineError = null;
		roundError = null;

		if (reqMode === 'daily' && !skipped) {
			const normTitle = normalizeTitle(guessedTitle);
			const dup = dailyAttempts.some(
				(a) => normalizeTitle(a.guessedTitle) === normTitle && a.guessedEpisode === guessedEpisode
			);
			if (dup) {
				guessInlineError = `You already tried "${guessedTitle}" episode ${guessedEpisode}.`;
				return;
			}
		}

		submitting = true;

		try {
			const useGlobalPool =
				profile.isGlobalPool || (reqMode === 'daily' && dailyUseGlobal);

			const res = await fetch('/api/guess', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					roundToken: reqToken,
					dailyStateToken: reqMode === 'daily' ? dailyStateToken : undefined,
					guessedTitle,
					guessedEpisode,
					skipped,
					username: useGlobalPool ? undefined : profile.username,
					statuses: profile.statuses,
					includeSingleEp: profile.includeSingleEp
				})
			});

			const data = await res.json();

			if (reqSeq !== roundRequestSeq || reqMode !== mode || currentRound?.roundToken !== reqToken) {
				return;
			}

			if (!res.ok) {
				const errMsg: string = data.error || 'Could not check your guess.';
				if (
					reqMode === 'daily' &&
					(res.status === 409 ||
						res.status === 403 ||
						/expired|mismatch|out of sync/i.test(errMsg))
				) {
					submitting = false;
					fetchRound('daily', 'Daily session refreshed — showing your latest progress.');
					return;
				}
				if (reqMode === 'daily') {
					guessInlineError = errMsg;
				} else {
					roundError = errMsg;
				}
				return;
			}

			if (reqMode === 'daily') {
				const wordleRes = data as WordleGuessResponse;
				const nextIdx = dailyAttempts.length;
				dailyAttempts = [...dailyAttempts, wordleRes.attempt];
				dailyFinished = wordleRes.finished;
				dailyWon = wordleRes.won;
				dailyStateToken = wordleRes.dailyStateToken;
				if (wordleRes.nextImageUrl && dailyRound) {
					dailyRound = {
						...dailyRound,
						imageUrl: wordleRes.nextImageUrl
					};
				}
				if (wordleRes.reveal) {
					dailyReveal = wordleRes.reveal;
				}
				if (wordleRes.finished) {
					writeDailyDoneHint(dailyScopeHintKey, true);
				}

				const a = wordleRes.attempt;
				srAnnouncement = wordleRes.won
					? `Solved in ${dailyAttempts.length} of 5! ${wordleRes.reveal?.titleRomaji}, episode ${wordleRes.reveal?.episodeNumber}.`
					: a.gaveUp
						? `Gave up. The answer was ${wordleRes.reveal?.titleRomaji}, episode ${wordleRes.reveal?.episodeNumber}.`
						: `Guess ${a.attemptNumber}: ${a.guessedTitle}, ${a.animeStatus === 'hit' ? 'correct anime' : a.animeStatus === 'close' ? 'same franchise' : 'wrong anime'}. Episode ${a.guessedEpisode}${a.episodeDirection === 'up' ? ', answer is later' : a.episodeDirection === 'down' ? ', answer is earlier' : ''}.`;

				// On narrow viewports, smoothly reveal the newly scored row below the input
				if (typeof window !== 'undefined' && window.innerWidth <= 960) {
					tick().then(() => {
						document.getElementById(`daily-row-${nextIdx}`)?.scrollIntoView({
							behavior: 'smooth',
							block: 'nearest'
						});
					});
				}
			} else {
				const classicRes = data as ClassicGuessResponse;

				if (reqMode === 'classic') {
					classicReveal = classicRes;
					classicSeenIds = [...classicSeenIds, classicRes.reveal.anilistId];
					recordRecentMedia(classicRes.reveal.anilistId);
					classicScore += classicRes.totalPoints;
					classicStreak = classicRes.animeMatch === 'exact' ? classicStreak + 1 : 0;
					classicHistory = [
						...classicHistory,
						{ roundIndex: classicRoundIndex, result: classicRes }
					];
				} else {
					unlimitedReveal = classicRes;
					unlimitedSeenIds = [...unlimitedSeenIds, classicRes.reveal.anilistId];
					recordRecentMedia(classicRes.reveal.anilistId);
					unlimitedHistory = [
						...unlimitedHistory,
						{ roundIndex: unlimitedCount, result: classicRes }
					];
					unlimitedScore += classicRes.totalPoints;
					if (unlimitedScore > unlimitedBestScore) {
						unlimitedBestScore = unlimitedScore;
						unlimitedRunIsNewBest = true;
						try {
							localStorage.setItem(STORAGE_BEST_SCORE_KEY, String(unlimitedBestScore));
						} catch {
							// ignore
						}
					}
					if (classicRes.animeMatch === 'exact') {
						unlimitedStreak++;
						if (unlimitedStreak > unlimitedRunPeakStreak) {
							unlimitedRunPeakStreak = unlimitedStreak;
						}
						if (unlimitedStreak > bestStreak) {
							bestStreak = unlimitedStreak;
							try {
								localStorage.setItem(STORAGE_BEST_STREAK_KEY, String(bestStreak));
							} catch {
								// ignore
							}
						}
					} else if (classicRes.animeMatch === 'franchise') {
						// Same franchise resets streak but spares your life
						unlimitedStreak = 0;
					} else {
						unlimitedStreak = 0;
						unlimitedLives = Math.max(0, unlimitedLives - 1);
					}
				}

				srAnnouncement = `${classicRes.reveal.titleRomaji}, episode ${classicRes.reveal.episodeNumber}. Scored ${classicRes.totalPoints} of 1,000 points.`;
			}
		} catch {
			if (reqSeq === roundRequestSeq) {
				roundError = 'Network error while checking your guess.';
			}
		} finally {
			if (reqSeq === roundRequestSeq) {
				submitting = false;
			}
		}
	}

	function advanceAfterReveal() {
		if (mode === 'classic') {
			if (classicRoundIndex + 1 >= CLASSIC_ROUNDS) {
				classicFinished = true;
				classicReveal = null;
				return;
			}
			classicRoundIndex++;
		} else if (mode === 'unlimited') {
			if (unlimitedLives <= 0) {
				unlimitedFinished = true;
				unlimitedReveal = null;
				return;
			}
			unlimitedCount++;
		}
		fetchRound(mode);
	}

	function openInspect(url: string | null) {
		if (!url) return;
		lightboxImage = url;
		lightboxOpen = true;
	}

	onMount(() => {
		loadAutocompleteTitles();

		try {
			const savedBest = Number(localStorage.getItem(STORAGE_BEST_STREAK_KEY) || '0');
			if (Number.isFinite(savedBest) && savedBest > 0) bestStreak = savedBest;

			const savedBestScore = Number(localStorage.getItem(STORAGE_BEST_SCORE_KEY) || '0');
			if (Number.isFinite(savedBestScore) && savedBestScore > 0) {
				unlimitedBestScore = savedBestScore;
			}

			const savedRecent = JSON.parse(localStorage.getItem(STORAGE_RECENT_KEY) || '[]');
			if (Array.isArray(savedRecent)) {
				recentUsers = savedRecent.filter((x): x is string => typeof x === 'string').slice(0, 5);
			}
		} catch {
			// ignore
		}

		const urlParams = new URLSearchParams(window.location.search);
		const urlUser = urlParams.get('user')?.trim();
		const urlMode = urlParams.get('mode');
		if (urlMode === 'unlimited' || urlMode === 'daily' || urlMode === 'classic') {
			mode = urlMode;
		}

		if (urlUser) {
			loadProfile(urlUser, ['COMPLETED', 'CURRENT'], false, true, true);
			return;
		}

		try {
			const rawUser = localStorage.getItem(STORAGE_USER_KEY);
			if (rawUser) {
				const saved = JSON.parse(rawUser) as {
					username?: string;
					statuses?: ListStatus[];
					includeSingleEp?: boolean;
				};
				if (saved.username) {
					loadProfile(
						saved.username,
						saved.statuses ?? ['COMPLETED', 'CURRENT'],
						Boolean(saved.includeSingleEp),
						true,
						true
					);
					return;
				}
			}
		} catch {
			// ignore
		}

		loadProfile(null, ['COMPLETED', 'CURRENT'], false, true, false);
	});
</script>

<div class="app-shell">
	<!-- Polite screen-reader announcer for Classic reveals and Daily attempt results -->
	<div class="sr-only" aria-live="polite" aria-atomic="true">{srAnnouncement}</div>

	<AppHeader
		{mode}
		username={profile.username}
		avatar={profile.avatar}
		eligibleShows={profile.eligibleShows}
		isGlobalPool={profile.isGlobalPool}
		dailyUnplayed={!dailyFinished && !dailyCompletedHint}
		onModeChange={switchMode}
		onOpenSetup={() => {
			setupError = null;
			setupOpen = true;
		}}
	/>

	{#if failedSavedUser}
		<div class="shell nudge-wrap">
			<div class="anilist-nudge warn" role="status">
				<span>
					Couldn’t load AniList user <b>{failedSavedUser.username}</b> ({failedSavedUser.reason}). Playing curated Global Pool for now.
				</span>
				<div class="nudge-actions">
					<button
						type="button"
						class="nudge-btn"
						onclick={() => {
							if (!failedSavedUser) return;
							loadProfile(
								failedSavedUser.username,
								failedSavedUser.statuses,
								failedSavedUser.includeSingleEp,
								true,
								false
							);
						}}
					>
						Retry {failedSavedUser.username}
					</button>
					<button type="button" class="nudge-dismiss" onclick={() => (failedSavedUser = null)}>
						Dismiss
					</button>
				</div>
			</div>
		</div>
	{:else if profile.isGlobalPool && !profileLoading && !nudgeDismissed}
		<div class="shell nudge-wrap">
			<div class="anilist-nudge">
				<span class="nudge-copy">
					Playing Global Pool ({profile.eligibleShows} popular anime). Connect your AniList to play your own list.
				</span>
				<div class="nudge-actions">
					<button type="button" class="nudge-btn" onclick={() => (setupOpen = true)}>
						Connect AniList
					</button>
					<button
						type="button"
						class="nudge-dismiss"
						aria-label="Dismiss Global Pool notice"
						onclick={() => (nudgeDismissed = true)}
					>
						×
					</button>
				</div>
			</div>
		</div>
	{/if}

	<SessionBar
		{mode}
		{classicRoundIndex}
		{classicHistory}
		{classicScore}
		{unlimitedCount}
		{unlimitedScore}
		{unlimitedLives}
		unlimitedMaxLives={UNLIMITED_MAX_LIVES}
		streak={activeStreak}
		{bestStreak}
		dailyPuzzleNumber={currentRound?.dailyMeta?.puzzleNumber}
		dailyScopeLabel={currentRound?.dailyMeta?.scopeLabel}
		dailyAttemptsCount={dailyAttempts.length}
		{dailyAnimeHitAttempt}
		dailyGaveUp={dailyAttempts.some((a) => a.gaveUp)}
		{dailyWon}
		{dailyFinished}
		canSwitchDailyScope={mode === 'daily' && !profile.isGlobalPool}
		isGlobalDaily={dailyUseGlobal}
		onToggleDailyScope={toggleDailyScope}
	/>

	<main class="stage">
		<h1 class="sr-only">
			{#if mode === 'classic'}
				Classic game, round {Math.min(classicRoundIndex + 1, CLASSIC_ROUNDS)} of {CLASSIC_ROUNDS}
			{:else if mode === 'unlimited'}
				Unlimited mode, frame {unlimitedCount + 1}
			{:else}
				Daily Frame-Wordle
			{/if}
		</h1>

		{#if roundNotice}
			<div class="shell">
				<div class="anilist-nudge" role="status">
					<span>{roundNotice}</span>
					<button type="button" class="nudge-dismiss" onclick={() => (roundNotice = null)}>
						Dismiss
					</button>
				</div>
			</div>
		{/if}

		{#if roundError}
			<div class="shell">
				<div class="error-banner" role="alert">
					<span>{roundError}</span>
					<button type="button" class="retry-btn" onclick={() => fetchRound(mode)}>
						Try another frame
					</button>
				</div>
			</div>
		{/if}

		{#if mode === 'classic' && classicFinished}
			<div class="shell">
				<ClassicSummary
					username={profile.username}
					rounds={classicHistory}
					{dailyFinished}
					onPlayAgain={restartClassicRun}
					onSwitchDaily={() => switchMode('daily')}
					onSwitchUnlimited={() => switchMode('unlimited')}
				/>
			</div>
		{:else if mode === 'unlimited' && unlimitedFinished}
			<div class="shell">
				<UnlimitedSummary
					username={profile.username}
					rounds={unlimitedHistory}
					peakStreak={unlimitedRunPeakStreak}
					{bestStreak}
					bestScore={unlimitedBestScore}
					isNewBestScore={unlimitedRunIsNewBest}
					{dailyFinished}
					onPlayAgain={restartUnlimitedRun}
					onSwitchDaily={() => switchMode('daily')}
					onSwitchClassic={() => switchMode('classic')}
				/>
			</div>
		{:else}
			<!-- Unified 2-column stage: Left cel stays pinned in the exact same position across Guess, Reveal, and Daily -->
			<div class="shell cols">
				<div class="left-stage">
					<LightTable
						imageUrl={activeImageUrl}
						loading={profileLoading || roundLoading}
						note={celNote}
						alt={activeReveal
							? `Frame from ${activeReveal.reveal.titleRomaji}, episode ${activeReveal.reveal.episodeNumber}`
							: mode === 'daily'
								? `Today's frame at ${dailyZoomScale.toFixed(1)}× zoom`
								: 'Anime episode screencap to guess'}
						allowInspect={mode !== 'daily' || dailyFinished}
						onInspect={() => openInspect(activeImageUrl)}
					/>

					{#if mode === 'daily'}
						<DailyZoomLadder activeStepIndex={dailyActiveStepIndex} finished={dailyFinished} />
					{/if}
				</div>

				<div class="right-rail" class:daily-rail={mode === 'daily'}>
					{#if mode === 'daily'}
						{#if currentRound?.dailyMeta}
							<div class="daily-board-slot">
								<DailyBoard
									puzzleNumber={currentRound.dailyMeta.puzzleNumber}
									puzzleDate={currentRound.dailyMeta.date}
									scopeLabel={currentRound.dailyMeta.scopeLabel}
									attempts={dailyAttempts}
									finished={dailyFinished}
									won={dailyWon}
									reveal={dailyReveal}
									lockedAnimeTitle={dailyMatchedAttempt?.guessedTitle ?? ''}
									lockedYear={dailyMatchedAttempt?.guessedYear ?? null}
									liveEpisode={dailyLiveEpisode}
									hintText={dailyEpisodeBounds.hint}
									onSwitchClassic={() => switchMode('classic')}
									onSwitchUnlimited={() => switchMode('unlimited')}
								/>
							</div>
						{/if}

						{#if !dailyFinished}
							<div class="daily-input-slot">
								<GuessConsole
									entries={dropdownEntries}
									{submitting}
									disabled={profileLoading || roundLoading || !currentRound}
									submitLabel="Lock in guess"
									skipLabel="Give up"
									confirmSkip={true}
									confirmSkipLabel="Confirm give up?"
									lockedAnimeTitle={dailyMatchedAttempt?.guessedTitle ?? ''}
									minEpisode={1}
									maxEpisode={null}
									initialEpisode={dailyEpisodeBounds.initialEp}
									inlineError={guessInlineError}
									roundKey={`daily-${roundCounter}-${dailyAttempts.length}`}
									onEpisodeChange={(ep) => (dailyLiveEpisode = ep)}
									onSubmit={(title, ep) => submitGuess(title, ep, false)}
									onSkip={() => submitGuess('', 1, true)}
								/>
							</div>
						{/if}
					{:else if activeReveal}
						<RoundReveal
							result={activeReveal}
							kicker={mode === 'classic'
								? `Round ${classicRoundIndex + 1} result`
								: `Frame #${unlimitedCount + 1} result`}
							nextLabel={mode === 'classic' && classicRoundIndex + 1 >= CLASSIC_ROUNDS
								? 'View final summary'
								: mode === 'unlimited' && unlimitedLives <= 0
									? 'View run summary'
									: 'Next frame'}
							afterSummary={mode === 'unlimited'
								? unlimitedLives <= 0
									? 'Out of lives'
									: activeReveal.skipped || activeReveal.animeMatch === 'wrong'
										? unlimitedLives === 1
											? '−1 life · Last life left'
											: `−1 life · ${unlimitedLives} lives left`
										: activeReveal.animeMatch === 'franchise'
											? 'Same franchise — life kept'
											: ''
								: ''}
							shortcutsEnabled={!setupOpen && !lightboxOpen}
							onNext={advanceAfterReveal}
						/>
					{:else}
						<GuessConsole
							entries={dropdownEntries}
							{submitting}
							disabled={profileLoading || roundLoading || !currentRound}
							submitLabel="Lock in guess"
							skipLabel="Skip frame"
							confirmSkip={mode === 'unlimited' && (unlimitedLives === 1 || unlimitedStreak >= 2)}
							confirmSkipLabel={unlimitedLives === 1 ? 'Skip & end run?' : 'Skip & lose a life?'}
							scoringNote={mode === 'unlimited'
								? '3 lives — missing or skipping an anime costs 1 life. Same franchise keeps your life.'
								: '500 points for the right anime, up to 500 more the closer your episode is.'}
							inlineError={guessInlineError}
							roundKey={`${mode}-${roundCounter}`}
							onSubmit={(title, ep) => submitGuess(title, ep, false)}
							onSkip={() => submitGuess('', 1, true)}
						/>
					{/if}
				</div>
			</div>
		{/if}
	</main>
</div>

<FrameLightbox
	open={lightboxOpen}
	imageUrl={lightboxImage}
	onClose={() => (lightboxOpen = false)}
/>

<PlayerSetupModal
	open={setupOpen}
	canDismiss={true}
	initialUsername={profile.isGlobalPool ? '' : profile.username}
	initialStatuses={profile.statuses}
	initialIncludeSingleEp={profile.includeSingleEp}
	isGlobalPool={profile.isGlobalPool}
	{recentUsers}
	loading={setupLoading}
	error={setupError}
	{activeRunWarning}
	onLoadUser={(u, st, inc) => loadProfile(u, st, inc, true, false)}
	onUseGlobal={() => loadProfile(null, ['COMPLETED'], false, true, false)}
	onClose={() => (setupOpen = false)}
/>

<style>
	.app-shell {
		min-height: 100svh;
		display: flex;
		flex-direction: column;
	}

	.nudge-wrap {
		padding-top: 6px;
	}

	.anilist-nudge {
		position: relative;
		background: var(--ink-deep);
		border: 1px solid var(--line);
		border-left: 3px solid var(--blue);
		border-radius: var(--r);
		padding: 6px 10px 6px 12px;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 10px;
		font-size: 13px;
		color: var(--text-2);
	}

	.anilist-nudge.warn {
		border-left-color: var(--yellow);
	}

	.anilist-nudge b {
		color: var(--paper);
	}

	.nudge-actions {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		flex: none;
	}

	.nudge-btn {
		background: var(--paper);
		color: var(--ink-deep);
		border: 0;
		border-radius: 6px;
		padding: 5px 12px;
		font-size: 13px;
		font-weight: 700;
		white-space: nowrap;
		transition: background-color 120ms ease;
	}

	.nudge-btn:hover {
		background: var(--paper-hover);
	}

	.nudge-dismiss {
		background: none;
		border: 0;
		color: var(--text-3);
		min-width: 30px;
		height: 30px;
		padding: 0 6px;
		display: inline-grid;
		place-items: center;
		border-radius: 6px;
		font-size: 15px;
		line-height: 1;
		transition: background-color 120ms ease, color 120ms ease;
	}

	.nudge-dismiss:hover {
		background: var(--ink-raised);
		color: var(--paper);
	}

	.stage {
		padding-bottom: 36px;
		display: flex;
		flex-direction: column;
		gap: 14px;
	}

	.left-stage {
		min-width: 0;
	}

	.right-rail {
		display: flex;
		flex-direction: column;
		gap: 18px;
		min-width: 0;
	}

	.error-banner {
		background: var(--danger-soft);
		border: 1px solid rgba(240, 138, 150, 0.45);
		color: #ffd5da;
		border-radius: var(--r);
		padding: 11px 14px;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		font-size: 14px;
	}

	.retry-btn {
		background: var(--ink-deep);
		border: 1px solid var(--line-strong);
		color: var(--paper);
		border-radius: 6px;
		padding: 6px 12px;
		font-size: 13.5px;
		font-weight: 600;
		white-space: nowrap;
	}

	.retry-btn:hover {
		background: var(--ink-raised);
	}

	@media (max-width: 960px) {
		.right-rail.daily-rail .daily-input-slot {
			order: 1;
		}

		.right-rail.daily-rail .daily-board-slot {
			order: 2;
		}
	}

	@media (max-width: 640px) {
		.anilist-nudge {
			flex-direction: column;
			align-items: flex-start;
			padding: 8px 40px 8px 12px;
		}

		.anilist-nudge:not(.warn) .nudge-dismiss {
			position: absolute;
			top: 4px;
			right: 4px;
			width: 36px;
			height: 36px;
		}
	}
</style>
