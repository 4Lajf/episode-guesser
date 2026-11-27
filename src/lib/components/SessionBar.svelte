<script lang="ts">
	import { CLASSIC_ROUNDS, WORDLE_MAX_ATTEMPTS } from '$lib/scoring';
	import type { CompletedClassicRound, GameMode } from '$lib/types';

	interface Props {
		mode: GameMode;
		classicRoundIndex: number;
		classicHistory: CompletedClassicRound[];
		classicScore: number;
		unlimitedCount: number;
		unlimitedScore: number;
		streak: number;
		bestStreak: number;
		dailyPuzzleNumber?: number;
		dailyScopeLabel?: string;
		dailyAttemptsCount: number;
		dailyAnimeHitAttempt?: number | null;
		dailyGaveUp?: boolean;
		dailyWon: boolean;
		dailyFinished: boolean;
		canSwitchDailyScope?: boolean;
		isGlobalDaily?: boolean;
		onToggleDailyScope?: () => void;
	}

	let {
		mode,
		classicRoundIndex,
		classicHistory,
		classicScore,
		unlimitedCount,
		unlimitedScore,
		streak,
		bestStreak,
		dailyPuzzleNumber,
		dailyScopeLabel,
		dailyAttemptsCount,
		dailyAnimeHitAttempt = null,
		dailyGaveUp = false,
		dailyWon,
		dailyFinished,
		canSwitchDailyScope = false,
		isGlobalDaily = false,
		onToggleDailyScope
	}: Props = $props();
</script>

<section class="session" aria-label="Current game">
	<div class="shell cols session-cols">
		{#if mode === 'classic'}
			<div class="rounds">
				<span class="rounds-label">
					Round <b class="tnum">{Math.min(classicRoundIndex + 1, CLASSIC_ROUNDS)}</b> of {CLASSIC_ROUNDS}
				</span>

				<ol class="pips" aria-label="Round scores">
					{#each Array.from({ length: CLASSIC_ROUNDS }) as _, idx (idx)}
						{@const done = classicHistory[idx]}
						{#if done}
							{@const pts = done.result.totalPoints}
							<li class="done" class:good={pts >= 800} class:zero={pts === 0}>
								<span class="sr-only">Round {idx + 1} scored {pts.toLocaleString('en-US')} points</span>
								<span class="v tnum" aria-hidden="true">{pts === 0 ? '✗' : pts.toLocaleString('en-US')}</span>
							</li>
						{:else if idx === classicRoundIndex}
							<li class="now" aria-current="step">
								<span class="sr-only">Round {idx + 1}, in play</span>
								<span class="v tnum" aria-hidden="true">{idx + 1}</span>
							</li>
						{:else}
							<li>
								<span class="sr-only">Round {idx + 1}, upcoming</span>
								<span class="v tnum" aria-hidden="true">{idx + 1}</span>
							</li>
						{/if}
					{/each}
				</ol>
			</div>

			<dl class="tally">
				<div>
					<dt>Score</dt>
					<dd class="tnum">{classicScore.toLocaleString('en-US')}</dd>
				</div>
				<div>
					<dt>Streak</dt>
					<dd class="tnum">{streak}</dd>
				</div>
			</dl>
		{:else if mode === 'unlimited'}
			<div class="rounds">
				<span class="rounds-label">
					Frame <b class="tnum">#{unlimitedCount + 1}</b>
				</span>
				<span class="sub-note">Endless run</span>
			</div>

			<dl class="tally">
				<div>
					<dt>Score</dt>
					<dd class="tnum">{unlimitedScore.toLocaleString('en-US')}</dd>
				</div>
				<div>
					<dt>Streak</dt>
					<dd class="tnum">{streak}</dd>
				</div>
				<div>
					<dt>Best streak</dt>
					<dd class="tnum">{bestStreak}</dd>
				</div>
			</dl>
		{:else}
			<div class="rounds daily-bar-left">
				<span class="rounds-label">
					Daily frame <b class="tnum">#{dailyPuzzleNumber ?? '—'}</b>
				</span>
				{#if dailyScopeLabel}
					<span class="sub-note">{dailyScopeLabel}</span>
				{/if}
				{#if canSwitchDailyScope && onToggleDailyScope}
					<button type="button" class="scope-link" onclick={onToggleDailyScope}>
						Switch to {isGlobalDaily ? 'your AniList daily' : 'Global Daily'}
					</button>
				{/if}
			</div>

			<div class="daily-status">
				{#if dailyFinished}
					<span class="status-text" class:won={dailyWon}>
						{#if dailyWon}
							Solved in <b class="tnum">{dailyAttemptsCount}</b> of {WORDLE_MAX_ATTEMPTS}
						{:else if dailyGaveUp}
							Gave up
						{:else if dailyAnimeHitAttempt}
							Anime in <b class="tnum">{dailyAnimeHitAttempt}</b>, episode missed
						{:else}
							Missed ({WORDLE_MAX_ATTEMPTS}/{WORDLE_MAX_ATTEMPTS})
						{/if}
					</span>
				{:else}
					<span class="status-text">
						Attempt <b class="tnum">{Math.min(dailyAttemptsCount + 1, WORDLE_MAX_ATTEMPTS)}</b> of {WORDLE_MAX_ATTEMPTS}
					</span>
				{/if}
			</div>
		{/if}
	</div>
</section>

<style>
	.session-cols {
		min-height: 54px;
		padding-block: 10px;
		align-items: center;
		row-gap: 10px;
	}

	.rounds {
		display: flex;
		align-items: center;
		gap: 14px;
		flex-wrap: wrap;
	}

	.rounds-label {
		color: var(--text-2);
		font-size: 15px;
	}

	.rounds-label b {
		color: var(--paper);
		font-weight: 700;
	}

	.sub-note {
		font-size: 14px;
		color: var(--text-3);
	}

	.scope-link {
		border: 0;
		background: none;
		padding: 2px 6px;
		border-radius: var(--r-sm);
		color: var(--blue);
		font-size: 13.5px;
		font-weight: 600;
		transition: background-color 120ms ease;
	}

	.scope-link:hover {
		background: var(--ink-raised);
		text-decoration: underline;
	}

	.pips {
		display: flex;
		gap: 5px;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.pips li {
		width: 64px;
		height: 26px;
		border-radius: var(--r-sm);
		display: grid;
		place-items: center;
		font-size: 13px;
		font-weight: 600;
		color: var(--text-3);
		box-shadow: inset 0 0 0 1px var(--line);
	}

	.pips .done {
		background: var(--ink-raised);
		color: var(--text-2);
		box-shadow: none;
	}

	.pips .done.good {
		color: var(--green);
	}

	.pips .done.zero {
		color: var(--text-3);
	}

	.pips .now {
		color: var(--paper);
		box-shadow: inset 0 0 0 1.5px var(--paper);
	}

	.tally {
		display: flex;
		gap: 28px;
		margin: 0;
	}

	.tally div {
		display: flex;
		align-items: baseline;
		gap: 8px;
	}

	.tally dt {
		color: var(--text-2);
		font-size: 14.5px;
	}

	.tally dd {
		margin: 0;
		font-size: 21px;
		font-weight: 750;
		color: var(--paper);
	}

	.daily-status {
		display: flex;
		align-items: baseline;
	}

	.status-text {
		font-size: 15px;
		color: var(--text-2);
	}

	.status-text b {
		color: var(--paper);
		font-weight: 700;
	}

	.status-text.won {
		color: var(--green);
	}

	.status-text.won b {
		color: var(--green);
	}

	@media (max-width: 960px) {
		.session-cols {
			grid-template-columns: minmax(0, 1fr) auto;
			align-items: end;
			column-gap: 12px;
			padding-block: 10px 8px;
		}

		.rounds:not(.daily-bar-left) {
			flex-direction: column;
			align-items: flex-start;
			gap: 7px;
		}

		.pips li {
			width: 22px;
			height: 6px;
			border-radius: 3px;
		}

		.pips .v {
			display: none;
		}

		.pips .done.good {
			background: var(--green);
		}

		.pips .now {
			background: var(--paper);
			box-shadow: none;
		}

		.tally {
			gap: 18px;
		}

		.tally dd {
			font-size: 19px;
		}

		.scope-link {
			margin-left: -6px;
		}
	}
</style>
