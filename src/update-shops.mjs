// Täglicher Shop-Abgleich: Displays bei deutschen TCG-Shops abrufen, Cardmarket-Produkten zuordnen,
// Gesamtpreis (inkl. Versand) berechnen und Historie fortschreiben.
//
// Aufruf: node src/update-shops.mjs            (alle Shops)
//         node src/update-shops.mjs cardcosmos (nur einzelne Shops, zum Testen)

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SHOPS, shippingFor } from './shops/config.mjs';
import { ADAPTERS } from './shops/adapters.mjs';
import { buildIndex, matchOffer } from './shops/match.mjs';
import './lib/env.mjs'; // lokale .env (eBay-Schlüssel) laden

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DATA = join(ROOT, 'data');
const readJson = (f, fb) => (existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : fb);

const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' }); // YYYY-MM-DD
const only = process.argv.slice(2);

const { products } = readJson(join(DATA, 'products.json'));
const index = buildIndex(products, readJson(join(DATA, 'set-names.json'), {}), readJson(join(DATA, 'shop-aliases.json'), {}));
const previous = readJson(join(DATA, 'shops', 'latest.json'), { shops: [] });

const shopResults = [];
const offers = [];

for (const shop of SHOPS.filter((s) => !only.length || only.includes(s.id))) {
  const missing = (shop.requiresEnv ?? []).filter((k) => !process.env[k]);
  if (missing.length) {
    console.log(`${shop.name.padEnd(18)} übersprungen (fehlt: ${missing.join(', ')})`);
    continue;
  }
  const t0 = Date.now();
  const result = { id: shop.id, name: shop.name, ok: true, errors: [], raw: 0, displays: 0, matched: 0 };
  const seen = new Set();
  const shopOffers = [];
  const sources = shop.sources ?? shop.dynamicSources(products);
  for (const source of sources) {
    let raw = [];
    try {
      raw = await ADAPTERS[shop.adapter](shop, source);
    } catch (err) {
      result.errors.push(err.message);
      continue;
    }
    for (const o of raw) {
      if (seen.has(o.url)) continue;
      seen.add(o.url);
      result.raw++;
      const m = matchOffer(o, index);
      if (m.skip) continue;
      if (shop.maxPerProduct && !m.product) continue; // Marktplätze: nur zuordenbare Angebote behalten
      result.displays++;
      if (m.product) result.matched++;
      const ownShipping = o.shipping != null;
      const shipping = !o.price ? null : ownShipping ? o.shipping : shippingFor(shop, o.price);
      shopOffers.push({
        shop: shop.id,
        title: o.title,
        url: o.url,
        price: o.price,
        shipping,
        shippingEstimated: (!ownShipping && shop.shipping.estimated) || undefined,
        seller: o.seller,
        total: o.price ? Math.round((o.price + shipping) * 100) / 100 : null,
        stock: o.stock,
        lang: m.lang ?? null,
        langSource: m.langSource ?? null,
        boosters: m.fmt?.count ?? null,
        damaged: m.damaged || undefined,
        cmId: m.product?.id ?? null,
        cmName: m.product?.name ?? null,
        reason: m.product ? undefined : m.reason,
      });
    }
  }
  // Marktplätze: je Display und Sprache nur die günstigsten N Angebote behalten
  if (shop.maxPerProduct) {
    const byKey = new Map();
    for (const o of shopOffers.sort((a, b) => a.total - b.total)) {
      const k = `${o.cmId}|${o.lang}`;
      byKey.set(k, (byKey.get(k) ?? 0) + 1);
      if (byKey.get(k) <= shop.maxPerProduct) offers.push(o);
    }
    result.matched = Math.min(result.matched, offers.filter((o) => o.shop === shop.id).length);
  } else offers.push(...shopOffers);
  if (result.errors.length === sources.length) result.ok = false;
  // Warnung, wenn ein Shop plötzlich viel weniger liefert (Seitenumbau?)
  const prev = previous.shops.find((s) => s.id === shop.id);
  if (prev?.displays && result.displays < prev.displays * 0.5) result.warning = `nur ${result.displays} Displays (vorher ${prev.displays})`;
  result.seconds = Math.round((Date.now() - t0) / 1000);
  shopResults.push(result);
  console.log(
    `${shop.name.padEnd(18)} ${result.ok ? 'OK ' : 'FEHLER'} ${String(result.displays).padStart(4)} Displays, ${String(result.matched).padStart(4)} zugeordnet` +
      (result.errors.length ? ` | ${result.errors.join('; ')}` : '') +
      (result.warning ? ` | WARNUNG: ${result.warning}` : ''),
  );
}

if (!shopResults.some((r) => r.ok)) {
  console.error('FEHLER: kein Shop erreichbar – nichts gespeichert.');
  process.exit(1);
}

// latest.json – bei Teilläufen (einzelne Shops) die übrigen Shops aus dem letzten Stand übernehmen
const latestFile = join(DATA, 'shops', 'latest.json');
let allOffers = offers;
let allShops = shopResults;
if (only.length) {
  allOffers = [...(previous.offers ?? []).filter((o) => !only.includes(o.shop)), ...offers];
  allShops = [...previous.shops.filter((s) => !only.includes(s.id)), ...shopResults];
}
mkdirSync(join(DATA, 'shops'), { recursive: true });
writeFileSync(
  latestFile,
  JSON.stringify({ date: today, fetchedAt: new Date().toISOString(), shops: allShops, offers: allOffers }, null, 1) + '\n',
);

// Historie: nur zugeordnete Angebote. Spalten: date,shop,cmId,lang,price,total,stock,damaged,key
const histDir = join(DATA, 'shop-history');
mkdirSync(histDir, { recursive: true });
const histFile = join(histDir, `${today.slice(0, 7)}.csv`);
const HEADER = 'date,shop,cmId,lang,price,total,stock,damaged,key';
const doneShops = new Set(shopResults.filter((r) => r.ok).map((r) => r.id));
const old = existsSync(histFile) ? readFileSync(histFile, 'utf8').trim().split('\n').slice(1) : [];
const kept = old.filter((l) => {
  const [date, shop] = l.split(',');
  return !(date === today && doneShops.has(shop)); // Wiederholung am selben Tag ersetzt die Zeilen
});
const key = (url) => new URL(url).pathname.replace(/\/$/, '').split('/').pop().replace(/[^\w.-]/g, '').slice(0, 100);
const rows = offers
  .filter((o) => o.cmId && o.price && doneShops.has(o.shop))
  .map((o) => [today, o.shop, o.cmId, o.lang ?? '', o.price, o.total, o.stock, o.damaged ? 1 : 0, key(o.url)].join(','));
writeFileSync(histFile, [HEADER, ...kept, ...rows].join('\n') + '\n');

const total = shopResults.reduce((a, r) => a + r.matched, 0);
console.log(`\n${today}: ${total} zugeordnete Angebote gespeichert (${rows.length} Zeilen Historie).`);
