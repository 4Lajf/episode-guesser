<script lang="ts">
	import { buildClassicShareText, getClassicRank, getNextClassicRankHint } from '$lib/scoring';
	import type { CompletedClassicRound } from '$lib/types';

	interface Props {
		username: string;
		rounds: CompletedClassicRound[];
		dailyFinished?: boolean;
		onPlayAgain: () => void;
		onSwitchDaily: () => void;
		onSwitchUnlimited?: () => void;
	}

	let {
		username,
		rounds,
		dailyFinished = false,
		onPlayAgain,
		onSwitchDaily,
		onSwitchUnlimited
	}: Props = $props();

	let copied = $state(false);

	const totalScore = $derived(rounds.reduce((sum, r) => sum + r.result.totalPoints, 0));
	const maxScore = $derived(rounds.length * 1000);
	const rank = $derived(getClassicRank(totalScore, maxScore));
	const nextRankHint = $derived(getNextClassicRankHint(totalScore, maxScore));
	const animeHits = $derived(rounds.filter((r) => r.result.animeMatch === 'exact').length);

	async function copySummary() {
		const text = buildClassicShareText({ username, rounds });
		let ok = false;
		if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
			try {
				await navigator.clipboard.writeText(text);
				ok = true;
			} catch {
				// fallback below
			}
		}
		if (!ok && typeof document !== 'undefined') {
			try {
				const ta = document.createElement('textarea');
				ta.value = text;
				ta.setAttribute('readonly', '');
				ta.style.position = 'fixed';
				ta.style.opacity = '0';
				document.body.appendChild(ta);
				ta.select();
				ok = document.execCommand('copy');
				document.body.removeChild(ta);
			} catch {
				ok = false;
			}
		}
		if (ok) {
			copied = true;
			setTimeout(() => (copied = false), 2200);
		}
	}
</script>

<section class="summary" aria-label="Classic run summary">
	<div class="summary-hero">
		<div>
			<div class="rank-row">
				<span class="rank-pill">{rank}</span>
				{#if nextRankHint}
					<span class="rank-next">{nextRankHint}</span>
				{/if}
			</div>
			<h2 class="summary-score tnum">
				<span class="big">{totalScore.toLocaleString('en-US')}</span>
				<span class="max">/ {maxScore.toLocaleString('en-US')} pts</span>
			</h2>
			<p class="summary-sub">
				Matched {animeHits} of {rounds.length} shows from {username}.
			</p>
		</div>

		<div class="summary-actions">
			<button type="button" class="primary" onclick={onPlayAgain}>Play 5 new frames</button>
			<button type="button" class="outline" onclick={copySummary}>
				{copied ? 'Copied results' : 'Copy results'}
			</button>
			<button type="button" class="quiet" onclick={onSwitchDaily}>
				{dailyFinished ? 'View Daily result' : 'Try Daily frame'}
			</button>
			{#if onSwitchUnlimited}
				<button type="button" class="quiet" onclick={onSwitchUnlimited}>Play Unlimited</button>
			{/if}
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
						Episode {entry.result.reveal.episodeNumber}{#if entry.result.reveal.episodeTitle}, “{entry.result.reveal.episodeTitle}”{/if}
					</div>
					<div class="round-guess">
						{#if entry.result.skipped}
							Skipped
						{:else}
							You said {entry.result.guessedTitle}{#if entry.result.guessedEpisode !== null}, EP {entry.result.guessedEpisode}{/if}
						{/if}
					</div>
				</div>

				<div
					class="round-pts tnum"
					class:hit={entry.result.totalPoints >= 800}
					class:mid={entry.result.totalPoints >= 450 && entry.result.totalPoints < 800}
				>
					+{entry.result.totalPoints.toLocaleString('en-US')}
				</div>
			</div>
		{/each}
	</div>
</section>

<style>
	.summary {
		display: flex;
		flex-direction: column;
		gap: 24px;
		padding-top: 8px;
	}

	.summary-hero {
		display: flex;
		align-items: flex-end;
		justify-content: space-between;
		gap: 24px;
		flex-wrap: wrap;
	}

	.rank-row {
		display: flex;
		align-items: center;
		gap: 10px;
		flex-wrap: wrap;
		margin-bottom: 10px;
	}

	.rank-pill {
		display: inline-block;
		background: var(--blue-soft);
		color: var(--blue);
		font-size: 13.5px;
		font-weight: 700;
		padding: 4px 10px;
		border-radius: var(--r-sm);
	}

	.rank-next {
		font-size: 13px;
		color: var(--text-3);
	}

	.summary-score {
		margin: 0;
		display: flex;
		align-items: baseline;
		gap: 10px;
	}

	.summary-score .big {
		font-size: 72px;
		line-height: 0.9;
		font-weight: 800;
		font-stretch: 80%;
		letter-spacing: -0.02em;
		color: var(--paper);
	}

	.summary-score .max {
		font-size: 20px;
		font-weight: 500;
		color: var(--text-2);
	}

	.summary-sub {
		margin: 8px 0 0;
		font-size: 15px;
		color: var(--text-2);
	}

	.summary-actions {
		display: flex;
		align-items: center;
		gap: 10px;
		flex-wrap: wrap;
	}

	.primary {
		height: 48px;
		padding: 0 22px;
		background: var(--paper);
		color: var(--ink-deep);
		border: 0;
		border-radius: var(--r);
		font-size: 16px;
		font-weight: 750;
		transition: background-color 120ms ease;
	}

	.primary:hover {
		background: var(--paper-hover);
	}

	.outline {
		height: 48px;
		padding: 0 18px;
		background: none;
		border: 1.5px solid var(--line-strong);
		border-radius: var(--r);
		color: var(--paper);
		font-size: 15px;
		font-weight: 650;
		transition: border-color 120ms ease, background-color 120ms ease;
	}

	.outline:hover {
		border-color: var(--paper);
		background: var(--ink-raised);
	}

	.quiet {
		height: 48px;
		padding: 0 16px;
		background: none;
		border: 0;
		border-radius: var(--r);
		color: var(--text-2);
		font-size: 15px;
		font-weight: 600;
		transition: background-color 120ms ease, color 120ms ease;
	}

	.quiet:hover {
		color: var(--paper);
		background: var(--ink-raised);
	}

	.round-list {
		display: flex;
		flex-direction: column;
		border-top: 1px solid var(--line);
	}

	.round-item {
		display: grid;
		grid-template-columns: 144px minmax(0, 1fr) auto;
		gap: 16px;
		align-items: center;
		padding: 14px 0;
		border-bottom: 1px solid var(--line-soft);
	}

	.thumb-wrap {
		width: 144px;
		aspect-ratio: 16 / 9;
		border-radius: var(--r-sm);
		overflow: hidden;
		background: var(--stage-black);
	}

	.thumb-wrap img {
		width: 100%;
		height: 100%;
		object-fit: contain;
	}

	.round-info {
		min-width: 0;
	}

	.round-show {
		font-weight: 700;
		font-size: 16px;
		color: var(--paper);
	}

	.round-ep {
		font-size: 14px;
		color: var(--text-2);
	}

	.round-guess {
		font-size: 13px;
		color: var(--text-3);
		margin-top: 2px;
	}

	.round-pts {
		font-size: 24px;
		font-weight: 750;
		color: var(--text-3);
		white-space: nowrap;
	}

	.round-pts.hit {
		color: var(--green);
	}

	.round-pts.mid {
		color: var(--yellow);
	}

	@media (max-width: 640px) {
		.summary-score .big {
			font-size: 56px;
		}

		.round-item {
			grid-template-columns: 96px minmax(0, 1fr) auto;
			gap: 12px;
		}

		.thumb-wrap {
			width: 96px;
		}

		.summary-actions {
			width: 100%;
			flex-direction: column;
			align-items: stretch;
		}
	}
</style>
