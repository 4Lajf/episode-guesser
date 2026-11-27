<script lang="ts">
	import {
		buildWordleShareText,
		WORDLE_MAX_ATTEMPTS,
		WORDLE_ZOOM_STEPS
	} from '$lib/scoring';
	import type { EpisodeReveal, TileStatus, WordleAttemptFeedback } from '$lib/types';

	interface Props {
		puzzleNumber: number;
		puzzleDate: string;
		scopeLabel: string;
		isArchive?: boolean;
		canGoPrevDay?: boolean;
		canGoNextDay?: boolean;
		attempts: WordleAttemptFeedback[];
		finished: boolean;
		won: boolean;
		reveal: EpisodeReveal | null;
		lockedAnimeTitle?: string;
		lockedYear?: number | null;
		liveEpisode?: number;
		hintText?: string;
		onPrevDay?: () => void;
		onNextDay?: () => void;
		onGoToday?: () => void;
		onOpenArchive?: () => void;
		onSwitchClassic?: () => void;
		onSwitchUnlimited?: () => void;
	}

	let {
		puzzleNumber,
		puzzleDate,
		scopeLabel,
		isArchive = false,
		canGoPrevDay = false,
		canGoNextDay = false,
		attempts,
		finished,
		won,
		reveal,
		lockedAnimeTitle = '',
		lockedYear = null,
		liveEpisode = 1,
		hintText = '',
		onPrevDay,
		onNextDay,
		onGoToday,
		onOpenArchive,
		onSwitchClassic,
		onSwitchUnlimited
	}: Props = $props();

	let copiedText = $state(false);
	let copiedImage = $state<'idle' | 'copied' | 'saved'>('idle');
	let resetCountdown = $state('');

	function formatUtcCountdown(): string {
		const now = new Date();
		const nextMidnight = Date.UTC(
			now.getUTCFullYear(),
			now.getUTCMonth(),
			now.getUTCDate() + 1,
			0,
			0,
			0
		);
		const diffSec = Math.max(0, Math.floor((nextMidnight - now.getTime()) / 1000));
		const h = Math.floor(diffSec / 3600);
		const m = Math.floor((diffSec % 3600) / 60);
		return `${h} h ${String(m).padStart(2, '0')} min`;
	}

	$effect(() => {
		resetCountdown = formatUtcCountdown();
		const timer = setInterval(() => {
			resetCountdown = formatUtcCountdown();
		}, 30_000);
		return () => clearInterval(timer);
	});

	function formatNiceDate(iso: string): string {
		const d = new Date(`${iso}T00:00:00Z`);
		if (Number.isNaN(d.getTime())) return iso;
		return d.toLocaleDateString('en-GB', {
			day: 'numeric',
			month: 'long',
			year: 'numeric',
			timeZone: 'UTC'
		});
	}

	// Strictly match server closeness status across UI grid, SVG card, and text share
	function cellTone(status: TileStatus): 'hit' | 'close' | 'miss' {
		if (status === 'hit') return 'hit';
		if (status === 'close') return 'close';
		return 'miss';
	}

	function describeCell(
		kind: 'Year' | 'Episode',
		value: number | null,
		status: TileStatus,
		dir: 'up' | 'down' | 'exact' | null
	): string {
		const valText = value && value > 0 ? String(value) : 'unknown';
		if (status === 'hit') return `${kind} ${valText}, exact match`;
		const prox = status === 'close' ? ', close' : ', miss';
		const dirText =
			dir === 'up' ? ', the answer is later' : dir === 'down' ? ', the answer is earlier' : '';
		return `${kind} ${valText}${prox}${dirText}`;
	}

	function svgCellFill(status: TileStatus): string {
		if (status === 'hit') return '#5FBF82';
		if (status === 'close') return '#EBC043';
		return '#272C50';
	}

	function svgIconStroke(status: TileStatus): string {
		return status === 'miss' ? '#B4B9D6' : '#1C2039';
	}

	const solvedZoomLabel = $derived.by(() => {
		const idx = Math.min(Math.max(0, attempts.length - 1), WORDLE_ZOOM_STEPS.length - 1);
		return `${WORDLE_ZOOM_STEPS[idx].toFixed(1)}× zoom`;
	});

	const animeHitAttempt = $derived(
		attempts.find((a) => a.animeStatus === 'hit')?.attemptNumber ?? null
	);

	const shareSummaryLine = $derived(
		won
			? `Solved in ${attempts.length} of ${WORDLE_MAX_ATTEMPTS}`
			: attempts.some((a) => a.gaveUp)
				? 'Gave up'
				: animeHitAttempt
					? `Anime in ${animeHitAttempt}, ep missed`
					: `Missed (${WORDLE_MAX_ATTEMPTS}/${WORDLE_MAX_ATTEMPTS})`
	);

	const showEnglish = $derived(
		Boolean(
			reveal?.titleEnglish &&
				reveal.titleEnglish.trim().toLowerCase() !== reveal.titleRomaji.trim().toLowerCase()
		)
	);

	async function writeTextToClipboard(text: string): Promise<boolean> {
		if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
			try {
				await navigator.clipboard.writeText(text);
				return true;
			} catch {
				// fall through to textarea copy fallback
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
		const text = buildWordleShareText({
			puzzleNumber,
			scopeLabel,
			attempts,
			won
		});
		const ok = await writeTextToClipboard(text);
		if (ok) {
			copiedText = true;
			setTimeout(() => (copiedText = false), 2200);
		}
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
		ctx.lineWidth = 2.6;
		ctx.lineCap = 'round';
		ctx.lineJoin = 'round';
		ctx.beginPath();
		if (kind === 'hit') {
			ctx.moveTo(cx - 8, cy + 0.5);
			ctx.lineTo(cx - 2.5, cy + 6);
			ctx.lineTo(cx + 8, cy - 6);
		} else if (kind === 'up') {
			ctx.moveTo(cx, cy + 7.5);
			ctx.lineTo(cx, cy - 7.5);
			ctx.moveTo(cx - 6, cy - 1.5);
			ctx.lineTo(cx, cy - 7.5);
			ctx.lineTo(cx + 6, cy - 1.5);
		} else if (kind === 'down') {
			ctx.moveTo(cx, cy - 7.5);
			ctx.lineTo(cx, cy + 7.5);
			ctx.moveTo(cx - 6, cy + 1.5);
			ctx.lineTo(cx, cy + 7.5);
			ctx.lineTo(cx + 6, cy + 1.5);
		} else if (kind === 'close') {
			ctx.moveTo(cx - 7, cy - 2);
			ctx.quadraticCurveTo(cx - 3.5, cy - 5, cx, cy - 2);
			ctx.quadraticCurveTo(cx + 3.5, cy + 1, cx + 7, cy - 2);
			ctx.moveTo(cx - 7, cy + 3);
			ctx.quadraticCurveTo(cx - 3.5, cy, cx, cy + 3);
			ctx.quadraticCurveTo(cx + 3.5, cy + 6, cx + 7, cy + 3);
		} else {
			ctx.moveTo(cx - 6, cy - 6);
			ctx.lineTo(cx + 6, cy + 6);
			ctx.moveTo(cx + 6, cy - 6);
			ctx.lineTo(cx - 6, cy + 6);
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

			// Paper card background
			drawRoundedRect(ctx, 0, 0, 600, 320, 14);
			ctx.fillStyle = '#F3EFE4';
			ctx.fill();

			// Peg holes
			ctx.fillStyle = '#1C2039';
			drawRoundedRect(ctx, 236, 16, 34, 10, 5);
			ctx.fill();
			ctx.beginPath();
			ctx.arc(300, 21, 6, 0, Math.PI * 2);
			ctx.fill();
			drawRoundedRect(ctx, 330, 16, 34, 10, 5);
			ctx.fill();

			// Left typography
			ctx.textAlign = 'left';
			ctx.fillStyle = '#4A507A';
			ctx.font = `600 15px ${family}`;
			ctx.fillText('Episode Guesser', 40, 84);

			ctx.fillStyle = '#1C2039';
			ctx.font = `700 34px ${family}`;
			ctx.fillText(`Daily frame ${puzzleNumber}`, 40, 126);

			ctx.fillStyle = '#4A507A';
			ctx.font = `400 15px ${family}`;
			ctx.fillText(formatNiceDate(puzzleDate), 40, 152);

			ctx.fillStyle = '#1C2039';
			ctx.font = `700 25px ${family}`;
			ctx.fillText(shareSummaryLine, 40, 212);

			ctx.fillStyle = '#4A507A';
			ctx.font = `400 15px ${family}`;
			ctx.fillText(`${scopeLabel}${won ? `, at ${solvedZoomLabel}` : ''}`, 40, 238);

			ctx.font = `400 13.5px ${family}`;
			ctx.fillText('episode-guesser.karczma.moe', 40, 288);

			// Column headers
			ctx.textAlign = 'center';
			ctx.fillStyle = '#4A507A';
			ctx.font = `600 12.5px ${family}`;
			ctx.fillText('Anime', 404, 60);
			ctx.fillText('Year', 468, 60);
			ctx.fillText('Episode', 532, 60);

			// 5x3 grid
			for (let r = 0; r < WORDLE_MAX_ATTEMPTS; r++) {
				const a = attempts[r];
				const y = 70 + r * 44;
				const cy = y + 18;
				const cols = [376, 440, 504];

				if (a) {
					const items: Array<{
						status: TileStatus;
						glyph: 'hit' | 'close' | 'up' | 'down' | 'x';
					}> = [
						{
							status: a.animeStatus,
							glyph: a.animeStatus === 'hit' ? 'hit' : a.animeStatus === 'close' ? 'close' : 'x'
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
							status: a.episodeStatus,
							glyph:
								a.episodeStatus === 'hit' || a.episodeDirection === 'exact'
									? 'hit'
									: a.episodeDirection === 'up'
										? 'up'
										: a.episodeDirection === 'down'
											? 'down'
											: 'x'
						}
					];

					items.forEach((cell, cIdx) => {
						drawRoundedRect(ctx, cols[cIdx], y, 56, 36, 5);
						ctx.fillStyle = svgCellFill(cell.status);
						ctx.fill();
						drawCanvasGlyph(ctx, cell.glyph, cols[cIdx] + 28, cy, svgIconStroke(cell.status));
					});
				} else {
					ctx.strokeStyle = '#C7C0AD';
					ctx.lineWidth = 1.5;
					for (const x of cols) {
						drawRoundedRect(ctx, x + 0.75, y + 0.75, 54.5, 34.5, 5);
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
			link.download = `episode-guesser-daily-${puzzleNumber}.png`;
			link.click();
			URL.revokeObjectURL(dlUrl);
			copiedImage = 'saved';
			setTimeout(() => (copiedImage = 'idle'), 2200);
		} catch {
			// fallback silently
		}
	}
</script>

<div class="daily-board" aria-label="Daily Frame-Wordle guesses">
	<!-- 5-row Anime | Year | Episode Feedback Grid -->
	<div class="guesses" role="table" aria-label="Your guesses today">
		<div class="g-row g-head" role="row">
			<span class="g-n" role="columnheader"><span class="sr-only">Guess</span></span>
			<span class="cell" role="columnheader">Anime</span>
			<span class="cell num" role="columnheader">Year</span>
			<span class="cell num" role="columnheader">Episode</span>
		</div>

		{#each Array.from({ length: WORDLE_MAX_ATTEMPTS }) as _, idx (idx)}
			{@const attempt = attempts[idx]}
			{@const isCurrent = !finished && idx === attempts.length}
			{#if attempt}
				{@const yearTone = cellTone(attempt.yearStatus)}
				{@const epTone = cellTone(attempt.episodeStatus)}
				<div class="g-row" id="daily-row-{idx}" role="row">
					<span class="g-n tnum" role="rowheader">{idx + 1}</span>

					<span
						class="cell"
						class:hit={attempt.animeStatus === 'hit'}
						class:close={attempt.animeStatus === 'close'}
						class:miss={attempt.animeStatus === 'miss'}
						class:gave-up={attempt.gaveUp}
						role="cell"
					>
						<span class="anime-txt">{attempt.guessedTitle}</span>
						{#if attempt.animeStatus === 'hit'}
							<span class="sr-only">, correct</span>
							<svg class="icon" viewBox="0 0 20 20" aria-hidden="true">
								<path d="M4.5 10.5 8 14l7.5-8" />
							</svg>
						{:else if attempt.animeStatus === 'close'}
							<span class="sr-only">, same franchise</span>
							<span class="tilde" aria-hidden="true">≈</span>
						{:else}
							<span class="sr-only">{attempt.gaveUp ? ', forfeited' : ', not the anime'}</span>
						{/if}
					</span>

					<span
						class="cell num {yearTone}"
						role="cell"
						aria-label={describeCell('Year', attempt.guessedYear, attempt.yearStatus, attempt.yearDirection)}
					>
						<span class="tnum">{attempt.guessedYear ?? '—'}</span>
						{#if attempt.yearStatus === 'hit'}
							<svg class="icon" viewBox="0 0 20 20" aria-hidden="true">
								<path d="M4.5 10.5 8 14l7.5-8" />
							</svg>
						{:else if attempt.yearDirection === 'up'}
							<svg class="icon" viewBox="0 0 20 20" aria-hidden="true">
								<path d="M10 16V4M5 9l5-5 5 5" />
							</svg>
						{:else if attempt.yearDirection === 'down'}
							<svg class="icon" viewBox="0 0 20 20" aria-hidden="true">
								<path d="M10 4v12M5 11l5 5 5-5" />
							</svg>
						{/if}
					</span>

					<span
						class="cell num {epTone}"
						role="cell"
						aria-label={describeCell('Episode', attempt.guessedEpisode, attempt.episodeStatus, attempt.episodeDirection)}
					>
						<span class="tnum">{attempt.guessedEpisode > 0 ? attempt.guessedEpisode : '—'}</span>
						{#if attempt.episodeStatus === 'hit'}
							<svg class="icon" viewBox="0 0 20 20" aria-hidden="true">
								<path d="M4.5 10.5 8 14l7.5-8" />
							</svg>
						{:else if attempt.episodeDirection === 'up'}
							<svg class="icon" viewBox="0 0 20 20" aria-hidden="true">
								<path d="M10 16V4M5 9l5-5 5 5" />
							</svg>
						{:else if attempt.episodeDirection === 'down'}
							<svg class="icon" viewBox="0 0 20 20" aria-hidden="true">
								<path d="M10 4v12M5 11l5 5 5-5" />
							</svg>
						{/if}
					</span>
				</div>
			{:else if isCurrent && lockedAnimeTitle}
				<!-- Found-anime carry-forward active row -->
				<div class="g-row" id="daily-row-{idx}" role="row" aria-current="true">
					<span class="g-n tnum" role="rowheader">{idx + 1}</span>
					<span class="cell kept" role="cell">
						<span class="anime-txt">{lockedAnimeTitle}</span>
						<span class="sr-only">, kept from earlier guess</span>
					</span>
					<span class="cell num kept tnum" role="cell">{lockedYear ?? '—'}</span>
					<span class="cell num edit tnum" role="cell">{liveEpisode}</span>
				</div>
			{:else if isCurrent}
				<div class="g-row" id="daily-row-{idx}" role="row" aria-current="true">
					<span class="g-n tnum" role="rowheader">{idx + 1}</span>
					<span class="cell edit-idle" role="cell"></span>
					<span class="cell empty" role="cell"></span>
					<span class="cell empty" role="cell"></span>
				</div>
			{:else}
				<div class="g-row" id="daily-row-{idx}" role="row">
					<span class="g-n tnum" role="rowheader">{idx + 1}</span>
					<span class="cell empty" role="cell"></span>
					<span class="cell empty" role="cell"></span>
					<span class="cell empty" role="cell"></span>
				</div>
			{/if}
		{/each}
	</div>

	{#if !finished && hintText}
		<p class="daily-hint"><b>You found the anime.</b> {hintText}</p>
	{/if}

	{#if !finished}
		<ul class="legend" aria-label="What the colours and arrows mean">
			<li><i class="sw hit" aria-hidden="true"></i>Match</li>
			<li><i class="sw close" aria-hidden="true"></i>Close</li>
			<li><i class="sw miss" aria-hidden="true"></i>Miss</li>
			<li><span class="arrow-leg" aria-hidden="true">↑↓</span>Later / earlier</li>
		</ul>
	{/if}

	{#if finished && reveal}
		<div class="daily-finished">
			<div class="answer-block">
				<p class="answer-kicker">
					{isArchive ? `Daily #${puzzleNumber} answer · ${formatNiceDate(puzzleDate)}` : 'Today’s answer'}
				</p>
				<h3 class="answer-title">{reveal.titleRomaji}</h3>
				{#if showEnglish}
					<p class="answer-sub">{reveal.titleEnglish}</p>
				{/if}
				<p class="answer-ep">
					Episode {reveal.episodeNumber}{#if reveal.episodeTitle}, “{reveal.episodeTitle}”{/if}{#if reveal.seasonYear}{' · '}{reveal.seasonYear}{/if}
				</p>
				<a
					class="ext"
					href={reveal.anilistUrl}
					target="_blank"
					rel="noopener noreferrer"
				>
					<span>{reveal.titleRomaji} on AniList</span>
					<svg class="icon" viewBox="0 0 20 20" aria-hidden="true">
						<path d="M8.5 5H5v10h10v-3.5M11.5 4H16v4.5M16 4l-7 7" />
					</svg>
				</a>
			</div>

			<!-- Punched Paper-Cel Spoiler-Free Share Card -->
			<div class="share-wrap">
				<svg
					class="share-card"
					viewBox="0 0 600 320"
					xmlns="http://www.w3.org/2000/svg"
					role="img"
					aria-label="Share card for Episode Guesser daily frame {puzzleNumber}. {shareSummaryLine}."
				>
					<rect width="600" height="320" rx="14" fill="#F3EFE4" />
					<rect x="236" y="16" width="34" height="10" rx="5" fill="#1C2039" />
					<circle cx="300" cy="21" r="6" fill="#1C2039" />
					<rect x="330" y="16" width="34" height="10" rx="5" fill="#1C2039" />

					<g font-family="'Bricolage Grotesque','Segoe UI',system-ui,sans-serif" fill="#1C2039">
						<text x="40" y="84" font-size="15" font-weight="650" fill="#4A507A">Episode Guesser</text>
						<text x="40" y="126" font-size="34" font-weight="750" letter-spacing="-0.5">
							Daily frame {puzzleNumber}
						</text>
						<text x="40" y="152" font-size="15" fill="#4A507A">{formatNiceDate(puzzleDate)}</text>

						<text x="40" y="212" font-size="25" font-weight="750">{shareSummaryLine}</text>
						<text x="40" y="238" font-size="15" fill="#4A507A">
							{scopeLabel}{won ? `, at ${solvedZoomLabel}` : ''}
						</text>

						<text x="40" y="288" font-size="13.5" fill="#4A507A">episode-guesser.karczma.moe</text>

						<g font-size="12.5" font-weight="650" fill="#4A507A" text-anchor="middle">
							<text x="404" y="60">Anime</text>
							<text x="468" y="60">Year</text>
							<text x="532" y="60">Episode</text>
						</g>
					</g>

					{#each Array.from({ length: WORDLE_MAX_ATTEMPTS }) as _, r (r)}
						{@const a = attempts[r]}
						{@const y = 70 + r * 44}
						{@const cy = y + 18}
						{#if a}
							<rect x="376" y={y} width="56" height="36" rx="5" fill={svgCellFill(a.animeStatus)} />
							{#if a.animeStatus === 'hit'}
								<path
									d="M{404 - 8} {cy + 0.5}L{404 - 2.5} {cy + 6}L{404 + 8} {cy - 6}"
									fill="none"
									stroke={svgIconStroke(a.animeStatus)}
									stroke-width="2.6"
									stroke-linecap="round"
									stroke-linejoin="round"
								/>
							{:else if a.animeStatus === 'close'}
								<path
									d="M{404 - 7} {cy - 2}q3.5 -3 7 0t7 0M{404 - 7} {cy + 3}q3.5 -3 7 0t7 0"
									fill="none"
									stroke={svgIconStroke(a.animeStatus)}
									stroke-width="2.2"
									stroke-linecap="round"
								/>
							{:else}
								<path
									d="M{404 - 6} {cy - 6}L{404 + 6} {cy + 6}M{404 + 6} {cy - 6}L{404 - 6} {cy + 6}"
									fill="none"
									stroke={svgIconStroke(a.animeStatus)}
									stroke-width="2.6"
									stroke-linecap="round"
								/>
							{/if}

							<rect x="440" y={y} width="56" height="36" rx="5" fill={svgCellFill(a.yearStatus)} />
							{#if a.yearStatus === 'hit'}
								<path
									d="M{468 - 8} {cy + 0.5}L{468 - 2.5} {cy + 6}L{468 + 8} {cy - 6}"
									fill="none"
									stroke={svgIconStroke(a.yearStatus)}
									stroke-width="2.6"
									stroke-linecap="round"
									stroke-linejoin="round"
								/>
							{:else if a.yearDirection === 'up'}
								<path
									d="M468 {cy + 7.5}V{cy - 7.5}M{468 - 6} {cy - 1.5}L468 {cy - 7.5}L{468 + 6} {cy - 1.5}"
									fill="none"
									stroke={svgIconStroke(a.yearStatus)}
									stroke-width="2.6"
									stroke-linecap="round"
									stroke-linejoin="round"
								/>
							{:else if a.yearDirection === 'down'}
								<path
									d="M468 {cy - 7.5}V{cy + 7.5}M{468 - 6} {cy + 1.5}L468 {cy + 7.5}L{468 + 6} {cy + 1.5}"
									fill="none"
									stroke={svgIconStroke(a.yearStatus)}
									stroke-width="2.6"
									stroke-linecap="round"
									stroke-linejoin="round"
								/>
							{:else}
								<path
									d="M{468 - 6} {cy - 6}L{468 + 6} {cy + 6}M{468 + 6} {cy - 6}L{468 - 6} {cy + 6}"
									fill="none"
									stroke={svgIconStroke(a.yearStatus)}
									stroke-width="2.6"
									stroke-linecap="round"
								/>
							{/if}

							<rect x="504" y={y} width="56" height="36" rx="5" fill={svgCellFill(a.episodeStatus)} />
							{#if a.episodeStatus === 'hit' || a.episodeDirection === 'exact'}
								<path
									d="M{532 - 8} {cy + 0.5}L{532 - 2.5} {cy + 6}L{532 + 8} {cy - 6}"
									fill="none"
									stroke={svgIconStroke(a.episodeStatus)}
									stroke-width="2.6"
									stroke-linecap="round"
									stroke-linejoin="round"
								/>
							{:else if a.episodeDirection === 'up'}
								<path
									d="M532 {cy + 7.5}V{cy - 7.5}M{532 - 6} {cy - 1.5}L532 {cy - 7.5}L{532 + 6} {cy - 1.5}"
									fill="none"
									stroke={svgIconStroke(a.episodeStatus)}
									stroke-width="2.6"
									stroke-linecap="round"
									stroke-linejoin="round"
								/>
							{:else if a.episodeDirection === 'down'}
								<path
									d="M532 {cy - 7.5}V{cy + 7.5}M{532 - 6} {cy + 1.5}L532 {cy + 7.5}L{532 + 6} {cy + 1.5}"
									fill="none"
									stroke={svgIconStroke(a.episodeStatus)}
									stroke-width="2.6"
									stroke-linecap="round"
									stroke-linejoin="round"
								/>
							{:else}
								<path
									d="M{532 - 6} {cy - 6}L{532 + 6} {cy + 6}M{532 + 6} {cy - 6}L{532 - 6} {cy + 6}"
									fill="none"
									stroke={svgIconStroke(a.episodeStatus)}
									stroke-width="2.6"
									stroke-linecap="round"
								/>
							{/if}
						{:else}
							<rect x="376.75" y={y + 0.75} width="54.5" height="34.5" rx="5" fill="none" stroke="#C7C0AD" stroke-width="1.5" />
							<rect x="440.75" y={y + 0.75} width="54.5" height="34.5" rx="5" fill="none" stroke="#C7C0AD" stroke-width="1.5" />
							<rect x="504.75" y={y + 0.75} width="54.5" height="34.5" rx="5" fill="none" stroke="#C7C0AD" stroke-width="1.5" />
						{/if}
					{/each}
				</svg>

				<div class="share-foot">
					{#if isArchive}
						<p class="countdown">Archive puzzle · {formatNiceDate(puzzleDate)}</p>
					{:else}
						<p class="countdown">Next daily frame in {resetCountdown}.</p>
					{/if}
					<div class="share-actions">
						<button type="button" class="outline" onclick={copyShareImage}>
							{#if copiedImage === 'copied'}
								Copied image
							{:else if copiedImage === 'saved'}
								Saved PNG
							{:else}
								Copy image
							{/if}
						</button>
						<button type="button" class="quiet" onclick={copyShareText}>
							{copiedText ? 'Copied text' : 'Copy as text'}
						</button>
					</div>

					<div class="play-more">
						{#if isArchive && canGoPrevDay && onPrevDay}
							<button type="button" class="primary-next" onclick={onPrevDay}>
								← Previous day
							</button>
						{/if}
						{#if isArchive && canGoNextDay && onNextDay}
							<button type="button" class="outline" onclick={onNextDay}>
								Next day →
							</button>
						{/if}
						{#if !isArchive && onOpenArchive}
							<button type="button" class="primary-next" onclick={onOpenArchive}>
								Play Archive (366 days)
							</button>
						{:else if isArchive && onGoToday}
							<button type="button" class="quiet" onclick={onGoToday}>
								Today’s Daily
							</button>
						{/if}
						{#if onSwitchClassic}
							<button type="button" class="quiet" onclick={onSwitchClassic}>
								Play Classic
							</button>
						{/if}
						{#if onSwitchUnlimited}
							<button type="button" class="quiet" onclick={onSwitchUnlimited}>
								Play Unlimited
							</button>
						{/if}
					</div>
				</div>
			</div>
		</div>
	{/if}
</div>

<style>
	.daily-board {
		display: flex;
		flex-direction: column;
		gap: 16px;
		min-width: 0;
	}

	.icon {
		width: 16px;
		height: 16px;
		flex: none;
		fill: none;
		stroke: currentColor;
		stroke-width: 2.25;
		stroke-linecap: round;
		stroke-linejoin: round;
	}

	.guesses {
		display: grid;
		gap: 6px;
	}

	.g-row {
		display: grid;
		grid-template-columns: 16px minmax(0, 1fr) 78px 78px;
		gap: 6px;
	}

	.g-n {
		display: grid;
		place-items: center;
		font-size: 13px;
		color: var(--text-3);
	}

	.g-head .cell {
		min-height: 0;
		padding-block: 0;
		font-size: 13px;
		font-weight: 600;
		color: var(--text-2);
	}

	.cell {
		min-height: 44px;
		padding: 6px 10px;
		border-radius: var(--r-sm);
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 6px;
		font-size: 14px;
		font-weight: 650;
		line-height: 1.25;
		min-width: 0;
	}

	.anime-txt {
		overflow-wrap: anywhere;
		display: -webkit-box;
		line-clamp: 2;
		-webkit-line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}

	.cell.num {
		justify-content: center;
		gap: 3px;
		padding-inline: 4px;
		font-size: 15.5px;
		white-space: nowrap;
	}

	.g-head .cell.num {
		font-size: 13px;
	}

	.cell.miss {
		background: var(--ink-raised);
		color: var(--paper);
	}

	.cell.miss.gave-up {
		color: var(--text-3);
		font-weight: 550;
	}

	.cell.miss .icon {
		color: var(--text-2);
	}

	.cell.hit {
		background: var(--green);
		color: var(--ink-deep);
	}

	.cell.close {
		background: var(--yellow);
		color: var(--ink-deep);
	}

	.cell.kept {
		color: var(--green);
		box-shadow: inset 0 0 0 1.5px var(--green);
	}

	.cell.edit {
		color: var(--paper);
		box-shadow: inset 0 0 0 1.5px var(--blue);
	}

	.cell.edit-idle {
		box-shadow: inset 0 0 0 1.5px var(--blue);
		background: rgba(143, 180, 255, 0.05);
	}

	.cell.empty {
		box-shadow: inset 0 0 0 1px var(--line);
	}

	.tilde {
		font-weight: 800;
		font-size: 15px;
		flex: none;
	}

	.daily-hint {
		margin: 0;
		font-size: 14.5px;
		color: var(--text-2);
	}

	.daily-hint b {
		color: var(--paper);
		font-weight: 650;
	}

	.legend {
		margin: 0;
		padding: 0;
		list-style: none;
		display: flex;
		flex-wrap: wrap;
		gap: 6px 14px;
		font-size: 13px;
		color: var(--text-2);
	}

	.legend li {
		display: inline-flex;
		align-items: center;
		gap: 6px;
	}

	.sw {
		width: 13px;
		height: 13px;
		border-radius: 3px;
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
		box-shadow: inset 0 0 0 1px var(--line-strong);
	}

	.arrow-leg {
		font-weight: 700;
		color: var(--paper);
	}

	.daily-finished {
		border-top: 1px solid var(--line);
		padding-top: 16px;
		display: flex;
		flex-direction: column;
		gap: 16px;
	}

	.answer-block {
		display: grid;
		gap: 4px;
	}

	.answer-kicker {
		margin: 0;
		font-size: 13px;
		font-weight: 600;
		color: var(--text-2);
	}

	.answer-title {
		margin: 0;
		font-size: 22px;
		font-weight: 750;
		line-height: 1.15;
		color: var(--paper);
	}

	.answer-sub {
		margin: 0;
		font-size: 13.5px;
		color: var(--text-3);
	}

	.answer-ep {
		margin: 2px 0 4px;
		font-size: 14.5px;
		color: var(--text-2);
	}

	.ext {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		color: var(--blue);
		font-size: 14px;
		font-weight: 600;
		text-decoration: none;
		justify-self: start;
	}

	.ext:hover {
		text-decoration: underline;
	}

	.ext .icon {
		stroke-width: 1.75;
	}

	.share-wrap {
		display: grid;
		gap: 12px;
	}

	.share-card {
		width: 100%;
		height: auto;
		border-radius: 10px;
	}

	.share-foot {
		display: flex;
		flex-direction: column;
		gap: 10px;
	}

	.countdown {
		margin: 0;
		font-size: 13.5px;
		color: var(--text-2);
	}

	.share-actions {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
	}

	.play-more {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		padding-top: 8px;
		border-top: 1px solid var(--line-soft);
	}

	.primary-next {
		height: 44px;
		padding: 0 20px;
		border: 0;
		border-radius: var(--r);
		background: var(--paper);
		color: var(--ink-deep);
		font-size: 14.5px;
		font-weight: 750;
		transition: background-color 120ms ease;
	}

	.primary-next:hover {
		background: var(--paper-hover);
	}

	.outline {
		height: 44px;
		padding: 0 18px;
		border-radius: var(--r);
		border: 1.5px solid var(--line-strong);
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

	.quiet {
		height: 44px;
		padding: 0 16px;
		border: 0;
		border-radius: var(--r);
		background: none;
		color: var(--text-2);
		font-size: 14.5px;
		font-weight: 600;
		transition: background-color 120ms ease, color 120ms ease;
	}

	.quiet:hover {
		color: var(--paper);
		background: var(--ink-raised);
	}

	@media (max-width: 560px) {
		.g-row {
			grid-template-columns: 14px minmax(0, 1fr) 70px 70px;
			gap: 5px;
		}
	}
</style>
