import { afterEach, describe, expect, it, vi } from 'vitest';
import { GET as imageGet } from '../src/routes/api/image/[token]/+server';
import type { SealedImageSecret } from '../src/lib/server/picker';
import { sealPayload } from '../src/lib/server/token';

function makeImageEvent(token: string) {
	return {
		params: { token }
	} as unknown as Parameters<typeof imageGet>[0];
}

describe('GET /api/image/[token] SSRF, redirect, MIME, and shared cache', () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('rejects tampered and expired tokens with 404', async () => {
		await expect(imageGet(makeImageEvent('invalid-token'))).rejects.toMatchObject({ status: 404 });

		const expired = sealPayload<SealedImageSecret>({
			typ: 'image',
			url: 'https://artworks.thetvdb.com/banners/v4/episode/1/screencap/expired.jpg',
			exp: Date.now() - 1_000
		});
		await expect(imageGet(makeImageEvent(expired))).rejects.toMatchObject({ status: 404 });
	});

	it('rejects non-allowlisted hosts and redirects to disallowed hosts with 403', async () => {
		const badHostToken = sealPayload<SealedImageSecret>({
			typ: 'image',
			url: 'http://127.0.0.1/internal.jpg',
			exp: Date.now() + 60_000
		});
		await expect(imageGet(makeImageEvent(badHostToken))).rejects.toMatchObject({ status: 403 });

		vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
			new Response(null, {
				status: 302,
				headers: { location: 'https://evil.example.com/ssrf.jpg' }
			})
		);

		const redirectToken = sealPayload<SealedImageSecret>({
			typ: 'image',
			url: 'https://artworks.thetvdb.com/banners/v4/episode/1/screencap/redir.jpg',
			exp: Date.now() + 60_000
		});
		await expect(imageGet(makeImageEvent(redirectToken))).rejects.toMatchObject({ status: 403 });
	});

	it('rejects non-image MIME types and shares cached bytes across distinct player tokens', async () => {
		vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
			new Response('<html>not an image</html>', {
				status: 200,
				headers: { 'content-type': 'text/html' }
			})
		);

		const htmlToken = sealPayload<SealedImageSecret>({
			typ: 'image',
			url: 'https://artworks.thetvdb.com/banners/v4/episode/1/screencap/html.jpg',
			exp: Date.now() + 60_000
		});
		await expect(imageGet(makeImageEvent(htmlToken))).rejects.toMatchObject({ status: 502 });

		const fakeJpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
		const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
			new Response(fakeJpeg, {
				status: 200,
				headers: { 'content-type': 'image/jpeg' }
			})
		);

		const sharedUrl = 'https://artworks.thetvdb.com/banners/v4/episode/999/screencap/shared.jpg';
		const tokenA = sealPayload<SealedImageSecret>({
			typ: 'image',
			url: sharedUrl,
			exp: Date.now() + 60_000
		});
		const tokenB = sealPayload<SealedImageSecret>({
			typ: 'image',
			url: sharedUrl,
			exp: Date.now() + 120_000
		});

		const resA = await imageGet(makeImageEvent(tokenA));
		const resB = await imageGet(makeImageEvent(tokenB));
		expect(resA.status).toBe(200);
		expect(resB.status).toBe(200);
		// Second distinct token for the same canonical URL hits shared cache without re-fetching
		expect(fetchSpy).toHaveBeenCalledTimes(1);
	});
});
