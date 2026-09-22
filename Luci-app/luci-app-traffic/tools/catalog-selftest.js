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
