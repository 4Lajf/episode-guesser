<script lang="ts">
	import { buildClassicShareText, getClassicRank } from '$lib/scoring';
	import type { CompletedClassicRound } from '$lib/types';

	interface Props {
		username: string;
		rounds: CompletedClassicRound[];
		onPlayAgain: () => void;
		onSwitchDaily: () => void;
	}

	let { username, rounds, onPlayAgain, onSwitchDaily }: Props = $props();

	let copied = $state(false);

	const totalScore = $derived(rounds.reduce((sum, r) => sum + r.result.totalPoints, 0));
	const maxScore = $derived(rounds.length * 1000);
	const rank = $derived(getClassicRank(totalScore, maxScore));
	const animeHits = $derived(rounds.filter((r) => r.result.animeMatch === 'exact').length);

	async function copySummary() {
		const text = buildClassicShareText({ username, rounds });
		try {
			await navigator.clipboard.writeText(text);
			copied = true;
			setTimeout(() => (copied = false), 2000);
		} catch {
			// ignore
		}
	}
</script>

<section class="summary-card" aria-label="Classic run summary">
	<div class="summary-hero">
		<div>
			<span class="rank-pill font-display">{rank}</span>
			<h2 class="summary-score font-display">
				{totalScore.toLocaleString('en-US')}
				<span class="summary-max">/ {maxScore.toLocaleString('en-US')} pts</span>
			</h2>
			<p class="summary-sub">
				Matched {animeHits} of {rounds.length} shows from {username}.
			</p>
		</div>

		<div class="summary-actions">
			<button type="button" class="btn-primary" onclick={onPlayAgain}>Play 5 new frames</button>
			<button type="button" class="btn-secondary" onclick={copySummary}>
				{copied ? 'Copied results' : 'Copy results'}
			</button>
			<button type="button" class="btn-ghost" onclick={onSwitchDaily}>Try Daily Wordle</button>
		</div>
	</div>

	<div class="round-list">
		{#each rounds as entry (entry.roundIndex)}
			<div class="round-item">
				<div class="thumb-wrap">
					<img
						src={entry.result.reveal.imageUrl}
						alt="{entry.result.reveal.titleRomaji} episode {entry.result.reveal.episodeNumber}"
					/>
				</div>

				<div class="round-info">
					<div class="round-show">{entry.result.reveal.titleRomaji}</div>
					<div class="round-ep">
						Episode {entry.result.reveal.episodeNumber}{#if entry.result.reveal.episodeTitle} — {entry.result.reveal.episodeTitle}{/if}
					</div>
					<div class="round-guess">
						{#if entry.result.skipped}
							Skipped
						{:else}
							You guessed {entry.result.guessedTitle}{#if entry.result.guessedEpisode !== null}, EP {entry.result.guessedEpisode}{/if}
						{/if}
					</div>
				</div>

				<div class="round-pts font-display" class:hit={entry.result.totalPoints >= 800} class:mid={entry.result.totalPoints >= 450 && entry.result.totalPoints < 800}>
					+{entry.result.totalPoints}
				</div>
			</div>
		{/each}
	</div>
</section>

<style>
	.summary-card {
		background: var(--ink-1);
		border: 1px solid var(--rule);
		border-radius: var(--radius-lg);
		padding: 24px;
		display: flex;
		flex-direction: column;
		gap: 20px;
	}

	.summary-hero {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 20px;
		flex-wrap: wrap;
	}

	.rank-pill {
		display: inline-block;
		background: var(--lamp-soft);
		color: var(--lamp);
		border: 1px solid rgba(244, 199, 82, 0.35);
		font-size: 14px;
		font-weight: 700;
		padding: 3px 10px;
		border-radius: 6px;
		margin-bottom: 8px;
	}

	.summary-score {
		margin: 0;
		font-size: 46px;
		line-height: 1;
		color: var(--text);
	}

	.summary-max {
		font-size: 20px;
		color: var(--text-3);
	}

	.summary-sub {
		margin: 6px 0 0;
		font-size: 14px;
		color: var(--text-2);
	}

	.summary-actions {
		display: flex;
		align-items: center;
		gap: 10px;
		flex-wrap: wrap;
	}

	.btn-primary {
		height: 44px;
		padding: 0 20px;
		background: var(--lamp);
		color: var(--lamp-ink);
		border: 0;
		border-radius: var(--radius-md);
		font-size: 14.5px;
		font-weight: 700;
		cursor: pointer;
	}

	.btn-primary:hover {
		background: var(--lamp-hover);
	}

	.btn-secondary,
	.btn-ghost {
		height: 44px;
		padding: 0 16px;
		background: var(--ink-2);
		border: 1px solid var(--rule-strong);
		border-radius: var(--radius-md);
		color: var(--text);
		font-size: 14px;
		font-weight: 500;
		cursor: pointer;
	}

	.btn-ghost {
		background: transparent;
		color: var(--text-2);
	}

	.round-list {
		display: flex;
		flex-direction: column;
		border-top: 1px solid var(--rule);
	}

	.round-item {
		display: grid;
		grid-template-columns: 128px minmax(0, 1fr) auto;
		gap: 14px;
		align-items: center;
		padding: 12px 4px;
		border-bottom: 1px solid var(--rule);
	}

	.round-item:last-child {
		border-bottom: 0;
		padding-bottom: 0;
	}

	.thumb-wrap {
		width: 128px;
		aspect-ratio: 16 / 9;
		border-radius: 5px;
		overflow: hidden;
		background: var(--stage-black);
	}

	.thumb-wrap img {
		width: 100%;
		height: 100%;
		object-fit: contain;
		display: block;
	}

	.round-info {
		min-width: 0;
	}

	.round-show {
		font-weight: 700;
		font-size: 15px;
		color: var(--text);
	}

	.round-ep {
		font-size: 13px;
		color: var(--text-2);
	}

	.round-guess {
		font-size: 12.5px;
		color: var(--text-3);
		margin-top: 2px;
	}

	.round-pts {
		font-size: 22px;
		font-weight: 700;
		color: var(--text-2);
		white-space: nowrap;
	}

	.round-pts.hit {
		color: var(--hit);
	}

	.round-pts.mid {
		color: var(--lamp);
	}

	@media (max-width: 640px) {
		.summary-card {
			padding: 16px;
		}
		.round-item {
			grid-template-columns: 92px minmax(0, 1fr) auto;
			gap: 10px;
		}
		.thumb-wrap {
			width: 92px;
		}
		.summary-actions {
			width: 100%;
			flex-direction: column;
			align-items: stretch;
		}
	}
</style>
