#!/usr/bin/env node
// Turn an admin "Download export" JSON file into content/ files you can commit.
//   npm run bundle-to-content -- ~/Downloads/randall-christmas-content-2026-12-01.json
'use strict';
const fs = require('fs');
const path = require('path');

const file = process.argv[2];
if (!file) {
  console.error('Usage: npm run bundle-to-content -- <export.json> [content-dir]');
  process.exit(1);
}
const dir = path.resolve(process.argv[3] || path.join(__dirname, '..', 'content'));
const bundle = JSON.parse(fs.readFileSync(file, 'utf8'));

// Write files directly (no database needed)
fs.mkdirSync(dir, { recursive: true });
if (bundle.paths?.length) {
  const paths = bundle.paths.filter(p => p.slug !== '_shared');
  fs.writeFileSync(path.join(dir, 'paths.json'), JSON.stringify(paths, null, 2) + '\n');
}
let n = 0;
for (const d of bundle.days || []) {
  const folder = path.join(dir, d.path);
  fs.mkdirSync(folder, { recursive: true });
  const out = { day: d.day, title: d.title || '', intro: d.intro || '', puzzles: d.puzzles || [] };
  fs.writeFileSync(path.join(folder, `day-${String(d.day).padStart(2, '0')}.json`), JSON.stringify(out, null, 2) + '\n');
  n++;
}
console.log(`Wrote ${n} day files to ${dir}`);
