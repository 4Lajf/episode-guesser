<script lang="ts">
	import { tick } from 'svelte';

	interface Props {
		imageUrl: string | null;
		loading: boolean;
		caption?: string;
		cropScale?: number;
		compact?: boolean;
		allowInspect?: boolean;
		onInspect?: () => void;
	}

	let {
		imageUrl,
		loading,
		caption = 'Which anime is this, and which episode?',
		cropScale = 1,
		compact = false,
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
		allowInspect && cropScale <= 1.01 && Boolean(imageUrl) && !loading && !imgFailed
	);
</script>

<div class="light-table" class:compact>
	<!-- Subtle 3-hole Japanese animation peg bar -->
	<div class="peg-bar" aria-hidden="true">
		<span class="peg-pill"></span>
		<span class="peg-dot"></span>
		<span class="peg-pill"></span>
	</div>

	<div class="stage-shell">
		<!-- Outside-the-frame camera registration corner marks -->
		<span class="corner tl" aria-hidden="true"></span>
		<span class="corner tr" aria-hidden="true"></span>
		<span class="corner bl" aria-hidden="true"></span>
		<span class="corner br" aria-hidden="true"></span>

		<!-- Strictly enforced 16:9 frame viewport with zero cropping -->
		<div class="frame-box">
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
					alt="Anime episode screencap"
					class="screencap-img"
					class:ready={imgLoaded}
					onload={() => (imgLoaded = true)}
					onerror={() => (imgFailed = true)}
				/>
			{/if}
		</div>
	</div>

	<div class="table-footer">
		<span class="table-caption">{caption}</span>
		{#if canInspect && onInspect}
			<button type="button" class="inspect-btn" onclick={onInspect}>
				<svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
					<path
						d="M10 2h4v4M6 14H2v-4M14 2l-4.5 4.5M2 14l4.5-4.5"
						stroke="currentColor"
						stroke-width="1.6"
						stroke-linecap="round"
						stroke-linejoin="round"
					/>
				</svg>
				<span>Full size</span>
			</button>
		{:else if cropScale > 1.01}
			<span class="zoom-pill font-display">{cropScale.toFixed(1)}× crop</span>
		{/if}
	</div>
</div>

<style>
	.light-table {
		position: relative;
		background:
			radial-gradient(ellipse 72% 60% at 50% 45%, var(--lamp-glow), transparent 72%),
			var(--ink-1);
		border: 1px solid var(--rule);
		border-radius: var(--radius-lg);
		padding: 12px 18px 10px;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 8px;
	}

	.light-table.compact {
		padding: 12px 14px 10px;
		gap: 8px;
	}

	.peg-bar {
		width: 176px;
		height: 12px;
		border-radius: 999px;
		background: var(--ink-2);
		border: 1px solid var(--rule);
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0 22px;
	}

	.light-table.compact .peg-bar {
		width: 136px;
		height: 10px;
		padding: 0 16px;
	}

	.peg-pill {
		width: 24px;
		height: 4px;
		border-radius: 999px;
		background: var(--ink-0);
		box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.05);
	}

	.peg-dot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: var(--ink-0);
		box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.05);
	}

	/* Sized so 16:9 frame + guessing console + downward 4-row dropdown fit inside 900px without scrolling */
	.stage-shell {
		position: relative;
		width: min(100%, 740px, calc(max(260px, 100svh - 465px) * 16 / 9));
		padding: 7px;
	}

	.light-table.compact .stage-shell {
		width: min(100%, calc(max(260px, 100svh - 360px) * 16 / 9));
		padding: 7px;
	}

	.corner {
		position: absolute;
		width: 14px;
		height: 14px;
		pointer-events: none;
		border-color: var(--lamp);
		border-style: solid;
		border-width: 0;
		opacity: 0.9;
	}

	.corner.tl {
		top: 0;
		left: 0;
		border-top-width: 2px;
		border-left-width: 2px;
	}
	.corner.tr {
		top: 0;
		right: 0;
		border-top-width: 2px;
		border-right-width: 2px;
	}
	.corner.bl {
		bottom: 0;
		left: 0;
		border-bottom-width: 2px;
		border-left-width: 2px;
	}
	.corner.br {
		bottom: 0;
		right: 0;
		border-bottom-width: 2px;
		border-right-width: 2px;
	}

	.frame-box {
		position: relative;
		width: 100%;
		aspect-ratio: 16 / 9;
		background: var(--stage-black);
		border-radius: 4px;
		overflow: hidden;
		border: 1px solid rgba(255, 255, 255, 0.07);
	}

	.screencap-img {
		width: 100%;
		height: 100%;
		object-fit: contain;
		display: block;
		opacity: 0;
		transition: opacity 180ms ease;
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
		color: var(--text-3);
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
		border: 2.5px solid var(--rule-strong);
		border-top-color: var(--lamp);
		animation: spin 0.75s linear infinite;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	.skeleton-text {
		font-size: 13.5px;
		color: var(--text-2);
	}

	.table-footer {
		width: min(100%, 740px, calc(max(260px, 100svh - 465px) * 16 / 9));
		padding: 0 7px;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		min-height: 24px;
	}

	.light-table.compact .table-footer {
		width: min(100%, calc(max(260px, 100svh - 360px) * 16 / 9));
		padding: 0 7px;
	}

	.table-caption {
		font-size: 13.5px;
		color: var(--text-2);
	}

	.inspect-btn {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		background: var(--ink-2);
		border: 1px solid var(--rule);
		border-radius: 6px;
		color: var(--text);
		font-size: 12.5px;
		font-weight: 500;
		padding: 5px 10px;
		cursor: pointer;
		flex-shrink: 0;
		transition: border-color 120ms ease, background 120ms ease;
	}

	.inspect-btn:hover {
		background: var(--ink-3);
		border-color: var(--rule-strong);
	}

	.zoom-pill {
		font-size: 13px;
		font-weight: 700;
		color: var(--lamp);
		background: var(--lamp-soft);
		border: 1px solid rgba(244, 199, 82, 0.35);
		border-radius: 6px;
		padding: 3px 9px;
		flex-shrink: 0;
	}

	@media (max-width: 760px) {
		.light-table,
		.light-table.compact {
			padding: 10px 10px 10px;
			gap: 8px;
		}

		.peg-bar,
		.light-table.compact .peg-bar {
			width: 120px;
			height: 9px;
			padding: 0 14px;
		}

		.peg-pill {
			width: 16px;
			height: 3px;
		}

		.peg-dot {
			width: 4px;
			height: 4px;
		}

		.stage-shell,
		.light-table.compact .stage-shell {
			width: 100%;
			padding: 6px;
		}

		.corner {
			width: 10px;
			height: 10px;
		}

		.table-footer,
		.light-table.compact .table-footer {
			width: 100%;
			padding: 0 6px;
		}

		.table-caption {
			font-size: 12.5px;
		}
	}
</style>
