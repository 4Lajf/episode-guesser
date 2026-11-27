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

async function fetchAllowlistedImage(initialUrl: string, signal: AbortSignal): Promise<{
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

		// Follow redirects only if the Location target is also on ALLOWED_IMAGE_HOSTS
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

		// Read with hard byte ceiling so chunked responses cannot exceed MAX_IMAGE_BYTES
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

	const scale = Math.min(4, Math.max(1.01, crop.scale));
	const cropW = Math.max(32, Math.round(w / scale));
	const cropH = Math.max(18, Math.round(h / scale));

	const centerX = Math.round((Math.min(90, Math.max(10, crop.originX)) / 100) * w);
	const centerY = Math.round((Math.min(90, Math.max(10, crop.originY)) / 100) * h);

	const left = Math.min(Math.max(0, centerX - Math.round(cropW / 2)), w - cropW);
	const top = Math.min(Math.max(0, centerY - Math.round(cropH / 2)), h - cropH);

	return image
		.extract({ left, top, width: cropW, height: cropH })
		.jpeg({ quality: 88, mozjpeg: true })
		.toBuffer();
}

export const GET: RequestHandler = async ({ params }) => {
	const secret = unsealPayload<SealedImageSecret>(params.token);
	if (!secret || !secret.url || secret.exp < Date.now()) {
		throw error(404, 'Image token expired or invalid');
	}

	if (!isAllowedImageUrl(secret.url)) {
		throw error(403, 'Disallowed upstream image host');
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

		return new Response(new Uint8Array(outBuffer), {
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
