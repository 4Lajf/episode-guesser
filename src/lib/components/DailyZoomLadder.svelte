<script lang="ts">
	import { WORDLE_ZOOM_STEPS } from '$lib/scoring';

	interface Props {
		activeStepIndex: number;
		finished: boolean;
	}

	let { activeStepIndex, finished }: Props = $props();
</script>

<ol class="zoom" aria-label="Zoom steps, one per guess">
	{#each WORDLE_ZOOM_STEPS as step, idx (step)}
		{@const ratio = Math.min(1, 1 / step)}
		{@const isNow = !finished && idx === activeStepIndex}
		{@const isDone = finished || idx < activeStepIndex}
		<li
			class:done={isDone && !isNow}
			class:now={isNow || (finished && idx === WORDLE_ZOOM_STEPS.length - 1)}
			aria-current={isNow ? 'step' : undefined}
		>
			<i class="fg" style="--v: {ratio.toFixed(3)}" aria-hidden="true"></i>
			<span>
				<b class="tnum">{step.toFixed(1)}×</b>
				{#if isNow}
					Now
				{:else if idx === WORDLE_ZOOM_STEPS.length - 1}
					Full frame
				{:else}
					Guess {idx + 1}
				{/if}
			</span>
		</li>
	{/each}
</ol>

<style>
	.zoom {
		display: grid;
		grid-template-columns: repeat(5, minmax(0, 1fr));
		gap: 6px;
		margin: 14px 0 0;
		padding: 0;
		list-style: none;
	}

	.zoom li {
		display: flex;
		align-items: center;
		gap: 10px;
		padding-top: 10px;
		border-top: 3px solid var(--line);
		font-size: 13px;
		line-height: 1.25;
		color: var(--text-3);
	}

	.zoom li b {
		display: block;
		font-size: 15.5px;
		font-weight: 700;
	}

	.zoom .done {
		border-top-color: var(--text-3);
		color: var(--text-2);
	}

	.zoom .now {
		border-top-color: var(--paper);
		color: var(--paper);
	}

	.fg {
		position: relative;
		flex: none;
		width: 40px;
		aspect-ratio: 16 / 9;
		border-radius: 2px;
		box-shadow: inset 0 0 0 1px currentColor;
	}

	.fg::after {
		content: '';
		position: absolute;
		inset: calc((1 - var(--v)) * 50%);
		border-radius: 1px;
		background: currentColor;
	}

	@media (max-width: 960px) {
		.zoom li {
			flex-direction: column;
			align-items: flex-start;
			gap: 6px;
			font-size: 12px;
		}

		.fg {
			width: 30px;
		}
	}
</style>
