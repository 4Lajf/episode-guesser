<script lang="ts">
	import type { VnArchivePayload } from '$lib/types';

	interface Props {
		archive: VnArchivePayload | null;
		loading: boolean;
		selectedDate: string;
		onSelectDate: (date: string) => void;
	}

	let { archive, loading, selectedDate, onSelectDate }: Props = $props();

	let filter = $state<'all' | 'unplayed' | 'solved' | 'missed'>('all');

	const filteredDays = $derived.by(() => {
		const days = archive?.days ?? [];
		if (filter === 'all') return days;
		if (filter === 'unplayed') {
			return days.filter((d) => d.status === 'unplayed' || d.status === 'in_progress');
		}
		if (filter === 'solved') return days.filter((d) => d.status === 'won');
		return days.filter((d) => d.status === 'lost' || d.status === 'gave_up');
	});

	function formatShortDate(iso: string): string {
		const d = new Date(`${iso}T00:00:00Z`);
		if (Number.isNaN(d.getTime())) return iso;
		return d.toLocaleDateString('en-GB', {
			day: 'numeric',
			month: 'short',
			year: '2-digit',
			timeZone: 'UTC'
		});
	}
</script>

<section class="arch" aria-label="Daily VN UI Archive">
	<div class="arch-head">
		<div>
			<h2 class="arch-title">Daily VN UI Archive</h2>
			{#if archive}
				<p class="arch-sub tnum">
					{archive.totalDays} daily interface puzzles · {archive.solvedCount} solved · {archive.playedCount} played
				</p>
			{/if}
		</div>

		<div class="filters" role="group" aria-label="Filter archive">
			{#each [['all', 'All'], ['unplayed', 'Unplayed'], ['solved', 'Solved'], ['missed', 'Missed']] as [id, label] (id)}
				<button
					type="button"
					class="f-btn"
					class:active={filter === id}
					onclick={() => (filter = id as typeof filter)}
				>
					{label}
				</button>
			{/each}
		</div>
	</div>

	{#if loading && !archive}
		<p class="arch-empty">Loading VN UI archive...</p>
	{:else if filteredDays.length === 0}
		<p class="arch-empty">No puzzles match this filter.</p>
	{:else}
		<div class="day-grid">
			{#each filteredDays as day (day.date)}
				<button
					type="button"
					class="day-card"
					class:selected={day.date === selectedDate}
					class:won={day.status === 'won'}
					class:lost={day.status === 'lost' || day.status === 'gave_up'}
					class:prog={day.status === 'in_progress'}
					onclick={() => onSelectDate(day.date)}
				>
					<span class="d-top">
						<span class="d-num tnum">#{day.puzzleNumber}</span>
						<span class="d-dot" aria-hidden="true"></span>
					</span>
					<span class="d-date">{formatShortDate(day.date)}</span>
					<span class="d-meta tnum">
						{#if day.status === 'won'}
							{day.attemptsUsed}/5
						{:else if day.status === 'lost'}
							X/5
						{:else if day.status === 'gave_up'}
							Gave up
						{:else if day.status === 'in_progress'}
							{day.attemptsUsed}/5…
						{:else}
							Play
						{/if}
					</span>
				</button>
			{/each}
		</div>
	{/if}
</section>

<style>
	.arch {
		display: flex;
		flex-direction: column;
		gap: 16px;
	}

	.arch-head {
		display: flex;
		align-items: flex-end;
		justify-content: space-between;
		gap: 12px;
		flex-wrap: wrap;
	}

	.arch-title {
		margin: 0;
		font-size: 22px;
		font-weight: 800;
		color: var(--paper);
	}

	.arch-sub {
		margin: 4px 0 0;
		font-size: 13.5px;
		color: var(--text-2);
	}

	.filters {
		display: inline-flex;
		gap: 4px;
		background: var(--ink-raised);
		padding: 3px;
		border-radius: var(--r);
	}

	.f-btn {
		border: 0;
		background: none;
		color: var(--text-2);
		padding: 5px 11px;
		border-radius: var(--r-sm);
		font-size: 13px;
		font-weight: 600;
	}

	.f-btn.active {
		background: var(--paper);
		color: var(--ink-deep);
	}

	.arch-empty {
		color: var(--text-3);
		font-size: 14px;
	}

	.day-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(112px, 1fr));
		gap: 8px;
	}

	.day-card {
		display: flex;
		flex-direction: column;
		gap: 4px;
		padding: 10px;
		border-radius: var(--r-sm);
		border: 1px solid var(--line);
		background: var(--ink-raised);
		color: var(--paper);
		text-align: left;
		transition: border-color 120ms ease, background-color 120ms ease;
	}

	.day-card:hover {
		border-color: var(--paper);
	}

	.day-card.selected {
		border-color: var(--blue);
	}

	.d-top {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}

	.d-num {
		font-size: 15px;
		font-weight: 750;
	}

	.d-dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: var(--line-strong);
	}

	.day-card.won .d-dot {
		background: var(--green);
	}

	.day-card.lost .d-dot {
		background: #df5b69;
	}

	.day-card.prog .d-dot {
		background: var(--yellow);
	}

	.d-date {
		font-size: 12px;
		color: var(--text-3);
	}

	.d-meta {
		font-size: 12px;
		font-weight: 650;
		color: var(--text-2);
	}

	.day-card.won .d-meta {
		color: var(--green);
	}
</style>
