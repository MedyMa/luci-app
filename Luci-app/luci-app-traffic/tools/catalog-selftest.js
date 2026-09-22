#!/usr/bin/env node
/* Check high-impact curated ownership entries in the shipped catalogue. */
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(__dirname, 'build-catalog.js'), 'utf8');
const candidateFunction = source.match(/function fuzzyIconNames\([\s\S]*?\n}/)[0];
const candidates = new Function(candidateFunction + '; return fuzzyIconNames;')();
for (const [query, unrelated] of [['blued', 'bluedriver'], ['sto', 'stoat'], ['friday', 'friday-night-funkin']]) {
  if (candidates([{set:new Set([unrelated]),rank:0}], query).length) {
    console.error(`FAIL ${query} must not select unrelated ${unrelated}`);
    process.exitCode = 1;
  }
}
const rows = fs.readFileSync(path.join(root, 'root/etc/traffic/apps.tsv'), 'utf8')
  .split(/\r?\n/).filter(Boolean).map(line => line.split('\t'));
function checkKey(key, owner, kind = 'S') {
  const matches = rows.filter(row => row[1] === key);
  const rule = kind === 'H' ? `['${owner}', '${key}', 'H']` : `['${owner}', '${key}']`;
  if (matches.length !== 1 || matches[0][0] !== owner || matches[0][2] !== kind ||
      !source.includes(rule)) {
    console.error(`FAIL ${key}: expected one ${owner} row and a matching curated rule; got ${JSON.stringify(matches)}`);
    process.exitCode = 1;
  } else {
    console.log(`PASS ${key} -> ${owner}`);
  }
}
checkKey('digicert.com', 'DigiCert');
checkKey('producthunt.com', 'Product Hunt');
checkKey('brandfetch.io', 'Brandfetch');
checkKey('hsr.hoyoverse.com', 'Honkai Star Rail', 'H');
checkKey('zenless.hoyoverse.com', 'Zenless Zone Zero', 'H');
checkKey('honkaiimpact3.hoyoverse.com', 'Honkai Impact 3rd', 'H');
checkKey('mc.kurogames.com', 'Wuthering Waves', 'H');
checkKey('wutheringwaves.kurogames.com', 'Wuthering Waves', 'H');

/* A whole-domain rule for a shared-infrastructure domain is the defect that
 * filed every unrecognised *.hinet.net host under Bahamut: 41 rows under
 * that ISP domain belong to seven different owners.  The list lives in the
 * generator and is read out of it here, so the assertion and the drop cannot
 * drift apart.  "One host, two owners" on its own is NOT tested: two
 * services of one vendor legitimately share a host (itunes.apple.com belongs
 * to App Store and to iTunes Store), and that pairing is intended. */
const sharedInfra = source.match(/const SHARED_INFRA_SUFFIX = new Set\(\[([\s\S]*?)\]\)/);
if (!sharedInfra) {
  console.error('FAIL could not read SHARED_INFRA_SUFFIX out of build-catalog.js');
  process.exitCode = 1;
} else {
  const listed = sharedInfra[1].split(',').map(s => s.trim().replace(/^'|'$/g, '')).filter(Boolean);
  if (!listed.length) {
    console.error('FAIL SHARED_INFRA_SUFFIX is empty; the assertion would pass vacuously');
    process.exitCode = 1;
  }
  for (const domain of listed) {
    const rule = rows.find(r => r[1] === domain && r[2] === 'S');
    if (rule) {
      console.error(`FAIL ${domain} must not be a whole-domain rule; it is shared infrastructure (rule for ${rule[0]})`);
      process.exitCode = 1;
    } else {
      console.log(`PASS ${domain} is not bound to one owner`);
    }
  }
}
