<script lang="ts">
	import type { GameMode } from '$lib/types';

	interface Props {
		mode: GameMode;
		username: string;
		avatar: string | null;
		eligibleShows: number;
		isGlobalPool: boolean;
		wide?: boolean;
		onModeChange: (mode: GameMode) => void;
		onOpenSetup: () => void;
	}

	let {
		mode,
		username,
		avatar,
		eligibleShows,
		isGlobalPool,
		wide = false,
		onModeChange,
		onOpenSetup
	}: Props = $props();

	const initials = $derived(
		isGlobalPool
			? 'GL'
			: username
					.replace(/[^a-zA-Z0-9]/g, '')
					.slice(0, 2)
					.toUpperCase() || 'AL'
	);

	const modes: Array<{ id: GameMode; label: string }> = [
		{ id: 'classic', label: 'Classic' },
		{ id: 'unlimited', label: 'Unlimited' },
		{ id: 'daily', label: 'Daily Wordle' }
	];
</script>

<header class="topbar">
	<div class="topbar-inner" class:wide>
		<a
			class="brand"
			href="/"
			onclick={(e) => {
				e.preventDefault();
				onModeChange('classic');
			}}
		>
			<span class="peg-mark" aria-hidden="true">
				<span class="peg-slot"></span>
				<span class="peg-hole"></span>
				<span class="peg-slot"></span>
			</span>
			<span class="brand-name font-display">Episode Guesser</span>
		</a>

		<nav class="mode-switcher" aria-label="Game mode">
			{#each modes as item (item.id)}
				<button
					type="button"
					class="mode-btn"
					class:active={mode === item.id}
					aria-pressed={mode === item.id}
					onclick={() => onModeChange(item.id)}
				>
					{#if item.id === 'daily'}
						<span class="daily-dot" aria-hidden="true"></span>
					{/if}
					<span>{item.label}</span>
				</button>
			{/each}
		</nav>

		<button type="button" class="user-pill" onclick={onOpenSetup} title="Change AniList user or filters">
			{#if avatar}
				<img class="user-avatar-img" src={avatar} alt="" width="28" height="28" />
			{:else}
				<span class="user-avatar font-display" aria-hidden="true">{initials}</span>
			{/if}
			<span class="user-meta">
				<span class="user-name">{username}</span>
				<span class="user-sub tabular">{eligibleShows} shows</span>
			</span>
		</button>
	</div>
</header>

<style>
	.topbar {
		position: sticky;
		top: 0;
		z-index: 30;
		background: rgba(13, 19, 26, 0.92);
		backdrop-filter: blur(10px);
		border-bottom: 1px solid var(--rule);
	}

	.topbar-inner {
		max-width: 1120px;
		margin: 0 auto;
		padding: 0 24px;
		min-height: 64px;
		display: grid;
		grid-template-columns: 1fr auto 1fr;
		align-items: center;
		gap: 16px;
	}

	.topbar-inner.wide {
		max-width: 1320px;
	}

	.brand {
		display: inline-flex;
		align-items: center;
		gap: 10px;
		text-decoration: none;
		color: var(--text);
		justify-self: start;
	}

	.peg-mark {
		width: 30px;
		height: 22px;
		border-radius: 5px;
		background: var(--lamp);
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 3px;
		padding: 0 4px;
		flex-shrink: 0;
	}

	.peg-slot {
		width: 6px;
		height: 3.5px;
		border-radius: 999px;
		background: var(--lamp-ink);
	}

	.peg-hole {
		width: 4.5px;
		height: 4.5px;
		border-radius: 50%;
		background: var(--lamp-ink);
	}

	.brand-name {
		font-size: 20px;
		font-weight: 700;
		line-height: 1;
		color: var(--text);
	}

	.mode-switcher {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		background: var(--ink-1);
		border: 1px solid var(--rule);
		border-radius: 999px;
		padding: 4px;
		justify-self: center;
	}

	.mode-btn {
		border: 0;
		background: transparent;
		color: var(--text-2);
		font-size: 13.5px;
		font-weight: 500;
		padding: 6px 14px;
		border-radius: 999px;
		cursor: pointer;
		display: inline-flex;
		align-items: center;
		gap: 6px;
		white-space: nowrap;
		transition: background 120ms ease, color 120ms ease;
	}

	.mode-btn:hover {
		color: var(--text);
	}

	.mode-btn.active {
		background: var(--text);
		color: var(--ink-0);
		font-weight: 700;
	}

	.daily-dot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: var(--lamp);
		flex-shrink: 0;
	}

	.mode-btn.active .daily-dot {
		background: var(--ink-0);
	}

	.user-pill {
		justify-self: end;
		display: inline-flex;
		align-items: center;
		gap: 10px;
		background: var(--ink-1);
		border: 1px solid var(--rule);
		border-radius: 999px;
		padding: 5px 13px 5px 6px;
		color: var(--text);
		cursor: pointer;
		text-align: left;
		transition: border-color 120ms ease, background 120ms ease;
	}

	.user-pill:hover {
		border-color: var(--rule-strong);
		background: var(--ink-2);
	}

	.user-avatar,
	.user-avatar-img {
		width: 28px;
		height: 28px;
		border-radius: 50%;
		flex-shrink: 0;
	}

	.user-avatar {
		background: var(--ink-3);
		color: var(--lamp);
		font-size: 13px;
		font-weight: 700;
		display: grid;
		place-items: center;
	}

	.user-avatar-img {
		object-fit: cover;
		display: block;
	}

	.user-meta {
		display: flex;
		flex-direction: column;
		line-height: 1.15;
	}

	.user-name {
		font-size: 13px;
		font-weight: 700;
		max-width: 120px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.user-sub {
		font-size: 11.5px;
		color: var(--text-3);
	}

	@media (max-width: 760px) {
		.topbar-inner {
			grid-template-columns: 1fr auto;
			padding: 10px 14px;
			gap: 10px;
		}

		.brand {
			grid-row: 1;
			grid-column: 1;
		}

		.user-pill {
			grid-row: 1;
			grid-column: 2;
		}

		.mode-switcher {
			grid-row: 2;
			grid-column: 1 / -1;
			width: 100%;
			justify-self: stretch;
			display: grid;
			grid-template-columns: repeat(3, 1fr);
		}

		.mode-btn {
			justify-content: center;
			padding: 7px 8px;
			font-size: 13px;
		}
	}
</style>
