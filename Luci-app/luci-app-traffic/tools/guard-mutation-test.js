#!/usr/bin/env node
/* Prove the check-icons.js guards are not vacuous.
 *
 * A guard that passes on the current tree proves nothing about the defect it
 * was written for: it may simply never look.  So each guard is handed the exact
 * defect it claims to catch, in a sandbox copy of the tree - same relative
 * layout, real icons, real catalogue - and has to fail.
 *
 * The M4 case is the reason this exists.  Five rows of
 * tools/site-icon-domains.tsv are product subdomains (hsr.hoyoverse.com) rather
 * than brand roots, which is legitimate and is why they stay, so the brand-root
 * guard passes on the real data and nothing else would show it is doing
 * anything.  Here it is shown failing on the defect it describes.
 *
 * Everything is resolved from this file's location: the test has to run from a
 * checkout, an SDK feed directory or CI, and a hardcoded path would make it
 * silently check the wrong tree.
 *
 * Usage: node tools/guard-mutation-test.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

const SRC = path.resolve(__dirname, '..');
const BASE = path.join(os.tmpdir(), 'traffic-guard-mutation');
const rel = {
	tool: path.join('tools', 'check-icons.js'),
	domain: path.join('tools', 'site-icon-domains.tsv'),
	manifest: path.join('htdocs', 'luci-static', 'resources', 'traffic', 'icons', 'SOURCES.tsv'),
	apps: path.join('root', 'etc', 'traffic', 'apps.tsv'),
};
const read = k => fs.readFileSync(path.join(BASE, rel[k]), 'utf8');
const write = (k, s) => fs.writeFileSync(path.join(BASE, rel[k]), s, 'utf8');

for (const k of ['tool', 'domain', 'apps']) {
	if (!fs.existsSync(path.join(SRC, rel[k]))) {
		console.error(`missing input: ${rel[k]}`);
		process.exit(2);
	}
}

fs.rmSync(BASE, { recursive: true, force: true });
fs.mkdirSync(path.join(BASE, 'tools'), { recursive: true });
fs.mkdirSync(path.join(BASE, 'root', 'etc', 'traffic'), { recursive: true });
fs.mkdirSync(path.join(BASE, 'htdocs', 'luci-static', 'resources', 'traffic'), { recursive: true });
for (const k of ['tool', 'domain', 'apps']) fs.copyFileSync(path.join(SRC, rel[k]), path.join(BASE, rel[k]));
fs.cpSync(path.join(SRC, 'htdocs', 'luci-static', 'resources', 'traffic', 'icons'),
	path.join(BASE, 'htdocs', 'luci-static', 'resources', 'traffic', 'icons'), { recursive: true });

function run() {
	const r = spawnSync(process.execPath, [path.join(BASE, rel.tool)], { encoding: 'utf8' });
	return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
}

const cases = [];
const expect = (label, mut, needle) => cases.push({ label, mut, needle });

expect('baseline (no mutation) must pass', null, null);

expect('M2 ragged manifest row (6 fields)',
	() => write('manifest', read('manifest').replace(/^(2gis\.svg\t[^\n]*)\t\n/m, '$1\n')),
	'fields, the header declares 7');

expect('M1 application column blanked',
	() => write('manifest', read('manifest').replace(/^2gis\.svg\t2gis\t/m, '2gis.svg\t\t')),
	'does not name the application');

expect('M1 application disagrees with the catalogue',
	() => write('manifest', read('manifest').replace(/^2gis\.svg\t2gis\t/m, '2gis.svg\tWrong Name\t')),
	'but the catalogue names this icon');

expect('M4 brand root mapped to a product icon',
	() => write('domain', read('domain').replace(/^zoho\.com\tzoho\t/m, 'zoho.com\thonkai-star-rail\t')),
	'is a brand root but maps to honkai-star-rail');

expect('M4 row pointing at a missing icon',
	() => write('domain', read('domain').replace(/^zoho\.com\tzoho\t/m, 'zoho.com\tno-such-icon\t')),
	'which is not a packaged icon');

expect('M4 ragged domain row (2 fields)',
	() => write('domain', read('domain').replace(/^zoho\.com\tzoho\t[^\t\n]*\n/m, 'zoho.com\tzoho\n')),
	'fields, the header declares 3');

expect('M3 a set falls back to the generic licence wording',
	() => write('manifest', read('manifest').replace(
		/^(abema\.svg\t[^\t]*\ticonify:arcticons\t[^\t]*\t)[^\t]*\t[^\t]*/m,
		'$1see the collection licence\thttps://icon-sets.iconify.design/arcticons/')),
	'arcticons does not state its licence');

expect('M3 a set carries two different licences',
	() => write('manifest', read('manifest').replace(
		/^(abema\.svg\t[^\t]*\ticonify:arcticons\t[^\t]*\t)[^\t]*/m, '$1MIT')),
	'different licences');

let failures = 0;
for (const c of cases) {
	const saved = { manifest: read('manifest'), domain: read('domain') };
	if (c.mut) c.mut();
	const r = run();
	write('manifest', saved.manifest);
	write('domain', saved.domain);

	const ok = c.needle ? (r.code !== 0 && r.out.includes(c.needle)) : r.code === 0;
	if (!ok) failures++;
	const seen = !c.needle ? '' : r.out.includes(c.needle) ? `  saw "${c.needle}"` : `  MISSING "${c.needle}"`;
	console.log(`${ok ? 'OK  ' : 'BAD '} exit=${r.code}  ${c.label}${seen}`);
	if (!ok) console.log(r.out.split('\n').slice(-14).join('\n'));
}

fs.rmSync(BASE, { recursive: true, force: true });
console.log(`\n${cases.length - failures}/${cases.length} guard behaviour(s) verified`);
if (failures) process.exitCode = 1;
