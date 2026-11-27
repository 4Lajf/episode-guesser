<script lang="ts">
	import type { AuthUser, VnDailyLeaderboardEntry, VnDailyLeaderboardPayload } from '$lib/types';
	import { VN_MAX_ATTEMPTS, VN_STAGE_LABELS } from '$lib/vnScoring';

	interface Props {
		leaderboard: VnDailyLeaderboardPayload | null;
		loading: boolean;
		authUser: AuthUser | null;
		finished: boolean;
		won: boolean;
		attemptsCount: number;
		puzzleDate?: string;
		isArchive?: boolean;
		onRefresh: () => void;
	}

	let {
		leaderboard,
		loading,
		authUser,
		finished,
		won,
		attemptsCount,
		puzzleDate = '',
		isArchive = false,
		onRefresh
	}: Props = $props();

	const loginReturnUrl = $derived(
		isArchive && puzzleDate ? `/?mode=vn&date=${encodeURIComponent(puzzleDate)}` : '/?mode=vn'
	);

	function formatOutcome(entry: VnDailyLeaderboardEntry): string {
		if (entry.won) {
			const stageIdx = Math.min(Math.max(0, entry.attemptsUsed - 1), VN_STAGE_LABELS.length - 1);
			return `${entry.attemptsUsed}/${VN_MAX_ATTEMPTS} · ${VN_STAGE_LABELS[stageIdx]}`;
		}
		if (entry.gaveUp) return 'Gave up';
		return `X/${VN_MAX_ATTEMPTS}`;
	}

	const authConfigured = $derived(leaderboard?.authConfigured ?? true);
</script>

<section class="lb" aria-label="Global Daily VN UI Leaderboard">
	<div class="lb-head">
		<div>
			<h2 class="lb-title">
				Daily VN UI Leaderboard
				{#if leaderboard}
					<span class="lb-num tnum">#{leaderboard.puzzleNumber}</span>
				{/if}
			</h2>
			<p class="lb-sub">
				{#if leaderboard && leaderboard.totalPlayers > 0}
					{leaderboard.totalPlayers} {leaderboard.totalPlayers === 1 ? 'player' : 'players'} · {leaderboard.solvedCount} solved · Ranked by points (ties go to first)
				{:else}
					Ranked by points (ties go to first)
				{/if}
			</p>
		</div>

		<button type="button" class="lb-refresh" disabled={loading} onclick={onRefresh}>
			{loading ? 'Refreshing...' : 'Refresh'}
		</button>
	</div>

	{#if !authUser}
		<div class="lb-cta" class:urgent={finished}>
			<div class="lb-cta-copy">
				{#if finished}
					<b>
						{won
							? `Solved VN UI in ${attemptsCount}/${VN_MAX_ATTEMPTS}!`
							: 'Claim your VN UI leaderboard spot'}
					</b>
					<span>Log in with AniList to post this result to the Global VN UI Leaderboard.</span>
				{:else}
					<b>Compete on the Daily VN UI Leaderboard</b>
					<span>Log in with AniList to rank your Daily VN UI solves worldwide.</span>
				{/if}
			</div>
			{#if authConfigured}
				<a class="lb-login-btn" href="/api/auth/anilist/login?returnTo={encodeURIComponent(loginReturnUrl)}">
					Log in with AniList
				</a>
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

	{#if !leaderboard || leaderboard.entries.length === 0}
		<p class="lb-empty">No ranked Daily VN UI finishes yet for this day. Be the first on the board.</p>
	{:else}
		<ol class="lb-list">
			{#each leaderboard.entries as entry, idx (entry.anilistUserId)}
				{@const isMe = authUser?.anilistUserId === entry.anilistUserId}
				<li class="lb-row" class:me={isMe}>
					<span class="lb-rank tnum" class:top={idx < 3}>#{idx + 1}</span>
					<a class="lb-user" href={entry.siteUrl} target="_blank" rel="noopener noreferrer">
						{#if entry.avatar}
							<img class="lb-ava" src={entry.avatar} alt="" width="28" height="28" />
						{:else}
							<span class="lb-ava fallback">{entry.username.slice(0, 1).toUpperCase()}</span>
						{/if}
						<span class="lb-name">{entry.username}</span>
					</a>

					<div class="lb-tiles" aria-label="Guess pattern">
						{#each entry.tiles as t, rIdx (rIdx)}
							<span class="tile-row">
								<i class="t {t.v}" class:gaveup={t.g}></i>
								<i class="t {t.y}" class:gaveup={t.g}></i>
								<i class="t {t.l}" class:gaveup={t.g}></i>
								<i class="t {t.s}" class:gaveup={t.g}></i>
							</span>
						{/each}
					</div>

					<div class="lb-score tnum">
						<span class="lb-pts" class:won={entry.won}>{entry.points.toLocaleString('en-US')} pts</span>
						<span class="lb-out">{formatOutcome(entry)}</span>
					</div>
				</li>
			{/each}
		</ol>
	{/if}
</section>

<style>
	.lb {
		margin-top: 24px;
		padding-top: 20px;
		border-top: 1px solid var(--line);
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
		font-size: 19px;
		font-weight: 750;
		color: var(--paper);
		display: flex;
		align-items: baseline;
		gap: 8px;
	}

	.lb-num {
		font-size: 14px;
		color: var(--blue);
		font-weight: 700;
	}

	.lb-sub {
		margin: 3px 0 0;
		font-size: 13px;
		color: var(--text-3);
	}

	.lb-refresh {
		height: 34px;
		padding: 0 12px;
		border: 1px solid var(--line-strong);
		border-radius: var(--r-sm);
		background: none;
		color: var(--text-2);
		font-size: 13px;
		font-weight: 600;
	}

	.lb-refresh:hover {
		color: var(--paper);
		border-color: var(--paper);
	}

	.lb-cta {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 14px;
		flex-wrap: wrap;
		padding: 12px 14px;
		border-radius: var(--r);
		background: var(--ink-raised);
		border: 1px solid var(--line);
	}

	.lb-cta.urgent {
		border-color: var(--blue);
		background: var(--blue-soft);
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
	}

	.lb-login-btn {
		display: inline-flex;
		align-items: center;
		height: 36px;
		padding: 0 14px;
		border-radius: var(--r-sm);
		background: var(--paper);
		color: var(--ink-deep);
		font-size: 13.5px;
		font-weight: 750;
		text-decoration: none;
	}

	.lb-me-banner {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 10px;
		flex-wrap: wrap;
		padding: 10px 14px;
		border-radius: var(--r);
		background: var(--blue-soft);
		border: 1px solid rgba(143, 180, 255, 0.35);
		font-size: 14px;
		color: var(--paper);
	}

	.lb-me-stat {
		font-weight: 700;
		color: var(--green);
	}

	.lb-empty {
		margin: 4px 0;
		font-size: 14px;
		color: var(--text-3);
	}

	.lb-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.lb-row {
		display: grid;
		grid-template-columns: 38px minmax(0, 1fr) auto auto;
		align-items: center;
		gap: 12px;
		padding: 10px 12px;
		border-radius: var(--r-sm);
		background: var(--ink-raised);
		border: 1px solid var(--line-soft);
	}

	.lb-row.me {
		border-color: rgba(143, 180, 255, 0.45);
		background: rgba(143, 180, 255, 0.08);
	}

	.lb-rank {
		font-size: 14px;
		font-weight: 750;
		color: var(--text-3);
	}

	.lb-rank.top {
		color: var(--yellow);
	}

	.lb-user {
		display: inline-flex;
		align-items: center;
		gap: 10px;
		text-decoration: none;
		color: var(--paper);
		min-width: 0;
	}

	.lb-ava {
		width: 28px;
		height: 28px;
		border-radius: 50%;
		object-fit: cover;
		flex: none;
	}

	.lb-ava.fallback {
		display: grid;
		place-items: center;
		background: var(--ink-deep);
		font-size: 12px;
		font-weight: 700;
	}

	.lb-name {
		font-size: 14.5px;
		font-weight: 650;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.lb-tiles {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		flex-wrap: wrap;
	}

	.tile-row {
		display: inline-flex;
		gap: 2px;
	}

	.t {
		width: 7px;
		height: 15px;
		border-radius: 2px;
		display: inline-block;
		background: #df5b69;
	}

	.t.hit {
		background: var(--green);
	}

	.t.close {
		background: var(--yellow);
	}

	.t.gaveup {
		background: var(--yellow);
		opacity: 0.7;
	}

	.lb-score {
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: 1px;
		white-space: nowrap;
	}

	.lb-pts {
		font-size: 14.5px;
		font-weight: 750;
		color: var(--paper);
	}

	.lb-pts.won {
		color: var(--green);
	}

	.lb-out {
		font-size: 12px;
		color: var(--text-3);
	}

	@media (max-width: 640px) {
		.lb-row {
			grid-template-columns: 32px minmax(0, 1fr) auto;
			grid-template-areas:
				'rank user score'
				'. tiles tiles';
			row-gap: 8px;
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
		}
	}
</style>
