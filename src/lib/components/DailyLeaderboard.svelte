<script lang="ts">
	import { WORDLE_MAX_ATTEMPTS, WORDLE_ZOOM_STEPS } from '$lib/scoring';
	import type { AuthUser, DailyLeaderboardEntry, DailyLeaderboardPayload } from '$lib/types';

	interface Props {
		leaderboard: DailyLeaderboardPayload | null;
		loading: boolean;
		authUser: AuthUser | null;
		dailyFinished: boolean;
		dailyWon: boolean;
		dailyAttemptsCount: number;
		puzzleDate?: string;
		isArchive?: boolean;
		onRefresh: () => void;
	}

	let {
		leaderboard,
		loading,
		authUser,
		dailyFinished,
		dailyWon,
		dailyAttemptsCount,
		puzzleDate = '',
		isArchive = false,
		onRefresh
	}: Props = $props();

	const loginReturnUrl = $derived(
		isArchive && puzzleDate ? `/?date=${encodeURIComponent(puzzleDate)}` : '/'
	);

	function formatNiceDate(iso: string): string {
		if (!iso) return '';
		const d = new Date(`${iso}T00:00:00Z`);
		if (Number.isNaN(d.getTime())) return iso;
		return d.toLocaleDateString('en-GB', {
			day: 'numeric',
			month: 'short',
			year: 'numeric',
			timeZone: 'UTC'
		});
	}

	function formatOutcome(entry: DailyLeaderboardEntry): string {
		if (entry.won) {
			const idx = Math.min(Math.max(0, entry.attemptsUsed - 1), WORDLE_ZOOM_STEPS.length - 1);
			return `${entry.attemptsUsed}/${WORDLE_MAX_ATTEMPTS} · ${WORDLE_ZOOM_STEPS[idx].toFixed(1)}×`;
		}
		if (entry.gaveUp) return 'Gave up';
		if (entry.animeHitAttempt) return `Anime #${entry.animeHitAttempt}`;
		return `X/${WORDLE_MAX_ATTEMPTS}`;
	}

	const authConfigured = $derived(leaderboard?.authConfigured ?? true);
</script>

<section class="lb" aria-label="Global Daily Leaderboard">
	<div class="lb-head">
		<div>
			<h2 class="lb-title">
				Global Daily Leaderboard
				{#if leaderboard}
					<span class="lb-num tnum">#{leaderboard.puzzleNumber}</span>
				{/if}
				{#if isArchive && puzzleDate}
					<span class="lb-date">{formatNiceDate(puzzleDate)}</span>
				{/if}
			</h2>
			<p class="lb-sub">
				{#if leaderboard && leaderboard.totalPlayers > 0}
					{leaderboard.totalPlayers} {leaderboard.totalPlayers === 1 ? 'player' : 'players'} · {leaderboard.solvedCount} solved · Ranked by Daily points (ties go to first)
				{:else}
					Ranked by Daily points (ties go to first)
				{/if}
			</p>
		</div>

		<button
			type="button"
			class="lb-refresh"
			disabled={loading}
			onclick={onRefresh}
			aria-label="Refresh leaderboard"
		>
			{loading ? 'Refreshing...' : 'Refresh'}
		</button>
	</div>

	{#if !authUser}
		<div class="lb-cta" class:urgent={dailyFinished}>
			<div class="lb-cta-copy">
				{#if dailyFinished}
					<b>
						{dailyWon
							? `You solved today’s frame in ${dailyAttemptsCount}/${WORDLE_MAX_ATTEMPTS}!`
							: 'Claim your Daily leaderboard spot!'}
					</b>
					<span>Log in with AniList to post this result directly onto the Global Leaderboard.</span>
				{:else}
					<b>Compete on the Global Daily Leaderboard</b>
					<span>Log in with AniList to rank your Daily solves against other anime fans worldwide.</span>
				{/if}
			</div>

			{#if authConfigured}
				<a class="lb-login-btn" href="/api/auth/anilist/login?returnTo={encodeURIComponent(loginReturnUrl)}">
					Log in with AniList
				</a>
			{:else}
				<span class="lb-config-note">AniList OAuth pending server keys</span>
			{/if}
		</div>
	{:else if leaderboard?.me}
		<div class="lb-me-banner">
			<span>
				Rank <b class="tnum">#{leaderboard.me.rank}</b> of <span class="tnum">{leaderboard.totalPlayers}</span> as <b>{authUser.username}</b>
			</span>
			<span class="lb-me-stat tnum">
				{leaderboard.me.entry.points.toLocaleString('en-US')} pts · {formatOutcome(leaderboard.me.entry)}
			</span>
		</div>
	{/if}

	{#if leaderboard && leaderboard.entries.length > 0}
		<ol class="lb-list">
			{#each leaderboard.entries as entry, idx (entry.anilistUserId)}
				{@const rank = idx + 1}
				{@const isMe = authUser?.anilistUserId === entry.anilistUserId}
				<li class="lb-row" class:me={isMe}>
					<span
						class="lb-rank tnum"
						class:gold={rank === 1}
						class:silver={rank === 2}
						class:bronze={rank === 3}
					>
						#{rank}
					</span>

					<a
						class="lb-user"
						href={entry.siteUrl}
						target="_blank"
						rel="noopener noreferrer"
					>
						{#if entry.avatar}
							<img class="lb-avatar" src={entry.avatar} alt="" width="28" height="28" />
						{:else}
							<span class="lb-avatar fallback" aria-hidden="true">
								{entry.username.slice(0, 1).toUpperCase()}
							</span>
						{/if}
						<span class="lb-name">{entry.username}</span>
						{#if isMe}
							<span class="me-tag">You</span>
						{/if}
					</a>

					<div class="lb-tiles" aria-hidden="true" title="Attempt pattern">
						{#each entry.tiles as t, ti (ti)}
							<span class="tile-row">
								<i class="sq {t.g ? 'skip' : t.a}"></i>
								<i class="sq {t.g ? 'skip' : t.y}"></i>
								<i class="sq {t.g ? 'skip' : t.e}"></i>
							</span>
						{/each}
					</div>

					<div class="lb-score">
						<span class="lb-points tnum" class:won={entry.won}>
							{entry.points.toLocaleString('en-US')} pts
						</span>
						<span class="lb-outcome tnum">
							{formatOutcome(entry)}
						</span>
					</div>
				</li>
			{/each}
		</ol>
	{:else if !loading}
		<p class="lb-empty">
			No ranked players on today’s board yet. {authUser ? 'Finish today’s Daily frame to claim #1!' : 'Log in with AniList and finish today’s frame to claim #1!'}
		</p>
	{/if}
</section>

<style>
	.lb {
		border-top: 1px solid var(--line);
		padding-top: 22px;
		margin-top: 10px;
		display: flex;
		flex-direction: column;
		gap: 14px;
	}

	.lb-head {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 12px;
	}

	.lb-title {
		margin: 0;
		font-size: 20px;
		font-weight: 750;
		color: var(--paper);
		display: flex;
		align-items: baseline;
		gap: 8px;
	}

	.lb-num {
		font-size: 15px;
		font-weight: 600;
		color: var(--text-3);
	}

	.lb-date {
		font-size: 14px;
		font-weight: 600;
		color: var(--text-2);
	}

	.lb-sub {
		margin: 3px 0 0;
		font-size: 13.5px;
		color: var(--text-2);
	}

	.lb-refresh {
		height: 34px;
		padding: 0 12px;
		border: 1px solid var(--line);
		border-radius: var(--r-sm);
		background: none;
		color: var(--text-2);
		font-size: 13px;
		font-weight: 600;
		white-space: nowrap;
		transition: background-color 120ms ease, color 120ms ease;
	}

	.lb-refresh:hover:not(:disabled) {
		background: var(--ink-raised);
		color: var(--paper);
	}

	.lb-cta {
		background: var(--ink-deep);
		border: 1px solid var(--line);
		border-left: 3px solid var(--blue);
		border-radius: var(--r);
		padding: 12px 14px;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 14px;
		flex-wrap: wrap;
	}

	.lb-cta.urgent {
		border-left-color: var(--green);
	}

	.lb-cta-copy {
		display: flex;
		flex-direction: column;
		gap: 2px;
		font-size: 13.5px;
		color: var(--text-2);
	}

	.lb-cta-copy b {
		color: var(--paper);
		font-size: 14.5px;
	}

	.lb-login-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		height: 38px;
		padding: 0 16px;
		border-radius: var(--r-sm);
		background: var(--paper);
		color: var(--ink-deep);
		font-size: 14px;
		font-weight: 750;
		text-decoration: none;
		white-space: nowrap;
		transition: background-color 120ms ease;
	}

	.lb-login-btn:hover {
		background: var(--paper-hover);
	}

	.lb-config-note {
		font-size: 12.5px;
		color: var(--text-3);
	}

	.lb-me-banner {
		background: var(--blue-soft);
		border: 1px solid rgba(143, 180, 255, 0.35);
		border-radius: var(--r);
		padding: 10px 14px;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		flex-wrap: wrap;
		font-size: 14px;
		color: var(--paper);
	}

	.lb-me-stat {
		font-weight: 700;
		color: var(--green);
	}

	.lb-list {
		margin: 0;
		padding: 0;
		list-style: none;
		display: flex;
		flex-direction: column;
		border-top: 1px solid var(--line-soft);
	}

	.lb-row {
		display: grid;
		grid-template-columns: 44px minmax(0, 1fr) auto auto;
		align-items: center;
		gap: 12px;
		padding: 10px 8px;
		border-bottom: 1px solid var(--line-soft);
	}

	.lb-row.me {
		background: rgba(143, 180, 255, 0.08);
		border-radius: var(--r-sm);
	}

	.lb-rank {
		font-size: 14.5px;
		font-weight: 750;
		color: var(--text-2);
	}

	.lb-rank.gold {
		color: #f6d365;
	}

	.lb-rank.silver {
		color: #d6dceb;
	}

	.lb-rank.bronze {
		color: #e09f74;
	}

	.lb-user {
		display: inline-flex;
		align-items: center;
		gap: 10px;
		min-width: 0;
		text-decoration: none;
		color: var(--paper);
	}

	.lb-user:hover .lb-name {
		text-decoration: underline;
	}

	.lb-avatar {
		width: 28px;
		height: 28px;
		border-radius: 50%;
		object-fit: cover;
		flex: none;
	}

	.lb-avatar.fallback {
		display: grid;
		place-items: center;
		background: var(--ink-raised);
		font-size: 12.5px;
		font-weight: 700;
		color: var(--paper);
	}

	.lb-name {
		font-size: 14.5px;
		font-weight: 650;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.me-tag {
		font-size: 11px;
		font-weight: 700;
		padding: 2px 6px;
		border-radius: 4px;
		background: var(--blue-soft);
		color: var(--blue);
		flex: none;
	}

	.lb-tiles {
		display: flex;
		align-items: center;
		gap: 4px;
	}

	.tile-row {
		display: inline-flex;
		gap: 2px;
	}

	.sq {
		width: 6px;
		height: 13px;
		border-radius: 1.5px;
		display: block;
		background: #df5b69;
	}

	.sq.miss {
		background: #df5b69;
	}

	.sq.hit {
		background: var(--green);
	}

	.sq.close,
	.sq.skip {
		background: var(--yellow);
	}

	.lb-score {
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: 1px;
		white-space: nowrap;
	}

	.lb-points {
		font-size: 14.5px;
		font-weight: 750;
		color: var(--paper);
	}

	.lb-points.won {
		color: var(--green);
	}

	.lb-outcome {
		font-size: 12px;
		font-weight: 600;
		color: var(--text-3);
	}

	.lb-empty {
		margin: 0;
		padding: 14px;
		border-radius: var(--r);
		background: var(--ink-deep);
		border: 1px solid var(--line-soft);
		font-size: 14px;
		color: var(--text-2);
	}

	@media (max-width: 640px) {
		.lb-row {
			grid-template-columns: 34px minmax(0, 1fr) auto;
			grid-template-areas:
				'rank user score'
				'. tiles tiles';
			row-gap: 6px;
			column-gap: 8px;
			padding: 10px 6px;
		}

		.lb-rank {
			grid-area: rank;
		}

		.lb-user {
			grid-area: user;
		}

		.lb-score {
			grid-area: score;
		}

		.lb-tiles {
			grid-area: tiles;
			display: flex;
			flex-wrap: wrap;
			gap: 5px;
		}

		.sq {
			width: 7px;
			height: 12px;
		}
	}
</style>
