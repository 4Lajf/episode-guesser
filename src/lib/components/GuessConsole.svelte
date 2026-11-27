<script lang="ts">
	import { tick } from 'svelte';
	import { normalizeTitle } from '$lib/scoring';
	import type { AutocompleteEntry } from '$lib/types';

	interface Props {
		entries: AutocompleteEntry[];
		submitting: boolean;
		disabled?: boolean;
		skipLabel?: string;
		confirmSkip?: boolean;
		confirmSkipLabel?: string;
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
		entries,
		submitting,
		disabled = false,
		skipLabel = 'Skip frame',
		confirmSkip = false,
		confirmSkipLabel = 'Confirm give up?',
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

	const indexedEntries = $derived(
		entries.map((entry) => ({
			entry,
			tLower: entry.t.toLowerCase(),
			tNorm: normalizeTitle(entry.t),
			aLower: entry.a ? entry.a.toLowerCase() : '',
			aNorm: entry.a ? normalizeTitle(entry.a) : '',
			sNorms: entry.s ? entry.s.map((x) => normalizeTitle(x)).filter(Boolean) : []
		}))
	);

	// Shows episode count strictly for the show the player typed/picked (global catalog only — never leaks target).
	const selectedEntryEp = $derived.by(() => {
		const raw = (isLockedAnime ? lockedAnimeTitle : titleQuery).trim();
		if (!raw) return null;
		const lower = raw.toLowerCase();
		const norm = normalizeTitle(raw);
		for (let i = 0; i < indexedEntries.length; i++) {
			const item = indexedEntries[i];
			if (
				item.tLower === lower ||
				(norm && item.tNorm === norm) ||
				(item.aLower && item.aLower === lower) ||
				(norm && item.aNorm === norm)
			) {
				return item.entry.ep && item.entry.ep > 0 ? item.entry.ep : null;
			}
		}
		return null;
	});

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

	function isWordStart(haystack: string, idx: number): boolean {
		if (idx <= 0) return idx === 0;
		const prev = haystack[idx - 1];
		return prev === ' ' || prev === ':' || prev === '-' || prev === '/' || prev === '(';
	}

	const searchResult = $derived.by(() => {
		const rawQ = titleQuery.trim().toLowerCase();
		const normQ = normalizeTitle(titleQuery);
		if (!rawQ && !normQ) return { items: [] as AutocompleteEntry[], total: 0 };

		const buckets: AutocompleteEntry[][] = [[], [], [], [], [], [], []];

		for (let i = 0; i < indexedEntries.length; i++) {
			const item = indexedEntries[i];
			const tRawIdx = rawQ ? item.tLower.indexOf(rawQ) : -1;
			const tNormIdx = normQ ? item.tNorm.indexOf(normQ) : -1;
			const aRawIdx = rawQ && item.aLower ? item.aLower.indexOf(rawQ) : -1;
			const aNormIdx = normQ && item.aNorm ? item.aNorm.indexOf(normQ) : -1;

			let sExactOrPrefix = false;
			let sContains = false;
			if (normQ && item.sNorms.length > 0 && tRawIdx === -1 && tNormIdx === -1 && aRawIdx === -1 && aNormIdx === -1) {
				for (let j = 0; j < item.sNorms.length; j++) {
					const s = item.sNorms[j];
					if (s === normQ || s.startsWith(normQ)) {
						sExactOrPrefix = true;
						break;
					}
					if (s.includes(normQ)) {
						sContains = true;
					}
				}
			}

			if (
				tRawIdx === -1 &&
				tNormIdx === -1 &&
				aRawIdx === -1 &&
				aNormIdx === -1 &&
				!sExactOrPrefix &&
				!sContains
			) {
				continue;
			}

			// Tier 0: exact raw display match (e.g. "Hunter x Hunter (2011)" always #1)
			if (rawQ && item.tLower === rawQ) {
				buckets[0].push(item.entry);
			} else if (
				(normQ && item.tNorm === normQ) ||
				(rawQ && item.aLower === rawQ) ||
				(normQ && item.aNorm === normQ)
			) {
				// Tier 1: exact normalized display or exact English alias
				buckets[1].push(item.entry);
			} else if (tRawIdx === 0) {
				// Tier 2: display raw prefix
				buckets[2].push(item.entry);
			} else if (tNormIdx === 0) {
				// Tier 3: display normalized prefix
				buckets[3].push(item.entry);
			} else if (aRawIdx === 0 || aNormIdx === 0) {
				// Tier 4: English alias prefix
				buckets[4].push(item.entry);
			} else if (
				isWordStart(item.tLower, tRawIdx) ||
				isWordStart(item.tNorm, tNormIdx) ||
				isWordStart(item.aLower, aRawIdx) ||
				isWordStart(item.aNorm, aNormIdx) ||
				sExactOrPrefix
			) {
				// Tier 5: word-start or nickname prefix
				buckets[5].push(item.entry);
			} else {
				// Tier 6: substring match
				buckets[6].push(item.entry);
			}
		}

		for (let b = 0; b < buckets.length; b++) {
			if (buckets[b].length > 1) {
				buckets[b].sort((a, c) => a.t.length - c.t.length || a.t.localeCompare(c.t));
			}
		}

		let total = 0;
		const items: AutocompleteEntry[] = [];
		for (let b = 0; b < buckets.length; b++) {
			total += buckets[b].length;
			if (items.length < 8) {
				const need = 8 - items.length;
				items.push(...buckets[b].slice(0, need));
			}
		}
		return { items, total };
	});

	const filteredEntries = $derived(searchResult.items);
	const totalMatches = $derived(searchResult.total);

	$effect(() => {
		if (activeIndex >= filteredEntries.length) {
			activeIndex = 0;
		}
	});

	$effect(() => {
		const idx = activeIndex;
		if (dropdownOpen && filteredEntries.length > 0 && typeof document !== 'undefined') {
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

	function selectEntry(entry: AutocompleteEntry) {
		titleQuery = entry.t;
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
			if (filteredEntries.length > 0) {
				dropdownOpen = true;
				activeIndex = (activeIndex + 1) % filteredEntries.length;
			}
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			if (filteredEntries.length > 0) {
				dropdownOpen = true;
				activeIndex = (activeIndex - 1 + filteredEntries.length) % filteredEntries.length;
			}
		} else if (e.key === 'Enter') {
			if (dropdownOpen && filteredEntries.length > 0) {
				e.preventDefault();
				selectEntry(filteredEntries[activeIndex] ?? filteredEntries[0]);
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
			{#if selectedEntryEp}
				<span class="locked-ep-meta tnum">{selectedEntryEp} {selectedEntryEp === 1 ? 'episode' : 'episodes'} total</span>
			{/if}
			<button
				type="button"
				class="quiet small"
				class:armed={armedSkip}
				disabled={disabled || submitting}
				onclick={handleSkipClick}
			>
				{armedSkip ? confirmSkipLabel : skipLabel}
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
						aria-expanded={dropdownOpen && filteredEntries.length > 0}
						aria-controls={dropdownOpen && filteredEntries.length > 0
							? 'anime-title-listbox'
							: undefined}
						aria-activedescendant={dropdownOpen && filteredEntries.length > 0
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

				{#if dropdownOpen && filteredEntries.length > 0}
					<div class="combo-panel">
						<div
							id="anime-title-listbox"
							class="matches"
							role="listbox"
							aria-label="Matching titles"
						>
							{#each filteredEntries as item, idx (item.t)}
								{@const [before, match, after] = splitHighlight(item.t, titleQuery)}
								<button
									type="button"
									tabindex="-1"
									id="anime-opt-{idx}"
									role="option"
									aria-selected={idx === activeIndex}
									class="match-opt"
									onmousedown={(e) => e.preventDefault()}
									onclick={() => selectEntry(item)}
									onmouseenter={() => (activeIndex = idx)}
								>
									<span class="t">
										{before}{#if match}<mark>{match}</mark>{/if}{after}
									</span>
									{#if item.a}
										{@const [aBefore, aMatch, aAfter] = splitHighlight(item.a, titleQuery)}
										<span class="sub">
											{aBefore}{#if aMatch}<mark>{aMatch}</mark>{/if}{aAfter}
										</span>
									{/if}
								</button>
							{/each}
						</div>
						<div class="combo-foot">
							<span class="tnum">{totalMatches} {totalMatches === 1 ? 'match' : 'matches'}</span>
							<span class="key-hint">Enter picks the highlighted title</span>
						</div>
					</div>
				{:else if dropdownOpen && titleQuery.trim().length >= 2 && filteredEntries.length === 0}
					<div class="combo-panel empty-pop" role="status">
						No catalog match — press Enter to submit as typed
					</div>
				{/if}
			</div>
		</div>

		<!-- Episode Stepper -->
		<div class="field">
			<div class="field-head">
				<label for="episode-input">Episode</label>
				{#if selectedEntryEp}
					<span class="ep-cap tnum">{selectedEntryEp} {selectedEntryEp === 1 ? 'episode' : 'episodes'}</span>
				{/if}
			</div>
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
				{armedSkip ? confirmSkipLabel : skipLabel}
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

	.field > label,
	.field-head label {
		font-size: 14px;
		font-weight: 600;
		color: var(--text-2);
	}

	.field-head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 8px;
	}

	.ep-cap {
		font-size: 13px;
		color: var(--text-3);
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
		max-height: 224px;
		overflow-y: auto;
	}

	.match-opt {
		width: 100%;
		border: 0;
		background: none;
		text-align: left;
		display: flex;
		flex-direction: column;
		gap: 2px;
		padding: 8px 14px;
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
		line-height: 1.3;
	}

	.match-opt .sub {
		display: block;
		font-size: 12.5px;
		color: var(--text-3);
		overflow-wrap: anywhere;
		line-height: 1.25;
	}

	.match-opt .t mark,
	.match-opt .sub mark {
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
		grid-template-columns: 42px minmax(0, 1fr) 42px;
	}

	.compact-stepper .ep-val {
		gap: 5px;
	}

	.compact-stepper .ep-val span {
		font-size: 12.5px;
	}

	.compact-stepper .ep-val input {
		font-size: 21px;
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
		grid-template-columns: 180px minmax(0, 1fr);
		gap: 8px;
	}

	.locked-secondary {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
		margin-top: -10px;
	}

	.locked-secondary:not(:has(.locked-ep-meta)) {
		justify-content: flex-end;
	}

	.locked-ep-meta {
		font-size: 13px;
		color: var(--text-3);
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
			grid-template-columns: 160px minmax(0, 1fr);
		}
	}
</style>
