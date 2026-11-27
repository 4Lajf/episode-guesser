<script lang="ts">
	import { onMount } from 'svelte';
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
	import {
		CLASSIC_ROUNDS,
		dropdownDedupeKey,
		normalizeTitle,
		WORDLE_ZOOM_STEPS
	} from '$lib/scoring';
	import type {
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
	const STORAGE_DAILY_SCOPE_KEY = 'eg:daily-global:v1';

	let anisongDbTitles = $state<string[]>([]);

	let profile = $state<PublicProfile>({
		username: 'Global Pool',
		avatar: null,
		totalEntries: 32,
		eligibleShows: 32,
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

	let mode = $state<GameMode>('classic');
	let currentRound = $state<RoundPayload | null>(null);
	let roundLoading = $state(false);
	let roundError = $state<string | null>(null);
	let guessInlineError = $state<string | null>(null);
	let submitting = $state(false);
	let lightboxOpen = $state(false);
	let lightboxImage = $state<string | null>(null);
	let roundCounter = $state(0);

	// Race protection across rapid mode / scope switches
	let roundRequestSeq = 0;
	let activeRoundAbort: AbortController | null = null;

	// Classic mode state
	let classicRoundIndex = $state(0);
	let classicHistory = $state<CompletedClassicRound[]>([]);
	let classicScore = $state(0);
	let classicFinished = $state(false);

	// Unlimited mode state
	let unlimitedCount = $state(0);
	let unlimitedScore = $state(0);
	let streak = $state(0);
	let bestStreak = $state(0);

	// Shared Classic/Unlimited reveal (renders inside right rail while frame stays pinned!)
	let activeReveal = $state<ClassicGuessResponse | null>(null);
	let seenMediaIds = $state<number[]>([]);

	// Daily Frame-Wordle state
	let dailyUseGlobal = $state(false);
	let dailyStateToken = $state<string | null>(null);
	let dailyAttempts = $state<WordleAttemptFeedback[]>([]);
	let dailyFinished = $state(false);
	let dailyWon = $state(false);
	let dailyReveal = $state<EpisodeReveal | null>(null);
	let dailyLiveEpisode = $state(1);

	const dropdownTitles = $derived.by(() => {
		const byKey = new Map<string, string>();
		for (const t of anisongDbTitles) {
			const k = dropdownDedupeKey(t);
			if (k && !byKey.has(k)) byKey.set(k, t);
		}
		for (const t of profile.titlesForDropdown) {
			const k = dropdownDedupeKey(t);
			if (k && !byKey.has(k)) byKey.set(k, t);
		}
		return Array.from(byKey.values()).sort((a, b) =>
			a.localeCompare(b, 'en', { sensitivity: 'base' })
		);
	});

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

	// Derive tightest known episode bounds from all directional hints (only on attempts with valid episodeDirection)
	const dailyEpisodeBounds = $derived.by(() => {
		let minEp = 1;
		let maxEp: number | null = null;
		for (const a of dailyAttempts) {
			if (a.guessedEpisode <= 0) continue;
			if (a.episodeDirection === 'up') {
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
		const suggested =
			maxEp !== null ? Math.round((minEp + maxEp) / 2) : Math.max(1, minEp);
		let hint = '';
		if (dailyMatchedAttempt) {
			if (minEp > 1 && maxEp !== null) {
				hint =
					minEp === maxEp
						? `It must be episode ${minEp}.`
						: `The episode is between ${minEp} and ${maxEp}.`;
			} else if (maxEp !== null) {
				hint = `The episode is earlier than ${maxEp + 1}.`;
			} else if (minEp > 1) {
				hint = `The episode is later than ${minEp - 1}.`;
			} else {
				hint = 'Narrow down the episode number.';
			}
		}
		return { minEp, maxEp, suggested, hint };
	});

	const activeImageUrl = $derived(activeReveal?.reveal.imageUrl ?? currentRound?.imageUrl ?? null);

	const celNote = $derived.by(() => {
		if (mode === 'daily') {
			if (dailyFinished) return 'Full 1.0× frame unlocked';
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
		if (nextMode === 'classic') url.searchParams.delete('mode');
		else url.searchParams.set('mode', nextMode);
		window.history.replaceState({}, '', url.toString());
	}

	function applyDailyStateFromPayload(payload: RoundPayload) {
		if (payload.dailyRestore) {
			dailyAttempts = payload.dailyRestore.attempts;
			dailyFinished = payload.dailyRestore.finished;
			dailyWon = payload.dailyRestore.won;
			dailyReveal = payload.dailyRestore.reveal ?? null;
			dailyStateToken = payload.dailyStateToken ?? null;
			return;
		}

		dailyAttempts = [];
		dailyFinished = false;
		dailyWon = false;
		dailyReveal = null;
		dailyStateToken = payload.dailyStateToken ?? null;
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
			const data = (await res.json()) as { titles?: string[] };
			if (Array.isArray(data.titles)) {
				anisongDbTitles = data.titles;
			}
		} catch {
			// fallback handled by profile titles
		}
	}

	async function loadProfile(
		username: string | null,
		statuses: ListStatus[] = ['COMPLETED', 'CURRENT'],
		includeSingleEp = false,
		closeAfter = true,
		openModalOnError = false
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
				setupError = data.error || 'Could not load that AniList profile.';
				if (openModalOnError) setupOpen = true;
				return false;
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
			} else {
				try {
					localStorage.removeItem(STORAGE_USER_KEY);
				} catch {
					// ignore
				}
			}

			if (closeAfter) setupOpen = false;
			resetAndStartMode(mode);
			return true;
		} catch {
			setupError = 'Network error while reaching AniList.';
			if (openModalOnError) setupOpen = true;
			return false;
		} finally {
			setupLoading = false;
			profileLoading = false;
		}
	}

	async function fetchRound(targetMode: GameMode) {
		const seq = ++roundRequestSeq;
		activeRoundAbort?.abort();
		const controller = new AbortController();
		activeRoundAbort = controller;

		roundLoading = true;
		roundError = null;
		guessInlineError = null;
		activeReveal = null;
		currentRound = null;

		try {
			const useGlobalPool =
				profile.isGlobalPool || (targetMode === 'daily' && dailyUseGlobal);

			const res = await fetch('/api/round', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					mode: targetMode,
					username: useGlobalPool ? undefined : profile.username,
					useGlobalPool,
					statuses: profile.statuses,
					includeSingleEp: profile.includeSingleEp,
					excludeMediaIds: targetMode === 'daily' ? [] : seenMediaIds
				}),
				signal: controller.signal
			});

			const data = await res.json();

			if (seq !== roundRequestSeq || targetMode !== mode) return;

			if (!res.ok) {
				roundError = data.error || 'Could not fetch an episode screencap.';
				currentRound = null;
				return;
			}

			const payload = data as RoundPayload;
			currentRound = payload;
			roundCounter++;

			if (targetMode === 'daily' && payload.dailyMeta) {
				applyDailyStateFromPayload(payload);
			}
		} catch (err) {
			if (err instanceof Error && err.name === 'AbortError') return;
			if (seq !== roundRequestSeq) return;
			roundError = 'Network error while loading the next frame.';
			currentRound = null;
		} finally {
			if (seq === roundRequestSeq) {
				roundLoading = false;
			}
		}
	}

	function resetAndStartMode(nextMode: GameMode) {
		mode = nextMode;
		syncModeUrl(nextMode);
		activeReveal = null;
		roundError = null;
		guessInlineError = null;
		submitting = false;

		if (nextMode === 'classic') {
			classicRoundIndex = 0;
			classicHistory = [];
			classicScore = 0;
			classicFinished = false;
			streak = 0;
			seenMediaIds = [];
		} else if (nextMode === 'unlimited') {
			unlimitedCount = 0;
			unlimitedScore = 0;
			streak = 0;
			seenMediaIds = [];
		} else {
			dailyAttempts = [];
			dailyFinished = false;
			dailyWon = false;
			dailyReveal = null;
			dailyStateToken = null;
		}

		fetchRound(nextMode);
	}

	function toggleDailyScope() {
		dailyUseGlobal = !dailyUseGlobal;
		try {
			localStorage.setItem(STORAGE_DAILY_SCOPE_KEY, dailyUseGlobal ? '1' : '0');
		} catch {
			// ignore
		}
		dailyAttempts = [];
		dailyFinished = false;
		dailyWon = false;
		dailyReveal = null;
		dailyStateToken = null;
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
					roundError = 'Daily session refreshed — loading today’s puzzle.';
					submitting = false;
					fetchRound('daily');
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
				dailyAttempts = [...dailyAttempts, wordleRes.attempt];
				dailyFinished = wordleRes.finished;
				dailyWon = wordleRes.won;
				dailyStateToken = wordleRes.dailyStateToken;
				if (wordleRes.nextImageUrl && currentRound) {
					currentRound = {
						...currentRound,
						imageUrl: wordleRes.nextImageUrl
					};
				}
				if (wordleRes.reveal) {
					dailyReveal = wordleRes.reveal;
				}
			} else {
				const classicRes = data as ClassicGuessResponse;
				activeReveal = classicRes;
				seenMediaIds = [...seenMediaIds, classicRes.reveal.anilistId];

				if (classicRes.animeMatch === 'exact') {
					streak++;
					if (reqMode === 'unlimited' && streak > bestStreak) {
						bestStreak = streak;
						try {
							localStorage.setItem(STORAGE_BEST_STREAK_KEY, String(bestStreak));
						} catch {
							// ignore
						}
					}
				} else {
					streak = 0;
				}

				if (reqMode === 'classic') {
					classicScore += classicRes.totalPoints;
					classicHistory = [
						...classicHistory,
						{ roundIndex: classicRoundIndex, result: classicRes }
					];
				} else {
					unlimitedScore += classicRes.totalPoints;
				}
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
				activeReveal = null;
				return;
			}
			classicRoundIndex++;
		} else if (mode === 'unlimited') {
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
	<AppHeader
		{mode}
		username={profile.username}
		avatar={profile.avatar}
		eligibleShows={profile.eligibleShows}
		isGlobalPool={profile.isGlobalPool}
		dailyUnplayed={!dailyFinished}
		onModeChange={(next) => {
			if (next !== mode) resetAndStartMode(next);
		}}
		onOpenSetup={() => {
			setupError = null;
			setupOpen = true;
		}}
	/>

	{#if profile.isGlobalPool && !profileLoading}
		<div class="shell nudge-wrap">
			<div class="anilist-nudge">
				<span>
					Playing curated Global Pool ({profile.eligibleShows} iconic anime). Connect your AniList to guess frames from your own watched shows.
				</span>
				<button type="button" class="nudge-btn" onclick={() => (setupOpen = true)}>
					Connect AniList
				</button>
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
		{streak}
		{bestStreak}
		dailyPuzzleNumber={currentRound?.dailyMeta?.puzzleNumber}
		dailyScopeLabel={currentRound?.dailyMeta?.scopeLabel}
		dailyAttemptsCount={dailyAttempts.length}
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
					onPlayAgain={() => resetAndStartMode('classic')}
					onSwitchDaily={() => resetAndStartMode('daily')}
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
								/>
							</div>
						{/if}

						{#if !dailyFinished}
							<div class="daily-input-slot">
								<GuessConsole
									titles={dropdownTitles}
									{submitting}
									disabled={profileLoading || roundLoading || !currentRound}
									submitLabel="Lock in guess"
									skipLabel="Give up"
									confirmSkip={true}
									lockedAnimeTitle={dailyMatchedAttempt?.guessedTitle ?? ''}
									minEpisode={dailyMatchedAttempt ? dailyEpisodeBounds.minEp : 1}
									maxEpisode={dailyMatchedAttempt ? dailyEpisodeBounds.maxEp : null}
									initialEpisode={dailyEpisodeBounds.suggested}
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
								: 'Next frame'}
							afterSummary={mode === 'classic'
								? `${classicScore.toLocaleString('en-US')} after ${classicRoundIndex + 1} of ${CLASSIC_ROUNDS}`
								: `${unlimitedScore.toLocaleString('en-US')} total`}
							shortcutsEnabled={!setupOpen && !lightboxOpen}
							onNext={advanceAfterReveal}
						/>
					{:else}
						<GuessConsole
							titles={dropdownTitles}
							{submitting}
							disabled={profileLoading || roundLoading || !currentRound}
							submitLabel="Lock in guess"
							skipLabel="Skip frame"
							scoringNote="500 points for the right anime, up to 500 more the closer your episode is."
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
	{recentUsers}
	loading={setupLoading}
	error={setupError}
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
		padding-top: 10px;
	}

	.anilist-nudge {
		background: var(--ink-deep);
		border: 1px solid var(--line);
		border-left: 3px solid var(--blue);
		border-radius: var(--r);
		padding: 9px 14px;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		font-size: 13.5px;
		color: var(--text-2);
	}

	.nudge-btn {
		background: var(--paper);
		color: var(--ink-deep);
		border: 0;
		border-radius: 6px;
		padding: 7px 14px;
		font-size: 13.5px;
		font-weight: 700;
		white-space: nowrap;
		flex: none;
		transition: background-color 120ms ease;
	}

	.nudge-btn:hover {
		background: var(--paper-hover);
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
		/* On narrow viewports, put Daily guess controls directly beneath the frame/zoom ladder so the image stays visible while typing */
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
		}
	}
</style>
