<script lang="ts">
	import { tick } from 'svelte';

	interface Props {
		open: boolean;
		imageUrl: string | null;
		onClose: () => void;
	}

	let { open, imageUrl, onClose }: Props = $props();
	let closeBtnEl = $state<HTMLButtonElement | null>(null);
	let dialogEl = $state<HTMLDivElement | null>(null);
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
		bind:this={dialogEl}
		class="lightbox-backdrop"
		role="dialog"
		aria-modal="true"
		aria-label="Full-size episode screencap"
		tabindex="-1"
		onclick={onClose}
		onkeydown={(e) => e.key === 'Escape' && onClose()}
	>
		<div class="lightbox-frame" onclick={(e) => e.stopPropagation()} role="presentation">
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
		background: rgba(7, 10, 15, 0.9);
		backdrop-filter: blur(8px);
		display: grid;
		place-items: center;
		padding: 20px;
	}

	.lightbox-frame {
		position: relative;
		max-width: 96vw;
		max-height: 92vh;
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: 10px;
	}

	.close-btn {
		background: var(--ink-2);
		border: 1px solid var(--rule-strong);
		color: var(--text);
		font-size: 13px;
		font-weight: 500;
		padding: 6px 12px;
		border-radius: 7px;
		cursor: pointer;
	}

	.close-btn:hover {
		background: var(--ink-3);
	}

	.lightbox-img {
		max-width: 96vw;
		max-height: calc(92vh - 46px);
		width: auto;
		height: auto;
		object-fit: contain;
		border-radius: 6px;
		border: 1px solid var(--rule-strong);
		background: var(--stage-black);
	}
</style>
