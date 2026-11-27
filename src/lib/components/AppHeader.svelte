<script lang="ts">
	import type { GameMode } from '$lib/types';

	interface Props {
		mode: GameMode;
		username: string;
		avatar: string | null;
		eligibleShows: number;
		isGlobalPool: boolean;
		dailyUnplayed?: boolean;
		onModeChange: (mode: GameMode) => void;
		onOpenSetup: () => void;
	}

	let {
		mode,
		username,
		avatar,
		eligibleShows,
		isGlobalPool,
		dailyUnplayed = true,
		onModeChange,
		onOpenSetup
	}: Props = $props();

	const initials = $derived(
		isGlobalPool
			? 'GL'
			: username
					.replace(/[^a-zA-Z0-9]/g, '')
					.slice(0, 1)
					.toUpperCase() || 'A'
	);

	const modes: Array<{ id: GameMode; label: string }> = [
		{ id: 'classic', label: 'Classic' },
		{ id: 'unlimited', label: 'Unlimited' },
		{ id: 'daily', label: 'Daily frame' }
	];
</script>

<header class="top">
	<div class="shell cols top-cols">
		<div class="top-left">
			<a
				class="brand"
				href="/"
				onclick={(e) => {
					e.preventDefault();
					onModeChange('classic');
				}}
			>
				<svg class="brand-mark" viewBox="0 0 28 20" aria-hidden="true">
					<rect
						x="1"
						y="1"
						width="26"
						height="18"
						rx="3"
						fill="none"
						stroke="#F3EFE4"
						stroke-width="1.75"
					/>
					<rect x="8" y="6" width="12" height="8" rx="1.5" fill="#8FB4FF" />
				</svg>
				<span>Episode Guesser</span>
			</a>

			<nav class="modes" aria-label="Game mode">
				{#each modes as item (item.id)}
					<button
						type="button"
						class="mode-tab"
						aria-current={mode === item.id ? 'page' : undefined}
						onclick={() => onModeChange(item.id)}
					>
						{#if item.id === 'daily' && dailyUnplayed}
							<span class="daily-dot" aria-hidden="true"></span>
						{/if}
						<span>{item.label}</span>
						{#if item.id === 'daily' && dailyUnplayed}
							<span class="sr-only"> (unplayed today)</span>
						{/if}
					</button>
				{/each}
			</nav>
		</div>

		<button
			type="button"
			class="player"
			onclick={onOpenSetup}
			aria-label="{isGlobalPool
				? `Curated Global Pool, ${eligibleShows} shows`
				: `AniList account ${username}, ${eligibleShows} shows`}. Change account or list filters"
		>
			{#if avatar}
				<img class="avatar-img" src={avatar} alt="" width="32" height="32" />
			{:else}
				<span class="avatar" aria-hidden="true">{initials}</span>
			{/if}
			<span class="player-text">
				<span class="player-name">{username}</span>
				<span class="player-meta tnum">{eligibleShows} shows</span>
			</span>
			<svg class="chev" viewBox="0 0 20 20" aria-hidden="true">
				<path d="M6 8l4 4 4-4" />
			</svg>
		</button>
	</div>
</header>

<style>
	.top {
		background: var(--ink-deep);
		border-bottom: 1px solid var(--line-soft);
	}

	.top-cols {
		height: 60px;
		align-items: center;
		row-gap: 0;
	}

	.top-left {
		display: flex;
		align-items: center;
		gap: 32px;
		height: 100%;
		min-width: 0;
	}

	.brand {
		display: inline-flex;
		align-items: center;
		gap: 10px;
		font-size: 18px;
		font-weight: 750;
		letter-spacing: -0.01em;
		text-decoration: none;
		color: var(--paper);
		white-space: nowrap;
	}

	.brand-mark {
		width: 28px;
		height: 20px;
		flex: none;
	}

	.modes {
		display: flex;
		height: 100%;
	}

	.mode-tab {
		display: inline-flex;
		align-items: center;
		gap: 7px;
		padding: 0 14px;
		border: 0;
		border-block: 2px solid transparent;
		background: none;
		color: var(--text-2);
		font-size: 15px;
		font-weight: 500;
		white-space: nowrap;
		transition: color 120ms ease, border-color 120ms ease;
	}

	.mode-tab:hover {
		color: var(--paper);
	}

	.mode-tab[aria-current='page'] {
		color: var(--paper);
		font-weight: 650;
		border-bottom-color: var(--blue);
	}

	.daily-dot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: var(--yellow);
		flex: none;
	}

	.player {
		justify-self: end;
		display: inline-flex;
		align-items: center;
		gap: 10px;
		padding: 5px 8px 5px 5px;
		border: 0;
		border-radius: var(--r);
		background: none;
		text-align: left;
		transition: background-color 120ms ease;
	}

	.player:hover {
		background: var(--ink-raised);
	}

	.avatar,
	.avatar-img {
		width: 32px;
		height: 32px;
		border-radius: 50%;
		flex: none;
	}

	.avatar {
		display: grid;
		place-items: center;
		background: var(--ink-raised);
		color: var(--paper);
		font-weight: 700;
		font-size: 14px;
	}

	.avatar-img {
		object-fit: cover;
	}

	.player-text {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}

	.player-name {
		display: block;
		font-weight: 650;
		font-size: 14px;
		line-height: 1.2;
		color: var(--paper);
		max-width: 140px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.player-meta {
		display: block;
		font-size: 12.5px;
		line-height: 1.3;
		color: var(--text-2);
	}

	.chev {
		width: 16px;
		height: 16px;
		flex: none;
		fill: none;
		stroke: var(--text-3);
		stroke-width: 1.75;
		stroke-linecap: round;
		stroke-linejoin: round;
	}

	@media (max-width: 960px) {
		.top-cols {
			grid-template-columns: minmax(0, 1fr) auto;
			grid-template-areas:
				'brand player'
				'modes modes';
			height: auto;
			column-gap: 12px;
			row-gap: 4px;
			padding-top: 8px;
		}

		.top-left {
			display: contents;
		}

		.brand {
			grid-area: brand;
		}

		.player {
			grid-area: player;
		}

		.modes {
			grid-area: modes;
			display: grid;
			grid-template-columns: repeat(3, minmax(0, 1fr));
			height: 42px;
		}

		.mode-tab {
			justify-content: center;
			padding: 0 4px;
			font-size: 14px;
		}
	}
</style>
