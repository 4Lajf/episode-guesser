<script lang="ts">
	import { tick } from 'svelte';
	import { CURATED_GLOBAL_POOL } from '$lib/curated';
	import type { ListStatus } from '$lib/types';

	interface Props {
		open: boolean;
		canDismiss: boolean;
		initialUsername: string;
		initialStatuses: ListStatus[];
		initialIncludeSingleEp: boolean;
		recentUsers: string[];
		loading: boolean;
		error: string | null;
		onLoadUser: (username: string, statuses: ListStatus[], includeSingleEp: boolean) => void;
		onUseGlobal: () => void;
		onClose: () => void;
	}

	let {
		open,
		canDismiss,
		initialUsername,
		initialStatuses,
		initialIncludeSingleEp,
		recentUsers,
		loading,
		error,
		onLoadUser,
		onUseGlobal,
		onClose
	}: Props = $props();

	let usernameInput = $state('');
	let statuses = $state<ListStatus[]>(['COMPLETED', 'CURRENT']);
	let includeSingleEp = $state(false);
	let usernameInputEl = $state<HTMLInputElement | null>(null);
	let cardEl = $state<HTMLDivElement | null>(null);
	let previouslyFocused: HTMLElement | null = null;

	$effect(() => {
		if (open) {
			previouslyFocused = document.activeElement as HTMLElement | null;
			usernameInput = initialUsername;
			statuses = [...initialStatuses];
			includeSingleEp = initialIncludeSingleEp;
			tick().then(() => usernameInputEl?.focus());
		} else if (previouslyFocused) {
			previouslyFocused.focus();
			previouslyFocused = null;
		}
	});

	function handleWindowKeydown(e: KeyboardEvent) {
		if (!open) return;
		if (canDismiss && e.key === 'Escape') {
			onClose();
			return;
		}
		if (e.key === 'Tab' && cardEl) {
			const focusables = Array.from(
				cardEl.querySelectorAll<HTMLElement>(
					'button:not(:disabled), input:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])'
				)
			);
			if (focusables.length === 0) return;
			const first = focusables[0];
			const last = focusables[focusables.length - 1];
			if (e.shiftKey && document.activeElement === first) {
				e.preventDefault();
				last.focus();
			} else if (!e.shiftKey && document.activeElement === last) {
				e.preventDefault();
				first.focus();
			}
		}
	}

	const statusOptions: Array<{ id: ListStatus; label: string }> = [
		{ id: 'COMPLETED', label: 'Completed' },
		{ id: 'CURRENT', label: 'Watching (spoiler-safe)' },
		{ id: 'REPEATING', label: 'Rewatching' },
		{ id: 'PAUSED', label: 'Paused' },
		{ id: 'DROPPED', label: 'Dropped' }
	];

	function toggleStatus(status: ListStatus) {
		if (statuses.includes(status)) {
			if (statuses.length > 1) {
				statuses = statuses.filter((s) => s !== status);
			}
		} else {
			statuses = [...statuses, status];
		}
	}

	function submitUser() {
		const clean = usernameInput.trim();
		if (!clean || loading) return;
		onLoadUser(clean, statuses, includeSingleEp);
	}
</script>

<svelte:window onkeydown={handleWindowKeydown} />

{#if open}
	<div
		class="modal-backdrop"
		role="dialog"
		aria-modal="true"
		aria-labelledby="setup-modal-title"
		tabindex="-1"
		onclick={() => canDismiss && onClose()}
		onkeydown={(e) => canDismiss && e.key === 'Escape' && onClose()}
	>
		<div
			bind:this={cardEl}
			class="modal-card"
			onclick={(e) => e.stopPropagation()}
			role="presentation"
		>
			<div class="modal-head">
				<div>
					<h2 id="setup-modal-title" class="modal-title">Load your AniList</h2>
					<p class="modal-sub">
						Frames are picked from shows you have watched. Ongoing shows are capped to your episode progress.
					</p>
				</div>
				{#if canDismiss}
					<button type="button" class="close-x" aria-label="Close" onclick={onClose}>
						<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 5l10 10M15 5 5 15" /></svg>
					</button>
				{/if}
			</div>

			<form
				class="setup-form"
				onsubmit={(e) => {
					e.preventDefault();
					submitUser();
				}}
			>
				<label class="field-label" for="anilist-username">AniList username</label>
				<div class="input-row">
					<input
						bind:this={usernameInputEl}
						id="anilist-username"
						type="text"
						class="user-input"
						placeholder="e.g. 4Lajf"
						autocomplete="username"
						disabled={loading}
						bind:value={usernameInput}
					/>
					<button type="submit" class="btn-load" disabled={loading || !usernameInput.trim()}>
						{loading ? 'Loading...' : 'Load list'}
					</button>
				</div>

				{#if recentUsers.length > 0}
					<div class="recent-row">
						<span class="recent-label">Recent:</span>
						{#each recentUsers as u (u)}
							<button
								type="button"
								class="recent-chip"
								disabled={loading}
								onclick={() => {
									usernameInput = u;
									onLoadUser(u, statuses, includeSingleEp);
								}}
							>
								{u}
							</button>
						{/each}
					</div>
				{/if}

				<div class="filter-block">
					<span class="field-label">Include list sections</span>
					<div class="status-grid">
						{#each statusOptions as opt (opt.id)}
							<button
								type="button"
								class="status-toggle"
								class:selected={statuses.includes(opt.id)}
								aria-pressed={statuses.includes(opt.id)}
								onclick={() => toggleStatus(opt.id)}
							>
								{opt.label}
							</button>
						{/each}
					</div>

					<label class="checkbox-row">
						<input type="checkbox" bind:checked={includeSingleEp} />
						<span>Include single-episode movies and OVAs</span>
					</label>
				</div>

				{#if error}
					<div class="error-box" role="alert">{error}</div>
				{/if}
			</form>

			<div class="modal-divider">
				<span>or play right away</span>
			</div>

			<button type="button" class="btn-global" disabled={loading} onclick={onUseGlobal}>
				Play with curated Global Pool ({CURATED_GLOBAL_POOL.length} iconic anime)
			</button>
		</div>
	</div>
{/if}

<style>
	.modal-backdrop {
		position: fixed;
		inset: 0;
		z-index: 50;
		background: rgba(12, 14, 29, 0.82);
		backdrop-filter: blur(6px);
		display: grid;
		place-items: center;
		padding: 16px;
	}

	.modal-card {
		width: min(100%, 480px);
		background: var(--ink);
		border: 1.5px solid var(--line);
		border-radius: 12px;
		padding: 24px;
		display: flex;
		flex-direction: column;
		gap: 18px;
		box-shadow: 0 24px 60px rgba(8, 10, 22, 0.72);
	}

	.modal-head {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 12px;
	}

	.modal-title {
		margin: 0;
		font-size: 24px;
		font-weight: 750;
		line-height: 1.15;
		letter-spacing: -0.01em;
		color: var(--paper);
	}

	.modal-sub {
		margin: 6px 0 0;
		font-size: 14px;
		color: var(--text-2);
	}

	.close-x {
		border: 0;
		background: none;
		color: var(--text-2);
		width: 34px;
		height: 34px;
		border-radius: var(--r);
		display: grid;
		place-items: center;
		flex: none;
		transition: background-color 120ms ease, color 120ms ease;
	}

	.close-x svg {
		width: 18px;
		height: 18px;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.75;
		stroke-linecap: round;
	}

	.close-x:hover {
		background: var(--ink-raised);
		color: var(--paper);
	}

	.setup-form {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}

	.field-label {
		font-size: 14px;
		font-weight: 600;
		color: var(--text-2);
	}

	.input-row {
		display: grid;
		grid-template-columns: 1fr auto;
		gap: 8px;
	}

	.user-input {
		height: 46px;
		background: var(--ink-deep);
		border: 1.5px solid var(--line-strong);
		border-radius: var(--r);
		color: var(--paper);
		padding: 0 13px;
		font-size: 15.5px;
		outline: none;
		transition: border-color 120ms ease;
	}

	.user-input::placeholder {
		color: var(--text-3);
	}

	.user-input:focus {
		border-color: var(--blue);
	}

	.btn-load {
		height: 46px;
		padding: 0 18px;
		background: var(--paper);
		color: var(--ink-deep);
		border: 0;
		border-radius: var(--r);
		font-size: 15px;
		font-weight: 750;
		transition: background-color 120ms ease;
	}

	.btn-load:hover:not(:disabled) {
		background: var(--paper-hover);
	}

	.btn-load:disabled {
		background: var(--ink-raised);
		color: var(--text-3);
		box-shadow: inset 0 0 0 1px var(--line);
		cursor: not-allowed;
	}

	.recent-row {
		display: flex;
		align-items: center;
		gap: 6px;
		flex-wrap: wrap;
	}

	.recent-label {
		font-size: 13px;
		color: var(--text-3);
	}

	.recent-chip {
		background: var(--ink-deep);
		border: 1px solid var(--line);
		border-radius: 999px;
		color: var(--text-2);
		font-size: 13px;
		padding: 3px 11px;
		transition: border-color 120ms ease, color 120ms ease;
	}

	.recent-chip:hover {
		border-color: var(--blue);
		color: var(--paper);
	}

	.filter-block {
		display: flex;
		flex-direction: column;
		gap: 8px;
		margin-top: 4px;
	}

	.status-grid {
		display: flex;
		flex-wrap: wrap;
		gap: 7px;
	}

	.status-toggle {
		background: var(--ink-deep);
		border: 1px solid var(--line);
		border-radius: 7px;
		color: var(--text-2);
		font-size: 13.5px;
		padding: 6px 11px;
		transition: background-color 120ms ease, border-color 120ms ease, color 120ms ease;
	}

	.status-toggle.selected {
		background: var(--blue-soft);
		border-color: var(--blue);
		color: var(--paper);
		font-weight: 650;
	}

	.checkbox-row {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 13.5px;
		color: var(--text-2);
		margin-top: 4px;
		cursor: pointer;
	}

	.checkbox-row input {
		accent-color: var(--blue);
		width: 15px;
		height: 15px;
	}

	.error-box {
		background: var(--danger-soft);
		border: 1px solid rgba(240, 138, 150, 0.45);
		color: #ffd5da;
		border-radius: var(--r);
		padding: 10px 12px;
		font-size: 13.5px;
	}

	.modal-divider {
		display: flex;
		align-items: center;
		gap: 10px;
		color: var(--text-3);
		font-size: 13px;
	}

	.modal-divider::before,
	.modal-divider::after {
		content: '';
		flex: 1;
		height: 1px;
		background: var(--line);
	}

	.btn-global {
		height: 46px;
		background: none;
		border: 1.5px solid var(--line-strong);
		border-radius: var(--r);
		color: var(--paper);
		font-size: 14.5px;
		font-weight: 650;
		transition: border-color 120ms ease, background-color 120ms ease;
	}

	.btn-global:hover:not(:disabled) {
		border-color: var(--paper);
		background: var(--ink-raised);
	}
</style>
