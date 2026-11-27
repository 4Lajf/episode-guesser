<script lang="ts">
	import { onMount } from 'svelte';
	import AppHeader from '$lib/components/AppHeader.svelte';
	import ClassicSummary from '$lib/components/ClassicSummary.svelte';
	import DailyBoard from '$lib/components/DailyBoard.svelte';
	import FrameLightbox from '$lib/components/FrameLightbox.svelte';
	import GuessConsole from '$lib/components/GuessConsole.svelte';
	import LightTable from '$lib/components/LightTable.svelte';
	import PlayerSetupModal from '$lib/components/PlayerSetupModal.svelte';
	import RoundReveal from '$lib/components/RoundReveal.svelte';
	import SessionBar from '$lib/components/SessionBar.svelte';
	import { CLASSIC_ROUNDS, normalizeTitle, WORDLE_ZOOM_STEPS } from '$lib/scoring';
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

	interface SavedDailyState {
		date: string;
		scopeKey: string;
		roundToken: string;
		dailyStateToken: string;
		imageUrl: string;
		attempts: WordleAttemptFeedback[];
		finished: boolean;
		won: boolean;
		reveal: EpisodeReveal | null;
	}

	const STORAGE_USER_KEY = 'eg:anilist-config:v1';
	const STORAGE_RECENT_KEY = 'eg:recent-users:v1';
	const STORAGE_BEST_STREAK_KEY = 'eg:best-streak:v1';

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
	let setupOpen = $state(false);
	let setupLoading = $state(false);
	let setupError = $state<string | null>(null);
	let recentUsers = $state<string[]>([]);
	let hasInitialized = $state(false);

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

	// Shared Classic/Unlimited reveal
	let activeReveal = $state<ClassicGuessResponse | null>(null);
	let seenMediaIds = $state<number[]>([]);

	// Daily Frame-Wordle state
	let dailyUseGlobal = $state(false);
	let dailyStateToken = $state<string | null>(null);
	let dailyAttempts = $state<WordleAttemptFeedback[]>([]);
	let dailyFinished = $state(false);
	let dailyWon = $state(false);
	let dailyReveal = $state<EpisodeReveal | null>(null);

	// Merged, normalized-deduplicated dropdown titles (cached AnisongDB + profile titles)
	const dropdownTitles = $derived.by(() => {
		const byNorm = new Map<string, string>();
		for (const t of anisongDbTitles) {
			const k = normalizeTitle(t);
			if (k && !byNorm.has(k)) byNorm.set(k, t);
		}
		for (const t of profile.titlesForDropdown) {
			const k = normalizeTitle(t);
			if (k && !byNorm.has(k)) byNorm.set(k, t);
		}
		return Array.from(byNorm.values()).sort((a, b) =>
			a.localeCompare(b, 'en', { sensitivity: 'base' })
		);
	});

	const dailyZoomScale = $derived.by(() => {
		if (mode !== 'daily') return 1;
		if (dailyFinished) return 1;
		const idx = Math.min(dailyAttempts.length, WORDLE_ZOOM_STEPS.length - 1);
		return WORDLE_ZOOM_STEPS[idx];
	});

	const dailyMatchedAnimeTitle = $derived.by(() => {
		if (mode !== 'daily' || dailyFinished) return '';
		const hit = dailyAttempts.find((a) => a.animeStatus === 'hit');
		return hit ? hit.guessedTitle : '';
	});

	const activeDailyScopeKey = $derived.by(() => {
		if (profile.isGlobalPool || dailyUseGlobal) return 'global';
		const statusKey = profile.statuses.slice().sort().join(',');
		return `user:${profile.username.toLowerCase()}:${statusKey}:${profile.includeSingleEp ? '1' : '0'}`;
	});

	function dailyStorageKey(date: string, scopeKey: string): string {
		return `eg:daily:v2:${date}:${scopeKey}`;
	}

	function saveDailyProgress() {
		if (typeof localStorage === 'undefined' || !currentRound?.dailyMeta || !dailyStateToken) return;
		const state: SavedDailyState = {
			date: currentRound.dailyMeta.date,
			scopeKey: activeDailyScopeKey,
			roundToken: currentRound.roundToken,
			dailyStateToken,
			imageUrl: currentRound.imageUrl,
			attempts: dailyAttempts,
			finished: dailyFinished,
			won: dailyWon,
			reveal: dailyReveal
		};
		try {
			localStorage.setItem(dailyStorageKey(state.date, state.scopeKey), JSON.stringify(state));
		} catch {
			// ignore storage quota
		}
	}

	function restoreDailyProgress(date: string, scopeKey: string, freshRound: RoundPayload) {
		dailyAttempts = [];
		dailyFinished = false;
		dailyWon = false;
		dailyReveal = null;
		dailyStateToken = freshRound.dailyStateToken ?? null;

		if (typeof localStorage === 'undefined') return;
		try {
			const raw = localStorage.getItem(dailyStorageKey(date, scopeKey));
			if (!raw) return;
			const parsed = JSON.parse(raw) as SavedDailyState;
			if (
				parsed.date === date &&
				parsed.scopeKey === scopeKey &&
				Array.isArray(parsed.attempts) &&
				parsed.roundToken &&
				parsed.dailyStateToken &&
				parsed.imageUrl
			) {
				dailyAttempts = parsed.attempts;
				dailyFinished = Boolean(parsed.finished);
				dailyWon = Boolean(parsed.won);
				dailyReveal = parsed.reveal ?? null;
				dailyStateToken = parsed.dailyStateToken;
				currentRound = {
					...freshRound,
					roundToken: parsed.roundToken,
					imageUrl: parsed.imageUrl
				};
			}
		} catch {
			// ignore corrupt state
		}
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
			dailyUseGlobal = profile.isGlobalPool;

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

			// Drop stale response if user switched modes or triggered another fetch
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
				restoreDailyProgress(payload.dailyMeta.date, activeDailyScopeKey, payload);
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

	async function submitGuess(guessedTitle: string, guessedEpisode: number, skipped = false) {
		if (!currentRound || submitting) return;

		const reqMode = mode;
		const reqToken = currentRound.roundToken;
		const reqSeq = roundRequestSeq;
		guessInlineError = null;
		roundError = null;

		// Client-side duplicate guard in Daily Wordle so players don't waste attempts
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

			// Ignore response if user switched mode or started a different round while awaiting
			if (reqSeq !== roundRequestSeq || reqMode !== mode || currentRound?.roundToken !== reqToken) {
				return;
			}

			if (!res.ok) {
				if (reqMode === 'daily') {
					guessInlineError = data.error || 'Could not check your guess.';
				} else {
					roundError = data.error || 'Could not check your guess.';
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
				saveDailyProgress();
			} else {
				const classicRes = data as ClassicGuessResponse;
				activeReveal = classicRes;
				seenMediaIds = [...seenMediaIds, classicRes.reveal.anilistId];

				if (classicRes.animeMatch === 'exact') {
					streak++;
					if (streak > bestStreak) {
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
					unlimitedCount++;
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
			hasInitialized = true;
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
					hasInitialized = true;
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

		hasInitialized = true;
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
		onModeChange={(next) => {
			if (next !== mode) resetAndStartMode(next);
		}}
		onOpenSetup={() => {
			setupError = null;
			setupOpen = true;
		}}
	/>

	<main class="main-stage" class:wide-daily={mode === 'daily'}>
		{#if profile.isGlobalPool && hasInitialized}
			<div class="anilist-nudge">
				<span>Playing curated Global Pool (32 iconic anime). Enter your AniList to guess frames from your own watched shows.</span>
				<button type="button" class="nudge-btn" onclick={() => (setupOpen = true)}>
					Connect AniList
				</button>
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
			{dailyWon}
			{dailyFinished}
		/>

		{#if roundError}
			<div class="error-banner" role="alert">
				<span>{roundError}</span>
				<button type="button" class="retry-btn" onclick={() => fetchRound(mode)}>Try another frame</button>
			</div>
		{/if}

		<!-- Classic Summary Screen -->
		{#if mode === 'classic' && classicFinished}
			<ClassicSummary
				username={profile.username}
				rounds={classicHistory}
				onPlayAgain={() => resetAndStartMode('classic')}
				onSwitchDaily={() => resetAndStartMode('daily')}
			/>
		{:else if (mode === 'classic' || mode === 'unlimited') && activeReveal}
			<!-- Round Reveal Screen -->
			<RoundReveal
				result={activeReveal}
				shortcutsEnabled={!setupOpen && !lightboxOpen}
				nextLabel={mode === 'classic' && classicRoundIndex + 1 >= CLASSIC_ROUNDS
					? 'View final summary'
					: 'Next frame'}
				onNext={advanceAfterReveal}
				onInspect={() => openInspect(activeReveal?.reveal.imageUrl ?? null)}
			/>
		{:else if mode === 'daily'}
			<!-- Daily Frame-Wordle: 2-column desktop layout so frame, console & board fit above the fold -->
			<div class="daily-workspace">
				<div class="daily-left">
					<LightTable
						imageUrl={currentRound?.imageUrl ?? null}
						loading={roundLoading}
						compact={true}
						caption={dailyFinished
							? `Daily #${currentRound?.dailyMeta?.puzzleNumber ?? ''} — full frame unlocked`
							: `Daily #${currentRound?.dailyMeta?.puzzleNumber ?? ''} — narrow it down in 5 tries`}
						cropScale={dailyZoomScale}
						allowInspect={dailyFinished}
						onInspect={() => openInspect(currentRound?.imageUrl ?? null)}
					/>

					{#if !dailyFinished}
						<GuessConsole
							titles={dropdownTitles}
							{submitting}
							compact={true}
							disabled={roundLoading || !currentRound}
							submitLabel="Submit attempt"
							skipLabel="Give up"
							episodeHint="↑↓ direction hints"
							prefillTitle={dailyMatchedAnimeTitle}
							inlineError={guessInlineError}
							roundKey={`daily-${roundCounter}-${dailyAttempts.length}`}
							onSubmit={(title, ep) => submitGuess(title, ep, false)}
							onSkip={() => submitGuess('', 1, true)}
						/>
					{/if}
				</div>

				{#if currentRound?.dailyMeta}
					<DailyBoard
						puzzleNumber={currentRound.dailyMeta.puzzleNumber}
						scopeLabel={currentRound.dailyMeta.scopeLabel}
						attempts={dailyAttempts}
						finished={dailyFinished}
						won={dailyWon}
						reveal={dailyReveal}
						canSwitchScope={!profile.isGlobalPool}
						isGlobalDaily={dailyUseGlobal}
						onToggleScope={() => {
							dailyUseGlobal = !dailyUseGlobal;
							dailyAttempts = [];
							dailyFinished = false;
							dailyWon = false;
							dailyReveal = null;
							dailyStateToken = null;
							fetchRound('daily');
						}}
					/>
				{/if}
			</div>
		{:else}
			<!-- Classic / Unlimited Active Play Stage -->
			<LightTable
				imageUrl={currentRound?.imageUrl ?? null}
				loading={roundLoading}
				caption="Name the anime and episode number"
				cropScale={1}
				allowInspect={true}
				onInspect={() => openInspect(currentRound?.imageUrl ?? null)}
			/>

			<GuessConsole
				titles={dropdownTitles}
				{submitting}
				disabled={roundLoading || !currentRound}
				submitLabel="Lock in guess"
				skipLabel="Skip frame"
				episodeHint="Near misses still score"
				inlineError={guessInlineError}
				roundKey={`${mode}-${roundCounter}`}
				onSubmit={(title, ep) => submitGuess(title, ep, false)}
				onSkip={() => submitGuess('', 1, true)}
			/>
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

	.main-stage {
		width: 100%;
		max-width: 1120px;
		margin: 0 auto;
		padding: 20px 24px 56px;
		display: flex;
		flex-direction: column;
		gap: 16px;
	}

	.main-stage.wide-daily {
		max-width: 1320px;
	}

	.daily-workspace {
		display: grid;
		grid-template-columns: minmax(0, 1.25fr) minmax(380px, 0.95fr);
		gap: 18px;
		align-items: start;
	}

	.daily-left {
		display: flex;
		flex-direction: column;
		gap: 14px;
		min-width: 0;
	}

	.anilist-nudge {
		background: var(--ink-1);
		border: 1px solid var(--rule);
		border-left: 3px solid var(--lamp);
		border-radius: var(--radius-md);
		padding: 10px 14px;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		font-size: 13.5px;
		color: var(--text-2);
	}

	.nudge-btn {
		background: var(--lamp);
		color: var(--lamp-ink);
		border: 0;
		border-radius: 7px;
		padding: 7px 13px;
		font-size: 13px;
		font-weight: 700;
		cursor: pointer;
		white-space: nowrap;
		flex-shrink: 0;
	}

	.nudge-btn:hover {
		background: var(--lamp-hover);
	}

	.error-banner {
		background: var(--danger-soft);
		border: 1px solid rgba(228, 108, 124, 0.45);
		color: #f8c2c9;
		border-radius: var(--radius-md);
		padding: 11px 14px;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		font-size: 13.5px;
	}

	.retry-btn {
		background: var(--ink-2);
		border: 1px solid var(--rule-strong);
		color: var(--text);
		border-radius: 6px;
		padding: 6px 12px;
		font-size: 13px;
		font-weight: 500;
		cursor: pointer;
		white-space: nowrap;
	}

	@media (max-width: 1120px) {
		.daily-workspace {
			grid-template-columns: 1fr;
		}
	}

	@media (max-width: 760px) {
		.main-stage {
			padding: 14px 14px 40px;
			gap: 12px;
		}

		.anilist-nudge {
			flex-direction: column;
			align-items: stretch;
			font-size: 13px;
		}

		.nudge-btn {
			text-align: center;
		}
	}
</style>
