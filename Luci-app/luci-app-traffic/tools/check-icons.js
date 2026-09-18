#!/usr/bin/env node
/*
 * Validate the icon set and publish the single machine-readable index.
 *
 * "751 files on disk" was never the same thing as "751 usable icons": a file can
 * be truncated, a manifest row can point at a file that is gone, and a file can
 * exist that no manifest row records - which is how a stale directory once
 * shipped 813 files while the generator reported 751.  This script is the check
 * that catches all three, and it reports coverage the way the page experiences
 * it rather than the way the disk counts it:
 *
 *   name coverage             names with an icon / all catalogue names
 *   domain-weighted coverage  1 - (domains of names without an icon / all domains)
 *
 * The second number is the one that matches what a user sees: the top of the
 * list is what carries the traffic, and 40% of the names can be 70% of the eye
 * contact.  Neither number is a target in itself.
 *
 * Usage: node tools/check-icons.js [--write]
 *   --write   also refresh tools/icons-index.json
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const ICON_DIR = path.join(ROOT, 'htdocs', 'luci-static', 'resources', 'traffic', 'icons');
const APPS = path.join(ROOT, 'root', 'etc', 'traffic', 'apps.tsv');
const MANIFEST = path.join(ICON_DIR, 'SOURCES.tsv');
const INDEX = path.join(__dirname, 'icons-index.json');

const write = process.argv.includes('--write');

function slug(name) {
	return String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

const problems = [];
const warnings = [];

/* ---- what the page can actually resolve ---------------------------------- */
const have = new Set(fs.readdirSync(ICON_DIR).filter(f => f.endsWith('.svg')));
const perName = new Map();
let rows = 0;
for (const line of fs.readFileSync(APPS, 'utf8').split('\n')) {
	if (!line || line.startsWith('#')) continue;
	const [name, domain] = line.split('\t');
	if (!name || !domain) continue;
	rows++;
	perName.set(name, (perName.get(name) || 0) + 1);
}
const names = [...perName.keys()];
const missing = names.filter(n => !have.has(slug(n) + '.svg'));
const coveredNames = names.length - missing.length;
const missingDomains = missing.reduce((s, n) => s + perName.get(n), 0);
const nameCoverage = coveredNames / names.length;
const domainCoverage = 1 - missingDomains / rows;

/* ---- the manifest must describe exactly the files that ship --------------- */
const manifestRows = [];
const seen = new Map();
if (!fs.existsSync(MANIFEST)) {
	problems.push('SOURCES.tsv is missing: the package would redistribute icons with no provenance');
} else {
	for (const line of fs.readFileSync(MANIFEST, 'utf8').split('\n')) {
		if (!line || line.startsWith('#')) continue;
		const cols = line.split('\t');
		const file = cols[0];
		if (!file) continue;
		if (seen.has(file)) problems.push(`duplicate manifest row for ${file}`);
		seen.set(file, true);
		manifestRows.push({ file, application: cols[1] || '', source: cols[2] || '', upstream: cols[3] || '', licence: cols[4] || '', url: cols[5] || '' });
	}
	for (const r of manifestRows) {
		if (!have.has(r.file)) problems.push(`manifest lists ${r.file} but the file does not exist`);
		if (!r.source) warnings.push(`${r.file} has no source set recorded`);
	}
	for (const f of have) {
		if (!seen.has(f)) problems.push(`${f} ships in the package but has no manifest row`);
	}
}

/* ---- every shipped file must be a usable SVG ----------------------------- */
const offenders = [];
for (const f of have) {
	const p = path.join(ICON_DIR, f);
	const st = fs.statSync(p);
	if (st.size === 0) { problems.push(`${f} is empty`); continue; }
	const body = fs.readFileSync(p, 'utf8');
	if (!body.includes('<svg')) { problems.push(`${f} does not contain an <svg> element`); continue; }
	if (!body.includes('viewBox')) offenders.push(f);
}
/* An <svg> with no viewBox still renders in an <img>, it just cannot be scaled
 * predictably, so this is reported and not failed. */
if (offenders.length) warnings.push(`${offenders.length} icon(s) have no viewBox: ${offenders.slice(0, 5).join(', ')}${offenders.length > 5 ? ', ...' : ''}`);

/* ---- publish ------------------------------------------------------------- */
const bySlug = {};
for (const r of manifestRows) bySlug[r.file.replace(/\.svg$/, '')] = r;
const index = {
	generated: new Date().toISOString().slice(0, 10),
	icons: have.size,
	manifestRows: manifestRows.length,
	catalogue: { rows, names: names.length },
	coverage: {
		names: +(nameCoverage * 100).toFixed(1),
		domains: +(domainCoverage * 100).toFixed(1),
	},
	missingByDomains: missing.map(n => ({ name: n, domains: perName.get(n) }))
		.sort((a, b) => b.domains - a.domains).slice(0, 40),
	iconsBySlug: bySlug,
};

console.log(`icons on disk        : ${have.size}`);
console.log(`manifest rows        : ${manifestRows.length}`);
console.log(`catalogue            : ${names.length} names / ${rows} domains`);
console.log(`name coverage        : ${(nameCoverage * 100).toFixed(1)}%  (${coveredNames}/${names.length})`);
console.log(`domain-weighted      : ${(domainCoverage * 100).toFixed(1)}%`);
if (warnings.length) {
	console.log(`\n${warnings.length} warning(s):`);
	for (const w of warnings.slice(0, 20)) console.log('  ! ' + w);
}
if (problems.length) {
	console.log(`\n${problems.length} problem(s):`);
	for (const p of problems.slice(0, 40)) console.log('  x ' + p);
	console.log('\nFAILED');
	process.exit(1);
}
if (write) {
	fs.writeFileSync(INDEX, JSON.stringify(index, null, 1), 'utf8');
	console.log(`\nwrote ${path.relative(ROOT, INDEX)}`);
}
console.log('\nOK');
