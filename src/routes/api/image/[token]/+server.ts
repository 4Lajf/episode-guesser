import { error } from '@sveltejs/kit';
import sharp from 'sharp';
import {
	ALLOWED_IMAGE_MIMES,
	isAllowedImageUrl,
	MAX_IMAGE_BYTES
} from '$lib/server/imageHost';
import type { CropSpec, SealedImageSecret } from '$lib/server/picker';
import { unsealPayload } from '$lib/server/token';
import type { RequestHandler } from './$types';

const MAX_REDIRECTS = 2;
const MAX_CACHE_ENTRIES = 64;

interface CachedImageResponse {
	bytes: Uint8Array;
	mime: string;
	expiresAt: number;
}

// Keyed by canonical upstream URL + crop parameters (not per-player token) so all players
// share cached Global Daily & common episode frames without re-fetching from TVDB.
const renderedCache = new Map<string, CachedImageResponse>();

function makeCacheKey(url: string, crop?: CropSpec): string {
	if (!crop || crop.scale <= 1.01) return `${url}|full`;
	return `${url}|${crop.scale.toFixed(2)}|${Math.round(crop.originX)}|${Math.round(crop.originY)}`;
}

function putRenderedCache(key: string, entry: CachedImageResponse): void {
	if (renderedCache.size >= MAX_CACHE_ENTRIES) {
		const first = renderedCache.keys().next().value;
		if (first) renderedCache.delete(first);
	}
	renderedCache.set(key, entry);
}

async function fetchAllowlistedImage(
	initialUrl: string,
	signal: AbortSignal
): Promise<{
	buffer: Buffer;
	contentType: string;
}> {
	let currentUrl = initialUrl;

	for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
		if (!isAllowedImageUrl(currentUrl)) {
			throw error(403, 'Disallowed upstream image host');
		}

		let res: Response;
		try {
			res = await fetch(currentUrl, {
				redirect: 'manual',
				headers: {
					Accept: 'image/avif,image/webp,image/jpeg,image/png,*/*',
					'User-Agent': 'episode-guesser.karczma.moe/1.0'
				},
				signal
			});
		} catch (err) {
			if (err instanceof Error && err.name === 'AbortError') {
				throw error(504, 'Upstream image request timed out');
			}
			throw error(502, 'Could not reach upstream image host');
		}

		if (res.status >= 300 && res.status < 400) {
			const location = res.headers.get('location');
			if (!location || hop === MAX_REDIRECTS) {
				throw error(502, 'Blocked upstream redirect');
			}
			try {
				currentUrl = new URL(location, currentUrl).toString();
			} catch {
				throw error(502, 'Invalid redirect target');
			}
			continue;
		}

		if (!res.ok || !res.body) {
			throw error(502, 'Could not fetch screencap');
		}

		const rawMime = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
		if (!ALLOWED_IMAGE_MIMES.has(rawMime)) {
			throw error(502, 'Upstream did not return a supported raster image');
		}

		const contentLength = Number(res.headers.get('content-length') || '0');
		if (contentLength > MAX_IMAGE_BYTES) {
			throw error(502, 'Upstream image exceeds maximum allowed size');
		}

		const reader = res.body.getReader();
		const chunks: Uint8Array[] = [];
		let total = 0;
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			if (value) {
				total += value.byteLength;
				if (total > MAX_IMAGE_BYTES) {
					await reader.cancel();
					throw error(502, 'Upstream image exceeds maximum allowed size');
				}
				chunks.push(value);
			}
		}

		return { buffer: Buffer.concat(chunks), contentType: rawMime };
	}

	throw error(502, 'Too many redirects');
}

async function applyServerCrop(buffer: Buffer, crop: CropSpec): Promise<Buffer> {
	const image = sharp(buffer, { failOn: 'none' });
	const meta = await image.metadata();
	const w = meta.width ?? 0;
	const h = meta.height ?? 0;
	if (w < 64 || h < 64) return buffer;

	const rawScale = Math.min(4, Math.max(1.01, crop.scale));
	// Cap effective zoom on legacy SD stills (<= 420px wide) so crops stay readable
	const scale = w <= 420 ? Math.min(rawScale, 1.75) : rawScale;
	const cropW = Math.max(32, Math.round(w / scale));
	const cropH = Math.max(18, Math.round(h / scale));

	const centerX = Math.round((Math.min(90, Math.max(10, crop.originX)) / 100) * w);
	const centerY = Math.round((Math.min(90, Math.max(10, crop.originY)) / 100) * h);

	const left = Math.min(Math.max(0, centerX - Math.round(cropW / 2)), w - cropW);
	const top = Math.min(Math.max(0, centerY - Math.round(cropH / 2)), h - cropH);

	let pipeline = image.extract({ left, top, width: cropW, height: cropH });

	// Upscale tight Daily crops cleanly with Lanczos3 + light sharpening so low-res sources
	// don't render as blurry 182x102 patches on 944px desktop viewports
	if (cropW < 960) {
		pipeline = pipeline
			.resize({ width: 960, kernel: 'lanczos3', withoutEnlargement: false })
			.sharpen({ sigma: 0.6 });
	}

	return pipeline.jpeg({ quality: 90, mozjpeg: true }).toBuffer();
}

export const GET: RequestHandler = async ({ params }) => {
	const secret = unsealPayload<SealedImageSecret>(params.token);
	if (!secret || secret.typ !== 'image' || !secret.url || secret.exp < Date.now()) {
		throw error(404, 'Image token expired or invalid');
	}

	if (!isAllowedImageUrl(secret.url)) {
		throw error(403, 'Disallowed upstream image host');
	}

	const cacheKey = makeCacheKey(secret.url, secret.crop);
	const cached = renderedCache.get(cacheKey);
	if (cached && cached.expiresAt > Date.now()) {
		return new Response(new Uint8Array(cached.bytes), {
			status: 200,
			headers: {
				'content-type': cached.mime,
				'cache-control': 'public, max-age=43200, immutable',
				'x-content-type-options': 'nosniff'
			}
		});
	}

	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), 12_000);

	try {
		const { buffer, contentType } = await fetchAllowlistedImage(secret.url, controller.signal);

		let outBuffer = buffer;
		let outMime = contentType;

		if (secret.crop && secret.crop.scale > 1.01) {
			try {
				outBuffer = await applyServerCrop(buffer, secret.crop);
				outMime = 'image/jpeg';
			} catch {
				throw error(502, 'Could not crop episode screencap');
			}
		}

		const bytes = new Uint8Array(outBuffer);
		if (bytes.byteLength <= 1_500_000) {
			putRenderedCache(cacheKey, {
				bytes,
				mime: outMime,
				expiresAt: Math.min(secret.exp, Date.now() + 60 * 60 * 1000)
			});
		}

		return new Response(bytes, {
			status: 200,
			headers: {
				'content-type': outMime,
				'cache-control': 'public, max-age=43200, immutable',
				'x-content-type-options': 'nosniff'
			}
		});
	} finally {
		clearTimeout(timer);
	}
};
