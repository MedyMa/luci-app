'use strict';
/* Measure icon coverage exactly the way the page resolves an icon:
 *   file = htdocs/luci-static/resources/traffic/icons/slug(name).svg
 * and weight every miss by the number of domains the catalogue attributes to
 * that name.  The point is to choose the next aliases from traffic instead of
 * from whatever looked missing in a hand-written list. */
const fs = require('fs');
const path = require('path');
const ROOT = 'D:/Code/Luci-app/luci-app-traffic';
const ICONS = path.join(ROOT, 'htdocs', 'luci-static', 'resources', 'traffic', 'icons');
const APPS = path.join(ROOT, 'root', 'etc', 'traffic', 'apps.tsv');

function slug(name) {
	return String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

const have = new Set(fs.readdirSync(ICONS).filter(f => f.endsWith('.svg')).map(f => f.slice(0, -4)));

const perName = new Map();
let rows = 0;
for (const line of fs.readFileSync(APPS, 'utf8').split('\n')) {
	if (!line || line.startsWith('#')) continue;
	const [name, domain] = line.split('\t');
	if (!name || !domain) continue;
	rows++;
	if (!perName.has(name)) perName.set(name, { domains: 0, sample: domain });
	perName.get(name).domains++;
}

const names = [...perName.keys()];
const missing = names.filter(n => !have.has(slug(n)));
const covered = names.length - missing.length;

const missingDomains = missing.reduce((s, n) => s + perName.get(n).domains, 0);
const totalDomains = rows;

console.log('catalogue rows      :', rows);
console.log('distinct app names  :', names.length);
console.log('icons on disk       :', have.size);
console.log('names covered       :', covered, '(' + (covered / names.length * 100).toFixed(1) + '%)');
console.log('names missing       :', missing.length);
console.log('domain-weighted     :', (100 - missingDomains / totalDomains * 100).toFixed(1) + '%');
console.log('');
const ranked = missing.map(n => ({ name: n, d: perName.get(n).domains, sample: perName.get(n).sample }))
	.sort((a, b) => b.d - a.d);
console.log('--- top 30 missing by domain count ---');
for (const r of ranked.slice(0, 30)) {
	console.log(String(r.d).padStart(5), slug(r.name).padEnd(26), r.name.padEnd(22), r.sample);
}
console.log('');
console.log('--- top 20 covered by domain count (sanity: these must NOT be in the gap) ---');
const cov = names.filter(n => !missing.includes(n)).map(n => ({ name: n, d: perName.get(n).domains })).sort((a, b) => b.d - a.d);
for (const r of cov.slice(0, 20)) console.log(String(r.d).padStart(5), slug(r.name).padEnd(26), r.name);

fs.writeFileSync(path.join(ROOT, 'tools', '_icon-coverage.json'),
	JSON.stringify({ rows, names: names.length, have: have.size, covered, missing: ranked }, null, 1));
console.log('\nwritten tools/_icon-coverage.json');
