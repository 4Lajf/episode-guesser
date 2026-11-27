<script lang="ts">
	import { tick } from 'svelte';
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

	$effect(() => {
		if (open) {
			usernameInput = initialUsername;
			statuses = [...initialStatuses];
			includeSingleEp = initialIncludeSingleEp;
			tick().then(() => usernameInputEl?.focus());
		}
	});

	function handleWindowKeydown(e: KeyboardEvent) {
		if (open && canDismiss && e.key === 'Escape') {
			onClose();
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
		<div class="modal-card" onclick={(e) => e.stopPropagation()} role="presentation">
			<div class="modal-head">
				<div>
					<h2 id="setup-modal-title" class="modal-title font-display">Load your AniList</h2>
					<p class="modal-sub">
						Frames are picked from shows you have watched. Ongoing shows are capped to your episode progress.
					</p>
				</div>
				{#if canDismiss}
					<button type="button" class="close-x" aria-label="Close" onclick={onClose}>×</button>
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
				Play with curated Global Pool (32 iconic anime)
			</button>
		</div>
	</div>
{/if}

<style>
	.modal-backdrop {
		position: fixed;
		inset: 0;
		z-index: 50;
		background: rgba(7, 10, 15, 0.8);
		backdrop-filter: blur(6px);
		display: grid;
		place-items: center;
		padding: 16px;
	}

	.modal-card {
		width: min(100%, 480px);
		background: var(--ink-1);
		border: 1px solid var(--rule-strong);
		border-radius: var(--radius-lg);
		padding: 22px;
		display: flex;
		flex-direction: column;
		gap: 16px;
	}

	.modal-head {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 12px;
	}

	.modal-title {
		margin: 0;
		font-size: 26px;
		line-height: 1.1;
		color: var(--text);
	}

	.modal-sub {
		margin: 6px 0 0;
		font-size: 13.5px;
		color: var(--text-2);
	}

	.close-x {
		border: 0;
		background: var(--ink-2);
		color: var(--text-2);
		width: 32px;
		height: 32px;
		border-radius: 8px;
		font-size: 20px;
		cursor: pointer;
		flex-shrink: 0;
	}

	.close-x:hover {
		background: var(--ink-3);
		color: var(--text);
	}

	.setup-form {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}

	.field-label {
		font-size: 13.5px;
		font-weight: 700;
		color: var(--text);
	}

	.input-row {
		display: grid;
		grid-template-columns: 1fr auto;
		gap: 8px;
	}

	.user-input {
		height: 44px;
		background: var(--ink-2);
		border: 1.5px solid var(--rule-strong);
		border-radius: var(--radius-md);
		color: var(--text);
		padding: 0 13px;
		font-size: 15px;
		outline: none;
	}

	.user-input:focus {
		border-color: var(--lamp);
		box-shadow: 0 0 0 3px var(--lamp-soft);
	}

	.btn-load {
		height: 44px;
		padding: 0 18px;
		background: var(--lamp);
		color: var(--lamp-ink);
		border: 0;
		border-radius: var(--radius-md);
		font-size: 14px;
		font-weight: 700;
		cursor: pointer;
	}

	.btn-load:hover:not(:disabled) {
		background: var(--lamp-hover);
	}

	.btn-load:disabled {
		opacity: 0.45;
		cursor: not-allowed;
	}

	.recent-row {
		display: flex;
		align-items: center;
		gap: 6px;
		flex-wrap: wrap;
	}

	.recent-label {
		font-size: 12.5px;
		color: var(--text-3);
	}

	.recent-chip {
		background: var(--ink-2);
		border: 1px solid var(--rule);
		border-radius: 999px;
		color: var(--text-2);
		font-size: 12.5px;
		padding: 3px 10px;
		cursor: pointer;
	}

	.recent-chip:hover {
		border-color: var(--lamp);
		color: var(--text);
	}

	.filter-block {
		display: flex;
		flex-direction: column;
		gap: 8px;
		margin-top: 2px;
	}

	.status-grid {
		display: flex;
		flex-wrap: wrap;
		gap: 7px;
	}

	.status-toggle {
		background: var(--ink-2);
		border: 1px solid var(--rule);
		border-radius: 7px;
		color: var(--text-2);
		font-size: 13px;
		padding: 6px 11px;
		cursor: pointer;
	}

	.status-toggle.selected {
		background: var(--lamp-soft);
		border-color: rgba(244, 199, 82, 0.55);
		color: var(--lamp);
		font-weight: 700;
	}

	.checkbox-row {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 13px;
		color: var(--text-2);
		margin-top: 4px;
		cursor: pointer;
	}

	.checkbox-row input {
		accent-color: var(--lamp);
		width: 15px;
		height: 15px;
	}

	.error-box {
		background: var(--danger-soft);
		border: 1px solid rgba(228, 108, 124, 0.45);
		color: #f8c2c9;
		border-radius: 8px;
		padding: 10px 12px;
		font-size: 13.5px;
	}

	.modal-divider {
		display: flex;
		align-items: center;
		gap: 10px;
		color: var(--text-3);
		font-size: 12.5px;
	}

	.modal-divider::before,
	.modal-divider::after {
		content: '';
		flex: 1;
		height: 1px;
		background: var(--rule);
	}

	.btn-global {
		height: 42px;
		background: var(--ink-2);
		border: 1px solid var(--rule-strong);
		border-radius: var(--radius-md);
		color: var(--text);
		font-size: 13.5px;
		font-weight: 500;
		cursor: pointer;
	}

	.btn-global:hover:not(:disabled) {
		background: var(--ink-3);
	}
</style>
