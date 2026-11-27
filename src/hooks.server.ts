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

let warnedFallbackIp = false;

function getTrustedClientIp(event: Parameters<Handle>[0]['event']): string {
	try {
		const addr = event.getClientAddress();
		if (addr) return addr;
	} catch {
		// fall through
	}
	if (!warnedFallbackIp) {
		warnedFallbackIp = true;
		console.warn(
			'[episode-guesser] Could not resolve client IP via adapter-node; verify ADDRESS_HEADER / XFF_DEPTH.'
		);
	}
	return 'unknown';
}

const CSP = [
	"default-src 'self'",
	"script-src 'self' 'unsafe-inline'",
	"style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
	"font-src 'self' https://fonts.gstatic.com",
	"img-src 'self' https://s4.anilist.co data: blob:",
	"connect-src 'self'",
	"frame-ancestors 'none'",
	"base-uri 'self'",
	"form-action 'self'"
].join('; ');

export const handle: Handle = async ({ event, resolve }) => {
	const pathname = event.url.pathname;

	if (
		pathname.startsWith('/api/round') ||
		pathname.startsWith('/api/anilist') ||
		pathname.startsWith('/api/guess') ||
		pathname.startsWith('/api/autocomplete')
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

	const response = await resolve(event);
	response.headers.set('x-content-type-options', 'nosniff');
	response.headers.set('referrer-policy', 'strict-origin-when-cross-origin');
	response.headers.set('x-frame-options', 'DENY');
	if (!pathname.startsWith('/api/')) {
		response.headers.set('content-security-policy', CSP);
		if (response.headers.get('content-type')?.includes('text/html')) {
			response.headers.set('cache-control', 'no-cache, no-store, must-revalidate');
		}
	}
	return response;
};
