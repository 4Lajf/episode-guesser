import { json, type Handle } from '@sveltejs/kit';

interface Bucket {
	tokens: number;
	lastRefill: number;
}

interface LimitConfig {
	capacity: number;
	refillPerSec: number;
}

const API_LIMIT: LimitConfig = { capacity: 30, refillPerSec: 1.2 };
const IMAGE_LIMIT: LimitConfig = { capacity: 90, refillPerSec: 3.0 };

const apiBuckets = new Map<string, Bucket>();
const imageBuckets = new Map<string, Bucket>();

function consumeToken(
	map: Map<string, Bucket>,
	ip: string,
	cfg: LimitConfig
): { allowed: boolean; retryAfterSec: number } {
	const now = Date.now();
	let bucket = map.get(ip);

	if (!bucket) {
		bucket = { tokens: cfg.capacity, lastRefill: now };
	} else {
		const elapsedSec = (now - bucket.lastRefill) / 1000;
		bucket.tokens = Math.min(cfg.capacity, bucket.tokens + elapsedSec * cfg.refillPerSec);
		bucket.lastRefill = now;
	}

	if (bucket.tokens < 1) {
		map.set(ip, bucket);
		const retryAfterSec = Math.ceil((1 - bucket.tokens) / cfg.refillPerSec);
		return { allowed: false, retryAfterSec };
	}

	bucket.tokens -= 1;
	if (map.size > 5000) {
		const oldest = map.keys().next().value;
		if (oldest) map.delete(oldest);
	}
	map.set(ip, bucket);
	return { allowed: true, retryAfterSec: 0 };
}

function getTrustedClientIp(event: Parameters<Handle>[0]['event']): string {
	// Rely on @sveltejs/adapter-node's ADDRESS_HEADER + XFF_DEPTH (configured in Dockerfile)
	// rather than reading an untrusted leftmost X-Forwarded-For value.
	try {
		return event.getClientAddress() || 'unknown';
	} catch {
		return 'unknown';
	}
}

export const handle: Handle = async ({ event, resolve }) => {
	const pathname = event.url.pathname;

	if (
		pathname.startsWith('/api/round') ||
		pathname.startsWith('/api/anilist') ||
		pathname.startsWith('/api/guess')
	) {
		const ip = getTrustedClientIp(event);
		const { allowed, retryAfterSec } = consumeToken(apiBuckets, ip, API_LIMIT);
		if (!allowed) {
			return json(
				{ error: 'Too many requests. Wait a moment and try again.' },
				{ status: 429, headers: { 'retry-after': String(retryAfterSec) } }
			);
		}
	} else if (pathname.startsWith('/api/image/')) {
		const ip = getTrustedClientIp(event);
		const { allowed, retryAfterSec } = consumeToken(imageBuckets, ip, IMAGE_LIMIT);
		if (!allowed) {
			return new Response('Too many image requests', {
				status: 429,
				headers: { 'retry-after': String(retryAfterSec) }
			});
		}
	}

	return resolve(event);
};
