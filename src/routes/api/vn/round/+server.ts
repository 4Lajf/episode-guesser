import { randomUUID } from 'node:crypto';
import { json } from '@sveltejs/kit';
import { getTodayUtcDate } from '$lib/scoring';
import { getAuthUser, PLAYER_COOKIE } from '$lib/server/auth';
import { mintVnImageUrl } from '$lib/server/picker';
import { sealPayload, unsealPayload } from '$lib/server/token';
import {
	getGlobalVnPool,
	getVnFranchiseTitles,
	pickDailyVn,
	pickVnFromPool
} from '$lib/server/vnCatalog';
import { getVnDailyRecord } from '$lib/server/vnDailyStore';
import { fetchVndbUserPool, sanitizeVndbLabels } from '$lib/server/vndbLive';
import type { SealedVnRoundSecret, SealedVnState } from '$lib/server/vnSession';
import type { VnPoolSize, VnReveal, VnRoundPayload } from '$lib/types';
import {
	getVnDailyPuzzleNumber,
	isValidVnDailyDate,
	VN_MAX_ATTEMPTS
} from '$lib/vnScoring';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request, cookies, url }) => {
	let body: {
		subMode?: 'daily' | 'practice' | 'survival';
		dailyDate?: string;
		excludeIds?: string[];
		poolSize?: VnPoolSize;
		vndbUser?: string;
		vndbLabels?: number[];
		vndbToken?: string;
	} = {};

	try {
		body = await request.json();
	} catch {
		body = {};
	}

	const subMode: 'daily' | 'practice' | 'survival' =
		body.subMode === 'practice' || body.subMode === 'survival' ? body.subMode : 'daily';
	const excludeIds = Array.isArray(body.excludeIds)
		? body.excludeIds.filter((x): x is string => typeof x === 'string')
		: [];
	const poolSize: VnPoolSize = body.poolSize === 250 ? 250 : 1000;

	let guestPid = cookies.get(PLAYER_COOKIE);
	if (!guestPid) {
		guestPid = randomUUID();
		cookies.set(PLAYER_COOKIE, guestPid, {
			path: '/',
			httpOnly: true,
			sameSite: 'lax',
			secure: url.protocol === 'https:',
			maxAge: 60 * 60 * 24 * 365
		});
	}

	const authUser = getAuthUser(cookies);
	const playerId = authUser ? `al:${authUser.anilistUserId}` : guestPid;
	const todayUtc = getTodayUtcDate();

	let targetDate = todayUtc;
	if (subMode === 'daily' && body.dailyDate) {
		const cleanDate = body.dailyDate.trim();
		if (!isValidVnDailyDate(cleanDate, todayUtc)) {
			return json({ error: 'Requested VN archive date is out of range.' }, { status: 400 });
		}
		targetDate = cleanDate;
	}
	const isArchive = subMode === 'daily' && targetDate !== todayUtc;

	if (subMode === 'daily') {
		const existing = getVnDailyRecord(playerId, targetDate);
		const existingSecret = existing ? unsealPayload<SealedVnRoundSecret>(existing.roundToken) : null;
		if (existing && existingSecret && existingSecret.typ === 'vn-round') {
			const stage = existing.finished ? 5 : existing.currentStage;
			const hintTags =
				existing.attempts.length >= 2 || existing.finished ? existingSecret.hintTags : undefined;
			const hintQuote =
				(existing.attempts.length >= 3 || existing.finished) && existingSecret.hintQuote
					? existingSecret.hintQuote
					: undefined;
			const restored: VnRoundPayload = {
				roundToken: existing.roundToken,
				stateToken: existing.stateToken,
				imageUrl: existing.currentImageUrl,
				subMode: 'daily',
				stage,
				maxAttempts: VN_MAX_ATTEMPTS,
				isNvl: existingSecret.isNvl,
				scopeLabel: 'Global Daily',
				...(hintTags && hintTags.length > 0 ? { hintTags } : {}),
				...(hintQuote ? { hintQuote } : {}),
				dailyMeta: {
					date: targetDate,
					puzzleNumber: getVnDailyPuzzleNumber(targetDate),
					isArchive
				},
				restore: {
					attempts: existing.attempts,
					finished: existing.finished,
					won: existing.won,
					...(existing.finished && existing.reveal ? { reveal: existing.reveal } : {})
				}
			};
			return json(restored);
		}
	}

	let picked: ReturnType<typeof pickDailyVn>;
	let scopeLabel = poolSize === 250 ? 'Global Top 250' : 'Global Top 1,000';

	try {
		if (subMode === 'daily') {
			picked = pickDailyVn(targetDate);
			scopeLabel = 'Global Daily';
		} else if (body.vndbUser?.trim() || body.vndbToken?.trim()) {
			const userPool = await fetchVndbUserPool({
				usernameOrId: body.vndbUser?.trim() ?? '',
				labelIds: sanitizeVndbLabels(body.vndbLabels),
				token: body.vndbToken?.trim() || undefined
			});
			picked = pickVnFromPool(userPool.pool, excludeIds);
			scopeLabel = `VNDB: ${userPool.username}`;
		} else {
			picked = pickVnFromPool(getGlobalVnPool(poolSize), excludeIds);
		}
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Could not pick a visual novel.';
		return json({ error: message }, { status: 400 });
	}

	const { vn, screen } = picked;
	const roundId = randomUUID();

	const fullImageUrl = mintVnImageUrl(screen.url, 5, vn.isNvl);
	const stage1ImageUrl = mintVnImageUrl(screen.url, 1, vn.isNvl);

	const reveal: VnReveal = {
		id: vn.id,
		title: vn.title,
		enTitle: vn.enTitle,
		year: vn.year,
		released: vn.released,
		lengthMinutes: vn.lengthMinutes,
		lengthBucket: vn.lengthBucket,
		rating: vn.rating,
		developers: vn.developers,
		isNvl: vn.isNvl,
		tags: vn.tags,
		quote: vn.quote ?? null,
		imageUrl: fullImageUrl,
		vndbUrl: `https://vndb.org/${vn.id}`
	};

	const targetTitles = Array.from(
		new Set([vn.title, ...(vn.enTitle ? [vn.enTitle] : []), ...vn.aliases])
	);

	const roundToken = sealPayload<SealedVnRoundSecret>({
		typ: 'vn-round',
		v: 1,
		roundId,
		subMode,
		playerId,
		...(subMode === 'daily' ? { dailyDate: targetDate } : {}),
		createdAt: Date.now(),
		rawImageUrl: screen.url,
		isNvl: vn.isNvl,
		targetId: vn.id,
		targetTitles,
		targetFranchiseIds: vn.franchiseIds,
		targetFranchiseTitles: getVnFranchiseTitles(vn),
		targetYear: vn.year,
		targetLengthMinutes: vn.lengthMinutes,
		targetLengthBucket: vn.lengthBucket,
		targetDevelopers: vn.developers,
		hintTags: vn.tags,
		hintQuote: vn.quote ?? null,
		reveal
	});

	const stateToken = sealPayload<SealedVnState>({
		typ: 'vn-state',
		v: 1,
		roundId,
		subMode,
		playerId,
		...(subMode === 'daily' ? { dailyDate: targetDate } : {}),
		stage: 1,
		attemptsUsed: 0,
		finished: false,
		usedKeys: []
	});

	const payload: VnRoundPayload = {
		roundToken,
		stateToken,
		imageUrl: stage1ImageUrl,
		subMode,
		stage: 1,
		maxAttempts: subMode === 'survival' ? 1 : VN_MAX_ATTEMPTS,
		isNvl: vn.isNvl,
		scopeLabel,
		...(subMode === 'daily'
			? {
					dailyMeta: {
						date: targetDate,
						puzzleNumber: getVnDailyPuzzleNumber(targetDate),
						isArchive
					}
				}
			: {})
	};

	return json(payload);
};
