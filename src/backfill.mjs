// Einmaliges Nachladen alter Preise aus der Git-Historie von
// https://github.com/Donnygr-code/binder-tcg-data (täglicher Snapshot der Cardmarket-Preisübersicht).
//
// Aufruf:
//   git clone https://github.com/Donnygr-code/binder-tcg-data.git <ordner>
//   node src/backfill.mjs <ordner>
//
// Bereits vorhandene Tage in data/history werden NICHT überschrieben (eigene Daten haben Vorrang).

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { price, writeDay } from './lib/history.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DATA = join(ROOT, 'data');
const repo = process.argv[2];
if (!repo) {
  console.error('Bitte Pfad zum geklonten binder-tcg-data angeben.');
  process.exit(1);
}

const git = (...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

const tracked = new Set(JSON.parse(readFileSync(join(DATA, 'products.json'), 'utf8')).products.map((p) => p.id));
const commits = git('log', '--format=%H', '--', 'sealed-products.json').trim().split('\n').reverse(); // alt -> neu

// Pro Datum gewinnt der letzte Commit
const byDate = new Map();
for (const sha of commits) {
  let feed;
  try {
    feed = JSON.parse(git('show', `${sha}:sealed-products.json`));
  } catch {
    continue;
  }
  if (!feed?.updatedAt || !Array.isArray(feed.products)) continue;
  byDate.set(feed.updatedAt.slice(0, 10), feed.products);
}

let days = 0;
let rows = 0;
for (const [date, products] of [...byDate].sort(([a], [b]) => a.localeCompare(b))) {
  const dayRows = products
    .filter((p) => tracked.has(p.id))
    .map((p) => ({ id: p.id, trend: price(p.trend), avg: price(p.avg), low: price(p.low) }))
    .filter((r) => r.trend !== null || r.avg !== null || r.low !== null);
  const res = writeDay(join(DATA, 'history'), date, dayRows, { overwrite: false });
  if (res.skipped) {
    console.log(`${date}: schon vorhanden – übersprungen`);
  } else {
    console.log(`${date}: ${res.written} Preise`);
    days++;
    rows += res.written;
  }
}
console.log(`\nFertig: ${days} Tage, ${rows} Zeilen nachgeladen.`);
