export const ALLOWED_IMAGE_HOSTS = new Set([
	'artworks.thetvdb.com',
	'thetvdb.com',
	'www.thetvdb.com',
	'image.tmdb.org',
	's4.anilist.co'
]);

export const ALLOWED_IMAGE_MIMES = new Set([
	'image/jpeg',
	'image/jpg',
	'image/png',
	'image/webp',
	'image/avif',
	'image/gif'
]);

export const MAX_IMAGE_BYTES = 8 * 1024 * 1024; // 8 MB

export function isAllowedImageUrl(raw: unknown): raw is string {
	if (typeof raw !== 'string') return false;
	try {
		const parsed = new URL(raw);
		if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false;
		return ALLOWED_IMAGE_HOSTS.has(parsed.hostname.toLowerCase());
	} catch {
		return false;
	}
}
