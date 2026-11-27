<script lang="ts">
	import { tick } from 'svelte';

	interface Props {
		open: boolean;
		imageUrl: string | null;
		onClose: () => void;
	}

	let { open, imageUrl, onClose }: Props = $props();
	let closeBtnEl = $state<HTMLButtonElement | null>(null);
	let previouslyFocused: HTMLElement | null = null;

	$effect(() => {
		if (open) {
			previouslyFocused = document.activeElement as HTMLElement | null;
			tick().then(() => closeBtnEl?.focus());
		} else if (previouslyFocused) {
			previouslyFocused.focus();
			previouslyFocused = null;
		}
	});

	function handleKeydown(e: KeyboardEvent) {
		if (!open) return;
		if (e.key === 'Escape') {
			onClose();
		} else if (e.key === 'Tab') {
			e.preventDefault();
			closeBtnEl?.focus();
		}
	}
</script>

<svelte:window onkeydown={handleKeydown} />

{#if open && imageUrl}
	<div
		class="lightbox-backdrop"
		role="dialog"
		aria-modal="true"
		aria-label="Full-size episode screencap"
	>
		<button
			type="button"
			class="backdrop-dismiss"
			tabindex="-1"
			aria-label="Close full-size image"
			onclick={onClose}
		></button>
		<div class="lightbox-frame">
			<button
				bind:this={closeBtnEl}
				type="button"
				class="close-btn"
				onclick={onClose}
				aria-label="Close full-size image"
			>
				Close (Esc)
			</button>
			<img src={imageUrl} alt="Full-resolution anime episode screencap" class="lightbox-img" />
		</div>
	</div>
{/if}

<style>
	.lightbox-backdrop {
		position: fixed;
		inset: 0;
		z-index: 60;
		background: rgba(12, 14, 29, 0.92);
		backdrop-filter: blur(8px);
		display: grid;
		place-items: center;
		padding: 20px;
	}

	.backdrop-dismiss {
		position: absolute;
		inset: 0;
		border: 0;
		padding: 0;
		background: transparent;
		cursor: default;
	}

	.lightbox-frame {
		position: relative;
		z-index: 1;
		max-width: 96vw;
		max-height: 92vh;
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: 10px;
	}

	.close-btn {
		background: var(--ink-deep);
		border: 1.5px solid var(--line-strong);
		color: var(--paper);
		font-size: 13.5px;
		font-weight: 600;
		padding: 6px 14px;
		border-radius: var(--r);
		transition: background-color 120ms ease, border-color 120ms ease;
	}

	.close-btn:hover {
		background: var(--ink-raised);
		border-color: var(--paper);
	}

	.lightbox-img {
		width: min(92vw, calc((90vh - 52px) * 16 / 9));
		aspect-ratio: 16 / 9;
		object-fit: contain;
		border-radius: var(--r);
		border: 1px solid var(--line);
		background: var(--stage-black);
	}
</style>
