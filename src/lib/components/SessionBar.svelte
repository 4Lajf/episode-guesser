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
		dailyWon: boolean;
		dailyFinished: boolean;
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
		dailyWon,
		dailyFinished
	}: Props = $props();

	function pipState(i: number): 'hit' | 'mid' | 'miss' | 'current' | 'empty' {
		const done = classicHistory[i];
		if (done) {
			if (done.result.totalPoints >= 800) return 'hit';
			if (done.result.totalPoints >= 450) return 'mid';
			return 'miss';
		}
		if (i === classicRoundIndex) return 'current';
		return 'empty';
	}
</script>

<div class="session-bar">
	{#if mode === 'classic'}
		<div class="session-left">
			<div class="pips" aria-label="Round progress">
				{#each Array.from({ length: CLASSIC_ROUNDS }) as _, idx (idx)}
					<span class="pip {pipState(idx)}"></span>
				{/each}
			</div>
			<span class="session-title">
				Round <strong class="font-display num-inline">{Math.min(classicRoundIndex + 1, CLASSIC_ROUNDS)}</strong> of {CLASSIC_ROUNDS}
			</span>
		</div>

		<div class="session-metrics">
			<div class="metric">
				<span class="metric-label">Score</span>
				<span class="metric-val font-display accent">{classicScore.toLocaleString('en-US')}</span>
			</div>
			<div class="metric">
				<span class="metric-label">Streak</span>
				<span class="metric-val font-display">{streak}</span>
			</div>
		</div>
	{:else if mode === 'unlimited'}
		<div class="session-left">
			<span class="session-title">
				Frame <strong class="font-display num-inline">#{unlimitedCount + 1}</strong>
			</span>
			<span class="session-muted">Endless run</span>
		</div>

		<div class="session-metrics">
			<div class="metric">
				<span class="metric-label">Score</span>
				<span class="metric-val font-display accent">{unlimitedScore.toLocaleString('en-US')}</span>
			</div>
			<div class="metric">
				<span class="metric-label">Streak</span>
				<span class="metric-val font-display">{streak}</span>
			</div>
			<div class="metric">
				<span class="metric-label">Best</span>
				<span class="metric-val font-display">{bestStreak}</span>
			</div>
		</div>
	{:else}
		<div class="session-left">
			<span class="session-title">
				Daily <strong class="font-display num-inline">#{dailyPuzzleNumber ?? '—'}</strong>
			</span>
			{#if dailyScopeLabel}
				<span class="session-muted">{dailyScopeLabel}</span>
			{/if}
		</div>

		<div class="session-metrics">
			<div class="metric">
				<span class="metric-label">Status</span>
				<span class="metric-val font-display" class:accent={!dailyFinished} class:hit={dailyWon}>
					{#if dailyFinished}
						{dailyWon ? `Solved in ${dailyAttemptsCount}/${WORDLE_MAX_ATTEMPTS}` : `Missed (${WORDLE_MAX_ATTEMPTS}/${WORDLE_MAX_ATTEMPTS})`}
					{:else}
						Attempt {Math.min(dailyAttemptsCount + 1, WORDLE_MAX_ATTEMPTS)} of {WORDLE_MAX_ATTEMPTS}
					{/if}
				</span>
			</div>
		</div>
	{/if}
</div>

<style>
	.session-bar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 14px;
		flex-wrap: wrap;
	}

	.session-left {
		display: flex;
		align-items: center;
		gap: 12px;
		flex-wrap: wrap;
	}

	.pips {
		display: flex;
		align-items: center;
		gap: 6px;
	}

	.pip {
		width: 24px;
		height: 5px;
		border-radius: 999px;
		background: var(--ink-2);
		border: 1px solid var(--rule);
		transition: background 180ms ease;
	}

	.pip.hit {
		background: var(--hit);
		border-color: var(--hit);
	}

	.pip.mid {
		background: var(--lamp);
		border-color: var(--lamp);
	}

	.pip.miss {
		background: var(--danger);
		border-color: var(--danger);
	}

	.pip.current {
		background: var(--text);
		border-color: var(--text);
	}

	.session-title {
		font-size: 14px;
		color: var(--text-2);
	}

	.num-inline {
		font-size: 16px;
		color: var(--text);
	}

	.session-muted {
		font-size: 13px;
		color: var(--text-3);
	}

	.session-metrics {
		display: flex;
		align-items: center;
		gap: 20px;
	}

	.metric {
		display: inline-flex;
		align-items: baseline;
		gap: 7px;
	}

	.metric-label {
		font-size: 13px;
		color: var(--text-3);
	}

	.metric-val {
		font-size: 19px;
		font-weight: 700;
		color: var(--text);
	}

	.metric-val.accent {
		color: var(--lamp);
	}

	.metric-val.hit {
		color: var(--hit);
	}

	@media (max-width: 540px) {
		.session-metrics {
			gap: 14px;
		}
		.metric-val {
			font-size: 17px;
		}
	}
</style>
