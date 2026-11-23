// Täglicher Lauf: Cardmarket-Daten laden, Displays + Booster filtern,
// Region bestimmen, Preis-Historie fortschreiben, Produktliste aktualisieren.
//
// Aufruf:  node src/update.mjs
// Test mit lokalen Dateien:  CM_DIR=<ordner mit products.json + prices.json> node src/update.mjs

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchJson } from './lib/fetch.mjs';
import { CATEGORY, buildRegionResolver, productType, setName } from './lib/classify.mjs';
import { price, writeDay } from './lib/history.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DATA = join(ROOT, 'data');
const CM_BASE = 'https://downloads.s3.cardmarket.com/productCatalog';
const PRODUCTS_URL = `${CM_BASE}/productList/products_nonsingles_6.json`; // 6 = Pokémon
const PRICES_URL = `${CM_BASE}/priceGuide/price_guide_6.json`;
const SETS_URL = 'https://api.pokemontcg.io/v2/sets?select=name&pageSize=250';

const MIN_TRACKED = 1000; // Plausibilität: so viele Displays+Booster erwarten wir mindestens
const MIN_PRICED_SHARE = 0.5; // ... und davon mindestens so viele mit Preis

const readJson = (file, fallback) => (existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : fallback);
const writeJson = (file, data) => {
  mkdirSync(join(file, '..'), { recursive: true });
  writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
};

async function loadCardmarket() {
  if (process.env.CM_DIR) {
    console.log(`Lese Cardmarket-Dateien lokal aus ${process.env.CM_DIR}`);
    return [readJson(join(process.env.CM_DIR, 'products.json')), readJson(join(process.env.CM_DIR, 'prices.json'))];
  }
  console.log('Lade Cardmarket-Katalog und Preisübersicht …');
  return Promise.all([fetchJson(PRODUCTS_URL), fetchJson(PRICES_URL)]);
}

async function loadIntlSetNames() {
  const cache = join(DATA, 'cache', 'intl-sets.json');
  try {
    const res = await fetchJson(SETS_URL, { attempts: 3, timeoutMs: 30_000 });
    const names = res.data.map((s) => s.name).sort();
    writeJson(cache, names);
    return names;
  } catch (err) {
    console.warn(`pokemontcg.io nicht erreichbar (${err.message}) – nutze Cache`);
    return readJson(cache, []);
  }
}

async function main() {
  const [catalog, guide] = await loadCardmarket();
  const intlSets = await loadIntlSetNames();
  const overrides = readJson(join(DATA, 'region-overrides.json'), {});
  const setNamesDe = readJson(join(DATA, 'set-names.json'), {});

  const date = guide.createdAt.slice(0, 10);
  const prices = new Map(guide.priceGuides.map((g) => [g.idProduct, g]));
  const resolveRegion = buildRegionResolver(catalog.products, intlSets, overrides.products ?? {});

  const tracked = catalog.products.filter((p) => CATEGORY[p.idCategory]);
  const products = tracked.map((p) => {
    const g = prices.get(p.idProduct) ?? {};
    const set = setName(p.name);
    const { region, reason } = resolveRegion(p);
    return {
      id: p.idProduct,
      name: p.name,
      category: CATEGORY[p.idCategory],
      type: productType(p),
      set,
      setDe: setNamesDe[set] ?? null,
      expansionId: p.idExpansion,
      region,
      regionReason: reason,
      added: p.dateAdded.slice(0, 10),
      trend: price(g.trend),
      avg: price(g.avg),
      low: price(g.low),
    };
  });

  const priced = products.filter((p) => p.trend !== null || p.avg !== null || p.low !== null);

  // Plausibilitätsprüfung – lieber abbrechen als kaputte Daten speichern
  if (products.length < MIN_TRACKED) throw new Error(`Nur ${products.length} Displays/Booster gefunden (erwartet ≥ ${MIN_TRACKED})`);
  if (priced.length / products.length < MIN_PRICED_SHARE)
    throw new Error(`Nur ${priced.length}/${products.length} Produkte mit Preis – Preisübersicht unvollständig?`);

  const ageHours = (Date.now() - Date.parse(guide.createdAt.replace(/(\+\d\d)(\d\d)$/, '$1:$2'))) / 36e5;
  if (ageHours > 36) console.warn(`WARNUNG: Preisübersicht ist ${Math.round(ageHours)} h alt (Stand ${guide.createdAt})`);

  const hist = writeDay(
    join(DATA, 'history'),
    date,
    priced.map((p) => ({ id: p.id, trend: p.trend, avg: p.avg, low: p.low })),
  );

  products.sort((a, b) => b.added.localeCompare(a.added) || a.id - b.id);
  writeJson(join(DATA, 'products.json'), {
    priceDate: date,
    cardmarketCreatedAt: guide.createdAt,
    updatedAt: new Date().toISOString(),
    count: products.length,
    products,
  });

  // Zusammenfassung
  const count = (key) => products.reduce((acc, p) => ((acc[p[key]] = (acc[p[key]] ?? 0) + 1), acc), {});
  console.log(`\nPreisstand ${date} (Cardmarket ${guide.createdAt})`);
  console.log(`Produkte: ${products.length}, davon mit Preis: ${priced.length}`);
  console.log('Typen:', count('type'));
  console.log('Regionen:', count('region'));
  console.log(`Historie: ${hist.written} Zeilen -> ${hist.file}`);
}

main().catch((err) => {
  console.error(`\nFEHLER: ${err.message}`);
  process.exit(1);
});
