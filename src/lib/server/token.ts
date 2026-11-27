import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

let cachedKey: Buffer | null = null;

function getKey(): Buffer {
	if (cachedKey) return cachedKey;

	const envSecret = process.env.SESSION_SECRET || process.env.EPISODE_GUESSER_SECRET;
	if (envSecret && envSecret.length >= 16) {
		cachedKey = createHash('sha256').update(envSecret).digest();
		return cachedKey;
	}

	if (process.env.NODE_ENV === 'production') {
		console.warn(
			'[episode-guesser] WARNING: SESSION_SECRET is not set in production. Tokens will be invalidated across container redeploys without a persistent /app/.cache volume.'
		);
	}

	// Persist a local key in .cache/.secret so tokens survive server restarts
	const cacheDir = join(process.cwd(), '.cache');
	const secretPath = join(cacheDir, '.secret');
	try {
		if (existsSync(secretPath)) {
			const raw = readFileSync(secretPath, 'utf8').trim();
			if (raw.length >= 32) {
				cachedKey = createHash('sha256').update(raw).digest();
				return cachedKey;
			}
		}
		mkdirSync(cacheDir, { recursive: true });
		const generated = randomBytes(32).toString('hex');
		writeFileSync(secretPath, generated, { mode: 0o600 });
		cachedKey = createHash('sha256').update(generated).digest();
		return cachedKey;
	} catch {
		cachedKey = randomBytes(32);
		return cachedKey;
	}
}

export function sealPayload<T extends object>(payload: T): string {
	const key = getKey();
	const iv = randomBytes(12);
	const cipher = createCipheriv('aes-256-gcm', key, iv);
	const plaintext = Buffer.from(JSON.stringify(payload), 'utf8');
	const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
	const tag = cipher.getAuthTag();
	return Buffer.concat([iv, tag, encrypted]).toString('base64url');
}

export function unsealPayload<T>(token: string): T | null {
	try {
		const raw = Buffer.from(token, 'base64url');
		if (raw.length < 29) return null;
		const iv = raw.subarray(0, 12);
		const tag = raw.subarray(12, 28);
		const data = raw.subarray(28);
		const decipher = createDecipheriv('aes-256-gcm', getKey(), iv);
		decipher.setAuthTag(tag);
		const decrypted = Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
		return JSON.parse(decrypted) as T;
	} catch {
		return null;
	}
}
