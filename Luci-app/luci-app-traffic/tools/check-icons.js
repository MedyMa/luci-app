#!/usr/bin/env node
/*
 * Validate the icon set and publish the single machine-readable index.
 *
 * "751 files on disk" was never the same thing as "751 usable icons": a file can
 * be truncated, a manifest row can point at a file that is gone, and a file can
 * exist that no manifest row records - which is how a stale directory once
 * shipped 813 files while the generator reported 751.  This script is the check
 * that catches all three, and it reports coverage the way the page experiences
 * it at the direct filename layer:
 *
 *   name coverage             names with an icon / all catalogue names
 *   domain-weighted coverage  1 - (domains of names without an icon / all domains)
 *
 * These are catalogue rule counts, not observed traffic coverage. Page aliases
 * and the separate domain index are exercised by icon-resolution-selftest.js.
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
/* The catalogue also names the icon each application resolves to, which is what
 * lets the manifest's application column be checked against something rather
 * than merely checked for being non-empty. */
const catalogueBySlug = new Map();
let rows = 0;
for (const line of fs.readFileSync(APPS, 'utf8').split('\n')) {
	if (!line || line.startsWith('#')) continue;
	const [name, domain] = line.split('\t');
	if (!name || !domain) continue;
	rows++;
	perName.set(name, (perName.get(name) || 0) + 1);
	if (!catalogueBySlug.has(slug(name))) catalogueBySlug.set(slug(name), name);
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
		/* The header declares seven columns.  Three rows ended at the URL column,
		 * which is invisible in a TSV and exactly the kind of "close enough" that
		 * lets a later column shift go unnoticed, so the shape is checked. */
		if (cols.length !== 7)
			problems.push(`${file}: manifest row has ${cols.length} fields, the header declares 7`);
		/* A row that does not say which application the icon stands for is not
		 * provenance, only a file list.  45 rows were empty here: the repair pass
		 * rewrote the source columns and left column 1 as it found it, and every
		 * one of those slugs is named in the catalogue, so the name was never
		 * unknown.  Where the catalogue names the slug, the two must agree. */
		if (!cols[1]) {
			problems.push(`${file}: manifest row does not name the application`);
		} else {
			const named = catalogueBySlug.get(file.replace(/\.svg$/, ''));
			if (named && cols[1] !== named)
				problems.push(`${file}: application column says "${cols[1]}" but the catalogue names this icon "${named}"`);
		}
		manifestRows.push({ file, application: cols[1] || '', source: cols[2] || '', upstream: cols[3] || '', licence: cols[4] || '', url: cols[5] || '' });
	}
	for (const r of manifestRows) {
		if (!have.has(r.file)) problems.push(`manifest lists ${r.file} but the file does not exist`);
		if (!r.source || r.source === 'unknown' || !r.licence || !r.url)
			problems.push(`${r.file} has incomplete source/licence metadata`);
	}
	for (const f of have) {
		if (!seen.has(f)) problems.push(`${f} ships in the package but has no manifest row`);
	}
}

/* ---- the site/icon map ---------------------------------------------------
 * Rows here answer "which packaged icon stands for this site domain".  Two
 * relations are recorded and they are not interchangeable:
 *   - a brand root, two labels (zoho.com): the icon is the brand's own mark, so
 *     the root label and the packaged slug are the same word;
 *   - a product subdomain, three or more labels (hsr.hoyoverse.com): the site
 *     belongs to a product of that brand and the icon is the product's, which is
 *     why the slug differs from the root label.  Five such rows exist; the icons
 *     they name are reachable through no other row, so they are kept and the
 *     distinction is checked instead of assumed.
 * A two-label row whose slug is not its root label is the defect this catches:
 * it would give a whole brand the icon of one of its products.  expand-icons.js
 * derives the two-label rows with exactly this rule (brandDomain), so a row that
 * disagrees with it can only have been added by hand. */
const DOMAIN_MAP = path.join(__dirname, 'site-icon-domains.tsv');
const domainSeen = new Set();
if (!fs.existsSync(DOMAIN_MAP)) {
	problems.push('tools/site-icon-domains.tsv is missing: the site icon map has no recorded provenance');
} else {
	for (const line of fs.readFileSync(DOMAIN_MAP, 'utf8').split(/\r?\n/)) {
		if (!line || line.startsWith('#')) continue;
		const cols = line.split('\t');
		const domain = cols[0], icon = cols[1];
		if (cols.length !== 3) {
			problems.push(`site-icon-domains.tsv: ${domain} has ${cols.length} fields, the header declares 3`);
			continue;
		}
		if (domainSeen.has(domain)) problems.push(`site-icon-domains.tsv: ${domain} is mapped twice`);
		domainSeen.add(domain);
		if (!have.has(icon + '.svg'))
			problems.push(`site-icon-domains.tsv: ${domain} maps to ${icon}, which is not a packaged icon`);
		const labels = domain.toLowerCase().split('.');
		if (labels.length < 2) {
			problems.push(`site-icon-domains.tsv: ${domain} is not a domain`);
		} else if (labels.length === 2 && labels[0] !== icon) {
			problems.push(`site-icon-domains.tsv: ${domain} is a brand root but maps to ${icon}; a brand root must map to its own icon, and only a subdomain may map to a product icon`);
		}
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

/* ---- the index the page consults must match the directory ---------------
 * The page reads icons/index.txt and asks only for what it lists, which is what
 * keeps a page load from emitting one 404 per application without an icon.  A
 * stale index would silently turn into "those icons do not exist", so it is
 * checked here and refreshed by --write. */
const SHIPPED_INDEX = path.join(ICON_DIR, 'index.txt');
const wantIndex = [...have].map(f => f.slice(0, -4)).sort();
const gotIndex = fs.existsSync(SHIPPED_INDEX)
	? fs.readFileSync(SHIPPED_INDEX, 'utf8').split('\n').map(s => s.trim()).filter(Boolean)
	: [];
if (wantIndex.join('\n') !== gotIndex.join('\n')) {
	const msg = `icons/index.txt lists ${gotIndex.length} entries but the directory holds ${wantIndex.length}`;
	if (write) {
		fs.writeFileSync(SHIPPED_INDEX, wantIndex.join('\n') + '\n', 'utf8');
		warnings.push(msg + ' - refreshed by --write');
	} else {
		problems.push(msg + ' (re-run with --write)');
	}
}

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
