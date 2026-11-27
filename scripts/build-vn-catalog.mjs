import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const VNDB_API = 'https://api.vndb.org/kana/vn';
const PAGES = 15; // 1,500 most-voted VNs on VNDB (only 15 requests!)
const TARGET_POOL_SIZE = 400;

function sleep(ms) {
	return new Promise((r) => setTimeout(r, ms));
}

function parseYear(released) {
	if (!released || typeof released !== 'string') return null;
	const m = released.match(/^(\d{4})/);
	if (!m) return null;
	const y = Number(m[1]);
	return y >= 1980 && y <= 2030 ? y : null;
}

function approxLengthMinutes(lengthBucket, lengthMinutes) {
	if (typeof lengthMinutes === 'number' && lengthMinutes >= 15) {
		return Math.round(lengthMinutes);
	}
	// Fallback from VNDB length 1..5 enum
	const fallback = { 1: 90, 2: 360, 3: 1200, 4: 2400, 5: 3900 };
	return fallback[lengthBucket] ?? 900;
}

function pickEnglishTitle(vn) {
	const titles = Array.isArray(vn.titles) ? vn.titles : [];
	const enMain = titles.find((t) => t.lang === 'en' && t.main)?.title;
	if (enMain && enMain.toLowerCase() !== vn.title.toLowerCase()) return enMain;
	const enAny = titles.find((t) => t.lang === 'en')?.title;
	if (enAny && enAny.toLowerCase() !== vn.title.toLowerCase()) return enAny;
	return null;
}

function pickBestScreenshots(vn) {
	const raw = Array.isArray(vn.screenshots) ? vn.screenshots : [];
	const sfw = raw.filter((s) => {
		if (!s?.url || !s.url.startsWith('https://t.vndb.org/')) return false;
		const sexual = typeof s.sexual === 'number' ? s.sexual : 0;
		const violence = typeof s.violence === 'number' ? s.violence : 0;
		const w = Array.isArray(s.dims) ? s.dims[0] : 0;
		const h = Array.isArray(s.dims) ? s.dims[1] : 0;
		return sexual < 0.35 && violence < 0.5 && w >= 640 && h >= 360;
	});

	// Score screenshots: prefer English releases (readable ADV/NVL buttons), standard 16:9 / 4:3, HD resolution
	const scored = sfw.map((s) => {
		const langs = (s.release?.languages || []).map((l) => l.lang);
		const hasEn = langs.includes('en');
		const w = s.dims[0];
		const h = s.dims[1];
		const ratio = w / h;
		let score = 0;
		if (hasEn) score += 30;
		if (w >= 1280) score += 20;
		else if (w >= 1000) score += 14;
		else if (w >= 800) score += 8;
		if (ratio >= 1.25 && ratio <= 1.85) score += 10;
		// Slightly prefer original / standard releases over very recent reboots only when dims are comparable
		return {
			id: s.id,
			url: s.url,
			w,
			h,
			lang: hasEn ? 'en' : langs[0] || 'ja',
			score
		};
	});

	scored.sort((a, b) => b.score - a.score);
	return scored.slice(0, 4).map(({ id, url, w, h, lang }) => ({ id, url, w, h, lang }));
}

async function main() {
	const allVns = [];

	for (let page = 1; page <= PAGES; page++) {
		const res = await fetch(VNDB_API, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'User-Agent': 'episode-guesser-vn-catalog/1.0'
			},
			body: JSON.stringify({
				filters: ['votecount', '>=', 100],
				fields:
					'id, title, alttitle, aliases, titles{lang,title,main}, released, length, length_minutes, rating, votecount, developers{name}, tags{name,rating,spoiler,category}, relations{id,relation,title}, screenshots{id,url,dims,sexual,violence,release{languages{lang}}}',
				sort: 'votecount',
				reverse: true,
				results: 100,
				page
			})
		});

		if (!res.ok) {
			const txt = await res.text();
			throw new Error(`VNDB API failed on page ${page}: ${res.status} ${txt}`);
		}

		const data = await res.json();
		const rows = data.results || [];
		allVns.push(...rows);
		console.log(`Fetched page ${page}/${PAGES}: ${rows.length} VNs (total ${allVns.length})`);
		if (!data.more) break;
		await sleep(350);
	}

	const autocomplete = [];
	const pool = [];

	for (const vn of allVns) {
		const year = parseYear(vn.released);
		const enTitle = pickEnglishTitle(vn);
		const lengthMinutes = approxLengthMinutes(vn.length, vn.length_minutes);
		const lengthBucket = typeof vn.length === 'number' && vn.length >= 1 && vn.length <= 5 ? vn.length : 3;
		const developers = Array.from(
			new Set((vn.developers || []).map((d) => d?.name?.trim()).filter(Boolean))
		).slice(0, 3);
		const aliases = Array.from(
			new Set(
				[
					...(Array.isArray(vn.aliases) ? vn.aliases : []),
					...(Array.isArray(vn.titles)
						? vn.titles
								.filter((t) => t.lang === 'en' || t.lang === 'ja')
								.map((t) => t.title)
						: [])
				]
					.map((s) => (typeof s === 'string' ? s.trim() : ''))
					.filter(
						(s) =>
							s.length >= 2 &&
							s.length <= 90 &&
							s.toLowerCase() !== vn.title.toLowerCase() &&
							(!enTitle || s.toLowerCase() !== enTitle.toLowerCase())
					)
			)
		).slice(0, 6);

		const franchiseIds = Array.from(
			new Set(
				(vn.relations || [])
					.filter((r) => r?.id && ['seq', 'preq', 'fan', 'side', 'ser', 'alt', 'orig', 'set'].includes(r.relation))
					.map((r) => r.id)
			)
		);

		autocomplete.push({
			id: vn.id,
			t: vn.title,
			...(enTitle ? { a: enTitle } : {}),
			...(aliases.length ? { s: aliases } : {}),
			y: year,
			lm: lengthMinutes,
			lb: lengthBucket,
			d: developers,
			...(franchiseIds.length ? { f: franchiseIds } : {})
		});

		if (pool.length < TARGET_POOL_SIZE && year && developers.length > 0) {
			const screens = pickBestScreenshots(vn);
			if (screens.length > 0) {
				const tags = Array.isArray(vn.tags) ? vn.tags : [];
				const isNvl = tags.some((t) => t.name === 'NVL' && (t.rating ?? 0) >= 1.5);
				const nonSpoilerTags = tags
					.filter(
						(t) =>
							t.spoiler === 0 &&
							(t.category === 'cont' || t.category === 'tech') &&
							(t.rating ?? 0) >= 2.0 &&
							!/protagonist|heroine|hero|19\d0s|20\d0s/i.test(t.name)
					)
					.sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0))
					.slice(0, 4)
					.map((t) => t.name);

				pool.push({
					id: vn.id,
					title: vn.title,
					enTitle,
					aliases,
					year,
					released: vn.released || String(year),
					lengthMinutes,
					lengthBucket,
					rating: typeof vn.rating === 'number' ? Number((vn.rating / 10).toFixed(2)) : null,
					votecount: vn.votecount ?? 0,
					developers,
					isNvl,
					tags: nonSpoilerTags,
					franchiseIds,
					screens
				});
			}
		}
	}

	const outPath = join(process.cwd(), 'src', 'lib', 'server', 'vnCatalog.json');
	const payload = {
		generatedAt: new Date().toISOString(),
		poolCount: pool.length,
		autocompleteCount: autocomplete.length,
		pool,
		autocomplete
	};
	const jsonStr = JSON.stringify(payload);
	writeFileSync(outPath, jsonStr, 'utf8');
	console.log(
		`Wrote ${outPath}: ${pool.length} playable pool VNs (${pool.reduce((s, v) => s + v.screens.length, 0)} SFW screenshots, ${pool.filter((v) => v.isNvl).length} NVL), ${autocomplete.length} autocomplete entries, ${(jsonStr.length / 1024).toFixed(1)} KB`
	);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
