<script lang="ts">
	import type { ClassicGuessResponse } from '$lib/types';

	interface Props {
		result: ClassicGuessResponse;
		kicker: string;
		nextLabel: string;
		afterSummary?: string;
		shortcutsEnabled?: boolean;
		onNext: () => void;
	}

	let {
		result,
		kicker,
		nextLabel,
		afterSummary = '',
		shortcutsEnabled = true,
		onNext
	}: Props = $props();

	const totalEps = $derived(Math.max(1, result.reveal.totalEpisodes));
	const actualEp = $derived(Math.min(Math.max(1, result.reveal.episodeNumber), totalEps));
	const showTimeline = $derived(
		totalEps > 1 && result.animeMatch === 'exact' && !result.skipped && result.guessedEpisode !== null
	);
	const useDiscreteTicks = $derived(totalEps <= 36);

	const guessedEpClamped = $derived(
		result.guessedEpisode !== null ? Math.min(Math.max(1, result.guessedEpisode), totalEps) : null
	);

	// 0..100 percentage positions for discrete tick centers or continuous track
	function posPct(ep: number): number {
		if (totalEps <= 1) return 50;
		if (useDiscreteTicks) {
			return ((ep - 0.5) / totalEps) * 100;
		}
		return ((ep - 1) / (totalEps - 1)) * 100;
	}

	const actualPct = $derived(posPct(actualEp));
	const guessPct = $derived(guessedEpClamped !== null ? posPct(guessedEpClamped) : null);
	const spanLeft = $derived(guessPct !== null ? Math.min(actualPct, guessPct) : 0);
	const spanWidth = $derived(guessPct !== null ? Math.abs(actualPct - guessPct) : 0);

	const showEnglish = $derived(
		Boolean(
			result.reveal.titleEnglish &&
				result.reveal.titleEnglish.trim().toLowerCase() !==
					result.reveal.titleRomaji.trim().toLowerCase()
		)
	);

	const animeWhy = $derived.by(() => {
		if (result.skipped) return 'Skipped';
		if (result.animeMatch === 'franchise') {
			return result.guessedTitle
				? `Right series, wrong season (${result.guessedTitle})`
				: 'Right series, wrong season';
		}
		return result.guessedTitle ? `You said ${result.guessedTitle}` : 'No guess';
	});

	const episodeWhy = $derived.by(() => {
		if (result.skipped) return 'Skipped';
		if (result.animeMatch === 'franchise') {
			return `Wrong season — episode not scored (EP ${result.reveal.episodeNumber})`;
		}
		if (result.animeMatch !== 'exact' || result.guessedEpisode === null) {
			return `It was episode ${result.reveal.episodeNumber}`;
		}
		if (result.guessedEpisode === result.reveal.episodeNumber) {
			return `Exact match (EP ${result.reveal.episodeNumber})`;
		}
		return `You said ${result.guessedEpisode}, it was ${result.reveal.episodeNumber}`;
	});

	const distanceHeadline = $derived.by(() => {
		if (result.episodeDistance === 0) {
			return `Exact, out of ${totalEps} episodes`;
		}
		if (result.episodeDistance !== null) {
			return `${result.episodeDistance} apart, out of ${totalEps} episodes`;
		}
		return `${totalEps} episodes`;
	});

	function handleWindowKey(e: KeyboardEvent) {
		if (!shortcutsEnabled || e.repeat || e.key !== 'Enter') return;
		const active = document.activeElement;
		if (active) {
			const tag = active.tagName;
			if (
				tag === 'INPUT' ||
				tag === 'TEXTAREA' ||
				tag === 'SELECT' ||
				tag === 'BUTTON' ||
				tag === 'A'
			) {
				return;
			}
			if (active.closest('[role="dialog"]')) return;
		}
		e.preventDefault();
		onNext();
	}
</script>

<svelte:window onkeydown={handleWindowKey} />

<div class="rail result" aria-label="Round result">
	<div class="result-top">
		<p class="kicker">{kicker}</p>
		<h3>{result.reveal.titleRomaji}</h3>
		{#if showEnglish}
			<p class="subtitle">{result.reveal.titleEnglish}</p>
		{/if}
		<p class="eptitle">
			Episode {result.reveal.episodeNumber}{#if result.reveal.episodeTitle}, “{result.reveal.episodeTitle.replace(/`/g, '’')}”{/if}
		</p>
	</div>

	<p class="score">
		<span
			class="big tnum"
			class:exact={result.totalPoints >= 800}
			class:close={result.totalPoints >= 450 && result.totalPoints < 800}
		>
			{result.totalPoints.toLocaleString('en-US')}
		</span>
		<span class="of">/ 1,000 pts</span>
	</p>

	<ul class="breakdown">
		<li>
			<span
				class="pts tnum"
				class:exact={result.animePoints === 500}
				class:close={result.animePoints > 0 && result.animePoints < 500}
			>
				+{result.animePoints}
			</span>
			<span class="what">Anime</span>
			<span class="why">{animeWhy}</span>
		</li>
		<li>
			<span
				class="pts tnum"
				class:exact={result.episodePoints === 500}
				class:close={result.episodePoints > 0 && result.episodePoints < 500}
			>
				+{result.episodePoints}
			</span>
			<span class="what">Episode</span>
			<span class="why">{episodeWhy}</span>
		</li>
	</ul>

	{#if showTimeline && guessedEpClamped !== null}
		<div class="tl-wrap">
			<div class="tl-headline">
				<span class="label">Episode accuracy</span>
				<span>{distanceHeadline}</span>
			</div>

			<div
				class="tl"
				role="img"
				aria-label="Timeline of {totalEps} episodes. The frame is from episode {actualEp}. You guessed episode {result.guessedEpisode}."
			>
				<div class="tl-lab tl-top" style="grid-row: 1">
					<span
						class:flip={actualPct > 68}
						style:left={actualPct > 68 ? undefined : `${actualPct}%`}
						style:right={actualPct > 68 ? `${100 - actualPct}%` : undefined}
					>
						Actual EP {actualEp}
					</span>
				</div>

				<span class="end tnum" style="grid-row: 2; grid-column: 1">1</span>

				{#if useDiscreteTicks}
					<ol
						class="ticks"
						style="grid-row: 2; grid-template-columns: repeat({totalEps}, minmax(0, 1fr))"
					>
						{#each Array.from({ length: totalEps }) as _, i (i)}
							{@const epNum = i + 1}
							{@const isActual = epNum === actualEp}
							{@const isYou = epNum === guessedEpClamped}
							{@const lo = Math.min(actualEp, guessedEpClamped)}
							{@const hi = Math.max(actualEp, guessedEpClamped)}
							<li
								class:actual={isActual}
								class:you={!isActual && isYou}
								class:between={!isActual && !isYou && epNum > lo && epNum < hi}
							></li>
						{/each}
					</ol>
				{:else}
					<div class="bar-track" style="grid-row: 2">
						{#if spanWidth > 0}
							<span class="bar-span" style:left="{spanLeft}%" style:width="{spanWidth}%"></span>
						{/if}
						<span class="bar-mark actual" style:left="{actualPct}%"></span>
						{#if guessPct !== null && guessedEpClamped !== actualEp}
							<span class="bar-mark you" style:left="{guessPct}%"></span>
						{/if}
					</div>
				{/if}

				<span class="end tnum" style="grid-row: 2; grid-column: 3">{totalEps}</span>

				{#if guessedEpClamped !== actualEp && guessPct !== null}
					<div class="tl-lab tl-bot" style="grid-row: 3">
						<span
							class:flip={guessPct > 68}
							style:left={guessPct > 68 ? undefined : `${guessPct}%`}
							style:right={guessPct > 68 ? `${100 - guessPct}%` : undefined}
						>
							You EP {result.guessedEpisode}
						</span>
					</div>
				{/if}
			</div>
		</div>
	{/if}

	{#if result.reveal.overview}
		<p class="synopsis">{result.reveal.overview}</p>
	{/if}

	<a
		class="ext"
		href={result.reveal.anilistUrl}
		target="_blank"
		rel="noopener noreferrer"
		aria-label="View {result.reveal.titleRomaji} on AniList"
	>
		<span>View on AniList</span>
		<svg class="icon" viewBox="0 0 20 20" aria-hidden="true">
			<path d="M8.5 5H5v10h10v-3.5M11.5 4H16v4.5M16 4l-7 7" />
		</svg>
	</a>

	<div class="actions">
		<button type="button" class="primary" onclick={onNext}>
			<span>{nextLabel}</span>
			<kbd class="kbd-hint">Enter</kbd>
		</button>
		{#if afterSummary}
			<span class="after">{afterSummary}</span>
		{/if}
	</div>
</div>

<style>
	.rail.result {
		display: flex;
		flex-direction: column;
		gap: 16px;
		min-width: 0;
	}

	.result-top {
		display: grid;
		gap: 4px;
	}

	.kicker {
		margin: 0;
		font-size: 13.5px;
		font-weight: 600;
		color: var(--text-2);
	}

	h3 {
		margin: 0;
		font-size: 28px;
		line-height: 1.12;
		font-weight: 750;
		letter-spacing: -0.015em;
		color: var(--paper);
		overflow-wrap: anywhere;
	}

	.subtitle {
		margin: 0;
		font-size: 14px;
		color: var(--text-3);
	}

	.eptitle {
		margin: 2px 0 0;
		font-size: 15.5px;
		color: var(--text-2);
	}

	.score {
		margin: 0;
		display: flex;
		align-items: baseline;
		gap: 10px;
	}

	.score .big {
		font-size: 76px;
		line-height: 0.9;
		font-weight: 800;
		font-stretch: 80%;
		letter-spacing: -0.02em;
		color: var(--paper);
	}

	.score .big.exact {
		color: var(--green);
	}

	.score .big.close {
		color: var(--yellow);
	}

	.score .of {
		font-size: 18px;
		font-weight: 500;
		color: var(--text-2);
	}

	.breakdown {
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.breakdown li {
		display: grid;
		grid-template-columns: 60px auto minmax(0, 1fr);
		column-gap: 8px;
		align-items: baseline;
		padding: 8px 0;
		border-top: 1px solid var(--line-soft);
	}

	.breakdown .pts {
		font-size: 17px;
		font-weight: 750;
		color: var(--text-3);
	}

	.breakdown .pts.exact {
		color: var(--green);
	}

	.breakdown .pts.close {
		color: var(--yellow);
	}

	.breakdown .what {
		font-weight: 650;
		color: var(--paper);
	}

	.breakdown .why {
		text-align: right;
		font-size: 14px;
		color: var(--text-2);
		overflow-wrap: anywhere;
	}

	/* Episode accuracy timeline */
	.tl-wrap {
		display: grid;
		gap: 6px;
	}

	.tl-headline {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		gap: 12px;
	}

	.tl-headline .label {
		font-size: 14px;
		font-weight: 600;
		color: var(--text-2);
	}

	.tl-headline span:last-child {
		font-size: 13.5px;
		color: var(--text-2);
	}

	.tl {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr) auto;
		column-gap: 8px;
		align-items: center;
	}

	.tl-lab {
		grid-column: 2;
		position: relative;
		height: 24px;
		font-size: 13px;
		font-weight: 650;
	}

	.tl-lab span {
		position: absolute;
		top: 0;
		bottom: 0;
		display: flex;
		padding-left: 7px;
		border-left: 2px solid currentColor;
		white-space: nowrap;
	}

	.tl-lab span.flip {
		padding-left: 0;
		padding-right: 7px;
		border-left: 0;
		border-right: 2px solid currentColor;
	}

	.tl-top span {
		color: var(--green);
		align-items: flex-start;
	}

	.tl-bot span {
		color: var(--paper);
		align-items: flex-end;
	}

	.ticks {
		grid-column: 2;
		display: grid;
		gap: 2px;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.ticks li {
		height: 14px;
		border-radius: 2px;
		background: var(--ink-raised);
	}

	.ticks .between {
		background: var(--line-strong);
	}

	.ticks .actual {
		background: var(--green);
	}

	.ticks .you {
		background: var(--paper);
	}

	.bar-track {
		grid-column: 2;
		position: relative;
		height: 14px;
		border-radius: 3px;
		background: var(--ink-raised);
		overflow: hidden;
	}

	.bar-span {
		position: absolute;
		top: 0;
		bottom: 0;
		background: var(--line-strong);
	}

	.bar-mark {
		position: absolute;
		top: 0;
		bottom: 0;
		width: 4px;
		transform: translateX(-50%);
		border-radius: 2px;
	}

	.bar-mark.actual {
		background: var(--green);
	}

	.bar-mark.you {
		background: var(--paper);
	}

	.tl .end {
		font-size: 12.5px;
		color: var(--text-3);
	}

	.synopsis {
		margin: 0;
		font-size: 14px;
		color: var(--text-2);
		display: -webkit-box;
		line-clamp: 3;
		-webkit-line-clamp: 3;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}

	.ext {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		color: var(--blue);
		font-size: 14.5px;
		font-weight: 600;
		text-decoration: none;
		align-self: flex-start;
	}

	.ext:hover {
		text-decoration: underline;
	}

	.ext .icon {
		width: 16px;
		height: 16px;
		flex: none;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.75;
		stroke-linecap: round;
		stroke-linejoin: round;
	}

	.actions {
		display: flex;
		align-items: center;
		gap: 12px;
		flex-wrap: wrap;
	}

	.primary {
		flex: 1;
		min-width: 180px;
		height: 52px;
		padding: 0 20px;
		border: 0;
		border-radius: var(--r);
		background: var(--paper);
		color: var(--ink-deep);
		font-size: 16.5px;
		font-weight: 750;
		white-space: nowrap;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 8px;
		transition: background-color 120ms ease;
	}

	.primary:hover {
		background: var(--paper-hover);
	}

	.kbd-hint {
		font-family: inherit;
		font-size: 11.5px;
		font-weight: 700;
		padding: 2px 6px;
		border-radius: 4px;
		background: rgba(20, 23, 48, 0.14);
		color: var(--ink-deep);
	}

	.after {
		color: var(--text-2);
		font-size: 14px;
	}

	@media (max-width: 960px) {
		.result-top {
			order: 1;
		}
		.score {
			order: 2;
		}
		.breakdown {
			order: 3;
		}
		.tl-wrap {
			order: 4;
		}
		.actions {
			order: 5;
		}
		.synopsis {
			order: 6;
		}
		.ext {
			order: 7;
		}
	}

	@media (max-width: 600px) {
		.score .big {
			font-size: 64px;
		}

		.kbd-hint {
			display: none;
		}
	}
</style>
