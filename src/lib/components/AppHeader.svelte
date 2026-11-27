<script lang="ts">
	import type { AuthUser, NavTab } from '$lib/types';

	interface Props {
		activeTab: NavTab;
		username: string;
		avatar: string | null;
		eligibleShows: number;
		isGlobalPool: boolean;
		authUser?: AuthUser | null;
		authConfigured?: boolean;
		dailyUnplayed?: boolean;
		onTabChange: (tab: NavTab) => void;
		onOpenSetup: () => void;
	}

	let {
		activeTab,
		username,
		avatar,
		eligibleShows,
		isGlobalPool,
		authUser = null,
		authConfigured = false,
		dailyUnplayed = true,
		onTabChange,
		onOpenSetup
	}: Props = $props();

	const displayAvatar = $derived(authUser?.avatar ?? avatar);
	const displayName = $derived(authUser ? authUser.username : username);
	const displayMeta = $derived(
		authUser && isGlobalPool
			? `${username}`
			: `${eligibleShows.toLocaleString('en-US')} shows`
	);

	const initials = $derived(
		authUser
			? authUser.username
					.replace(/[^a-zA-Z0-9]/g, '')
					.slice(0, 1)
					.toUpperCase() || 'A'
			: isGlobalPool
				? 'GL'
				: username
						.replace(/[^a-zA-Z0-9]/g, '')
						.slice(0, 1)
						.toUpperCase() || 'A'
	);

	const modes: Array<{ id: NavTab; label: string }> = [
		{ id: 'daily', label: 'Daily frame' },
		{ id: 'archive', label: 'Archive' },
		{ id: 'classic', label: 'Classic' },
		{ id: 'unlimited', label: 'Unlimited' }
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
					onTabChange('daily');
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
						aria-current={activeTab === item.id ? 'page' : undefined}
						onclick={() => onTabChange(item.id)}
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

		<div class="top-right">
			{#if !authUser && authConfigured}
				<a class="login-pill" href="/api/auth/anilist/login?returnTo=/">
					Log in with AniList
				</a>
			{/if}

			<button
				type="button"
				class="player"
				onclick={onOpenSetup}
				aria-label="{authUser
					? `Signed in as ${authUser.username}`
					: isGlobalPool
						? `${username}, ${eligibleShows} shows`
						: `AniList list ${username}, ${eligibleShows} shows`}. Open pool and account settings"
			>
				<span class="avatar-wrap">
					{#if displayAvatar}
						<img class="avatar-img" src={displayAvatar} alt="" width="32" height="32" />
					{:else}
						<span class="avatar" aria-hidden="true">{initials}</span>
					{/if}
					{#if authUser}
						<span class="auth-badge" aria-hidden="true" title="Signed in with AniList"></span>
					{/if}
				</span>
				<span class="player-text">
					<span class="player-name">{displayName}</span>
					<span class="player-meta tnum">{displayMeta}</span>
				</span>
				<svg class="chev" viewBox="0 0 20 20" aria-hidden="true">
					<path d="M6 8l4 4 4-4" />
				</svg>
			</button>
		</div>
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

	.top-right {
		justify-self: end;
		display: inline-flex;
		align-items: center;
		gap: 8px;
	}

	.login-pill {
		display: inline-flex;
		align-items: center;
		height: 34px;
		padding: 0 12px;
		border-radius: var(--r-sm);
		background: var(--paper);
		color: var(--ink-deep);
		font-size: 13px;
		font-weight: 750;
		text-decoration: none;
		white-space: nowrap;
		transition: background-color 120ms ease;
	}

	.login-pill:hover {
		background: var(--paper-hover);
	}

	.player {
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

	.avatar-wrap {
		position: relative;
		width: 32px;
		height: 32px;
		flex: none;
	}

	.auth-badge {
		position: absolute;
		right: -1px;
		bottom: -1px;
		width: 10px;
		height: 10px;
		border-radius: 50%;
		background: var(--green);
		box-shadow: 0 0 0 2px var(--ink-deep);
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

		.top-right {
			grid-area: player;
		}

		.login-pill {
			display: none;
		}

		.modes {
			grid-area: modes;
			display: grid;
			grid-template-columns: repeat(4, minmax(0, 1fr));
			height: 42px;
		}

		.mode-tab {
			justify-content: center;
			padding: 0 4px;
			font-size: 14px;
		}
	}
</style>
