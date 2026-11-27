<script lang="ts">
	import { WORDLE_MAX_ATTEMPTS, WORDLE_ZOOM_STEPS } from '$lib/scoring';
	import type { ArchiveDaySummary, DailyArchivePayload } from '$lib/types';

	interface Props {
		archive: DailyArchivePayload | null;
		loading: boolean;
		selectedDate: string;
		onSelectDate: (date: string) => void;
	}

	let { archive, loading, selectedDate, onSelectDate }: Props = $props();

	let selectedMonth = $state<string>('all');
	let statusFilter = $state<'all' | 'unplayed' | 'solved' | 'in_progress' | 'missed'>('all');
	let searchText = $state('');

	const months = $derived.by(() => {
		if (!archive) return [] as Array<{ key: string; label: string; count: number; solved: number }>;
		const map = new Map<string, { key: string; label: string; count: number; solved: number }>();
		for (const day of archive.days) {
			const key = day.date.slice(0, 7); // YYYY-MM
			let entry = map.get(key);
			if (!entry) {
				const d = new Date(`${key}-01T00:00:00Z`);
				const label = d.toLocaleDateString('en-US', {
					month: 'short',
					year: 'numeric',
					timeZone: 'UTC'
				});
				entry = { key, label, count: 0, solved: 0 };
				map.set(key, entry);
			}
			entry.count++;
			if (day.status === 'won') entry.solved++;
		}
		return Array.from(map.values());
	});

	// Default cleanly to the latest month when archive loads (keeps initial render fast & calendar-friendly)
	let initializedMonth = false;
	$effect(() => {
		if (!initializedMonth && months.length > 0) {
			initializedMonth = true;
			selectedMonth = months[0].key;
		}
	});

	function formatCardDate(iso: string): string {
		const d = new Date(`${iso}T00:00:00Z`);
		if (Number.isNaN(d.getTime())) return iso;
		return d.toLocaleDateString('en-GB', {
			day: 'numeric',
			month: 'short',
			year: 'numeric',
			timeZone: 'UTC'
		});
	}

	function formatWeekday(iso: string): string {
		const d = new Date(`${iso}T00:00:00Z`);
		if (Number.isNaN(d.getTime())) return '';
		return d.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });
	}

	function statusLabel(day: ArchiveDaySummary): string {
		if (day.status === 'won') {
			const idx = Math.min(Math.max(0, day.attemptsUsed - 1), WORDLE_ZOOM_STEPS.length - 1);
			return `Solved ${day.attemptsUsed}/${WORDLE_MAX_ATTEMPTS} · ${WORDLE_ZOOM_STEPS[idx].toFixed(1)}×`;
		}
		if (day.status === 'in_progress') {
			return `In progress (${day.attemptsUsed}/${WORDLE_MAX_ATTEMPTS})`;
		}
		if (day.status === 'gave_up') return 'Gave up';
		if (day.status === 'lost') {
			return day.animeHitAttempt ? `Anime #${day.animeHitAttempt}` : 'Missed';
		}
		return 'Play';
	}

	const filteredDays = $derived.by(() => {
		if (!archive) return [] as ArchiveDaySummary[];
		const q = searchText.trim().toLowerCase().replace(/^#/, '');

		return archive.days.filter((day) => {
			if (!q && selectedMonth !== 'all' && !day.date.startsWith(selectedMonth)) {
				return false;
			}
			if (statusFilter === 'unplayed' && day.status !== 'unplayed') return false;
			if (statusFilter === 'solved' && day.status !== 'won') return false;
			if (statusFilter === 'in_progress' && day.status !== 'in_progress') return false;
			if (statusFilter === 'missed' && day.status !== 'lost' && day.status !== 'gave_up') {
				return false;
			}
			if (q) {
				const numStr = String(day.puzzleNumber);
				const nice = formatCardDate(day.date).toLowerCase();
				if (!numStr.includes(q) && !day.date.includes(q) && !nice.includes(q)) {
					return false;
				}
			}
			return true;
		});
	});

	const unplayedDays = $derived(
		archive ? archive.days.filter((d) => d.status === 'unplayed') : []
	);

	function playRandomUnplayed() {
		const pool = unplayedDays.length > 0 ? unplayedDays : (archive?.days ?? []);
		if (pool.length === 0) return;
		const pick = pool[Math.floor(Math.random() * pool.length)];
		onSelectDate(pick.date);
	}

	const solvedPct = $derived(
		archive && archive.totalDays > 0
			? Math.round((archive.solvedCount / archive.totalDays) * 100)
			: 0
	);
</script>

<section class="archive" aria-label="Daily Frame Archive">
	<div class="archive-hero">
		<div>
			<h2 class="archive-title">Daily Frame Archive</h2>
			<p class="archive-sub">
				{#if archive}
					<span class="tnum">{archive.totalDays}</span> Ranked Top 1,000 puzzles from {formatCardDate(archive.startDate)} to {formatCardDate(archive.today)} — every past day has progressive 4.0× zoom, Share Cards, and its own Global Leaderboard.
				{:else}
					Browse and play a full year of past Daily frames with full zoom, hints, and leaderboards.
				{/if}
			</p>
		</div>

		<div class="archive-cta">
			{#if archive}
				<button type="button" class="primary" onclick={playRandomUnplayed}>
					{unplayedDays.length > 0 ? 'Play random unplayed' : 'Play random puzzle'}
				</button>
				<button type="button" class="outline" onclick={() => onSelectDate(archive.today)}>
					Today’s Daily (#{archive.days[0]?.puzzleNumber ?? ''})
				</button>
			{/if}
		</div>
	</div>

	{#if archive}
		<div class="progress-bar-wrap">
			<div class="progress-stats">
				<span>
					<b class="tnum">{archive.solvedCount}</b> solved · <b class="tnum">{archive.playedCount}</b> finished of <span class="tnum">{archive.totalDays}</span>
				</span>
				<span class="tnum">{solvedPct}%</span>
			</div>
			<div class="progress-track" role="progressbar" aria-valuenow={solvedPct} aria-valuemin={0} aria-valuemax={100}>
				<div class="progress-fill" style:width="{solvedPct}%"></div>
			</div>
		</div>

		<div class="controls">
			<div class="month-pills" role="tablist" aria-label="Filter by month">
				<button
					type="button"
					role="tab"
					class="pill"
					aria-selected={selectedMonth === 'all'}
					onclick={() => (selectedMonth = 'all')}
				>
					All <span class="tnum">({archive.totalDays})</span>
				</button>
				{#each months as m (m.key)}
					<button
						type="button"
						role="tab"
						class="pill"
						aria-selected={selectedMonth === m.key}
						onclick={() => (selectedMonth = m.key)}
					>
						<span>{m.label}</span>
						{#if m.solved > 0}
							<span class="pill-solved tnum">{m.solved}/{m.count}</span>
						{/if}
					</button>
				{/each}
			</div>

			<div class="filter-row">
				<div class="status-pills" role="group" aria-label="Filter by status">
					{#each [
						{ id: 'all', label: 'All' },
						{ id: 'unplayed', label: 'Unplayed' },
						{ id: 'in_progress', label: 'In progress' },
						{ id: 'solved', label: 'Solved' },
						{ id: 'missed', label: 'Missed' }
					] as opt (opt.id)}
						<button
							type="button"
							class="status-btn"
							class:active={statusFilter === opt.id}
							onclick={() => (statusFilter = opt.id as typeof statusFilter)}
						>
							{opt.label}
						</button>
					{/each}
				</div>

				<input
					type="search"
					class="search-input"
					placeholder="Jump to #number or date (e.g. #150 or Aug)"
					bind:value={searchText}
					aria-label="Filter archive by puzzle number or date"
				/>
			</div>
		</div>

		{#if filteredDays.length > 0}
			<div class="day-grid">
				{#each filteredDays as day (day.date)}
					{@const isToday = day.date === archive.today}
					{@const isSelected = day.date === selectedDate}
					<button
						type="button"
						class="day-card"
						class:won={day.status === 'won'}
						class:in-progress={day.status === 'in_progress'}
						class:missed={day.status === 'lost' || day.status === 'gave_up'}
						class:selected={isSelected}
						onclick={() => onSelectDate(day.date)}
					>
						<div class="card-top">
							<span class="puzzle-num tnum">#{day.puzzleNumber}</span>
							{#if isToday}
								<span class="today-tag">Today</span>
							{:else}
								<span class="weekday">{formatWeekday(day.date)}</span>
							{/if}
						</div>

						<div class="card-date">{formatCardDate(day.date)}</div>

						<div class="card-foot">
							<span class="card-status tnum">{statusLabel(day)}</span>
							{#if day.leaderboardCount > 0}
								<span class="card-lb tnum">{day.leaderboardCount} ranked</span>
							{/if}
						</div>
					</button>
				{/each}
			</div>
		{:else}
			<p class="empty-msg">No archive puzzles match those filters.</p>
		{/if}
	{:else if loading}
		<p class="empty-msg">Loading 366-day Daily Archive...</p>
	{:else}
		<p class="empty-msg">Could not load the archive right now.</p>
	{/if}
</section>

<style>
	.archive {
		display: flex;
		flex-direction: column;
		gap: 20px;
		padding-top: 8px;
	}

	.archive-hero {
		display: flex;
		align-items: flex-end;
		justify-content: space-between;
		gap: 20px;
		flex-wrap: wrap;
	}

	.archive-title {
		margin: 0;
		font-size: 32px;
		font-weight: 800;
		letter-spacing: -0.02em;
		color: var(--paper);
		line-height: 1.1;
	}

	.archive-sub {
		margin: 6px 0 0;
		font-size: 14.5px;
		color: var(--text-2);
		max-width: 66ch;
	}

	.archive-cta {
		display: flex;
		align-items: center;
		gap: 10px;
		flex-wrap: wrap;
	}

	.primary {
		height: 44px;
		padding: 0 18px;
		border: 0;
		border-radius: var(--r);
		background: var(--paper);
		color: var(--ink-deep);
		font-size: 14.5px;
		font-weight: 750;
		transition: background-color 120ms ease;
	}

	.primary:hover {
		background: var(--paper-hover);
	}

	.outline {
		height: 44px;
		padding: 0 16px;
		border: 1.5px solid var(--line-strong);
		border-radius: var(--r);
		background: none;
		color: var(--paper);
		font-size: 14.5px;
		font-weight: 650;
		transition: border-color 120ms ease, background-color 120ms ease;
	}

	.outline:hover {
		border-color: var(--paper);
		background: var(--ink-raised);
	}

	.progress-bar-wrap {
		display: flex;
		flex-direction: column;
		gap: 7px;
	}

	.progress-stats {
		display: flex;
		justify-content: space-between;
		font-size: 13.5px;
		color: var(--text-2);
	}

	.progress-stats b {
		color: var(--paper);
	}

	.progress-track {
		height: 8px;
		border-radius: 999px;
		background: var(--ink-deep);
		border: 1px solid var(--line-soft);
		overflow: hidden;
	}

	.progress-fill {
		height: 100%;
		background: var(--green);
		border-radius: 999px;
		transition: width 220ms ease;
	}

	.controls {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}

	.month-pills {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}

	.pill {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		height: 34px;
		padding: 0 12px;
		border: 1px solid var(--line);
		border-radius: 999px;
		background: var(--ink-deep);
		color: var(--text-2);
		font-size: 13px;
		font-weight: 600;
		transition: border-color 120ms ease, background-color 120ms ease, color 120ms ease;
	}

	.pill:hover {
		border-color: var(--line-strong);
		color: var(--paper);
	}

	.pill[aria-selected='true'] {
		background: var(--blue-soft);
		border-color: var(--blue);
		color: var(--paper);
		font-weight: 700;
	}

	.pill-solved {
		font-size: 11.5px;
		color: var(--green);
		font-weight: 700;
	}

	.filter-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		flex-wrap: wrap;
	}

	.status-pills {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}

	.status-btn {
		height: 32px;
		padding: 0 11px;
		border: 1px solid var(--line-soft);
		border-radius: var(--r-sm);
		background: none;
		color: var(--text-2);
		font-size: 13px;
		font-weight: 600;
		transition: background-color 120ms ease, color 120ms ease;
	}

	.status-btn:hover {
		background: var(--ink-raised);
		color: var(--paper);
	}

	.status-btn.active {
		background: var(--ink-raised);
		border-color: var(--line-strong);
		color: var(--paper);
	}

	.search-input {
		height: 36px;
		width: min(100%, 300px);
		padding: 0 12px;
		border-radius: var(--r-sm);
		border: 1.5px solid var(--line-strong);
		background: var(--ink-deep);
		color: var(--paper);
		font-size: 13.5px;
		outline: none;
	}

	.search-input:focus {
		border-color: var(--blue);
	}

	.search-input::placeholder {
		color: var(--text-3);
	}

	.day-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(195px, 1fr));
		gap: 10px;
	}

	.day-card {
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding: 12px 14px;
		border-radius: var(--r);
		border: 1.5px solid var(--line);
		background: var(--ink-deep);
		text-align: left;
		color: var(--paper);
		transition: border-color 120ms ease, background-color 120ms ease, transform 120ms ease;
	}

	.day-card:hover {
		border-color: var(--blue);
		background: var(--ink-raised);
		transform: translateY(-1px);
	}

	.day-card.selected {
		border-color: var(--paper);
	}

	.day-card.won {
		border-color: rgba(95, 191, 130, 0.55);
	}

	.day-card.in-progress {
		border-color: rgba(143, 180, 255, 0.6);
	}

	.card-top {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
	}

	.puzzle-num {
		font-size: 15px;
		font-weight: 800;
		color: var(--paper);
	}

	.weekday {
		font-size: 12px;
		color: var(--text-3);
		font-weight: 600;
	}

	.today-tag {
		font-size: 11px;
		font-weight: 750;
		padding: 2px 7px;
		border-radius: 999px;
		background: var(--blue-soft);
		color: var(--blue);
	}

	.card-date {
		font-size: 14px;
		font-weight: 550;
		color: var(--text-2);
	}

	.card-foot {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 6px;
		margin-top: 2px;
	}

	.card-status {
		font-size: 12.5px;
		font-weight: 700;
		color: var(--blue);
	}

	.day-card.won .card-status {
		color: var(--green);
	}

	.day-card.in-progress .card-status {
		color: var(--yellow);
	}

	.day-card.missed .card-status {
		color: var(--text-3);
	}

	.card-lb {
		font-size: 11.5px;
		color: var(--text-3);
	}

	.empty-msg {
		margin: 0;
		padding: 18px;
		border-radius: var(--r);
		background: var(--ink-deep);
		border: 1px solid var(--line-soft);
		font-size: 14px;
		color: var(--text-2);
	}

	@media (max-width: 640px) {
		.archive-title {
			font-size: 26px;
		}

		.day-grid {
			grid-template-columns: repeat(2, minmax(0, 1fr));
			gap: 8px;
		}
	}
</style>
