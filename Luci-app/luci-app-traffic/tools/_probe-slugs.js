'use strict';
/* Verify candidate upstream slugs against the exact sets build-catalog.js queries,
 * so every alias added to BRAND_ALIAS is a measured fact rather than a guess.
 *
 * Usage: node tools/_probe-slugs.js
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

const CACHE = path.join(os.tmpdir(), 'traffic-catalog');
fs.mkdirSync(CACHE, { recursive: true });
const GH_TOKEN = process.env.GH_TOKEN || process.env.GITHUB_TOKEN || '';
const PREFIXES = [ 'logos', 'arcticons', 'cib', 'token', 'devicon', 'skill-icons', 'simple-icons' ];

async function httpText(url, { tries = 3 } = {}) {
	for (let i = 0; i < tries; i++) {
		try {
			const r = await fetch(url, {
				headers: GH_TOKEN && url.includes('api.github.com')
					? { Authorization: 'token ' + GH_TOKEN } : {},
			});
			if (r.ok) return await r.text();
			if (r.status === 404) return null;
		} catch (e) { /* retry */ }
		await new Promise(r => setTimeout(r, 500 * (i + 1)));
	}
	return null;
}

async function ghTree(url, name) {
	const f = path.join(CACHE, name);
	if (fs.existsSync(f) && Date.now() - fs.statSync(f).mtimeMs < 3600e3)
		return JSON.parse(fs.readFileSync(f, 'utf8'));
	const t = await httpText(url);
	if (!t) throw new Error('tree failed: ' + url);
	fs.writeFileSync(f, t, 'utf8');
	return JSON.parse(t);
}

(async () => {
	const [dash, simple, selfhst] = await Promise.all([
		ghTree('https://api.github.com/repos/homarr-labs/dashboard-icons/git/trees/main?recursive=1', 'dashboard-tree.json'),
		ghTree('https://api.github.com/repos/simple-icons/simple-icons/git/trees/develop?recursive=1', 'simple-tree.json'),
		ghTree('https://api.github.com/repos/selfhst/icons/git/trees/main?recursive=1', 'selfhst-tree.json').catch(() => ({ tree: [] })),
	]);
	const sets = new Map();
	sets.set('dashboard-icons', new Set(dash.tree.filter(e => /^svg\/[^/]+\.svg$/.test(e.path)).map(e => e.path.slice(4, -4))));
	sets.set('simple-icons', new Set(simple.tree.filter(e => /^icons\/[^/]+\.svg$/.test(e.path)).map(e => e.path.slice(6, -4))));
	sets.set('selfhst/icons', new Set(selfhst.tree.filter(e => /^svg\/[^/]+\.svg$/.test(e.path)).map(e => e.path.slice(4, -4))));
	for (const p of PREFIXES) {
		const idx = await httpText(`https://api.iconify.design/collection?prefix=${p}`, { tries: 2 });
		if (!idx) continue;
		let j; try { j = JSON.parse(idx); } catch (e) { continue; }
		const s = new Set();
		for (const n of (j.uncategorized || [])) s.add(n);
		for (const arr of Object.values(j.categories || {})) for (const n of arr) s.add(n);
		for (const n of Object.keys(j.aliases || {})) s.add(n);
		sets.set('iconify:' + p, s);
	}
	let total = 0;
	for (const s of sets.values()) total += s.size;
	console.log('index sets built:', [...sets].map(([k, v]) => k + '=' + v.size).join(', '), '| total', total);
	console.log('');

	/* name -> candidate upstream slugs to test */
	const WANT = JSON.parse(fs.readFileSync(path.join(__dirname, '_probe-want.json'), 'utf8'));
	const result = {};
	for (const [name, cands] of Object.entries(WANT)) {
		const hits = [];
		for (const c of cands) {
			for (const [setName, set] of sets) {
				if (set.has(c)) { hits.push({ cand: c, set: setName }); break; }
			}
		}
		result[name] = hits;
		const label = hits.length ? hits.map(h => `${h.cand} <- ${h.set}`).join(' | ') : 'NONE';
		console.log((hits.length ? 'OK  ' : '--  ') + name.padEnd(22), label);
	}
	fs.writeFileSync(path.join(__dirname, '_probe-result.json'), JSON.stringify(result, null, 1), 'utf8');
	console.log('\nwritten tools/_probe-result.json');
})();
