<script lang="ts">
	import { tick } from 'svelte';

	interface Props {
		imageUrl: string | null;
		loading: boolean;
		note?: string;
		alt?: string;
		allowInspect?: boolean;
		onInspect?: () => void;
	}

	let {
		imageUrl,
		loading,
		note = '',
		alt = 'Anime episode screencap',
		allowInspect = true,
		onInspect
	}: Props = $props();

	let imgLoaded = $state(false);
	let imgFailed = $state(false);
	let imgEl = $state<HTMLImageElement | null>(null);

	$effect(() => {
		const url = imageUrl;
		imgLoaded = false;
		imgFailed = false;
		if (url) {
			tick().then(() => {
				if (imgEl && imgEl.complete && imgEl.naturalWidth > 0) {
					imgLoaded = true;
				}
			});
		}
	});

	const canInspect = $derived(
		allowInspect && Boolean(imageUrl) && !loading && !imgFailed && Boolean(onInspect)
	);
</script>

<figure class="cel">
	<div class="pegbar">
		<span class="peg-note">{note}</span>
		<span class="pegs" aria-hidden="true">
			<i class="slot"></i>
			<i class="hole"></i>
			<i class="slot"></i>
		</span>
		{#if canInspect}
			<button
				type="button"
				class="inspect"
				onclick={onInspect}
				aria-label="Open the frame at full size"
			>
				<svg class="icon" viewBox="0 0 20 20" aria-hidden="true">
					<path d="M4 8V4h4M16 8V4h-4M4 12v4h4M16 12v4h-4" />
				</svg>
				<span>Full size</span>
			</button>
		{:else}
			<span class="inspect-spacer" aria-hidden="true"></span>
		{/if}
	</div>

	<div class="frame">
		{#if loading}
			<div class="frame-skeleton" role="status" aria-label="Loading episode screencap">
				<span class="spinner"></span>
				<span class="skeleton-text">Pulling a frame from ani.zip...</span>
			</div>
		{:else if !imageUrl}
			<div class="frame-skeleton">
				<span class="skeleton-text">Connect an AniList or select the Global Pool to load a frame.</span>
			</div>
		{:else if imgFailed}
			<div class="frame-skeleton">
				<span class="skeleton-text">Screencap failed to load. Try skipping to the next frame.</span>
			</div>
		{:else}
			{#if !imgLoaded}
				<div class="frame-skeleton overlay" role="status" aria-label="Loading image">
					<span class="spinner"></span>
				</div>
			{/if}
			<img
				bind:this={imgEl}
				src={imageUrl}
				{alt}
				class="screencap-img"
				class:ready={imgLoaded}
				onload={() => (imgLoaded = true)}
				onerror={() => (imgFailed = true)}
			/>
		{/if}
	</div>
</figure>

<style>
	.cel {
		margin: 0;
		border-radius: var(--r);
		overflow: hidden;
		background: var(--ink-deep);
	}

	.pegbar {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
		align-items: center;
		height: 40px;
		padding: 0 6px 0 14px;
		gap: 8px;
	}

	.peg-note {
		grid-column: 1;
		font-size: 13.5px;
		color: var(--text-2);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.pegs {
		grid-column: 2;
		display: flex;
		align-items: center;
		gap: 48px;
	}

	.pegs i {
		display: block;
		background: var(--line);
	}

	.pegs .slot {
		width: 30px;
		height: 8px;
		border-radius: 5px;
	}

	.pegs .hole {
		width: 10px;
		height: 10px;
		border-radius: 50%;
	}

	.inspect {
		grid-column: 3;
		justify-self: end;
		display: inline-flex;
		align-items: center;
		gap: 6px;
		height: 32px;
		padding: 0 10px;
		border: 0;
		border-radius: 6px;
		background: none;
		color: var(--text-2);
		font-size: 13.5px;
		font-weight: 500;
		white-space: nowrap;
		transition: background-color 120ms ease, color 120ms ease;
	}

	.inspect:hover {
		color: var(--paper);
		background: var(--ink-raised);
	}

	.inspect .icon {
		width: 16px;
		height: 16px;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.75;
		stroke-linecap: round;
		stroke-linejoin: round;
	}

	.inspect-spacer {
		grid-column: 3;
	}

	.frame {
		position: relative;
		width: 100%;
		aspect-ratio: 16 / 9;
		background: var(--stage-black);
		overflow: hidden;
	}

	.screencap-img {
		width: 100%;
		height: 100%;
		object-fit: contain;
		opacity: 0;
		transition: opacity 160ms ease;
	}

	.screencap-img.ready {
		opacity: 1;
	}

	.frame-skeleton {
		width: 100%;
		height: 100%;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 10px;
		padding: 16px;
		text-align: center;
		color: var(--text-2);
		background: var(--stage-black);
	}

	.frame-skeleton.overlay {
		position: absolute;
		inset: 0;
		z-index: 2;
	}

	.spinner {
		width: 26px;
		height: 26px;
		border-radius: 50%;
		border: 2.5px solid var(--line);
		border-top-color: var(--blue);
		animation: spin 0.75s linear infinite;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	.skeleton-text {
		font-size: 14px;
		color: var(--text-2);
	}

	@media (max-width: 960px) {
		.peg-note {
			display: none;
		}

		.pegs {
			gap: 22px;
		}

		.pegs .slot {
			width: 22px;
		}
	}
</style>
