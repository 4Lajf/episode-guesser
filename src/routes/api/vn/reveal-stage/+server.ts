import { json } from '@sveltejs/kit';
import { getEffectiveDailyPlayerId } from '$lib/server/auth';
import { mintVnImageUrl } from '$lib/server/picker';
import { sealPayload, unsealPayload } from '$lib/server/token';
import type { SealedVnRoundSecret, SealedVnState } from '$lib/server/vnSession';
import { VN_SURVIVAL_STAGE_POINTS } from '$lib/vnScoring';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request, cookies }) => {
	let body: { roundToken?: string; stateToken?: string };
	try {
		body = await request.json();
	} catch {
		return json({ error: 'Invalid JSON request body.' }, { status: 400 });
	}

	if (!body.roundToken || !body.stateToken) {
		return json({ error: 'Missing VN round/state tokens.' }, { status: 400 });
	}

	const secret = unsealPayload<SealedVnRoundSecret>(body.roundToken);
	const state = unsealPayload<SealedVnState>(body.stateToken);
	if (
		!secret ||
		secret.typ !== 'vn-round' ||
		!state ||
		state.typ !== 'vn-state' ||
		secret.roundId !== state.roundId ||
		secret.playerId !== state.playerId ||
		secret.subMode !== 'survival' ||
		state.finished
	) {
		return json({ error: 'Survival session expired or already finished.' }, { status: 400 });
	}

	const effectivePid = getEffectiveDailyPlayerId(cookies);
	if (!effectivePid || effectivePid !== secret.playerId) {
		return json({ error: 'Session cookie mismatch.' }, { status: 403 });
	}

	const nextStage = Math.min(5, state.stage + 1) as 1 | 2 | 3 | 4 | 5;
	const nextImageUrl =
		nextStage >= 5
			? secret.reveal.imageUrl
			: mintVnImageUrl(secret.rawImageUrl, nextStage, secret.isNvl);

	const nextStateToken = sealPayload<SealedVnState>({
		...state,
		stage: nextStage
	});

	return json({
		stage: nextStage,
		imageUrl: nextImageUrl,
		stateToken: nextStateToken,
		stagePoints: VN_SURVIVAL_STAGE_POINTS[nextStage - 1],
		...(nextStage >= 3 && secret.hintTags.length > 0 ? { hintTags: secret.hintTags } : {}),
		...(nextStage >= 4 && secret.hintQuote ? { hintQuote: secret.hintQuote } : {})
	});
};
