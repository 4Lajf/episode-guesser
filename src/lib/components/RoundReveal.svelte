<script lang="ts">
	import type { ClassicGuessResponse } from '$lib/types';

	interface Props {
		result: ClassicGuessResponse;
		nextLabel: string;
		shortcutsEnabled?: boolean;
		onNext: () => void;
		onInspect: () => void;
	}

	let { result, nextLabel, shortcutsEnabled = true, onNext, onInspect }: Props = $props();

	const totalEps = $derived(Math.max(1, result.reveal.totalEpisodes));
	const actualPct = $derived(
		totalEps <= 1 ? 50 : ((result.reveal.episodeNumber - 1) / (totalEps - 1)) * 100
	);
	const guessedEp = $derived(
		result.animeMatch === 'exact' && result.guessedEpisode !== null
			? Math.min(Math.max(1, result.guessedEpisode), totalEps)
			: null
	);
	const guessPct = $derived(
		guessedEp === null ? null : totalEps <= 1 ? 50 : ((guessedEp - 1) / (totalEps - 1)) * 100
	);
	const deltaLeft = $derived(guessPct === null ? 0 : Math.min(actualPct, guessPct));
	const deltaWidth = $derived(guessPct === null ? 0 : Math.abs(actualPct - guessPct));

	const animeStatusText = $derived(
		result.skipped
			? 'Skipped'
			: result.animeMatch === 'exact'
				? 'Right show'
				: result.animeMatch === 'franchise'
					? 'Same franchise'
					: 'Missed show'
	);

	function handleWindowKey(e: KeyboardEvent) {
		if (!shortcutsEnabled || e.repeat || e.key !== 'Enter') return;
		const active = document.activeElement;
		if (active) {
			const tag = active.tagName;
			if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'BUTTON' || tag === 'A') {
				return;
			}
			if (active.closest('[role="dialog"]')) return;
		}
		e.preventDefault();
		onNext();
	}
</script>

<svelte:window onkeydown={handleWindowKey} />

<section class="reveal-card" aria-label="Round result">
	<div class="reveal-grid">
		<!-- Strictly 16:9 reveal image (never cropped) -->
		<div class="reveal-media">
			<button type="button" class="reveal-img-btn" onclick={onInspect} title="Inspect full size">
				<div class="reveal-aspect">
					<img src={result.reveal.imageUrl} alt="{result.reveal.titleRomaji} episode {result.reveal.episodeNumber}" />
				</div>
			</button>

			<div class="show-meta">
				<h2 class="show-title">{result.reveal.titleRomaji}</h2>
				{#if result.reveal.titleEnglish && result.reveal.titleEnglish.toLowerCase() !== result.reveal.titleRomaji.toLowerCase()}
					<p class="show-english">{result.reveal.titleEnglish}</p>
				{/if}
				<p class="ep-line">
					<strong class="font-display ep-badge">Episode {result.reveal.episodeNumber}</strong>
					{#if result.reveal.episodeTitle}
						<span class="ep-name">{result.reveal.episodeTitle}</span>
					{/if}
				</p>
				{#if !result.skipped}
					<p class="your-guess">
						You said <strong>{result.guessedTitle}</strong>{#if result.guessedEpisode !== null}, episode {result.guessedEpisode}{/if}
					</p>
				{:else}
					<p class="your-guess">You skipped this frame</p>
				{/if}
			</div>
		</div>

		<!-- Score Breakdown & Closeness Ruler -->
		<div class="reveal-scoring">
			<div class="big-score-row">
				<div class="big-score">
					<span
						class="score-num font-display"
						class:hit={result.totalPoints >= 800}
						class:mid={result.totalPoints >= 450 && result.totalPoints < 800}
					>
						{result.totalPoints.toLocaleString('en-US')}
					</span>
					<span class="score-denom font-display">/ 1,000 pts</span>
				</div>
			</div>

			<!-- Two clean horizontal score bars -->
			<div class="bars">
				<div class="bar-item">
					<div class="bar-top">
						<span>Anime <span class="bar-sub">{animeStatusText}</span></span>
						<span class="bar-pts font-display" class:hit={result.animePoints === 500} class:mid={result.animePoints > 0 && result.animePoints < 500}>
							+{result.animePoints}
						</span>
					</div>
					<div class="bar-track">
						<div
							class="bar-fill"
							class:hit={result.animePoints === 500}
							class:mid={result.animePoints > 0 && result.animePoints < 500}
							style:width="{(result.animePoints / 500) * 100}%"
						></div>
					</div>
				</div>

				<div class="bar-item">
					<div class="bar-top">
						<span>Episode <span class="bar-sub">{result.episodeLabel}</span></span>
						<span class="bar-pts font-display" class:hit={result.episodePoints === 500} class:mid={result.episodePoints > 0 && result.episodePoints < 500}>
							+{result.episodePoints}
						</span>
					</div>
					<div class="bar-track">
						<div
							class="bar-fill"
							class:hit={result.episodePoints === 500}
							class:mid={result.episodePoints > 0 && result.episodePoints < 500}
							style:width="{(result.episodePoints / 500) * 100}%"
						></div>
					</div>
				</div>
			</div>

			<!-- Episode Closeness Ruler (only shown after reveal, with clamped labels!) -->
			{#if totalEps > 1}
				<div class="ruler-box">
					<div class="ruler-head">
						<span>Episode timeline ({totalEps} episodes)</span>
						{#if result.animeMatch === 'exact' && result.guessedEpisode !== null}
							<span class="font-display ruler-summary">
								You guessed EP {result.guessedEpisode}
							</span>
						{/if}
					</div>

					<div class="ruler-track">
						{#if guessPct !== null && deltaWidth > 0}
							<div
								class="ruler-delta"
								style:left="{deltaLeft}%"
								style:width="{deltaWidth}%"
							></div>
						{/if}

						<span
							class="ruler-tag actual font-display"
							style:left="clamp(30px, {actualPct}%, calc(100% - 30px))"
						>
							EP {result.reveal.episodeNumber}
						</span>
						<span class="ruler-pin actual" style:left="{actualPct}%"></span>

						{#if guessPct !== null && result.guessedEpisode !== null && result.guessedEpisode !== result.reveal.episodeNumber}
							<span class="ruler-pin guess" style:left="{guessPct}%"></span>
							<span
								class="ruler-tag guess font-display"
								style:left="clamp(30px, {guessPct}%, calc(100% - 30px))"
							>
								You {result.guessedEpisode}
							</span>
						{/if}
					</div>

					<div class="ruler-axis font-display">
						<span>EP 1</span>
						{#if totalEps >= 6}
							<span>EP {Math.round(totalEps / 2)}</span>
						{/if}
						<span>EP {totalEps}</span>
					</div>
				</div>
			{/if}

			{#if result.reveal.overview}
				<p class="synopsis">{result.reveal.overview}</p>
			{/if}

			<div class="reveal-footer">
				<a
					class="anilist-link"
					href={result.reveal.anilistUrl}
					target="_blank"
					rel="noopener noreferrer"
				>
					Open on AniList
					<svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
						<path
							d="M6 3h7v7M13 3L6 10M3 6v7h7"
							stroke="currentColor"
							stroke-width="1.6"
							stroke-linecap="round"
							stroke-linejoin="round"
						/>
					</svg>
				</a>

				<button type="button" class="btn-next" onclick={onNext}>
					<span>{nextLabel}</span>
					<kbd class="kbd-hint">Enter</kbd>
				</button>
			</div>
		</div>
	</div>
</section>

<style>
	.reveal-card {
		background: var(--ink-1);
		border: 1px solid var(--rule);
		border-radius: var(--radius-lg);
		padding: 20px;
	}

	.reveal-grid {
		display: grid;
		grid-template-columns: minmax(0, 1.05fr) minmax(0, 0.95fr);
		gap: 24px;
		align-items: start;
	}

	.reveal-media {
		display: flex;
		flex-direction: column;
		gap: 14px;
	}

	.reveal-img-btn {
		padding: 0;
		border: 0;
		background: transparent;
		cursor: zoom-in;
		display: block;
		width: 100%;
	}

	.reveal-aspect {
		width: 100%;
		aspect-ratio: 16 / 9;
		background: var(--stage-black);
		border-radius: 8px;
		overflow: hidden;
		border: 1px solid var(--rule);
	}

	.reveal-aspect img {
		width: 100%;
		height: 100%;
		object-fit: contain;
		display: block;
	}

	.show-meta {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.show-title {
		margin: 0;
		font-size: 20px;
		font-weight: 700;
		line-height: 1.25;
		color: var(--text);
	}

	.show-english {
		margin: 0;
		font-size: 13.5px;
		color: var(--text-3);
	}

	.ep-line {
		margin: 4px 0 0;
		display: flex;
		align-items: baseline;
		gap: 8px;
		flex-wrap: wrap;
	}

	.ep-badge {
		font-size: 16px;
		color: var(--lamp);
	}

	.ep-name {
		font-size: 14.5px;
		color: var(--text-2);
	}

	.your-guess {
		margin: 6px 0 0;
		font-size: 13.5px;
		color: var(--text-3);
	}

	.your-guess strong {
		color: var(--text-2);
	}

	.reveal-scoring {
		display: flex;
		flex-direction: column;
		gap: 16px;
	}

	.big-score-row {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 12px;
	}

	.big-score {
		display: flex;
		align-items: baseline;
		gap: 6px;
	}

	.score-num {
		font-size: 46px;
		font-weight: 700;
		line-height: 0.95;
		color: var(--text);
	}

	.score-num.hit {
		color: var(--hit);
	}

	.score-num.mid {
		color: var(--lamp);
	}

	.score-denom {
		font-size: 18px;
		color: var(--text-3);
	}

	.bars {
		display: flex;
		flex-direction: column;
		gap: 11px;
	}

	.bar-item {
		display: flex;
		flex-direction: column;
		gap: 5px;
	}

	.bar-top {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 8px;
		font-size: 13.5px;
		color: var(--text);
	}

	.bar-sub {
		color: var(--text-3);
		margin-left: 6px;
		font-size: 13px;
	}

	.bar-pts {
		font-size: 16px;
		font-weight: 700;
		color: var(--text-2);
		white-space: nowrap;
	}

	.bar-pts.hit {
		color: var(--hit);
	}

	.bar-pts.mid {
		color: var(--lamp);
	}

	.bar-track {
		height: 6px;
		border-radius: 999px;
		background: var(--ink-2);
		overflow: hidden;
	}

	.bar-fill {
		height: 100%;
		border-radius: 999px;
		background: var(--rule-strong);
		transition: width 320ms cubic-bezier(0.22, 1, 0.36, 1);
	}

	.bar-fill.hit {
		background: var(--hit);
	}

	.bar-fill.mid {
		background: var(--lamp);
	}

	/* Episode Accuracy Ruler — dissolved card nesting, clean structural hairline */
	.ruler-box {
		border-top: 1px solid var(--rule);
		padding-top: 14px;
	}

	.ruler-head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 8px;
		flex-wrap: wrap;
		font-size: 12.5px;
		color: var(--text-3);
	}

	.ruler-summary {
		font-size: 14px;
		color: var(--text);
	}

	.ruler-track {
		position: relative;
		height: 7px;
		border-radius: 999px;
		background: var(--ink-0);
		margin: 24px 0 28px;
	}

	.ruler-delta {
		position: absolute;
		top: 0;
		height: 7px;
		background: rgba(244, 199, 82, 0.45);
		border-radius: 999px;
	}

	.ruler-pin {
		position: absolute;
		top: 50%;
		transform: translate(-50%, -50%);
		width: 14px;
		height: 14px;
		border-radius: 50%;
		border: 2px solid var(--ink-2);
	}

	.ruler-pin.actual {
		background: var(--hit);
	}

	.ruler-pin.guess {
		background: var(--lamp);
	}

	.ruler-tag {
		position: absolute;
		transform: translateX(-50%);
		font-size: 12.5px;
		font-weight: 700;
		white-space: nowrap;
	}

	.ruler-tag.actual {
		top: -22px;
		color: var(--hit);
	}

	.ruler-tag.guess {
		top: 13px;
		color: var(--lamp);
	}

	.ruler-axis {
		display: flex;
		justify-content: space-between;
		font-size: 12px;
		color: var(--text-3);
	}

	.synopsis {
		margin: 0;
		padding-left: 12px;
		border-left: 2px solid var(--rule-strong);
		font-size: 13.5px;
		color: var(--text-2);
		display: -webkit-box;
		line-clamp: 3;
		-webkit-line-clamp: 3;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}

	.reveal-footer {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		margin-top: 2px;
	}

	.anilist-link {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font-size: 13.5px;
		font-weight: 500;
		color: var(--text-2);
		text-decoration: none;
	}

	.anilist-link:hover {
		color: var(--text);
		text-decoration: underline;
	}

	.btn-next {
		height: 44px;
		padding: 0 20px;
		background: var(--lamp);
		color: var(--lamp-ink);
		border: 0;
		border-radius: var(--radius-md);
		font-size: 14.5px;
		font-weight: 700;
		cursor: pointer;
		display: inline-flex;
		align-items: center;
		gap: 8px;
		white-space: nowrap;
	}

	.btn-next:hover {
		background: var(--lamp-hover);
	}

	.kbd-hint {
		font-family: inherit;
		font-size: 11px;
		font-weight: 700;
		padding: 2px 6px;
		border-radius: 4px;
		background: rgba(22, 17, 5, 0.16);
		color: var(--lamp-ink);
	}

	@media (max-width: 820px) {
		.reveal-card {
			padding: 16px;
		}

		.reveal-grid {
			grid-template-columns: 1fr;
			gap: 18px;
		}

		.reveal-footer {
			flex-direction: column-reverse;
			align-items: stretch;
		}

		.btn-next {
			justify-content: center;
		}

		.kbd-hint {
			display: none;
		}

		.anilist-link {
			justify-content: center;
			padding: 6px 0;
		}
	}
</style>
