// Erzeugt die Daten fürs Dashboard (GitHub Pages, Ordner docs/):
//   docs/data/dashboard.json  – Übersicht, Kaufchancen, Produkte mit aktuellen Angeboten
//   docs/data/history.json    – Preisverläufe (wird erst in der Detailansicht geladen)

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyze, isDisplay, releaseCalendar, CM_SHIPPING_EST } from './lib/analysis.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = join(ROOT, 'docs', 'data');
const A = analyze();
const r2 = (v) => (v == null ? null : Math.round(v * 10000) / 10000);

const displays = A.products.filter(isDisplay);

const products = displays.map((p) => {
  const offers = A.shopsLatest.offers
    .filter((o) => o.cmId === p.id)
    .map((o) => ({ shop: o.shop, lang: o.lang, price: o.price, total: o.total, stock: o.stock, url: o.url, title: o.title, damaged: !!o.damaged }))
    .sort((a, b) => (a.stock === 'in') - (b.stock === 'in') || a.total - b.total)
    .sort((a, b) => (b.stock === 'in') - (a.stock === 'in'));
  // Bester Shop je Sprache (ohne Cardmarket) …
  const best = {};
  for (const lang of ['de', 'en', 'jp', 'cn']) {
    const g = A.groups.get(`${p.id}|${lang}`);
    const o = g && A.shopOnly(g)[0];
    if (o) best[lang] = { total: o.total, shop: o.shop, url: o.url };
  }
  // … und Cardmarket als eigene Kaufmöglichkeit
  const cmo = A.cmOffers.get(p.id);
  const cm = cmo ? { price: cmo.price, shipping: cmo.shipping, total: cmo.total, url: cmo.url, suspicious: cmo.suspicious, lang: cmo.lang } : null;
  // Günstigste Kaufmöglichkeit insgesamt (Shop oder Cardmarket, auffällige Cardmarket-Preise ausgenommen)
  const cands = [
    ...Object.entries(best).map(([lang, b]) => ({ ...b, lang })),
    ...(cm && !cm.suspicious ? [{ total: cm.total, shop: 'cardmarket', url: cm.url, lang: cm.lang ?? 'mix' }] : []),
  ].sort((a, b) => a.total - b.total);
  const cheapest = cands[0] ?? null;
  const t7 = A.trendAgo(p.id, 7);
  const t30 = A.trendAgo(p.id, 30);
  return {
    id: p.id,
    name: p.name,
    set: p.set,
    setDe: p.setDe,
    type: p.type,
    region: p.region,
    added: p.added,
    trend: p.trend,
    low: p.low,
    avg: p.avg,
    d7: p.trend && t7 ? r2(p.trend / t7 - 1) : null,
    d30: p.trend && t30 ? r2(p.trend / t30 - 1) : null,
    best,
    cm,
    cheapest,
    inStock: offers.filter((o) => o.stock === 'in' && !o.damaged).length,
    offers,
  };
});

const dashboard = {
  generatedAt: new Date().toISOString(),
  priceDate: A.priceDate,
  shopsDate: A.shopsLatest.date,
  cmDays: A.cmDates.length,
  shopDays: A.shopDates.length,
  shops: A.shopsLatest.shops.map((s) => ({ id: s.id, name: s.name, ok: s.ok, displays: s.displays, matched: s.matched, warning: s.warning ?? null })),
  market: A.market.map((m) => ({ ...m, m7: r2(m.m7), m30: r2(m.m30), index: m.index.map((x) => [x.date, r2(x.value)]) })),
  verdict: A.verdict,
  opportunities: A.opportunities.slice(0, 12).map((o) => ({
    id: o.p.id,
    lang: o.lang,
    total: o.best.total,
    shop: o.best.shop,
    url: o.best.url,
    price: o.best.price,
    shipping: o.best.shipping,
    second: o.second ? { shop: o.second.shop, total: o.second.total } : null,
    reasons: o.reasons,
    score: r2(o.score),
    buy: o.buy,
  })),
  recentSets: A.recentSets.map((p) => p.id),
  fallers: A.fallers.slice(0, 12).map((m) => ({ id: m.p.id, c: r2(m.c), isLow: m.isLow, isHigh: m.isHigh, days: m.days })),
  risers: A.risers.slice(0, 12).map((m) => ({ id: m.p.id, c: r2(m.c), isLow: m.isLow, isHigh: m.isHigh, days: m.days })),
  restocks: A.restocks.map((o) => ({ id: o.cmId, lang: o.lang, shop: o.shop, total: o.total, url: o.url })),
  shopNames: A.shopName,
  cmShippingEst: CM_SHIPPING_EST,
  calendar: (() => {
    const c = releaseCalendar(A);
    return { ...c, recent: c.recent.map((r) => ({ ...r, cm30: r.cm30 == null ? null : r2(r.cm30) })) };
  })(),
  products,
};

// Verläufe, an gemeinsame Datumsachsen ausgerichtet
const ids = new Set(displays.map((p) => p.id));
const cm = {};
const low = {};
for (const id of ids) {
  const rows = new Map((A.cmHist.get(id) ?? []).map((r) => [r.date, r]));
  if (!rows.size) continue;
  cm[id] = A.cmDates.map((d) => rows.get(d)?.trend ?? null);
  low[id] = A.cmDates.map((d) => rows.get(d)?.low ?? null);
}
const shop = {};
const shopIdx = new Map(A.shopDates.map((d, i) => [d, i]));
for (const r of A.shopHist) {
  if (!ids.has(r.cmId) || r.stock !== 'in' || r.damaged || !r.lang) continue;
  shop[r.cmId] ??= {};
  shop[r.cmId][r.lang] ??= A.shopDates.map(() => null);
  const i = shopIdx.get(r.date);
  const cur = shop[r.cmId][r.lang][i];
  if (cur == null || r.total < cur) shop[r.cmId][r.lang][i] = r.total;
}
const history = { cmDates: A.cmDates, cm, low, shopDates: A.shopDates, shop };

mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, 'dashboard.json'), JSON.stringify(dashboard));
writeFileSync(join(OUT, 'history.json'), JSON.stringify(history));
console.log(
  `Dashboard-Daten: ${products.length} Displays, ${dashboard.opportunities.length} Kaufchancen, ` +
    `Verlauf ${A.cmDates.length} Tage Cardmarket / ${A.shopDates.length} Tage Shops`,
);
