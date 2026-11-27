<script lang="ts">
	import { tick } from 'svelte';
	import { normalizeTitle } from '$lib/scoring';

	interface Props {
		titles: string[];
		submitting: boolean;
		disabled?: boolean;
		compact?: boolean;
		skipLabel?: string;
		submitLabel?: string;
		episodeHint?: string;
		prefillTitle?: string;
		inlineError?: string | null;
		roundKey: string;
		onSubmit: (title: string, episode: number) => void;
		onSkip: () => void;
	}

	let {
		titles,
		submitting,
		disabled = false,
		compact = false,
		skipLabel = 'Skip frame',
		submitLabel = 'Lock in guess',
		episodeHint = 'Near misses still score',
		prefillTitle = '',
		inlineError = null,
		roundKey,
		onSubmit,
		onSkip
	}: Props = $props();

	let titleQuery = $state('');
	let episodeText = $state('1');
	let dropdownOpen = $state(false);
	let openUpward = $state(false);
	let activeIndex = $state(0);

	let titleInputEl = $state<HTMLInputElement | null>(null);
	let episodeInputEl = $state<HTMLInputElement | null>(null);

	// Precompute normalized titles once whenever title pool changes
	const indexedTitles = $derived(
		titles.map((raw) => ({
			raw,
			lower: raw.toLowerCase(),
			norm: normalizeTitle(raw)
		}))
	);

	function updateDropdownDirection() {
		if (!titleInputEl || typeof window === 'undefined') return;
		const rect = titleInputEl.getBoundingClientRect();
		const spaceBelow = window.innerHeight - rect.bottom;
		const spaceAbove = rect.top;
		openUpward = spaceBelow < 240 && spaceAbove > spaceBelow;
	}

	// Reset inputs cleanly whenever a new round/attempt starts
	$effect(() => {
		void roundKey;
		titleQuery = prefillTitle || '';
		episodeText = '1';
		dropdownOpen = false;
		activeIndex = 0;

		if (typeof window !== 'undefined' && window.innerWidth > 760) {
			tick().then(() => {
				if (disabled) return;
				if (prefillTitle) {
					episodeInputEl?.focus();
					episodeInputEl?.select();
				} else {
					titleInputEl?.focus();
				}
			});
		}
	});

	const filteredTitles = $derived.by(() => {
		const rawQ = titleQuery.trim().toLowerCase();
		const normQ = normalizeTitle(titleQuery);
		if (!rawQ && !normQ) return [];

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

		// Shorter prefix matches surface first so exact shows rank above long OVAs
		exactOrPrefix.sort((a, b) => a.length - b.length);
		wordStarts.sort((a, b) => a.length - b.length);

		return [...exactOrPrefix, ...wordStarts, ...contains].slice(0, 10);
	});

	$effect(() => {
		if (activeIndex >= filteredTitles.length) {
			activeIndex = 0;
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
		return Number.isFinite(n) && n >= 1 ? n : 1;
	}

	function nudgeEpisode(delta: number) {
		const next = Math.max(1, parsedEpisode() + delta);
		episodeText = String(next);
	}

	function handleTitleKeydown(e: KeyboardEvent) {
		if (e.key === 'ArrowDown') {
			e.preventDefault();
			if (filteredTitles.length > 0) {
				updateDropdownDirection();
				dropdownOpen = true;
				activeIndex = (activeIndex + 1) % filteredTitles.length;
			}
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			if (filteredTitles.length > 0) {
				updateDropdownDirection();
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
		const cleanTitle = titleQuery.trim();
		if (!cleanTitle) {
			titleInputEl?.focus();
			return;
		}
		dropdownOpen = false;
		onSubmit(cleanTitle, parsedEpisode());
	}
</script>

<form
	class="guess-console"
	class:compact
	onsubmit={(e) => {
		e.preventDefault();
		handleFormSubmit();
	}}
>
	<!-- Anime Title WAI-ARIA Combobox (dropdown anchored to .title-field so upward never clips label!) -->
	<div class="field title-field">
		<div class="field-head">
			<label for="anime-combobox" class="field-label">Anime title</label>
			<span class="field-hint desktop-only">Type title · ↑↓ Enter to pick</span>
		</div>

		<div class="combobox-wrap">
			<svg class="search-icon" width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true">
				<circle cx="9" cy="9" r="6" stroke="currentColor" stroke-width="1.8" />
				<path d="M13.5 13.5L17.5 17.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
			</svg>

			<input
				bind:this={titleInputEl}
				id="anime-combobox"
				type="text"
				class="title-input"
				role="combobox"
				aria-autocomplete="list"
				aria-expanded={dropdownOpen && filteredTitles.length > 0}
				aria-controls={dropdownOpen && filteredTitles.length > 0
					? 'anime-title-listbox'
					: undefined}
				aria-activedescendant={dropdownOpen && filteredTitles.length > 0
					? `anime-opt-${activeIndex}`
					: undefined}
				autocomplete="off"
				spellcheck="false"
				placeholder="Search anime title..."
				disabled={disabled || submitting}
				bind:value={titleQuery}
				onfocus={() => {
					updateDropdownDirection();
					if (titleQuery.trim()) dropdownOpen = true;
				}}
				oninput={() => {
					updateDropdownDirection();
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
					class="clear-btn"
					aria-label="Clear anime title"
					onclick={() => {
						titleQuery = '';
						dropdownOpen = false;
						titleInputEl?.focus();
					}}
				>
					×
				</button>
			{/if}
		</div>

		{#if dropdownOpen && filteredTitles.length > 0}
			<div
				id="anime-title-listbox"
				class="dropdown"
				class:upward={openUpward}
				role="listbox"
				aria-label="Anime title suggestions"
			>
				{#each filteredTitles as item, idx (item)}
					{@const [before, match, after] = splitHighlight(item, titleQuery)}
					<button
						type="button"
						tabindex="-1"
						id="anime-opt-{idx}"
						role="option"
						aria-selected={idx === activeIndex}
						class="dropdown-opt"
						class:active={idx === activeIndex}
						onmousedown={(e) => e.preventDefault()}
						onclick={() => selectTitle(item)}
						onmouseenter={() => (activeIndex = idx)}
					>
						<span class="opt-text">
							{before}<strong class="opt-match">{match}</strong>{after}
						</span>
					</button>
				{/each}
			</div>
		{/if}
	</div>

	<!-- Episode Stepper (never leaks target show's episode count) -->
	<div class="field episode-field">
		<div class="field-head">
			<label for="episode-input" class="field-label">Episode</label>
			<span class="field-hint">{episodeHint}</span>
		</div>

		<div class="stepper">
			<button
				type="button"
				class="step-btn"
				aria-label="Decrease episode number"
				disabled={disabled || submitting || parsedEpisode() <= 1}
				onclick={() => nudgeEpisode(-1)}
			>
				−
			</button>

			<div class="ep-center">
				<span class="ep-prefix font-display" aria-hidden="true">EP</span>
				<input
					bind:this={episodeInputEl}
					id="episode-input"
					type="text"
					inputmode="numeric"
					pattern="[0-9]*"
					class="ep-input font-display"
					disabled={disabled || submitting}
					bind:value={episodeText}
					oninput={() => {
						episodeText = episodeText.replace(/[^0-9]/g, '').slice(0, 4);
					}}
					onblur={() => {
						episodeText = String(parsedEpisode());
					}}
					onkeydown={handleEpisodeKeydown}
				/>
			</div>

			<button
				type="button"
				class="step-btn"
				aria-label="Increase episode number"
				disabled={disabled || submitting}
				onclick={() => nudgeEpisode(1)}
			>
				+
			</button>
		</div>
	</div>

	<!-- Actions -->
	<div class="actions">
		<button
			type="submit"
			class="btn-submit"
			disabled={disabled || submitting || !titleQuery.trim()}
		>
			<span>{submitting ? 'Checking...' : submitLabel}</span>
			{#if !submitting}
				<kbd class="kbd-hint">Enter</kbd>
			{/if}
		</button>

		<button
			type="button"
			class="btn-skip"
			disabled={disabled || submitting}
			onclick={onSkip}
		>
			{skipLabel}
		</button>
	</div>

	{#if inlineError}
		<div class="inline-error" role="alert">{inlineError}</div>
	{/if}
</form>

<style>
	.guess-console {
		display: grid;
		grid-template-columns: minmax(0, 1fr) 196px auto;
		gap: 12px;
		align-items: end;
		background: var(--ink-1);
		border: 1px solid var(--rule);
		border-radius: var(--radius-lg);
		padding: 16px 18px;
	}

	.guess-console.compact {
		grid-template-columns: minmax(0, 1fr) 196px;
		padding: 14px 16px;
		gap: 10px 12px;
	}

	.guess-console.compact .actions {
		grid-column: 1 / -1;
		display: grid;
		grid-template-columns: 1fr auto;
	}

	.field {
		display: flex;
		flex-direction: column;
		gap: 6px;
		min-width: 0;
	}

	.title-field {
		position: relative;
	}

	.field-head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 8px;
	}

	.field-label {
		font-size: 13.5px;
		font-weight: 700;
		color: var(--text);
	}

	.field-hint {
		font-size: 12px;
		color: var(--text-3);
		white-space: nowrap;
	}

	.combobox-wrap {
		position: relative;
		display: flex;
		align-items: center;
	}

	.search-icon {
		position: absolute;
		left: 13px;
		color: var(--text-3);
		pointer-events: none;
	}

	.title-input {
		width: 100%;
		height: 46px;
		background: var(--ink-2);
		border: 1.5px solid var(--rule-strong);
		border-radius: var(--radius-md);
		color: var(--text);
		font-size: 15px;
		font-weight: 500;
		padding: 0 36px 0 38px;
		outline: none;
		transition: border-color 120ms ease, box-shadow 120ms ease;
	}

	.title-input::placeholder {
		color: var(--text-3);
	}

	.title-input:focus {
		border-color: var(--lamp);
		box-shadow: 0 0 0 3px var(--lamp-soft);
	}

	.clear-btn {
		position: absolute;
		right: 8px;
		width: 26px;
		height: 26px;
		border: 0;
		border-radius: 6px;
		background: transparent;
		color: var(--text-2);
		font-size: 18px;
		line-height: 1;
		cursor: pointer;
		display: grid;
		place-items: center;
	}

	.clear-btn:hover {
		background: var(--ink-3);
		color: var(--text);
	}

	/* Floating popover anchored to .title-field so upward never overlaps the label */
	.dropdown {
		position: absolute;
		left: 0;
		right: 0;
		top: calc(100% + 6px);
		z-index: 40;
		background: var(--ink-1);
		border: 1px solid var(--rule-strong);
		border-radius: var(--radius-md);
		max-height: 270px;
		overflow-y: auto;
		box-shadow: 0 14px 34px rgba(0, 0, 0, 0.6);
	}

	.dropdown.upward {
		top: auto;
		bottom: calc(100% + 6px);
		max-height: 172px;
		box-shadow: 0 -14px 34px rgba(0, 0, 0, 0.6);
	}

	.dropdown-opt {
		width: 100%;
		border: 0;
		background: transparent;
		color: var(--text-2);
		text-align: left;
		padding: 10px 14px;
		font-size: 14px;
		cursor: pointer;
		border-bottom: 1px solid rgba(38, 50, 65, 0.55);
		display: block;
	}

	.dropdown-opt:last-child {
		border-bottom: 0;
	}

	.dropdown-opt.active,
	.dropdown-opt:hover {
		background: var(--ink-3);
		color: var(--text);
	}

	.opt-match {
		color: var(--lamp);
		font-weight: 700;
	}

	/* Episode Stepper */
	.stepper {
		height: 46px;
		display: grid;
		grid-template-columns: 40px 1fr 40px;
		background: var(--ink-2);
		border: 1.5px solid var(--rule-strong);
		border-radius: var(--radius-md);
		overflow: hidden;
	}

	.stepper:focus-within {
		border-color: var(--lamp);
		box-shadow: 0 0 0 3px var(--lamp-soft);
	}

	.step-btn {
		border: 0;
		background: var(--ink-1);
		color: var(--text);
		font-size: 18px;
		font-weight: 700;
		cursor: pointer;
		transition: background 120ms ease;
	}

	.step-btn:hover:not(:disabled) {
		background: var(--ink-3);
	}

	.step-btn:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}

	.step-btn:first-child {
		border-right: 1px solid var(--rule);
	}

	.step-btn:last-child {
		border-left: 1px solid var(--rule);
	}

	.ep-center {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 5px;
		padding: 0 6px;
	}

	.ep-prefix {
		font-size: 14px;
		font-weight: 700;
		color: var(--text-3);
	}

	.ep-input {
		width: 52px;
		background: transparent;
		border: 0;
		color: var(--text);
		font-size: 20px;
		font-weight: 700;
		text-align: center;
		outline: none;
	}

	/* Actions */
	.actions {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.btn-submit {
		height: 46px;
		padding: 0 18px;
		background: var(--lamp);
		color: var(--lamp-ink);
		border: 0;
		border-radius: var(--radius-md);
		font-size: 14.5px;
		font-weight: 700;
		cursor: pointer;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 8px;
		white-space: nowrap;
		transition: background 120ms ease, color 120ms ease;
	}

	.btn-submit:hover:not(:disabled) {
		background: var(--lamp-hover);
	}

	/* Clean neutral disabled style instead of muddy translucent yellow */
	.btn-submit:disabled {
		background: var(--ink-3);
		color: var(--text-3);
		border: 1px solid var(--rule);
		cursor: not-allowed;
	}

	.btn-submit:disabled .kbd-hint {
		background: rgba(255, 255, 255, 0.06);
		color: var(--text-3);
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

	.btn-skip {
		height: 46px;
		padding: 0 14px;
		background: transparent;
		border: 1px solid var(--rule-strong);
		border-radius: var(--radius-md);
		color: var(--text-2);
		font-size: 13.5px;
		font-weight: 500;
		cursor: pointer;
		white-space: nowrap;
		transition: background 120ms ease, color 120ms ease;
	}

	.btn-skip:hover:not(:disabled) {
		background: var(--ink-2);
		color: var(--text);
	}

	.inline-error {
		grid-column: 1 / -1;
		background: var(--danger-soft);
		border: 1px solid rgba(228, 108, 124, 0.45);
		color: #f8c2c9;
		border-radius: 8px;
		padding: 8px 12px;
		font-size: 13px;
	}

	@media (max-width: 860px) {
		.guess-console,
		.guess-console.compact {
			grid-template-columns: 1fr;
			padding: 14px;
		}

		.actions,
		.guess-console.compact .actions {
			display: grid;
			grid-template-columns: 1fr auto;
		}

		.kbd-hint,
		.desktop-only {
			display: none;
		}
	}
</style>
