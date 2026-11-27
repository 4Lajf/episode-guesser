<script lang="ts">
	import { tick } from 'svelte';
	import { normalizeTitle } from '$lib/scoring';

	interface Props {
		titles: string[];
		submitting: boolean;
		disabled?: boolean;
		skipLabel?: string;
		confirmSkip?: boolean;
		submitLabel?: string;
		scoringNote?: string;
		lockedAnimeTitle?: string;
		minEpisode?: number;
		maxEpisode?: number | null;
		initialEpisode?: number;
		inlineError?: string | null;
		roundKey: string;
		onEpisodeChange?: (ep: number) => void;
		onSubmit: (title: string, episode: number) => void;
		onSkip: () => void;
	}

	let {
		titles,
		submitting,
		disabled = false,
		skipLabel = 'Skip frame',
		confirmSkip = false,
		submitLabel = 'Lock in guess',
		scoringNote = '',
		lockedAnimeTitle = '',
		minEpisode = 1,
		maxEpisode = null,
		initialEpisode = 1,
		inlineError = null,
		roundKey,
		onEpisodeChange,
		onSubmit,
		onSkip
	}: Props = $props();

	let titleQuery = $state('');
	let episodeText = $state('1');
	let dropdownOpen = $state(false);
	let activeIndex = $state(0);
	let armedSkip = $state(false);
	let skipArmTimer: ReturnType<typeof setTimeout> | null = null;

	let titleInputEl = $state<HTMLInputElement | null>(null);
	let episodeInputEl = $state<HTMLInputElement | null>(null);

	const isLockedAnime = $derived(Boolean(lockedAnimeTitle));

	const indexedTitles = $derived(
		titles.map((raw) => ({
			raw,
			lower: raw.toLowerCase(),
			norm: normalizeTitle(raw)
		}))
	);

	function clampEpisode(v: number): number {
		const lo = Math.max(1, minEpisode);
		let next = Number.isFinite(v) ? Math.round(v) : lo;
		if (next < lo) next = lo;
		if (maxEpisode !== null && next > maxEpisode) next = maxEpisode;
		return next;
	}

	function resetSkipArm() {
		armedSkip = false;
		if (skipArmTimer) {
			clearTimeout(skipArmTimer);
			skipArmTimer = null;
		}
	}

	function handleSkipClick() {
		if (!confirmSkip) {
			onSkip();
			return;
		}
		if (!armedSkip) {
			armedSkip = true;
			skipArmTimer = setTimeout(() => {
				armedSkip = false;
				skipArmTimer = null;
			}, 4000);
			return;
		}
		resetSkipArm();
		onSkip();
	}

	// Reset cleanly on each round or Daily attempt
	$effect(() => {
		void roundKey;
		titleQuery = lockedAnimeTitle || '';
		const startEp = clampEpisode(initialEpisode);
		episodeText = String(startEp);
		onEpisodeChange?.(startEp);
		dropdownOpen = false;
		activeIndex = 0;
		resetSkipArm();

		if (typeof window !== 'undefined' && window.innerWidth > 960) {
			tick().then(() => {
				if (disabled) return;
				if (lockedAnimeTitle) {
					episodeInputEl?.focus();
					episodeInputEl?.select();
				} else {
					titleInputEl?.focus();
				}
			});
		}
	});

	const searchResult = $derived.by(() => {
		const rawQ = titleQuery.trim().toLowerCase();
		const normQ = normalizeTitle(titleQuery);
		if (!rawQ && !normQ) return { items: [] as string[], total: 0 };

		const exactOrPrefix: string[] = [];
		const wordStarts: string[] = [];
		const contains: string[] = [];

		for (let i = 0; i < indexedTitles.length; i++) {
			const item = indexedTitles[i];
			const normIdx = normQ ? item.norm.indexOf(normQ) : -1;
			const rawIdx = rawQ ? item.lower.indexOf(rawQ) : -1;

			if (normIdx === -1 && rawIdx === -1) continue;

			if (normIdx === 0 || rawIdx === 0) {
				exactOrPrefix.push(item.raw);
			} else if (
				(normIdx > 0 && item.norm[normIdx - 1] === ' ') ||
				(rawIdx > 0 &&
					(item.lower[rawIdx - 1] === ' ' ||
						item.lower[rawIdx - 1] === ':' ||
						item.lower[rawIdx - 1] === '-'))
			) {
				wordStarts.push(item.raw);
			} else {
				contains.push(item.raw);
			}
		}

		exactOrPrefix.sort((a, b) => a.length - b.length);
		wordStarts.sort((a, b) => a.length - b.length);

		const all = [...exactOrPrefix, ...wordStarts, ...contains];
		return { items: all.slice(0, 10), total: all.length };
	});

	const filteredTitles = $derived(searchResult.items);
	const totalMatches = $derived(searchResult.total);

	$effect(() => {
		if (activeIndex >= filteredTitles.length) {
			activeIndex = 0;
		}
	});

	$effect(() => {
		const idx = activeIndex;
		if (dropdownOpen && filteredTitles.length > 0 && typeof document !== 'undefined') {
			tick().then(() => {
				document.getElementById(`anime-opt-${idx}`)?.scrollIntoView({ block: 'nearest' });
			});
		}
	});

	function splitHighlight(title: string, query: string): [string, string, string] {
		const q = query.trim();
		if (!q) return [title, '', ''];
		const idx = title.toLowerCase().indexOf(q.toLowerCase());
		if (idx === -1) return [title, '', ''];
		return [title.slice(0, idx), title.slice(idx, idx + q.length), title.slice(idx + q.length)];
	}

	function selectTitle(title: string) {
		titleQuery = title;
		dropdownOpen = false;
		activeIndex = 0;
		tick().then(() => {
			episodeInputEl?.focus();
			episodeInputEl?.select();
		});
	}

	function parsedEpisode(): number {
		const n = parseInt(episodeText.replace(/[^0-9]/g, ''), 10);
		return clampEpisode(Number.isFinite(n) ? n : minEpisode);
	}

	function nudgeEpisode(delta: number) {
		const next = clampEpisode(parsedEpisode() + delta);
		episodeText = String(next);
		onEpisodeChange?.(next);
	}

	function handleTitleKeydown(e: KeyboardEvent) {
		if (e.key === 'ArrowDown') {
			e.preventDefault();
			if (filteredTitles.length > 0) {
				dropdownOpen = true;
				activeIndex = (activeIndex + 1) % filteredTitles.length;
			}
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			if (filteredTitles.length > 0) {
				dropdownOpen = true;
				activeIndex = (activeIndex - 1 + filteredTitles.length) % filteredTitles.length;
			}
		} else if (e.key === 'Enter') {
			if (dropdownOpen && filteredTitles.length > 0) {
				e.preventDefault();
				selectTitle(filteredTitles[activeIndex] ?? filteredTitles[0]);
			} else if (titleQuery.trim()) {
				e.preventDefault();
				episodeInputEl?.focus();
				episodeInputEl?.select();
			}
		} else if (e.key === 'Escape') {
			dropdownOpen = false;
		}
	}

	function handleEpisodeKeydown(e: KeyboardEvent) {
		if (e.key === 'ArrowUp') {
			e.preventDefault();
			nudgeEpisode(1);
		} else if (e.key === 'ArrowDown') {
			e.preventDefault();
			nudgeEpisode(-1);
		} else if (e.key === 'Enter') {
			e.preventDefault();
			handleFormSubmit();
		}
	}

	function handleFormSubmit() {
		if (disabled || submitting) return;
		const cleanTitle = (isLockedAnime ? lockedAnimeTitle : titleQuery).trim();
		if (!cleanTitle) {
			titleInputEl?.focus();
			return;
		}
		dropdownOpen = false;
		const ep = parsedEpisode();
		episodeText = String(ep);
		onEpisodeChange?.(ep);
		onSubmit(cleanTitle, ep);
	}

	const canDecrement = $derived(parsedEpisode() > Math.max(1, minEpisode));
	const canIncrement = $derived(maxEpisode === null || parsedEpisode() < maxEpisode);
	const epInputWidthCh = $derived(Math.max(1.8, (episodeText.length || 1) * 1.05 + 0.6));
</script>

<form
	class="rail"
	autocomplete="off"
	onsubmit={(e) => {
		e.preventDefault();
		handleFormSubmit();
	}}
>
	{#if isLockedAnime}
		<!-- Daily found-anime compact console: episode stepper + primary submit side by side -->
		<div class="daily-console">
			<div class="stepper compact-stepper">
				<button
					type="button"
					class="step-btn"
					aria-label="One episode earlier"
					disabled={disabled || submitting || !canDecrement}
					onclick={() => nudgeEpisode(-1)}
				>
					<svg class="icon" viewBox="0 0 20 20" aria-hidden="true"><path d="M4.5 10h11" /></svg>
				</button>

				<div class="ep-val">
					<span aria-hidden="true">EP</span>
					<input
						bind:this={episodeInputEl}
						id="episode-input"
						type="text"
						inputmode="numeric"
						pattern="[0-9]*"
						aria-label={maxEpisode !== null
							? `Episode, between ${minEpisode} and ${maxEpisode}`
							: `Episode, ${minEpisode} or later`}
						disabled={disabled || submitting}
						bind:value={episodeText}
						style:width="{epInputWidthCh}ch"
						oninput={() => {
							episodeText = episodeText.replace(/[^0-9]/g, '').slice(0, 4);
							const n = parseInt(episodeText, 10);
							if (Number.isFinite(n) && n >= 1) onEpisodeChange?.(n);
						}}
						onblur={() => {
							const ep = parsedEpisode();
							episodeText = String(ep);
							onEpisodeChange?.(ep);
						}}
						onkeydown={handleEpisodeKeydown}
					/>
				</div>

				<button
					type="button"
					class="step-btn"
					aria-label="One episode later"
					disabled={disabled || submitting || !canIncrement}
					onclick={() => nudgeEpisode(1)}
				>
					<svg class="icon" viewBox="0 0 20 20" aria-hidden="true">
						<path d="M10 4.5v11M4.5 10h11" />
					</svg>
				</button>
			</div>

			<button type="submit" class="primary" disabled={disabled || submitting}>
				<span>{submitting ? 'Checking...' : submitLabel}</span>
				{#if !submitting}
					<kbd class="kbd-hint">Enter</kbd>
				{/if}
			</button>
		</div>

		<div class="locked-secondary">
			<button
				type="button"
				class="quiet small"
				class:armed={armedSkip}
				disabled={disabled || submitting}
				onclick={handleSkipClick}
			>
				{armedSkip ? 'Confirm give up?' : skipLabel}
			</button>
		</div>
	{:else}
		<!-- Full Anime Title Combobox (bounded popover inside 400px rail, never covers frame or bounces layout) -->
		<div class="field title-field">
			<label for="anime-combobox">Anime title</label>

			<div class="combo" class:open={dropdownOpen}>
				<div class="combo-input">
					<svg class="icon search-ico" viewBox="0 0 20 20" aria-hidden="true">
						<circle cx="9" cy="9" r="5.5" />
						<path d="M13.2 13.2 17 17" />
					</svg>

					<input
						bind:this={titleInputEl}
						id="anime-combobox"
						type="text"
						role="combobox"
						aria-autocomplete="list"
						aria-expanded={dropdownOpen && filteredTitles.length > 0}
						aria-controls={dropdownOpen && filteredTitles.length > 0
							? 'anime-title-listbox'
							: undefined}
						aria-activedescendant={dropdownOpen && filteredTitles.length > 0
							? `anime-opt-${activeIndex}`
							: undefined}
						spellcheck="false"
						placeholder="Start typing a title"
						disabled={disabled || submitting}
						bind:value={titleQuery}
						onfocus={() => {
							if (titleQuery.trim()) dropdownOpen = true;
						}}
						oninput={() => {
							dropdownOpen = titleQuery.trim().length > 0;
							activeIndex = 0;
						}}
						onblur={() => {
							setTimeout(() => (dropdownOpen = false), 140);
						}}
						onkeydown={handleTitleKeydown}
					/>

					{#if titleQuery}
						<button
							type="button"
							class="clear"
							aria-label="Clear title"
							disabled={disabled || submitting}
							onclick={() => {
								titleQuery = '';
								dropdownOpen = false;
								titleInputEl?.focus();
							}}
						>
							<svg class="icon" viewBox="0 0 20 20" aria-hidden="true">
								<path d="M5 5l10 10M15 5 5 15" />
							</svg>
						</button>
					{/if}
				</div>

				{#if dropdownOpen && filteredTitles.length > 0}
					<div class="combo-panel">
						<div
							id="anime-title-listbox"
							class="matches"
							role="listbox"
							aria-label="Matching titles"
						>
							{#each filteredTitles as item, idx (item)}
								{@const [before, match, after] = splitHighlight(item, titleQuery)}
								<button
									type="button"
									tabindex="-1"
									id="anime-opt-{idx}"
									role="option"
									aria-selected={idx === activeIndex}
									class="match-opt"
									onmousedown={(e) => e.preventDefault()}
									onclick={() => selectTitle(item)}
									onmouseenter={() => (activeIndex = idx)}
								>
									<span class="t">
										{before}{#if match}<mark>{match}</mark>{/if}{after}
									</span>
								</button>
							{/each}
						</div>
						<div class="combo-foot">
							<span class="tnum">{totalMatches} {totalMatches === 1 ? 'match' : 'matches'}</span>
							<span class="key-hint">Enter picks the highlighted title</span>
						</div>
					</div>
				{:else if dropdownOpen && titleQuery.trim().length >= 2 && filteredTitles.length === 0}
					<div class="combo-panel empty-pop" role="status">
						No catalog match — press Enter to submit as typed
					</div>
				{/if}
			</div>
		</div>

		<!-- Episode Stepper -->
		<div class="field">
			<label for="episode-input">Episode</label>
			<div class="stepper">
				<button
					type="button"
					class="step-btn"
					aria-label="One episode earlier"
					disabled={disabled || submitting || !canDecrement}
					onclick={() => nudgeEpisode(-1)}
				>
					<svg class="icon" viewBox="0 0 20 20" aria-hidden="true"><path d="M4.5 10h11" /></svg>
				</button>

				<div class="ep-val">
					<span aria-hidden="true">EP</span>
					<input
						bind:this={episodeInputEl}
						id="episode-input"
						type="text"
						inputmode="numeric"
						pattern="[0-9]*"
						aria-describedby={scoringNote ? 'scoring-note' : undefined}
						disabled={disabled || submitting}
						bind:value={episodeText}
						style:width="{epInputWidthCh}ch"
						oninput={() => {
							episodeText = episodeText.replace(/[^0-9]/g, '').slice(0, 4);
							const n = parseInt(episodeText, 10);
							if (Number.isFinite(n) && n >= 1) onEpisodeChange?.(n);
						}}
						onblur={() => {
							const ep = parsedEpisode();
							episodeText = String(ep);
							onEpisodeChange?.(ep);
						}}
						onkeydown={handleEpisodeKeydown}
					/>
				</div>

				<button
					type="button"
					class="step-btn"
					aria-label="One episode later"
					disabled={disabled || submitting || !canIncrement}
					onclick={() => nudgeEpisode(1)}
				>
					<svg class="icon" viewBox="0 0 20 20" aria-hidden="true">
						<path d="M10 4.5v11M4.5 10h11" />
					</svg>
				</button>
			</div>
		</div>

		<!-- Actions -->
		<div class="actions">
			<button
				type="submit"
				class="primary"
				disabled={disabled || submitting || !titleQuery.trim()}
			>
				<span>{submitting ? 'Checking...' : submitLabel}</span>
				{#if !submitting}
					<kbd class="kbd-hint">Enter</kbd>
				{/if}
			</button>

			<button
				type="button"
				class="quiet"
				class:armed={armedSkip}
				disabled={disabled || submitting}
				onclick={handleSkipClick}
			>
				{armedSkip ? 'Confirm give up?' : skipLabel}
			</button>
		</div>

		{#if scoringNote}
			<p class="note" id="scoring-note">{scoringNote}</p>
		{/if}
	{/if}

	{#if inlineError}
		<div class="inline-error" role="alert">{inlineError}</div>
	{/if}
</form>

<style>
	.rail {
		display: flex;
		flex-direction: column;
		gap: 18px;
		min-width: 0;
	}

	.icon {
		width: 18px;
		height: 18px;
		flex: none;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.75;
		stroke-linecap: round;
		stroke-linejoin: round;
	}

	.field {
		display: grid;
		gap: 8px;
	}

	.field > label {
		font-size: 14px;
		font-weight: 600;
		color: var(--text-2);
	}

	.title-field {
		position: relative;
	}

	.combo {
		border: 1.5px solid var(--line-strong);
		border-radius: var(--r);
		background: var(--ink-deep);
		overflow: hidden;
		transition: border-color 120ms ease;
	}

	.combo:focus-within,
	.combo.open {
		border-color: var(--blue);
	}

	.combo-input {
		display: flex;
		align-items: center;
		gap: 10px;
		height: 50px;
		padding: 0 6px 0 14px;
	}

	.search-ico {
		color: var(--text-2);
	}

	.combo-input input {
		flex: 1;
		min-width: 0;
		height: 100%;
		border: 0;
		outline: 0;
		background: none;
		font-size: 16.5px;
		font-weight: 500;
		color: var(--paper);
	}

	.combo-input input::placeholder {
		color: var(--text-3);
	}

	.clear {
		width: 36px;
		height: 36px;
		display: grid;
		place-items: center;
		border: 0;
		border-radius: 6px;
		background: none;
		color: var(--text-2);
		transition: background-color 120ms ease, color 120ms ease;
	}

	.clear:hover {
		color: var(--paper);
		background: var(--ink-raised);
	}

	/* Unified in-flow combobox panel inside the 400px rail: never overlaps the frame OR hides the Episode stepper */
	.combo-panel {
		border-top: 1px solid var(--line);
	}

	.matches {
		max-height: 204px;
		overflow-y: auto;
	}

	.match-opt {
		width: 100%;
		border: 0;
		background: none;
		text-align: left;
		display: block;
		padding: 9px 14px;
		cursor: pointer;
		border-bottom: 1px solid var(--line-soft);
		transition: background-color 100ms ease;
	}

	.match-opt:last-child {
		border-bottom: 0;
	}

	.match-opt .t {
		display: block;
		font-size: 14.5px;
		font-weight: 550;
		color: var(--text-2);
		overflow-wrap: anywhere;
		line-height: 1.35;
	}

	.match-opt .t mark {
		background: none;
		color: var(--paper);
		font-weight: 700;
	}

	.match-opt:hover {
		background: var(--line-soft);
	}

	.match-opt[aria-selected='true'] {
		background: var(--ink-raised);
	}

	.match-opt[aria-selected='true'] .t {
		color: var(--paper);
	}

	.combo-foot {
		display: flex;
		justify-content: space-between;
		gap: 12px;
		padding: 7px 14px;
		border-top: 1px solid var(--line);
		background: var(--ink-deep);
		font-size: 12.5px;
		color: var(--text-3);
	}

	.empty-pop {
		padding: 11px 14px;
		font-size: 13.5px;
		color: var(--text-2);
	}

	/* Episode Stepper */
	.stepper {
		display: grid;
		grid-template-columns: 52px minmax(0, 1fr) 52px;
		height: 52px;
		border: 1.5px solid var(--line-strong);
		border-radius: var(--r);
		background: var(--ink-deep);
		overflow: hidden;
	}

	.stepper.compact-stepper {
		grid-template-columns: 44px minmax(0, 1fr) 44px;
	}

	.step-btn {
		border: 0;
		background: none;
		display: grid;
		place-items: center;
		color: var(--paper);
		transition: background-color 120ms ease;
	}

	.step-btn:hover:not(:disabled) {
		background: var(--ink-raised);
	}

	.step-btn:disabled {
		color: var(--line-strong);
		cursor: default;
	}

	.step-btn:focus-visible {
		outline-offset: -3px;
	}

	.ep-val {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 8px;
		border-inline: 1px solid var(--line);
	}

	.ep-val:focus-within {
		box-shadow: inset 0 0 0 2px var(--blue);
	}

	.ep-val span {
		font-size: 14px;
		font-weight: 650;
		color: var(--text-2);
	}

	.ep-val input {
		min-width: 1.8ch;
		max-width: 5.5ch;
		border: 0;
		outline: 0;
		background: none;
		padding: 0;
		text-align: center;
		font-size: 24px;
		font-weight: 750;
		font-variant-numeric: tabular-nums;
		color: var(--paper);
	}

	/* Actions */
	.actions {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.daily-console {
		display: grid;
		grid-template-columns: 158px minmax(0, 1fr);
		gap: 8px;
	}

	.locked-secondary {
		display: flex;
		justify-content: flex-end;
		margin-top: -10px;
	}

	.primary {
		flex: 1;
		height: 52px;
		padding: 0 18px;
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
		transition: background-color 120ms ease, color 120ms ease;
	}

	.primary:hover:not(:disabled) {
		background: var(--paper-hover);
	}

	.primary:disabled {
		background: var(--ink-raised);
		color: var(--text-3);
		box-shadow: inset 0 0 0 1px var(--line);
		cursor: not-allowed;
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

	.primary:disabled .kbd-hint {
		background: rgba(243, 239, 228, 0.08);
		color: var(--text-3);
	}

	.quiet {
		height: 52px;
		padding: 0 16px;
		border: 0;
		border-radius: var(--r);
		background: none;
		color: var(--text-2);
		font-size: 15px;
		font-weight: 600;
		white-space: nowrap;
		transition: background-color 120ms ease, color 120ms ease;
	}

	.quiet.small {
		height: 36px;
		padding: 0 12px;
		font-size: 13.5px;
	}

	.quiet:hover:not(:disabled) {
		color: var(--paper);
		background: var(--ink-raised);
	}

	.quiet.armed {
		background: var(--danger-soft);
		color: var(--danger);
		box-shadow: inset 0 0 0 1px rgba(240, 138, 150, 0.5);
	}

	.note {
		margin: 0;
		font-size: 13.5px;
		color: var(--text-3);
		max-width: 48ch;
	}

	.inline-error {
		background: var(--danger-soft);
		border: 1px solid rgba(240, 138, 150, 0.45);
		color: #ffd5da;
		border-radius: var(--r);
		padding: 9px 12px;
		font-size: 13.5px;
	}

	@media (max-width: 600px) {
		.key-hint,
		.kbd-hint {
			display: none;
		}

		.daily-console {
			grid-template-columns: 144px minmax(0, 1fr);
		}
	}
</style>
