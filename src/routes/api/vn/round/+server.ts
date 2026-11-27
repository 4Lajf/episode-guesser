import { randomUUID } from 'node:crypto';
import { json } from '@sveltejs/kit';
import { getTodayUtcDate } from '$lib/scoring';
import { getAuthUser, PLAYER_COOKIE } from '$lib/server/auth';
import { mintVnImageUrl } from '$lib/server/picker';
import { sealPayload, unsealPayload } from '$lib/server/token';
import { getVnFranchiseTitles, pickDailyVn, pickPracticeVn } from '$lib/server/vnCatalog';
import { getVnDailyRecord } from '$lib/server/vnDailyStore';
import type { SealedVnRoundSecret, SealedVnState } from '$lib/server/vnSession';
import type { VnReveal, VnRoundPayload, VnUiSubMode } from '$lib/types';
import { getVnDailyPuzzleNumber, VN_MAX_ATTEMPTS } from '$lib/vnScoring';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request, cookies, url }) => {
	let body: {
		subMode?: VnUiSubMode;
		excludeIds?: string[];
	} = {};

	try {
		body = await request.json();
	} catch {
		body = {};
	}

	const subMode: VnUiSubMode = body.subMode === 'practice' ? 'practice' : 'daily';
	const excludeIds = Array.isArray(body.excludeIds)
		? body.excludeIds.filter((x): x is string => typeof x === 'string')
		: [];

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

	if (subMode === 'daily') {
		const existing = getVnDailyRecord(playerId, todayUtc);
		const existingSecret = existing ? unsealPayload<SealedVnRoundSecret>(existing.roundToken) : null;
		if (existing && existingSecret && existingSecret.typ === 'vn-round') {
			const stage = existing.finished ? 5 : existing.currentStage;
			const hintTags =
				existing.attempts.length >= 2 || existing.finished ? existingSecret.hintTags : undefined;
			const restored: VnRoundPayload = {
				roundToken: existing.roundToken,
				stateToken: existing.stateToken,
				imageUrl: existing.currentImageUrl,
				subMode: 'daily',
				stage,
				maxAttempts: VN_MAX_ATTEMPTS,
				isNvl: existingSecret.isNvl,
				...(hintTags && hintTags.length > 0 ? { hintTags } : {}),
				dailyMeta: {
					date: todayUtc,
					puzzleNumber: getVnDailyPuzzleNumber(todayUtc)
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

	const picked = subMode === 'daily' ? pickDailyVn(todayUtc) : pickPracticeVn(excludeIds);
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
		...(subMode === 'daily' ? { dailyDate: todayUtc } : {}),
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
		reveal
	});

	const stateToken = sealPayload<SealedVnState>({
		typ: 'vn-state',
		v: 1,
		roundId,
		subMode,
		playerId,
		...(subMode === 'daily' ? { dailyDate: todayUtc } : {}),
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
		maxAttempts: VN_MAX_ATTEMPTS,
		isNvl: vn.isNvl,
		...(subMode === 'daily'
			? {
					dailyMeta: {
						date: todayUtc,
						puzzleNumber: getVnDailyPuzzleNumber(todayUtc)
					}
				}
			: {})
	};

	return json(payload);
};
