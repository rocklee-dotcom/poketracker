// Set-Index für die Kartensuche (Dashboard, Reiter "Karten"):
// je Sprache alle Sets mit gedrucktem Set-Code (z. B. "MEW", "SV2a"), Kartenanzahl und Erscheinungsdatum.
// Quelle: TCGdex (freie Pokémon-Kartendatenbank, https://tcgdex.dev). Wird höchstens alle 7 Tage neu gebaut.
//
// Aufruf: node src/build-card-sets.mjs          (nur wenn älter als 7 Tage)
//         node src/build-card-sets.mjs --force  (immer)

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = join(ROOT, 'docs', 'data', 'card-sets.json');
const LANGS = { de: 'de', en: 'en', jp: 'ja', cn: 'zh-tw' }; // unsere Kürzel -> TCGdex-Sprache
const MAX_AGE_DAYS = 7;

if (!process.argv.includes('--force') && existsSync(OUT)) {
  const age = (Date.now() - Date.parse(JSON.parse(readFileSync(OUT, 'utf8')).builtAt)) / 864e5;
  if (age < MAX_AGE_DAYS) {
    console.log(`Set-Index ist ${age.toFixed(1)} Tage alt – kein Neubau nötig.`);
    process.exit(0);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function get(url, attempts = 3) {
  for (let i = 1; i <= attempts; i++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'poketracker (private Preisbeobachtung)' }, signal: AbortSignal.timeout(30_000) });
      if (res.ok) return res.json();
      if (res.status === 404) return null;
      throw new Error(`HTTP ${res.status}`);
    } catch (err) {
      if (i === attempts) throw err;
      await sleep(1500 * i);
    }
  }
}

/** führt fn für alle Einträge mit begrenzter Parallelität aus */
async function pool(items, n, fn) {
  const out = [];
  let i = 0;
  await Promise.all(
    Array.from({ length: n }, async () => {
      while (i < items.length) {
        const idx = i++;
        out[idx] = await fn(items[idx]);
      }
    }),
  );
  return out;
}

const index = { builtAt: new Date().toISOString(), source: 'TCGdex (https://tcgdex.dev)', langs: {} };
for (const [ours, tcg] of Object.entries(LANGS)) {
  const list = (await get(`https://api.tcgdex.net/v2/${tcg}/sets`)) ?? [];
  const details = await pool(list, 4, async (s) => {
    try {
      const d = await get(`https://api.tcgdex.net/v2/${tcg}/sets/${encodeURIComponent(s.id)}`);
      await sleep(80);
      return d;
    } catch {
      return null;
    }
  });
  index.langs[ours] = {
    tcgdex: tcg,
    sets: details
      .filter(Boolean)
      .map((d) => ({
        id: d.id,
        name: d.name,
        code: d.abbreviation?.official ?? null, // gedruckter Code, z. B. "MEW"
        official: d.cardCount?.official ?? null, // Zahl hinter dem Schrägstrich
        total: d.cardCount?.total ?? null,
        release: d.releaseDate ?? null,
        serie: d.serie?.name ?? null,
      })),
  };
  console.log(`${ours} (${tcg}): ${index.langs[ours].sets.length} Sets`);
}

mkdirSync(join(ROOT, 'docs', 'data'), { recursive: true });
writeFileSync(OUT, JSON.stringify(index));
console.log(`Set-Index gespeichert: ${OUT}`);
