import { json, type Handle } from '@sveltejs/kit';

interface Bucket {
	tokens: number;
	lastRefill: number;
}

const RATE_LIMITED_PATHS = ['/api/round', '/api/anilist', '/api/guess'];
const BUCKET_CAPACITY = 30;
const REFILL_PER_SEC = 1.2; // 72 requests/min sustained, 30 burst per IP
const buckets = new Map<string, Bucket>();

function consumeToken(ip: string): { allowed: boolean; retryAfterSec: number } {
	const now = Date.now();
	let bucket = buckets.get(ip);

	if (!bucket) {
		bucket = { tokens: BUCKET_CAPACITY, lastRefill: now };
	} else {
		const elapsedSec = (now - bucket.lastRefill) / 1000;
		bucket.tokens = Math.min(BUCKET_CAPACITY, bucket.tokens + elapsedSec * REFILL_PER_SEC);
		bucket.lastRefill = now;
	}

	if (bucket.tokens < 1) {
		buckets.set(ip, bucket);
		const retryAfterSec = Math.ceil((1 - bucket.tokens) / REFILL_PER_SEC);
		return { allowed: false, retryAfterSec };
	}

	bucket.tokens -= 1;
	if (buckets.size > 5000) {
		const oldest = buckets.keys().next().value;
		if (oldest) buckets.delete(oldest);
	}
	buckets.set(ip, bucket);
	return { allowed: true, retryAfterSec: 0 };
}

export const handle: Handle = async ({ event, resolve }) => {
	const pathname = event.url.pathname;
	if (RATE_LIMITED_PATHS.some((p) => pathname.startsWith(p))) {
		const forwarded = event.request.headers.get('x-forwarded-for');
		const ip =
			forwarded?.split(',')[0]?.trim() ||
			event.request.headers.get('cf-connecting-ip') ||
			event.getClientAddress() ||
			'unknown';

		const { allowed, retryAfterSec } = consumeToken(ip);
		if (!allowed) {
			return json(
				{ error: 'Too many requests. Wait a moment and try again.' },
				{
					status: 429,
					headers: { 'retry-after': String(retryAfterSec) }
				}
			);
		}
	}

	return resolve(event);
};
