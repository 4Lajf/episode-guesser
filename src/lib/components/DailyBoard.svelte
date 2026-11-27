<script lang="ts">
	import {
		buildWordleShareText,
		WORDLE_MAX_ATTEMPTS,
		WORDLE_ZOOM_STEPS
	} from '$lib/scoring';
	import type { EpisodeReveal, TileStatus, WordleAttemptFeedback } from '$lib/types';

	interface Props {
		puzzleNumber: number;
		scopeLabel: string;
		attempts: WordleAttemptFeedback[];
		finished: boolean;
		won: boolean;
		reveal: EpisodeReveal | null;
		canSwitchScope: boolean;
		isGlobalDaily: boolean;
		onToggleScope: () => void;
	}

	let {
		puzzleNumber,
		scopeLabel,
		attempts,
		finished,
		won,
		reveal,
		canSwitchScope,
		isGlobalDaily,
		onToggleScope
	}: Props = $props();

	let copied = $state(false);
	let resetCountdown = $state('');

	function formatUtcCountdown(): string {
		const now = new Date();
		const nextMidnight = Date.UTC(
			now.getUTCFullYear(),
			now.getUTCMonth(),
			now.getUTCDate() + 1,
			0,
			0,
			0
		);
		const diffSec = Math.max(0, Math.floor((nextMidnight - now.getTime()) / 1000));
		const h = Math.floor(diffSec / 3600);
		const m = Math.floor((diffSec % 3600) / 60);
		return `${h}h ${String(m).padStart(2, '0')}m`;
	}

	$effect(() => {
		resetCountdown = formatUtcCountdown();
		const timer = setInterval(() => {
			resetCountdown = formatUtcCountdown();
		}, 30_000);
		return () => clearInterval(timer);
	});

	const activeStepIndex = $derived(
		finished
			? WORDLE_ZOOM_STEPS.length - 1
			: Math.min(attempts.length, WORDLE_ZOOM_STEPS.length - 1)
	);

	function arrowChar(dir: 'up' | 'down' | 'exact' | null): string {
		if (dir === 'up') return '↑';
		if (dir === 'down') return '↓';
		if (dir === 'exact') return '✓';
		return '';
	}

	function svgFill(status: TileStatus): string {
		if (status === 'hit') return '#5BCB95';
		if (status === 'close') return '#F4C752';
		return '#2A3545';
	}

	async function copyShare() {
		const text = buildWordleShareText({
			puzzleNumber,
			scopeLabel,
			attempts,
			won
		});
		try {
			await navigator.clipboard.writeText(text);
			copied = true;
			setTimeout(() => (copied = false), 2000);
		} catch {
			// fallback
		}
	}
</script>

<section class="daily-board" aria-label="Daily Frame-Wordle progress">
	<!-- 5-step camera zoom progress bar directly linked to the main Light Table -->
	<div class="zoom-strip">
		<div class="zoom-head">
			<span class="zoom-caption">
				{#if finished}
					Full 1.0× frame unlocked · Next daily in {resetCountdown}
				{:else}
					Each wrong guess pulls the camera back
				{/if}
			</span>

			{#if canSwitchScope}
				<button type="button" class="scope-switch" onclick={onToggleScope}>
					Switch to {isGlobalDaily ? 'your AniList daily' : 'Global Daily'}
				</button>
			{/if}
		</div>

		<div class="zoom-track" role="list" aria-label="Zoom progression steps">
			{#each WORDLE_ZOOM_STEPS as step, idx (step)}
				<div
					class="zoom-step"
					class:past={idx < activeStepIndex}
					class:active={idx === activeStepIndex}
					role="listitem"
				>
					<span class="zoom-bar"></span>
					<span class="zoom-val font-display">{step.toFixed(1)}×</span>
				</div>
			{/each}
		</div>
	</div>

	<!-- Anime | Year | Episode Feedback Grid -->
	<div class="grid-wrap">
		<div class="grid-header" aria-hidden="true">
			<span>Anime</span>
			<span class="center">Year</span>
			<span class="center">Episode</span>
		</div>

		<div class="rows">
			{#each Array.from({ length: WORDLE_MAX_ATTEMPTS }) as _, idx (idx)}
				{@const attempt = attempts[idx]}
				{#if attempt}
					<div class="w-row filled">
						<div class="cell anime-cell {attempt.animeStatus}">
							{#if attempt.animeStatus === 'hit'}
								<span class="cell-icon" aria-label="Correct anime">✓</span>
							{:else if attempt.animeStatus === 'close'}
								<span class="cell-icon" aria-label="Same franchise">≈</span>
							{/if}
							<span class="anime-text">{attempt.guessedTitle}</span>
						</div>

						<div class="cell num-cell {attempt.yearStatus}">
							<span class="font-display">
								{attempt.guessedYear ?? '—'}
							</span>
							{#if attempt.yearDirection}
								<span class="dir-mark" class:lamp={attempt.yearStatus !== 'hit'}>
									{arrowChar(attempt.yearDirection)}
								</span>
							{/if}
						</div>

						<div class="cell num-cell {attempt.episodeStatus}">
							<span class="font-display">
								{attempt.guessedEpisode > 0 ? attempt.guessedEpisode : '—'}
							</span>
							{#if attempt.episodeDirection}
								<span class="dir-mark" class:lamp={attempt.episodeStatus !== 'hit'}>
									{arrowChar(attempt.episodeDirection)}
								</span>
							{/if}
						</div>
					</div>
				{:else}
					<div class="w-row" class:current={!finished && idx === attempts.length}>
						<div class="cell empty-cell">
							{#if !finished && idx === attempts.length}
								<span class="placeholder-txt">Guess {idx + 1} goes here</span>
							{/if}
						</div>
						<div class="cell empty-cell"></div>
						<div class="cell empty-cell"></div>
					</div>
				{/if}
			{/each}
		</div>
	</div>

	<!-- Finished Banner + Reveal Summary + Custom SVG Share Card -->
	{#if finished && reveal}
		<div class="daily-result">
			<div class="daily-answer">
				<span class="result-badge font-display" class:won>
					{#if won}
						Solved in {attempts.length} of {WORDLE_MAX_ATTEMPTS}
					{:else if attempts.some((a) => a.guessedEpisode === 0 && a.guessedTitle === 'Gave up')}
						Gave up
					{:else}
						Out of attempts
					{/if}
				</span>
				<h3 class="answer-title">{reveal.titleRomaji}</h3>
				<p class="answer-ep">
					<strong class="font-display">Episode {reveal.episodeNumber}</strong>
					{#if reveal.episodeTitle} — {reveal.episodeTitle}{/if}
					{#if reveal.seasonYear} ({reveal.seasonYear}){/if}
				</p>
				<a
					class="answer-link"
					href={reveal.anilistUrl}
					target="_blank"
					rel="noopener noreferrer"
				>
					Open on AniList
				</a>
			</div>

			<div class="share-card">
				<svg
					class="share-svg"
					width="62"
					height="86"
					viewBox="0 0 62 86"
					aria-hidden="true"
				>
					{#each Array.from({ length: WORDLE_MAX_ATTEMPTS }) as _, r (r)}
						{@const a = attempts[r]}
						{@const y = 3 + r * 16}
						{#if a}
							<rect x="3" y={y} width="16" height="13" rx="3" fill={svgFill(a.animeStatus)} />
							<rect x="23" y={y} width="16" height="13" rx="3" fill={svgFill(a.yearStatus)} />
							<rect x="43" y={y} width="16" height="13" rx="3" fill={svgFill(a.episodeStatus)} />
						{:else}
							<rect x="3" y={y} width="16" height="13" rx="3" fill="#1A2430" stroke="#263241" />
							<rect x="23" y={y} width="16" height="13" rx="3" fill="#1A2430" stroke="#263241" />
							<rect x="43" y={y} width="16" height="13" rx="3" fill="#1A2430" stroke="#263241" />
						{/if}
					{/each}
				</svg>

				<div class="share-copy">
					<div class="share-title">Daily #{puzzleNumber} share card</div>
					<div class="share-sub">Shows colors and arrows only, never the answer.</div>
					<button type="button" class="btn-copy" onclick={copyShare}>
						{copied ? 'Copied to clipboard' : 'Copy share card'}
					</button>
				</div>
			</div>
		</div>
	{/if}
</section>

<style>
	.daily-board {
		background: var(--ink-1);
		border: 1px solid var(--rule);
		border-radius: var(--radius-lg);
		padding: 18px 20px;
		display: flex;
		flex-direction: column;
		gap: 18px;
	}

	.zoom-strip {
		display: flex;
		flex-direction: column;
		gap: 10px;
	}

	.zoom-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 10px;
		flex-wrap: wrap;
	}

	.zoom-caption {
		font-size: 13.5px;
		color: var(--text-2);
	}

	.scope-switch {
		background: var(--ink-2);
		border: 1px solid var(--rule);
		border-radius: 6px;
		color: var(--text-2);
		font-size: 12.5px;
		padding: 4px 10px;
		cursor: pointer;
	}

	.scope-switch:hover {
		color: var(--text);
		border-color: var(--rule-strong);
	}

	.zoom-track {
		display: grid;
		grid-template-columns: repeat(5, 1fr);
		gap: 8px;
	}

	.zoom-step {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 5px;
	}

	.zoom-bar {
		width: 100%;
		height: 4px;
		border-radius: 999px;
		background: var(--ink-3);
	}

	.zoom-step.past .zoom-bar {
		background: var(--rule-strong);
	}

	.zoom-step.active .zoom-bar {
		background: var(--lamp);
	}

	.zoom-val {
		font-size: 13px;
		color: var(--text-3);
	}

	.zoom-step.active .zoom-val {
		color: var(--lamp);
		font-weight: 700;
	}

	.grid-wrap {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.grid-header {
		display: grid;
		grid-template-columns: minmax(0, 1fr) 82px 86px;
		gap: 8px;
		padding: 0 4px;
		font-size: 12.5px;
		font-weight: 700;
		color: var(--text-3);
	}

	.center {
		text-align: center;
	}

	.rows {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.w-row {
		display: grid;
		grid-template-columns: minmax(0, 1fr) 82px 86px;
		gap: 8px;
		align-items: stretch;
	}

	.cell {
		min-height: 44px;
		border-radius: 8px;
		padding: 8px 12px;
		display: flex;
		align-items: center;
		font-size: 14px;
	}

	.empty-cell {
		background: transparent;
		border: 1px dashed var(--rule);
	}

	.w-row.current .empty-cell {
		border-style: solid;
		border-color: rgba(244, 199, 82, 0.55);
		background: rgba(244, 199, 82, 0.04);
	}

	.placeholder-txt {
		font-size: 13px;
		color: var(--text-3);
	}

	.anime-cell {
		gap: 8px;
		font-weight: 500;
		min-width: 0;
	}

	.anime-text {
		display: -webkit-box;
		line-clamp: 2;
		-webkit-line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
		line-height: 1.3;
	}

	.num-cell {
		justify-content: center;
		gap: 4px;
		font-size: 15.5px;
		font-weight: 700;
		padding: 8px 6px;
	}

	.cell.hit {
		background: var(--hit);
		color: var(--hit-ink);
		font-weight: 700;
	}

	.cell.close {
		background: var(--close-soft);
		color: var(--lamp);
		border: 1px solid rgba(244, 199, 82, 0.45);
	}

	.cell.miss {
		background: var(--miss);
		color: var(--miss-text);
	}

	.cell-icon {
		font-weight: 700;
		flex-shrink: 0;
	}

	.dir-mark {
		font-size: 14px;
		font-weight: 700;
	}

	.dir-mark.lamp {
		color: var(--lamp);
	}

	.daily-result {
		border-top: 1px solid var(--rule);
		padding-top: 16px;
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		gap: 18px;
		align-items: center;
	}

	.result-badge {
		display: inline-block;
		font-size: 13px;
		font-weight: 700;
		padding: 3px 9px;
		border-radius: 6px;
		background: var(--danger-soft);
		color: var(--danger);
		margin-bottom: 6px;
	}

	.result-badge.won {
		background: var(--hit-soft);
		color: var(--hit);
	}

	.answer-title {
		margin: 0;
		font-size: 19px;
		font-weight: 700;
	}

	.answer-ep {
		margin: 3px 0 8px;
		font-size: 14px;
		color: var(--text-2);
	}

	.answer-ep strong {
		color: var(--lamp);
		font-size: 15px;
	}

	.answer-link {
		font-size: 13px;
		color: var(--text-2);
		text-decoration: underline;
	}

	.share-card {
		display: flex;
		align-items: center;
		gap: 14px;
		background: var(--ink-2);
		border: 1px solid var(--rule);
		border-radius: var(--radius-md);
		padding: 12px 14px;
	}

	.share-svg {
		flex-shrink: 0;
	}

	.share-copy {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.share-title {
		font-size: 14px;
		font-weight: 700;
	}

	.share-sub {
		font-size: 12.5px;
		color: var(--text-3);
		max-width: 200px;
	}

	.btn-copy {
		margin-top: 4px;
		align-self: flex-start;
		background: var(--lamp);
		color: var(--lamp-ink);
		border: 0;
		border-radius: 7px;
		padding: 7px 12px;
		font-size: 13px;
		font-weight: 700;
		cursor: pointer;
	}

	.btn-copy:hover {
		background: var(--lamp-hover);
	}

	@media (max-width: 680px) {
		.daily-board {
			padding: 14px;
		}

		.grid-header,
		.w-row {
			grid-template-columns: minmax(0, 1fr) 68px 70px;
			gap: 6px;
		}

		.cell {
			padding: 7px 9px;
			font-size: 13px;
		}

		.daily-result {
			grid-template-columns: 1fr;
		}
	}
</style>
