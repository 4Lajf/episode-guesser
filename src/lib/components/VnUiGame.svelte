<script lang="ts">
	import { onMount } from 'svelte';
	import { normalizeTitle } from '$lib/scoring';
	import type {
		TileStatus,
		VnAttemptFeedback,
		VnAutocompleteEntry,
		VnGuessResponse,
		VnReveal,
		VnRoundPayload,
		VnUiSubMode
	} from '$lib/types';
	import {
		buildVnShareText,
		calculateVnPoints,
		formatVnLength,
		VN_MAX_ATTEMPTS,
		VN_STAGE_LABELS
	} from '$lib/vnScoring';

	interface Props {
		onZoom?: (imageUrl: string) => void;
	}

	let { onZoom }: Props = $props();

	let subMode = $state<VnUiSubMode>('daily');
	let autocomplete = $state<VnAutocompleteEntry[]>([]);
	let loading = $state(true);
	let submitting = $state(false);
	let errorMsg = $state<string | null>(null);
	let inlineError = $state<string | null>(null);

	// Preserved state per subMode so toggling Daily <-> Practice never loses progress
	let dailyRound = $state<VnRoundPayload | null>(null);
	let dailyAttempts = $state<VnAttemptFeedback[]>([]);
	let dailyFinished = $state(false);
	let dailyWon = $state(false);
	let dailyReveal = $state<VnReveal | null>(null);
	let dailyStage = $state(1);
	let dailyImageUrl = $state<string | null>(null);
	let dailyStateToken = $state<string | null>(null);
	let dailyHintTags = $state<string[]>([]);

	let practiceRound = $state<VnRoundPayload | null>(null);
	let practiceAttempts = $state<VnAttemptFeedback[]>([]);
	let practiceFinished = $state(false);
	let practiceWon = $state(false);
	let practiceReveal = $state<VnReveal | null>(null);
	let practiceStage = $state(1);
	let practiceImageUrl = $state<string | null>(null);
	let practiceStateToken = $state<string | null>(null);
	let practiceHintTags = $state<string[]>([]);
	let practiceSeenIds = $state<string[]>([]);
	let practiceStreak = $state(0);
	let practiceSolved = $state(0);

	// Input / autocomplete UI state
	let query = $state('');
	let selectedEntry = $state<VnAutocompleteEntry | null>(null);
	let dropdownOpen = $state(false);
	let activeIdx = $state(0);
	let inputEl: HTMLInputElement | null = $state(null);

	let copiedText = $state(false);
	let copiedImage = $state<'idle' | 'copied' | 'saved'>('idle');
	let imgBroken = $state(false);

	const activeRound = $derived(subMode === 'daily' ? dailyRound : practiceRound);
	const attempts = $derived(subMode === 'daily' ? dailyAttempts : practiceAttempts);
	const finished = $derived(subMode === 'daily' ? dailyFinished : practiceFinished);
	const won = $derived(subMode === 'daily' ? dailyWon : practiceWon);
	const reveal = $derived(subMode === 'daily' ? dailyReveal : practiceReveal);
	const stage = $derived(subMode === 'daily' ? dailyStage : practiceStage);
	const imageUrl = $derived(subMode === 'daily' ? dailyImageUrl : practiceImageUrl);
	const stateToken = $derived(subMode === 'daily' ? dailyStateToken : practiceStateToken);
	const hintTags = $derived(subMode === 'daily' ? dailyHintTags : practiceHintTags);

	const points = $derived(calculateVnPoints(attempts, won));

	const stageNote = $derived.by(() => {
		if (finished) return 'Full screenshot revealed';
		const isNvl = activeRound?.isNvl ?? false;
		if (stage === 1) {
			return isNvl
				? 'Stage 1/5 · NVL frame border (text frosted)'
				: 'Stage 1/5 · Textbox skin (dialogue frosted)';
		}
		if (stage === 2) {
			return isNvl
				? 'Stage 2/5 · Crisp NVL interface & typography'
				: 'Stage 2/5 · Crisp UI & typography (nameplate frosted)';
		}
		if (stage === 3) return 'Stage 3/5 · Lower half of the frame';
		if (stage === 4) return 'Stage 4/5 · Wide frame reveal';
		return 'Stage 5/5 · Full frame';
	});

	const shareSummaryLine = $derived(
		won
			? `Solved in ${attempts.length} of ${VN_MAX_ATTEMPTS}`
			: attempts.some((a) => a.gaveUp)
				? 'Gave up'
				: `Missed (${VN_MAX_ATTEMPTS}/${VN_MAX_ATTEMPTS})`
	);

	const showEnTitle = $derived(
		Boolean(
			reveal?.enTitle &&
				reveal.enTitle.trim().toLowerCase() !== reveal.title.trim().toLowerCase()
		)
	);

	const filteredSuggestions = $derived.by(() => {
		const raw = query.trim();
		if (!raw || autocomplete.length === 0) return [];
		const qNorm = normalizeTitle(raw);
		const qLower = raw.toLowerCase();
		if (!qNorm) return [];

		const scored: Array<{ entry: VnAutocompleteEntry; score: number; matchedAlias?: string }> = [];

		for (const entry of autocomplete) {
			const tLower = entry.t.toLowerCase();
			const tNorm = normalizeTitle(entry.t);
			const aLower = entry.a?.toLowerCase() ?? '';
			const aNorm = entry.a ? normalizeTitle(entry.a) : '';

			let best = 0;
			let matchedAlias: string | undefined;

			if (tNorm === qNorm || tLower === qLower) best = 100;
			else if (aNorm && (aNorm === qNorm || aLower === qLower)) {
				best = 96;
				matchedAlias = entry.a;
			} else if (tNorm.startsWith(qNorm) || tLower.startsWith(qLower)) best = 88;
			else if (aNorm && (aNorm.startsWith(qNorm) || aLower.startsWith(qLower))) {
				best = 84;
				matchedAlias = entry.a;
			} else if (tNorm.includes(` ${qNorm}`) || tLower.includes(` ${qLower}`)) best = 74;
			else if (aNorm && (aNorm.includes(` ${qNorm}`) || aLower.includes(` ${qLower}`))) {
				best = 70;
				matchedAlias = entry.a;
			} else if (tNorm.includes(qNorm) || tLower.includes(qLower)) best = 60;
			else if (aNorm && (aNorm.includes(qNorm) || aLower.includes(qLower))) {
				best = 56;
				matchedAlias = entry.a;
			} else if (entry.s && entry.s.length > 0) {
				for (const alias of entry.s) {
					const sNorm = normalizeTitle(alias);
					if (sNorm === qNorm) {
						best = 90;
						matchedAlias = alias;
						break;
					}
					if (sNorm.startsWith(qNorm)) {
						best = Math.max(best, 76);
						matchedAlias = alias;
					} else if (sNorm.includes(qNorm)) {
						best = Math.max(best, 52);
						matchedAlias = alias;
					}
				}
			}

			if (best > 0) {
				scored.push({ entry, score: best, matchedAlias });
			}
		}

		scored.sort((a, b) => b.score - a.score || a.entry.t.length - b.entry.t.length);
		return scored.slice(0, 10);
	});

	async function loadAutocomplete() {
		try {
			const res = await fetch('/api/vn/autocomplete');
			if (!res.ok) return;
			const data = (await res.json()) as { entries?: VnAutocompleteEntry[] };
			if (Array.isArray(data.entries)) {
				autocomplete = data.entries;
			}
		} catch {
			// non-fatal
		}
	}

	async function loadRound(targetMode: VnUiSubMode) {
		loading = true;
		errorMsg = null;
		inlineError = null;
		imgBroken = false;
		query = '';
		selectedEntry = null;
		dropdownOpen = false;

		try {
			const res = await fetch('/api/vn/round', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					subMode: targetMode,
					excludeIds: targetMode === 'practice' ? practiceSeenIds.slice(-30) : []
				})
			});
			const data = await res.json();
			if (!res.ok) {
				errorMsg = data.error || 'Could not load a visual novel interface puzzle.';
				return;
			}

			const payload = data as VnRoundPayload;
			if (targetMode === 'daily') {
				dailyRound = payload;
				dailyStateToken = payload.stateToken;
				dailyStage = payload.stage;
				dailyImageUrl = payload.imageUrl;
				dailyHintTags = payload.hintTags ?? [];
				if (payload.restore) {
					dailyAttempts = payload.restore.attempts;
					dailyFinished = payload.restore.finished;
					dailyWon = payload.restore.won;
					dailyReveal = payload.restore.reveal ?? null;
				} else {
					dailyAttempts = [];
					dailyFinished = false;
					dailyWon = false;
					dailyReveal = null;
				}
			} else {
				practiceRound = payload;
				practiceStateToken = payload.stateToken;
				practiceStage = payload.stage;
				practiceImageUrl = payload.imageUrl;
				practiceHintTags = payload.hintTags ?? [];
				practiceAttempts = [];
				practiceFinished = false;
				practiceWon = false;
				practiceReveal = null;
			}
		} catch {
			errorMsg = 'Network error while loading VN UI puzzle.';
		} finally {
			loading = false;
		}
	}

	function switchSubMode(next: VnUiSubMode) {
		if (next === subMode) return;
		subMode = next;
		errorMsg = null;
		inlineError = null;
		query = '';
		selectedEntry = null;
		dropdownOpen = false;
		imgBroken = false;
		const existing = next === 'daily' ? dailyRound : practiceRound;
		if (!existing) {
			loadRound(next);
		}
	}

	function pickSuggestion(entry: VnAutocompleteEntry) {
		selectedEntry = entry;
		query = entry.t;
		dropdownOpen = false;
		inlineError = null;
		inputEl?.focus();
	}

	function handleKeydown(e: KeyboardEvent) {
		if (!dropdownOpen || filteredSuggestions.length === 0) {
			if (e.key === 'Enter' && query.trim()) {
				e.preventDefault();
				void submitGuess(false);
			}
			return;
		}
		if (e.key === 'ArrowDown') {
			e.preventDefault();
			activeIdx = (activeIdx + 1) % filteredSuggestions.length;
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			activeIdx = (activeIdx - 1 + filteredSuggestions.length) % filteredSuggestions.length;
		} else if (e.key === 'Enter') {
			e.preventDefault();
			const pick = filteredSuggestions[activeIdx]?.entry;
			if (pick && (!selectedEntry || normalizeTitle(selectedEntry.t) !== normalizeTitle(query))) {
				pickSuggestion(pick);
			} else {
				void submitGuess(false);
			}
		} else if (e.key === 'Escape') {
			dropdownOpen = false;
		}
	}

	async function submitGuess(skipped = false) {
		if (!activeRound || !stateToken || submitting || finished) return;
		inlineError = null;
		errorMsg = null;

		let entryToSubmit = selectedEntry;
		const trimmed = query.trim();

		if (!skipped) {
			if (!trimmed) {
				inlineError = 'Type or select a visual novel title first.';
				return;
			}
			if (!entryToSubmit || normalizeTitle(entryToSubmit.t) !== normalizeTitle(trimmed)) {
				const topMatch = filteredSuggestions[0]?.entry ?? null;
				if (topMatch && normalizeTitle(topMatch.t) === normalizeTitle(trimmed)) {
					entryToSubmit = topMatch;
				} else if (topMatch && topMatch.a && normalizeTitle(topMatch.a) === normalizeTitle(trimmed)) {
					entryToSubmit = topMatch;
				}
			}

			const dup = attempts.some(
				(a) =>
					(entryToSubmit && a.guessedId === entryToSubmit.id) ||
					normalizeTitle(a.guessedTitle) === normalizeTitle(entryToSubmit?.t ?? trimmed)
			);
			if (dup) {
				inlineError = `You already guessed "${entryToSubmit?.t ?? trimmed}".`;
				return;
			}
		}

		submitting = true;
		const reqMode = subMode;
		const reqToken = activeRound.roundToken;

		try {
			const res = await fetch('/api/vn/guess', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					roundToken: reqToken,
					stateToken,
					guessedId: skipped ? null : (entryToSubmit?.id ?? null),
					guessedTitle: skipped ? '' : (entryToSubmit?.t ?? trimmed),
					skipped
				})
			});
			const data = await res.json();
			if (!res.ok) {
				inlineError = data.error || 'Could not evaluate guess.';
				if (res.status === 409 || res.status === 403) {
					void loadRound(reqMode);
				}
				return;
			}

			const resp = data as VnGuessResponse;
			imgBroken = false;
			query = '';
			selectedEntry = null;
			dropdownOpen = false;

			if (reqMode === 'daily') {
				dailyAttempts = [...dailyAttempts, resp.attempt];
				dailyFinished = resp.finished;
				dailyWon = resp.won;
				dailyStage = resp.nextStage;
				dailyImageUrl = resp.nextImageUrl;
				dailyStateToken = resp.stateToken;
				if (resp.hintTags) dailyHintTags = resp.hintTags;
				if (resp.reveal) dailyReveal = resp.reveal;
			} else {
				practiceAttempts = [...practiceAttempts, resp.attempt];
				practiceFinished = resp.finished;
				practiceWon = resp.won;
				practiceStage = resp.nextStage;
				practiceImageUrl = resp.nextImageUrl;
				practiceStateToken = resp.stateToken;
				if (resp.hintTags) practiceHintTags = resp.hintTags;
				if (resp.reveal) {
					practiceReveal = resp.reveal;
					if (!practiceSeenIds.includes(resp.reveal.id)) {
						practiceSeenIds = [...practiceSeenIds, resp.reveal.id];
					}
					if (resp.won) {
						practiceStreak += 1;
						practiceSolved += 1;
					} else {
						practiceStreak = 0;
					}
				}
			}
		} catch {
			inlineError = 'Network error while checking guess.';
		} finally {
			submitting = false;
		}
	}

	async function writeTextToClipboard(text: string): Promise<boolean> {
		if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
			try {
				await navigator.clipboard.writeText(text);
				return true;
			} catch {
				// fallback below
			}
		}
		if (typeof document !== 'undefined') {
			try {
				const ta = document.createElement('textarea');
				ta.value = text;
				ta.setAttribute('readonly', '');
				ta.style.position = 'fixed';
				ta.style.opacity = '0';
				document.body.appendChild(ta);
				ta.select();
				const ok = document.execCommand('copy');
				document.body.removeChild(ta);
				return ok;
			} catch {
				return false;
			}
		}
		return false;
	}

	async function copyShareText() {
		const text = buildVnShareText({
			puzzleNumber: activeRound?.dailyMeta?.puzzleNumber,
			isDaily: subMode === 'daily',
			attempts,
			won
		});
		const ok = await writeTextToClipboard(text);
		if (ok) {
			copiedText = true;
			setTimeout(() => (copiedText = false), 2200);
		}
	}

	function svgCellFill(status: TileStatus): string {
		if (status === 'hit') return '#5FBF82';
		if (status === 'close') return '#EBC043';
		return '#272C50';
	}

	function svgIconStroke(status: TileStatus): string {
		return status === 'miss' ? '#B4B9D6' : '#1C2039';
	}

	function drawRoundedRect(
		ctx: CanvasRenderingContext2D,
		x: number,
		y: number,
		w: number,
		h: number,
		r: number
	) {
		ctx.beginPath();
		ctx.moveTo(x + r, y);
		ctx.arcTo(x + w, y, x + w, y + h, r);
		ctx.arcTo(x + w, y + h, x, y + h, r);
		ctx.arcTo(x, y + h, x, y, r);
		ctx.arcTo(x, y, x + w, y, r);
		ctx.closePath();
	}

	function drawCanvasGlyph(
		ctx: CanvasRenderingContext2D,
		kind: 'hit' | 'close' | 'up' | 'down' | 'x',
		cx: number,
		cy: number,
		stroke: string
	) {
		ctx.save();
		ctx.strokeStyle = stroke;
		ctx.lineWidth = 2.4;
		ctx.lineCap = 'round';
		ctx.lineJoin = 'round';
		ctx.beginPath();
		if (kind === 'hit') {
			ctx.moveTo(cx - 7, cy + 0.5);
			ctx.lineTo(cx - 2, cy + 5.5);
			ctx.lineTo(cx + 7, cy - 5.5);
		} else if (kind === 'up') {
			ctx.moveTo(cx, cy + 7);
			ctx.lineTo(cx, cy - 7);
			ctx.moveTo(cx - 5.5, cy - 1.5);
			ctx.lineTo(cx, cy - 7);
			ctx.lineTo(cx + 5.5, cy - 1.5);
		} else if (kind === 'down') {
			ctx.moveTo(cx, cy - 7);
			ctx.lineTo(cx, cy + 7);
			ctx.moveTo(cx - 5.5, cy + 1.5);
			ctx.lineTo(cx, cy + 7);
			ctx.lineTo(cx + 5.5, cy + 1.5);
		} else if (kind === 'close') {
			ctx.moveTo(cx - 6, cy - 2);
			ctx.quadraticCurveTo(cx - 3, cy - 5, cx, cy - 2);
			ctx.quadraticCurveTo(cx + 3, cy + 1, cx + 6, cy - 2);
			ctx.moveTo(cx - 6, cy + 3);
			ctx.quadraticCurveTo(cx - 3, cy, cx, cy + 3);
			ctx.quadraticCurveTo(cx + 3, cy + 6, cx + 6, cy + 3);
		} else {
			ctx.moveTo(cx - 5.5, cy - 5.5);
			ctx.lineTo(cx + 5.5, cy + 5.5);
			ctx.moveTo(cx + 5.5, cy - 5.5);
			ctx.lineTo(cx - 5.5, cy + 5.5);
		}
		ctx.stroke();
		ctx.restore();
	}

	async function copyShareImage() {
		try {
			if (typeof document !== 'undefined' && 'fonts' in document) {
				await document.fonts.ready;
			}
			const canvas = document.createElement('canvas');
			canvas.width = 1200;
			canvas.height = 640;
			const ctx = canvas.getContext('2d');
			if (!ctx) return;

			ctx.scale(2, 2);
			const family = "'Bricolage Grotesque', 'Segoe UI', system-ui, sans-serif";

			drawRoundedRect(ctx, 0, 0, 600, 320, 14);
			ctx.fillStyle = '#F3EFE4';
			ctx.fill();

			ctx.fillStyle = '#1C2039';
			drawRoundedRect(ctx, 236, 16, 34, 10, 5);
			ctx.fill();
			ctx.beginPath();
			ctx.arc(300, 21, 6, 0, Math.PI * 2);
			ctx.fill();
			drawRoundedRect(ctx, 330, 16, 34, 10, 5);
			ctx.fill();

			ctx.textAlign = 'left';
			ctx.fillStyle = '#4A507A';
			ctx.font = `600 15px ${family}`;
			ctx.fillText('Episode Guesser', 36, 84);

			ctx.fillStyle = '#1C2039';
			ctx.font = `700 32px ${family}`;
			const heading =
				subMode === 'daily'
					? `VN UI #${activeRound?.dailyMeta?.puzzleNumber ?? 1}`
					: 'VN UI Practice';
			ctx.fillText(heading, 36, 126);

			ctx.fillStyle = '#4A507A';
			ctx.font = `400 14.5px ${family}`;
			ctx.fillText(
				subMode === 'daily' && activeRound?.dailyMeta?.date
					? activeRound.dailyMeta.date
					: 'Visual Novel Interface Wordle',
				36,
				152
			);

			ctx.fillStyle = '#1C2039';
			ctx.font = `700 24px ${family}`;
			ctx.fillText(shareSummaryLine, 36, 212);

			ctx.fillStyle = '#4A507A';
			ctx.font = `400 15px ${family}`;
			ctx.fillText(`${points.toLocaleString('en-US')} pts · ${VN_STAGE_LABELS[Math.min(attempts.length - 1, 4)] ?? 'Full frame'}`, 36, 238);

			ctx.font = `400 13.5px ${family}`;
			ctx.fillText('episode-guesser.karczma.moe', 36, 288);

			const cols = [332, 392, 452, 512];
			const headers = ['VN', 'Year', 'Len', 'Dev'];
			ctx.textAlign = 'center';
			ctx.fillStyle = '#4A507A';
			ctx.font = `600 12px ${family}`;
			headers.forEach((h, i) => ctx.fillText(h, cols[i] + 25, 60));

			for (let r = 0; r < VN_MAX_ATTEMPTS; r++) {
				const a = attempts[r];
				const y = 70 + r * 44;
				const cy = y + 18;
				if (a) {
					const cells: Array<{
						status: TileStatus;
						glyph: 'hit' | 'close' | 'up' | 'down' | 'x';
					}> = [
						{
							status: a.vnStatus,
							glyph: a.vnStatus === 'hit' ? 'hit' : a.vnStatus === 'close' ? 'close' : 'x'
						},
						{
							status: a.yearStatus,
							glyph:
								a.yearStatus === 'hit'
									? 'hit'
									: a.yearDirection === 'up'
										? 'up'
										: a.yearDirection === 'down'
											? 'down'
											: 'x'
						},
						{
							status: a.lengthStatus,
							glyph:
								a.lengthStatus === 'hit'
									? 'hit'
									: a.lengthDirection === 'up'
										? 'up'
										: a.lengthDirection === 'down'
											? 'down'
											: 'x'
						},
						{
							status: a.studioStatus,
							glyph: a.studioStatus === 'hit' ? 'hit' : 'x'
						}
					];
					cells.forEach((cell, cIdx) => {
						drawRoundedRect(ctx, cols[cIdx], y, 50, 36, 5);
						ctx.fillStyle = svgCellFill(cell.status);
						ctx.fill();
						drawCanvasGlyph(ctx, cell.glyph, cols[cIdx] + 25, cy, svgIconStroke(cell.status));
					});
				} else {
					ctx.strokeStyle = '#C7C0AD';
					ctx.lineWidth = 1.5;
					for (const x of cols) {
						drawRoundedRect(ctx, x + 0.75, y + 0.75, 48.5, 34.5, 5);
						ctx.stroke();
					}
				}
			}

			const pngBlob = await new Promise<Blob | null>((resolve) =>
				canvas.toBlob((b) => resolve(b), 'image/png')
			);
			if (!pngBlob) return;

			if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
				try {
					await navigator.clipboard.write([new ClipboardItem({ 'image/png': pngBlob })]);
					copiedImage = 'copied';
					setTimeout(() => (copiedImage = 'idle'), 2200);
					return;
				} catch {
					// fallback to PNG download
				}
			}

			const dlUrl = URL.createObjectURL(pngBlob);
			const link = document.createElement('a');
			link.href = dlUrl;
			link.download = `episode-guesser-vn-ui-${activeRound?.dailyMeta?.puzzleNumber ?? 'practice'}.png`;
			link.click();
			URL.revokeObjectURL(dlUrl);
			copiedImage = 'saved';
			setTimeout(() => (copiedImage = 'idle'), 2200);
		} catch {
			// silent fallback
		}
	}

	onMount(() => {
		void loadAutocomplete();
		void loadRound('daily');
	});
</script>

<div class="vn-wrap">
	<!-- Compact VN Session Sub-Bar -->
	<div class="vn-bar">
		<div class="vn-submodes" role="tablist" aria-label="VN UI mode">
			<button
				type="button"
				role="tab"
				class="sub-pill"
				aria-selected={subMode === 'daily'}
				onclick={() => switchSubMode('daily')}
			>
				Daily VN UI{#if dailyRound?.dailyMeta}&nbsp;<span class="tnum">#{dailyRound.dailyMeta.puzzleNumber}</span>{/if}
			</button>
			<button
				type="button"
				role="tab"
				class="sub-pill"
				aria-selected={subMode === 'practice'}
				onclick={() => switchSubMode('practice')}
			>
				Practice
			</button>
		</div>

		<div class="vn-bar-meta">
			{#if subMode === 'practice'}
				<span class="meta-stat tnum">Streak <b>{practiceStreak}</b></span>
				<span class="meta-dot">·</span>
				<span class="meta-stat tnum">Solved <b>{practiceSolved}</b></span>
			{:else if finished}
				<span class="meta-stat" class:won={won} class:lost={!won}>
					{won ? `Solved in ${attempts.length}/${VN_MAX_ATTEMPTS}` : 'Completed'}
				</span>
			{:else}
				<span class="meta-stat tnum">Guess {attempts.length + 1} of {VN_MAX_ATTEMPTS}</span>
			{/if}
		</div>
	</div>

	{#if errorMsg}
		<div class="vn-error" role="alert">
			<span>{errorMsg}</span>
			<button type="button" class="outline-sm" onclick={() => loadRound(subMode)}>Retry</button>
		</div>
	{/if}

	<div class="cols vn-cols">
		<!-- Left: Server-Masked VN Interface Frame + Progressive Reveal Ladder -->
		<div class="vn-left">
			<div class="vn-stage" class:strip={stage <= 2 && !finished}>
				{#if loading}
					<div class="vn-skeleton" aria-label="Loading visual novel interface">
						<span class="pulse-label">Loading interface frame...</span>
					</div>
				{:else if imageUrl && !imgBroken}
					<button
						type="button"
						class="frame-btn"
						onclick={() => onZoom?.(imageUrl)}
						aria-label="Inspect visual novel interface frame fullscreen"
					>
						<img
							src={imageUrl}
							alt={finished && reveal
								? `${reveal.title} screenshot`
								: `Visual novel interface reveal stage ${stage} of ${VN_MAX_ATTEMPTS}`}
							onerror={() => (imgBroken = true)}
						/>
					</button>
				{:else}
					<div class="vn-skeleton">
						<span class="pulse-label">Could not load interface image.</span>
						<button type="button" class="outline-sm" onclick={() => loadRound(subMode)}>
							Reload
						</button>
					</div>
				{/if}
			</div>

			<div class="vn-stage-foot">
				<span class="stage-note">{stageNote}</span>
				{#if activeRound?.isNvl}
					<span class="fmt-tag">NVL</span>
				{:else if activeRound}
					<span class="fmt-tag">ADV</span>
				{/if}
			</div>

			<!-- 5-Step Reveal Ladder -->
			<ol class="ladder" aria-label="Interface reveal stages">
				{#each VN_STAGE_LABELS as label, idx (label)}
					{@const stepNum = idx + 1}
					<li
						class="ladder-step"
						class:active={!finished && stepNum === stage}
						class:passed={finished || stepNum < stage}
					>
						<span class="step-idx tnum">{stepNum}</span>
						<span class="step-lbl">{label}</span>
					</li>
				{/each}
			</ol>

			<!-- Unlocked non-spoiler VNDB hint tags (appear after 2 misses or on finish) -->
			{#if hintTags.length > 0}
				<div class="hints-box">
					<span class="hints-kicker">VNDB clues</span>
					<div class="hints-list">
						{#each hintTags as tag (tag)}
							<span class="hint-chip">{tag}</span>
						{/each}
					</div>
				</div>
			{:else if !finished}
				<p class="hints-locked">Non-spoiler VNDB tag clues unlock after 2 misses.</p>
			{/if}
		</div>

		<!-- Right: Autocomplete Guess Console + 5x4 Wordle Feedback Grid + Share Card -->
		<div class="vn-right">
			{#if !finished}
				<div class="vn-console">
					<div class="combo-wrap">
						<label class="sr-only" for="vn-title-input">Visual novel title</label>
						<input
							id="vn-title-input"
							bind:this={inputEl}
							type="text"
							autocomplete="off"
							spellcheck="false"
							placeholder="Guess the visual novel..."
							value={query}
							disabled={loading || submitting}
							oninput={(e) => {
								query = (e.currentTarget as HTMLInputElement).value;
								selectedEntry = null;
								dropdownOpen = true;
								activeIdx = 0;
								inlineError = null;
							}}
							onfocus={() => {
								if (query.trim()) dropdownOpen = true;
							}}
							onblur={() => {
								setTimeout(() => (dropdownOpen = false), 140);
							}}
							onkeydown={handleKeydown}
						/>

						{#if dropdownOpen && filteredSuggestions.length > 0}
							<ul class="combo-list" role="listbox" aria-label="Visual novel suggestions">
								{#each filteredSuggestions as item, idx (item.entry.id)}
									<li role="option" aria-selected={idx === activeIdx}>
										<button
											type="button"
											class="combo-opt"
											class:active={idx === activeIdx}
											onmousedown={(e) => {
												e.preventDefault();
												pickSuggestion(item.entry);
											}}
										>
											<span class="opt-main">{item.entry.t}</span>
											{#if item.matchedAlias && item.matchedAlias.toLowerCase() !== item.entry.t.toLowerCase()}
												<span class="opt-sub">{item.matchedAlias}</span>
											{:else if item.entry.a}
												<span class="opt-sub">{item.entry.a}</span>
											{/if}
										</button>
									</li>
								{/each}
							</ul>
						{/if}
					</div>

					<div class="console-actions">
						<button
							type="button"
							class="primary-btn"
							disabled={loading || submitting || !query.trim()}
							onclick={() => submitGuess(false)}
						>
							{submitting ? 'Checking...' : 'Guess'}
						</button>
						<button
							type="button"
							class="quiet-btn"
							disabled={loading || submitting}
							onclick={() => submitGuess(true)}
						>
							Give up
						</button>
					</div>

					{#if inlineError}
						<p class="inline-err" role="alert">{inlineError}</p>
					{/if}
				</div>
			{/if}

			<!-- 5-Row x 4-Column VN Wordle Grid -->
			<div class="vn-grid" role="table" aria-label="Visual novel guesses">
				<div class="g-row g-head" role="row">
					<span class="g-n" role="columnheader"><span class="sr-only">Guess</span></span>
					<span class="cell" role="columnheader">Visual Novel</span>
					<span class="cell num" role="columnheader">Year</span>
					<span class="cell num" role="columnheader">Length</span>
					<span class="cell" role="columnheader">Studio</span>
				</div>

				{#each Array.from({ length: VN_MAX_ATTEMPTS }) as _, idx (idx)}
					{@const a = attempts[idx]}
					{@const isCurrent = !finished && idx === attempts.length}
					{#if a}
						<div class="g-row" role="row">
							<span class="g-n tnum" role="rowheader">{idx + 1}</span>

							<span
								class="cell"
								class:hit={a.vnStatus === 'hit'}
								class:close={a.vnStatus === 'close'}
								class:miss={a.vnStatus === 'miss'}
								class:gave-up={a.gaveUp}
								role="cell"
							>
								<span class="txt">{a.guessedTitle}</span>
								{#if a.vnStatus === 'hit'}
									<svg class="icon" viewBox="0 0 20 20" aria-hidden="true">
										<path d="M4.5 10.5 8 14l7.5-8" />
									</svg>
								{:else if a.vnStatus === 'close'}
									<span class="tilde" aria-hidden="true" title="Same franchise">≈</span>
								{/if}
							</span>

							<span class="cell num {a.yearStatus}" role="cell">
								<span class="tnum">{a.guessedYear ?? '—'}</span>
								{#if a.yearStatus === 'hit'}
									<svg class="icon" viewBox="0 0 20 20" aria-hidden="true">
										<path d="M4.5 10.5 8 14l7.5-8" />
									</svg>
								{:else if a.yearDirection === 'up'}
									<svg class="icon" viewBox="0 0 20 20" aria-hidden="true">
										<path d="M10 16V4M5 9l5-5 5 5" />
									</svg>
								{:else if a.yearDirection === 'down'}
									<svg class="icon" viewBox="0 0 20 20" aria-hidden="true">
										<path d="M10 4v12M5 11l5 5 5-5" />
									</svg>
								{/if}
							</span>

							<span class="cell num {a.lengthStatus}" role="cell">
								<span class="tnum">{formatVnLength(a.guessedLengthMinutes)}</span>
								{#if a.lengthStatus === 'hit'}
									<svg class="icon" viewBox="0 0 20 20" aria-hidden="true">
										<path d="M4.5 10.5 8 14l7.5-8" />
									</svg>
								{:else if a.lengthDirection === 'up'}
									<svg class="icon" viewBox="0 0 20 20" aria-hidden="true">
										<path d="M10 16V4M5 9l5-5 5 5" />
									</svg>
								{:else if a.lengthDirection === 'down'}
									<svg class="icon" viewBox="0 0 20 20" aria-hidden="true">
										<path d="M10 4v12M5 11l5 5 5-5" />
									</svg>
								{/if}
							</span>

							<span class="cell {a.studioStatus}" role="cell">
								<span class="txt">{a.guessedStudio ?? '—'}</span>
							</span>
						</div>
					{:else if isCurrent}
						<div class="g-row" role="row" aria-current="true">
							<span class="g-n tnum" role="rowheader">{idx + 1}</span>
							<span class="cell edit-idle" role="cell"></span>
							<span class="cell empty" role="cell"></span>
							<span class="cell empty" role="cell"></span>
							<span class="cell empty" role="cell"></span>
						</div>
					{:else}
						<div class="g-row" role="row">
							<span class="g-n tnum" role="rowheader">{idx + 1}</span>
							<span class="cell empty" role="cell"></span>
							<span class="cell empty" role="cell"></span>
							<span class="cell empty" role="cell"></span>
							<span class="cell empty" role="cell"></span>
						</div>
					{/if}
				{/each}
			</div>

			{#if !finished}
				<ul class="legend" aria-label="What the colours and arrows mean">
					<li><i class="sw hit" aria-hidden="true"></i>Match</li>
					<li><i class="sw close" aria-hidden="true"></i>Close / Franchise</li>
					<li><i class="sw miss" aria-hidden="true"></i>Miss</li>
					<li><span class="arrow-leg" aria-hidden="true">↑↓</span>Higher / lower</li>
				</ul>
			{/if}

			{#if finished && reveal}
				<div class="vn-finished">
					<div class="answer-block">
						<p class="answer-kicker">
							{subMode === 'daily'
								? `Daily VN UI #${activeRound?.dailyMeta?.puzzleNumber ?? 1} answer`
								: 'Answer'}
						</p>
						<h3 class="answer-title">{reveal.title}</h3>
						{#if showEnTitle}
							<p class="answer-sub">{reveal.enTitle}</p>
						{/if}
						<p class="answer-meta tnum">
							{reveal.year} · {formatVnLength(reveal.lengthMinutes)} · {reveal.developers.join(', ')}{#if reveal.rating}{' · '}{reveal.rating.toFixed(1)}/10{/if}
						</p>
						<a
							class="ext"
							href={reveal.vndbUrl}
							target="_blank"
							rel="noopener noreferrer"
						>
							<span>View on VNDB</span>
							<svg class="icon" viewBox="0 0 20 20" aria-hidden="true">
								<path d="M8.5 5H5v10h10v-3.5M11.5 4H16v4.5M16 4l-7 7" />
							</svg>
						</a>
					</div>

					<!-- Spoiler-Free Share Card -->
					<svg
						class="share-card"
						viewBox="0 0 600 320"
						xmlns="http://www.w3.org/2000/svg"
						role="img"
						aria-label="Share card for VN UI Wordle. {shareSummaryLine}."
					>
						<rect width="600" height="320" rx="14" fill="#F3EFE4" />
						<rect x="236" y="16" width="34" height="10" rx="5" fill="#1C2039" />
						<circle cx="300" cy="21" r="6" fill="#1C2039" />
						<rect x="330" y="16" width="34" height="10" rx="5" fill="#1C2039" />

						<g font-family="'Bricolage Grotesque','Segoe UI',system-ui,sans-serif" fill="#1C2039">
							<text x="36" y="84" font-size="15" font-weight="650" fill="#4A507A">Episode Guesser</text>
							<text x="36" y="126" font-size="32" font-weight="750" letter-spacing="-0.5">
								{subMode === 'daily'
									? `VN UI #${activeRound?.dailyMeta?.puzzleNumber ?? 1}`
									: 'VN UI Practice'}
							</text>
							<text x="36" y="152" font-size="14.5" fill="#4A507A">
								{subMode === 'daily' && activeRound?.dailyMeta?.date
									? activeRound.dailyMeta.date
									: 'Visual Novel Interface Wordle'}
							</text>
							<text x="36" y="212" font-size="24" font-weight="750">{shareSummaryLine}</text>
							<text x="36" y="238" font-size="15" fill="#4A507A">
								{points.toLocaleString('en-US')} pts · {VN_STAGE_LABELS[Math.min(attempts.length - 1, 4)] ?? 'Full frame'}
							</text>
							<text x="36" y="288" font-size="13.5" fill="#4A507A">episode-guesser.karczma.moe</text>

							<g font-size="12" font-weight="650" fill="#4A507A" text-anchor="middle">
								<text x="357" y="60">VN</text>
								<text x="417" y="60">Year</text>
								<text x="477" y="60">Len</text>
								<text x="537" y="60">Dev</text>
							</g>
						</g>

						{#each Array.from({ length: VN_MAX_ATTEMPTS }) as _, r (r)}
							{@const a = attempts[r]}
							{@const y = 70 + r * 44}
							{@const cy = y + 18}
							{#if a}
								<rect x="332" y={y} width="50" height="36" rx="5" fill={svgCellFill(a.vnStatus)} />
								<rect x="392" y={y} width="50" height="36" rx="5" fill={svgCellFill(a.yearStatus)} />
								<rect x="452" y={y} width="50" height="36" rx="5" fill={svgCellFill(a.lengthStatus)} />
								<rect x="512" y={y} width="50" height="36" rx="5" fill={svgCellFill(a.studioStatus)} />

								{#if a.vnStatus === 'hit'}
									<path d="M350 {cy + 0.5}L355 {cy + 5.5}L364 {cy - 5.5}" fill="none" stroke={svgIconStroke(a.vnStatus)} stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" />
								{:else if a.vnStatus === 'close'}
									<path d="M351 {cy - 2}q3 -3 6 0t6 0M351 {cy + 3}q3 -3 6 0t6 0" fill="none" stroke={svgIconStroke(a.vnStatus)} stroke-width="2.1" stroke-linecap="round" />
								{:else}
									<path d="M351.5 {cy - 5.5}L362.5 {cy + 5.5}M362.5 {cy - 5.5}L351.5 {cy + 5.5}" fill="none" stroke={svgIconStroke(a.vnStatus)} stroke-width="2.4" stroke-linecap="round" />
								{/if}

								{#if a.yearStatus === 'hit'}
									<path d="M410 {cy + 0.5}L415 {cy + 5.5}L424 {cy - 5.5}" fill="none" stroke={svgIconStroke(a.yearStatus)} stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" />
								{:else if a.yearDirection === 'up'}
									<path d="M417 {cy + 7}V{cy - 7}M411.5 {cy - 1.5}L417 {cy - 7}L422.5 {cy - 1.5}" fill="none" stroke={svgIconStroke(a.yearStatus)} stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" />
								{:else if a.yearDirection === 'down'}
									<path d="M417 {cy - 7}V{cy + 7}M411.5 {cy + 1.5}L417 {cy + 7}L422.5 {cy + 1.5}" fill="none" stroke={svgIconStroke(a.yearStatus)} stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" />
								{:else}
									<path d="M411.5 {cy - 5.5}L422.5 {cy + 5.5}M422.5 {cy - 5.5}L411.5 {cy + 5.5}" fill="none" stroke={svgIconStroke(a.yearStatus)} stroke-width="2.4" stroke-linecap="round" />
								{/if}

								{#if a.lengthStatus === 'hit'}
									<path d="M470 {cy + 0.5}L475 {cy + 5.5}L484 {cy - 5.5}" fill="none" stroke={svgIconStroke(a.lengthStatus)} stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" />
								{:else if a.lengthDirection === 'up'}
									<path d="M477 {cy + 7}V{cy - 7}M471.5 {cy - 1.5}L477 {cy - 7}L482.5 {cy - 1.5}" fill="none" stroke={svgIconStroke(a.lengthStatus)} stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" />
								{:else if a.lengthDirection === 'down'}
									<path d="M477 {cy - 7}V{cy + 7}M471.5 {cy + 1.5}L477 {cy + 7}L482.5 {cy + 1.5}" fill="none" stroke={svgIconStroke(a.lengthStatus)} stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" />
								{:else}
									<path d="M471.5 {cy - 5.5}L482.5 {cy + 5.5}M482.5 {cy - 5.5}L471.5 {cy + 5.5}" fill="none" stroke={svgIconStroke(a.lengthStatus)} stroke-width="2.4" stroke-linecap="round" />
								{/if}

								{#if a.studioStatus === 'hit'}
									<path d="M530 {cy + 0.5}L535 {cy + 5.5}L544 {cy - 5.5}" fill="none" stroke={svgIconStroke(a.studioStatus)} stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" />
								{:else}
									<path d="M531.5 {cy - 5.5}L542.5 {cy + 5.5}M542.5 {cy - 5.5}L531.5 {cy + 5.5}" fill="none" stroke={svgIconStroke(a.studioStatus)} stroke-width="2.4" stroke-linecap="round" />
								{/if}
							{:else}
								<rect x="332.75" y={y + 0.75} width="48.5" height="34.5" rx="5" fill="none" stroke="#C7C0AD" stroke-width="1.5" />
								<rect x="392.75" y={y + 0.75} width="48.5" height="34.5" rx="5" fill="none" stroke="#C7C0AD" stroke-width="1.5" />
								<rect x="452.75" y={y + 0.75} width="48.5" height="34.5" rx="5" fill="none" stroke="#C7C0AD" stroke-width="1.5" />
								<rect x="512.75" y={y + 0.75} width="48.5" height="34.5" rx="5" fill="none" stroke="#C7C0AD" stroke-width="1.5" />
							{/if}
						{/each}
					</svg>

					<div class="share-actions">
						<button type="button" class="outline-btn" onclick={copyShareImage}>
							{#if copiedImage === 'copied'}
								Copied image
							{:else if copiedImage === 'saved'}
								Saved PNG
							{:else}
								Copy image
							{/if}
						</button>
						<button type="button" class="outline-btn" onclick={copyShareText}>
							{copiedText ? 'Copied text' : 'Copy text'}
						</button>
					</div>

					<div class="next-actions">
						{#if subMode === 'daily'}
							<button type="button" class="primary-btn full" onclick={() => switchSubMode('practice')}>
								Play Practice VN UI
							</button>
						{:else}
							<button type="button" class="primary-btn full" onclick={() => loadRound('practice')}>
								Next visual novel →
							</button>
						{/if}
					</div>
				</div>
			{/if}
		</div>
	</div>
</div>

<style>
	.vn-wrap {
		display: flex;
		flex-direction: column;
		gap: 18px;
	}

	.vn-bar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		flex-wrap: wrap;
		padding-bottom: 12px;
		border-bottom: 1px solid var(--line-soft);
	}

	.vn-submodes {
		display: inline-flex;
		background: var(--ink-raised);
		padding: 3px;
		border-radius: var(--r);
		gap: 4px;
	}

	.sub-pill {
		border: 0;
		background: none;
		color: var(--text-2);
		padding: 6px 14px;
		border-radius: var(--r-sm);
		font-size: 14px;
		font-weight: 650;
		transition: background-color 120ms ease, color 120ms ease;
	}

	.sub-pill:hover {
		color: var(--paper);
	}

	.sub-pill[aria-selected='true'] {
		background: var(--paper);
		color: var(--ink-deep);
	}

	.vn-bar-meta {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 14px;
		color: var(--text-2);
	}

	.meta-stat b {
		color: var(--paper);
	}

	.meta-stat.won {
		color: var(--green);
		font-weight: 650;
	}

	.meta-stat.lost {
		color: var(--text-2);
	}

	.meta-dot {
		color: var(--text-3);
	}

	.vn-error {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		padding: 12px 14px;
		border-radius: var(--r);
		background: var(--danger-soft);
		color: var(--paper);
		font-size: 14px;
	}

	.vn-left {
		display: flex;
		flex-direction: column;
		gap: 12px;
		min-width: 0;
	}

	.vn-stage {
		position: relative;
		width: 100%;
		border-radius: var(--r);
		overflow: hidden;
		background: var(--stage-black);
		border: 1px solid var(--line);
		min-height: 220px;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.vn-stage.strip {
		min-height: 180px;
		background: #0d1022;
	}

	.frame-btn {
		display: block;
		width: 100%;
		padding: 0;
		border: 0;
		background: none;
		cursor: zoom-in;
	}

	.frame-btn img {
		display: block;
		width: 100%;
		height: auto;
		max-height: 540px;
		object-fit: contain;
	}

	.vn-skeleton {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 10px;
		width: 100%;
		min-height: 240px;
		color: var(--text-3);
		font-size: 14px;
	}

	.vn-stage-foot {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
		font-size: 13.5px;
		color: var(--text-2);
	}

	.fmt-tag {
		font-size: 11.5px;
		font-weight: 700;
		letter-spacing: 0.04em;
		padding: 2px 7px;
		border-radius: var(--r-sm);
		background: var(--ink-raised);
		color: var(--blue);
		border: 1px solid var(--line);
	}

	.ladder {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		grid-template-columns: repeat(5, minmax(0, 1fr));
		gap: 6px;
	}

	.ladder-step {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 6px 8px;
		border-radius: var(--r-sm);
		background: var(--ink-raised);
		border: 1px solid var(--line-soft);
		color: var(--text-3);
		font-size: 12px;
		min-width: 0;
	}

	.ladder-step.active {
		border-color: var(--blue);
		color: var(--paper);
		background: var(--blue-soft);
	}

	.ladder-step.passed {
		color: var(--text-2);
		border-color: var(--line);
	}

	.step-idx {
		font-weight: 750;
		flex: none;
	}

	.step-lbl {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.hints-box {
		display: flex;
		flex-direction: column;
		gap: 6px;
		padding: 10px 12px;
		border-radius: var(--r);
		background: var(--ink-raised);
		border: 1px solid var(--line-soft);
	}

	.hints-kicker {
		font-size: 11.5px;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--text-3);
	}

	.hints-list {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}

	.hint-chip {
		font-size: 12.5px;
		padding: 3px 9px;
		border-radius: var(--r-sm);
		background: var(--ink-deep);
		border: 1px solid var(--line);
		color: var(--paper);
	}

	.hints-locked {
		margin: 0;
		font-size: 12.5px;
		color: var(--text-3);
	}

	.vn-right {
		display: flex;
		flex-direction: column;
		gap: 14px;
		min-width: 0;
	}

	.vn-console {
		display: flex;
		flex-direction: column;
		gap: 10px;
	}

	.combo-wrap {
		position: relative;
	}

	.combo-wrap input {
		width: 100%;
		height: 46px;
		padding: 0 14px;
		border-radius: var(--r);
		border: 1.5px solid var(--line-strong);
		background: var(--ink-deep);
		color: var(--paper);
		font-size: 15px;
		font-weight: 500;
		outline: none;
		transition: border-color 120ms ease;
	}

	.combo-wrap input:focus {
		border-color: var(--blue);
	}

	.combo-list {
		position: absolute;
		z-index: 30;
		left: 0;
		right: 0;
		top: calc(100% + 4px);
		margin: 0;
		padding: 4px;
		list-style: none;
		background: var(--ink-deep);
		border: 1px solid var(--line-strong);
		border-radius: var(--r);
		max-height: 290px;
		overflow-y: auto;
		box-shadow: 0 12px 32px rgba(0, 0, 0, 0.45);
	}

	.combo-opt {
		width: 100%;
		border: 0;
		background: none;
		color: var(--paper);
		text-align: left;
		padding: 8px 10px;
		border-radius: var(--r-sm);
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.combo-opt:hover,
	.combo-opt.active {
		background: var(--ink-raised);
	}

	.opt-main {
		font-size: 14px;
		font-weight: 600;
		line-height: 1.25;
	}

	.opt-sub {
		font-size: 12px;
		color: var(--text-3);
		line-height: 1.2;
	}

	.console-actions {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.primary-btn {
		height: 44px;
		padding: 0 20px;
		border: 0;
		border-radius: var(--r);
		background: var(--paper);
		color: var(--ink-deep);
		font-size: 15px;
		font-weight: 750;
		transition: background-color 120ms ease, opacity 120ms ease;
	}

	.primary-btn.full {
		width: 100%;
	}

	.primary-btn:hover:not(:disabled) {
		background: var(--paper-hover);
	}

	.primary-btn:disabled {
		opacity: 0.45;
		cursor: not-allowed;
	}

	.quiet-btn {
		height: 44px;
		padding: 0 14px;
		border: 0;
		border-radius: var(--r);
		background: none;
		color: var(--text-2);
		font-size: 14px;
		font-weight: 600;
	}

	.quiet-btn:hover:not(:disabled) {
		color: var(--paper);
		background: var(--ink-raised);
	}

	.outline-btn,
	.outline-sm {
		border: 1.5px solid var(--line-strong);
		border-radius: var(--r);
		background: none;
		color: var(--paper);
		font-weight: 650;
		transition: border-color 120ms ease, background-color 120ms ease;
	}

	.outline-btn {
		height: 42px;
		padding: 0 14px;
		font-size: 14px;
		flex: 1;
	}

	.outline-sm {
		height: 32px;
		padding: 0 10px;
		font-size: 13px;
	}

	.outline-btn:hover,
	.outline-sm:hover {
		border-color: var(--paper);
		background: var(--ink-raised);
	}

	.inline-err {
		margin: 0;
		font-size: 13px;
		color: var(--danger);
	}

	/* 5x4 Wordle Feedback Grid */
	.vn-grid {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.g-row {
		display: grid;
		grid-template-columns: 18px minmax(0, 1.8fr) 64px 62px minmax(0, 1.1fr);
		gap: 6px;
		align-items: stretch;
	}

	.g-head {
		font-size: 12px;
		font-weight: 600;
		color: var(--text-3);
	}

	.g-head .cell {
		background: none;
		border: 0;
		min-height: auto;
		padding: 0 4px 2px;
		color: var(--text-3);
	}

	.g-n {
		display: grid;
		place-items: center;
		font-size: 12px;
		color: var(--text-3);
	}

	.cell {
		min-height: 44px;
		padding: 6px 8px;
		border-radius: var(--r-sm);
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 4px;
		font-size: 13px;
		font-weight: 650;
		min-width: 0;
		border: 1px solid transparent;
	}

	.cell.num {
		justify-content: center;
		padding: 6px 4px;
		white-space: nowrap;
	}

	.cell .txt {
		overflow: hidden;
		text-overflow: ellipsis;
		display: -webkit-box;
		line-clamp: 2;
		-webkit-line-clamp: 2;
		-webkit-box-orient: vertical;
		line-height: 1.2;
	}

	.cell.hit {
		background: var(--green);
		color: var(--ink-deep);
	}

	.cell.close {
		background: var(--yellow);
		color: var(--ink-deep);
	}

	.cell.miss {
		background: var(--ink-raised);
		color: var(--paper);
		border-color: var(--line);
	}

	.cell.gave-up {
		color: var(--text-3);
		font-style: italic;
	}

	.cell.empty {
		background: rgba(255, 255, 255, 0.02);
		border: 1px dashed var(--line-soft);
	}

	.cell.edit-idle {
		background: rgba(143, 180, 255, 0.06);
		border: 1px solid rgba(143, 180, 255, 0.35);
	}

	.icon {
		width: 15px;
		height: 15px;
		flex: none;
		fill: none;
		stroke: currentColor;
		stroke-width: 2.2;
		stroke-linecap: round;
		stroke-linejoin: round;
	}

	.tilde {
		font-size: 15px;
		font-weight: 800;
		flex: none;
	}

	.legend {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-wrap: wrap;
		gap: 14px;
		font-size: 12.5px;
		color: var(--text-3);
	}

	.legend li {
		display: inline-flex;
		align-items: center;
		gap: 6px;
	}

	.sw {
		width: 10px;
		height: 10px;
		border-radius: 2px;
		display: inline-block;
	}

	.sw.hit {
		background: var(--green);
	}

	.sw.close {
		background: var(--yellow);
	}

	.sw.miss {
		background: var(--ink-raised);
		border: 1px solid var(--line-strong);
	}

	.arrow-leg {
		color: var(--paper);
		font-weight: 700;
	}

	.vn-finished {
		display: flex;
		flex-direction: column;
		gap: 14px;
		padding-top: 12px;
		border-top: 1px solid var(--line);
	}

	.answer-kicker {
		margin: 0 0 4px;
		font-size: 12.5px;
		font-weight: 600;
		color: var(--text-3);
	}

	.answer-title {
		margin: 0;
		font-size: 22px;
		line-height: 1.15;
		font-weight: 800;
		color: var(--paper);
	}

	.answer-sub {
		margin: 4px 0 0;
		font-size: 14px;
		color: var(--text-2);
	}

	.answer-meta {
		margin: 6px 0 10px;
		font-size: 13.5px;
		color: var(--text-2);
	}

	.ext {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		color: var(--blue);
		font-size: 14px;
		font-weight: 650;
		text-decoration: none;
	}

	.ext:hover {
		text-decoration: underline;
	}

	.share-card {
		width: 100%;
		height: auto;
		display: block;
		border-radius: var(--r);
	}

	.share-actions {
		display: flex;
		gap: 8px;
	}

	.next-actions {
		display: flex;
	}

	@media (max-width: 640px) {
		.ladder {
			grid-template-columns: repeat(5, minmax(0, 1fr));
			gap: 4px;
		}

		.ladder-step {
			flex-direction: column;
			gap: 2px;
			padding: 5px 3px;
			text-align: center;
			font-size: 10.5px;
		}

		.g-row {
			grid-template-columns: 14px minmax(0, 1.7fr) 54px 52px minmax(0, 1fr);
			gap: 4px;
		}

		.cell {
			font-size: 11.5px;
			padding: 5px 5px;
			min-height: 40px;
		}
	}
</style>
