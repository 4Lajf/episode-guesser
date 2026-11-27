<script lang="ts">
	import type { VndbUserProfile, VnPoolSize } from '$lib/types';

	interface Props {
		open: boolean;
		profile: VndbUserProfile;
		loading: boolean;
		error: string | null;
		recentUsers: string[];
		savedToken: string;
		onClose: () => void;
		onSelectGlobal: (size: VnPoolSize) => void;
		onConnectVndb: (username: string, labelIds: number[], token: string) => void;
	}

	let {
		open,
		profile,
		loading,
		error,
		recentUsers,
		savedToken,
		onClose,
		onSelectGlobal,
		onConnectVndb
	}: Props = $props();

	const LABELS = [
		{ id: 2, label: 'Finished' },
		{ id: 1, label: 'Playing' },
		{ id: 3, label: 'Stalled' },
		{ id: 4, label: 'Dropped' },
		{ id: 7, label: 'Voted' }
	];

	let usernameInput = $state('');
	let selectedLabels = $state<number[]>([2, 1]);
	let tokenInput = $state('');
	let showToken = $state(false);

	$effect(() => {
		if (open) {
			usernameInput = profile.isGlobalPool ? '' : profile.username;
			selectedLabels = profile.labelIds?.length ? [...profile.labelIds] : [2, 1];
			tokenInput = savedToken || '';
		}
	});

	function toggleLabel(id: number) {
		if (selectedLabels.includes(id)) {
			if (selectedLabels.length === 1) return;
			selectedLabels = selectedLabels.filter((x) => x !== id);
		} else {
			selectedLabels = [...selectedLabels, id];
		}
	}

	function handleSubmit(e: SubmitEvent) {
		e.preventDefault();
		onConnectVndb(usernameInput.trim(), selectedLabels, tokenInput.trim());
	}
</script>

{#if open}
	<div
		class="backdrop"
		role="dialog"
		aria-modal="true"
		aria-label="Visual novel pool and VNDB account settings"
	>
		<button type="button" class="backdrop-hit" aria-label="Close modal" onclick={onClose}></button>
		<div class="modal">
			<div class="m-head">
				<h3>VN UI Pool &amp; VNDB</h3>
				<button type="button" class="close-btn" aria-label="Close" onclick={onClose}>×</button>
			</div>

			<p class="m-note">
				Daily VN UI always uses the shared Global Pool so leaderboards stay fair. Practice and
				Survival use whichever pool or VNDB account you pick below.
			</p>

			<div class="section">
				<span class="sec-label">Global Pool</span>
				<div class="global-row">
					<button
						type="button"
						class="pool-btn"
						class:active={profile.isGlobalPool && (profile.poolSize ?? 1000) === 1000}
						disabled={loading}
						onclick={() => onSelectGlobal(1000)}
					>
						<b>Global Top 1,000</b>
						<span>Most-voted VNs on VNDB</span>
					</button>
					<button
						type="button"
						class="pool-btn"
						class:active={profile.isGlobalPool && profile.poolSize === 250}
						disabled={loading}
						onclick={() => onSelectGlobal(250)}
					>
						<b>Global Top 250</b>
						<span>Well-known classics &amp; hits</span>
					</button>
				</div>
			</div>

			<form class="section" onsubmit={handleSubmit}>
				<span class="sec-label">Connect Your VNDB List</span>
				<label class="field">
					<span>VNDB username or user ID</span>
					<input
						type="text"
						placeholder="e.g. yorhel or u2"
						bind:value={usernameInput}
						disabled={loading}
						autocomplete="off"
						spellcheck="false"
					/>
				</label>

				{#if recentUsers.length > 0}
					<div class="recent-row">
						<span class="recent-lbl">Recent:</span>
						{#each recentUsers as u (u)}
							<button
								type="button"
								class="recent-chip"
								onclick={() => {
									usernameInput = u;
									onConnectVndb(u, selectedLabels, tokenInput.trim());
								}}
							>
								{u}
							</button>
						{/each}
					</div>
				{/if}

				<div class="labels-wrap">
					<span class="sub-lbl">Include VNDB list labels</span>
					<div class="label-chips">
						{#each LABELS as item (item.id)}
							<button
								type="button"
								class="l-chip"
								class:on={selectedLabels.includes(item.id)}
								onclick={() => toggleLabel(item.id)}
							>
								{item.label}
							</button>
						{/each}
					</div>
				</div>

				<div class="token-toggle">
					<button type="button" class="link-btn" onclick={() => (showToken = !showToken)}>
						{showToken ? 'Hide private list token' : 'Have a private VNDB list? Add read-only token'}
					</button>
				</div>

				{#if showToken}
					<label class="field">
						<span>VNDB API token (<code>listread</code> scope, from vndb.org/u/tokens)</span>
						<input
							type="password"
							placeholder="xxxx-xxxxx-xxxxx-xxxxx-xxxxx-xxxxx-xxxx"
							bind:value={tokenInput}
							disabled={loading}
							autocomplete="off"
						/>
					</label>
				{/if}

				{#if error}
					<p class="m-err" role="alert">{error}</p>
				{/if}

				<button
					type="submit"
					class="connect-btn"
					disabled={loading || (!usernameInput.trim() && !tokenInput.trim())}
				>
					{loading ? 'Loading VNDB list...' : 'Load my VNDB list'}
				</button>
			</form>
		</div>
	</div>
{/if}

<style>
	.backdrop {
		position: fixed;
		inset: 0;
		z-index: 60;
		display: grid;
		place-items: center;
		padding: 16px;
		background: rgba(10, 12, 26, 0.78);
		backdrop-filter: blur(4px);
	}

	.backdrop-hit {
		position: fixed;
		inset: 0;
		border: 0;
		background: none;
		padding: 0;
	}

	.modal {
		position: relative;
		z-index: 1;
		width: 100%;
		max-width: 480px;
		max-height: 90vh;
		overflow-y: auto;
		background: var(--ink-deep);
		border: 1px solid var(--line-strong);
		border-radius: var(--r);
		padding: 20px;
		display: flex;
		flex-direction: column;
		gap: 16px;
		box-shadow: 0 24px 64px rgba(0, 0, 0, 0.55);
	}

	.m-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}

	.m-head h3 {
		margin: 0;
		font-size: 19px;
		font-weight: 750;
		color: var(--paper);
	}

	.close-btn {
		border: 0;
		background: none;
		color: var(--text-2);
		font-size: 24px;
		line-height: 1;
		padding: 2px 8px;
		border-radius: var(--r-sm);
	}

	.close-btn:hover {
		color: var(--paper);
		background: var(--ink-raised);
	}

	.m-note {
		margin: 0;
		font-size: 13.5px;
		line-height: 1.45;
		color: var(--text-2);
	}

	.section {
		display: flex;
		flex-direction: column;
		gap: 10px;
		padding-top: 12px;
		border-top: 1px solid var(--line-soft);
	}

	.sec-label {
		font-size: 12px;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--text-3);
	}

	.global-row {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 8px;
	}

	.pool-btn {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 3px;
		padding: 10px 12px;
		border-radius: var(--r-sm);
		border: 1.5px solid var(--line);
		background: var(--ink-raised);
		color: var(--paper);
		text-align: left;
		transition: border-color 120ms ease;
	}

	.pool-btn:hover {
		border-color: var(--paper);
	}

	.pool-btn.active {
		border-color: var(--blue);
		background: var(--blue-soft);
	}

	.pool-btn b {
		font-size: 14px;
		font-weight: 700;
	}

	.pool-btn span {
		font-size: 12px;
		color: var(--text-2);
	}

	.field {
		display: flex;
		flex-direction: column;
		gap: 5px;
		font-size: 13px;
		color: var(--text-2);
	}

	.field input {
		height: 42px;
		padding: 0 12px;
		border-radius: var(--r-sm);
		border: 1.5px solid var(--line-strong);
		background: var(--ink-raised);
		color: var(--paper);
		font-size: 14.5px;
		outline: none;
	}

	.field input:focus {
		border-color: var(--blue);
	}

	.recent-row {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 6px;
	}

	.recent-lbl {
		font-size: 12px;
		color: var(--text-3);
	}

	.recent-chip {
		border: 1px solid var(--line);
		background: var(--ink-raised);
		color: var(--paper);
		padding: 3px 9px;
		border-radius: var(--r-sm);
		font-size: 12.5px;
	}

	.recent-chip:hover {
		border-color: var(--blue);
	}

	.labels-wrap {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.sub-lbl {
		font-size: 12.5px;
		color: var(--text-2);
	}

	.label-chips {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}

	.l-chip {
		border: 1px solid var(--line);
		background: var(--ink-raised);
		color: var(--text-2);
		padding: 5px 11px;
		border-radius: var(--r-sm);
		font-size: 13px;
		font-weight: 600;
	}

	.l-chip.on {
		background: var(--paper);
		color: var(--ink-deep);
		border-color: var(--paper);
	}

	.link-btn {
		border: 0;
		background: none;
		padding: 0;
		color: var(--blue);
		font-size: 12.5px;
		text-align: left;
	}

	.link-btn:hover {
		text-decoration: underline;
	}

	.m-err {
		margin: 0;
		font-size: 13px;
		color: var(--danger);
	}

	.connect-btn {
		height: 44px;
		border: 0;
		border-radius: var(--r);
		background: var(--paper);
		color: var(--ink-deep);
		font-size: 15px;
		font-weight: 750;
	}

	.connect-btn:hover:not(:disabled) {
		background: var(--paper-hover);
	}

	.connect-btn:disabled {
		opacity: 0.45;
		cursor: not-allowed;
	}
</style>
