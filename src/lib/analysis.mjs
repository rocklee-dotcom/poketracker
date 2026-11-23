// Gemeinsame Marktanalyse für Telegram-Bericht und Dashboard.
// Liest data/ und liefert alle Kennzahlen, Kaufchancen, Bewegungen und das Fazit als Daten.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readMonth } from './history.mjs';
import { SHOPS } from '../shops/config.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const DATA = join(ROOT, 'data');
const readJson = (f, fb) => (existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : fb);

// ---------- kleine Helfer (auch für Ausgabe) ----------
export const eur = (v) => (v == null ? '–' : v.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €');
export const eur0 = (v) => Math.round(v).toLocaleString('de-DE') + ' €';
export const pctAbs = (v) => Math.abs(Math.round(v * 100)) + ' %';
export const delta = (v) => (v > 0.005 ? `▲ ${pctAbs(v)}` : v < -0.005 ? `▼ ${pctAbs(v)}` : '● 0 %');
export const delta1 = (v) => {
  const s = Math.abs(v * 100).toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + ' %';
  return v > 0.0005 ? `▲ ${s}` : v < -0.0005 ? `▼ ${s}` : `● ${s}`;
};
export const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
export const addDays = (d, n) => new Date(Date.parse(d + 'T12:00:00Z') + n * 864e5).toISOString().slice(0, 10);
export const median = (a) => {
  const s = [...a].sort((x, y) => x - y);
  return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null;
};
export const trimmedMean = (a) => {
  const s = [...a].sort((x, y) => x - y);
  const k = Math.floor(s.length * 0.1);
  const t = s.slice(k, s.length - k);
  return t.length ? t.reduce((x, y) => x + y, 0) / t.length : null;
};
export const FLAG = { de: '🇩🇪', en: '🇬🇧', jp: '🇯🇵', cn: '🇨🇳' };
export const REGION_FLAG = { international: '🌍', japanese: '🇯🇵', chinese: '🇨🇳' };
export const fmtName = (p) =>
  p.region === 'international' ? (p.type === 'half-box' ? '18er' : '36er') : p.type === 'jumbo-box' ? 'Jumbo' : 'Display';
export const setTitle = (p, lang) =>
  (lang === 'de' && p.setDe ? p.setDe : p.set)
    .replace(/^[A-Za-z0-9.]+C:\s*/, '')
    .replace(/\s+(S-Ch|T-Ch|JP|Simplified Chinese|Traditional Chinese)\b/g, '')
    .trim();
export const cmTitle = (p) => setTitle(p, p.region === 'international' ? 'de' : null);
export const cmLink = (p) => `https://www.cardmarket.com/de/Pokemon/Products/Search?searchString=${encodeURIComponent(p.name)}`;
export const isDisplay = (p) =>
  p.region !== 'other' && (['booster-box', 'half-box'].includes(p.type) || (p.region !== 'international' && p.type === 'jumbo-box'));
export const offerKey = (url) => new URL(url).pathname.replace(/\/$/, '').split('/').pop().replace(/[^\w.-]/g, '').slice(0, 100);

export function analyze() {
  // ---------- Daten laden ----------
  const { products, priceDate } = readJson(join(DATA, 'products.json'));
  const byId = new Map(products.map((p) => [p.id, p]));

  const cmHist = new Map();
  for (const f of readdirSync(join(DATA, 'history')).filter((f) => f.endsWith('.csv')).sort()) {
    for (const r of readMonth(join(DATA, 'history', f))) {
      if (!cmHist.has(r.id)) cmHist.set(r.id, []);
      cmHist.get(r.id).push(r);
    }
  }
  for (const arr of cmHist.values()) arr.sort((a, b) => a.date.localeCompare(b.date));
  const cmDates = [...new Set([...cmHist.values()].flatMap((a) => a.map((r) => r.date)))].sort();

  const shopsLatest = readJson(join(DATA, 'shops', 'latest.json'), { offers: [], shops: [] });
  const shopHist = [];
  const shDir = join(DATA, 'shop-history');
  if (existsSync(shDir)) {
    for (const f of readdirSync(shDir).filter((f) => f.endsWith('.csv')).sort()) {
      for (const line of readFileSync(join(shDir, f), 'utf8').trim().split('\n').slice(1)) {
        const [date, shop, cmId, lang, , total, stock, damaged, key] = line.split(',');
        shopHist.push({ date, shop, cmId: Number(cmId), lang, total: Number(total), stock, damaged: damaged === '1', key });
      }
    }
  }
  const shopName = Object.fromEntries(SHOPS.map((s) => [s.id, s.name]));
  const shopDates = [...new Set(shopHist.map((r) => r.date))].sort();

  const trendAt = (id, date) => {
    const arr = cmHist.get(id) ?? [];
    for (let i = arr.length - 1; i >= 0; i--) {
      if (arr[i].date <= date) return arr[i].date >= addDays(date, -3) ? arr[i].trend : null;
    }
    return null;
  };
  const trendAgo = (id, days) => trendAt(id, addDays(priceDate, -days));

  // ---------- Markt je Region ----------
  const REGIONS = [
    ['International', 'international'],
    ['Japan', 'japanese'],
    ['China', 'chinese'],
  ];
  const market = REGIONS.map(([name, region]) => {
    const items = products.filter((p) => p.region === region && p.type === 'booster-box' && p.trend >= 20);
    const ch = (days) =>
      items
        .map((p) => {
          const t = trendAgo(p.id, days);
          return t ? p.trend / t - 1 : null;
        })
        .filter((x) => x != null);
    const ch7 = ch(7);
    const ch30 = ch(30);
    // Index: Ø Verhältnis zum ersten Tag des Fensters (1 = unverändert)
    const index = cmDates.map((d) => {
      const r = items.map((p) => [trendAt(p.id, cmDates[0]), trendAt(p.id, d)]).filter(([b, c]) => b && c).map(([b, c]) => c / b);
      return { date: d, value: r.length ? trimmedMean(r) : null };
    });
    return {
      name,
      region,
      n: ch7.length,
      m7: ch7.length ? trimmedMean(ch7) : null,
      m30: ch30.length >= 5 ? trimmedMean(ch30) : null,
      up: ch7.filter((c) => c > 0.03).length,
      down: ch7.filter((c) => c < -0.03).length,
      index,
    };
  }).filter((m) => m.n);

  // ---------- Shop-Angebote je (Produkt, Sprache), nur lieferbar ----------
  const groups = new Map();
  for (const o of shopsLatest.offers) {
    if (!o.cmId || !o.total || o.stock !== 'in' || o.damaged || !o.lang) continue;
    const p = byId.get(o.cmId);
    if (!p) continue;
    const k = `${o.cmId}|${o.lang}`;
    if (!groups.has(k)) groups.set(k, { p, lang: o.lang, offers: [] });
    groups.get(k).offers.push(o);
  }
  for (const g of groups.values()) g.offers.sort((x, y) => x.total - y.total);

  const shopBestHistory = (cmId, lang, days) => {
    const from = addDays(shopsLatest.date, -days);
    const perDay = new Map();
    for (const r of shopHist) {
      if (r.cmId !== cmId || r.lang !== lang || r.stock !== 'in' || r.damaged || r.date >= shopsLatest.date || r.date < from) continue;
      perDay.set(r.date, Math.min(perDay.get(r.date) ?? Infinity, r.total));
    }
    return [...perDay.values()];
  };

  // ---------- Kaufchancen ----------
  const opportunities = [];
  for (const g of groups.values()) {
    const best = g.offers[0];
    const { p } = g;
    // Keine Kaufchance, wenn Cardmarket günstiger ist. 5 % Spielraum ≈ Versand, der auf Cardmarket dazukommt.
    if (p.trend && best.total > p.trend * 1.05) continue;
    const reasons = [];
    let score = 0;
    // a) unter dem Cardmarket-Trend – zählt als Kaufgrund nur für EN/JP/CN.
    //    Der Trend mischt alle Sprachen; deutsche Displays sind meist ohnehin billiger,
    //    "unter Trend" ist bei DE also kein Schnäppchen-Signal (nur Info).
    const info = [];
    if (p.trend && best.total <= p.trend * 0.97) {
      const txt = `${eur0(p.trend - best.total)} unter Cardmarket-Trend`;
      if (g.lang === 'de') info.push(txt);
      else {
        reasons.push(txt);
        score = Math.max(score, 1 - best.total / p.trend);
      }
    }
    const second = g.offers.find((o) => o.shop !== best.shop);
    if (second) {
      const s = 1 - best.total / second.total;
      if (s >= 0.08 && second.total - best.total >= 10) {
        reasons.push(`${eur0(second.total - best.total)} unter ${shopName[second.shop]}`);
        score = Math.max(score, s);
      }
    }
    const hist = shopBestHistory(p.id, g.lang, 14);
    if (hist.length >= 3) {
      const s = 1 - best.total / median(hist);
      if (s >= 0.05) {
        reasons.push(`${pctAbs(s)} unter Shop-Schnitt (${hist.length} T)`);
        score = Math.max(score, s * 1.2);
      }
    }
    if (p.low && best.total <= p.low) {
      reasons.push('unter Cardmarket-Tiefstpreis');
      score = Math.max(score, 1 - best.total / p.low + 0.05);
    }
    // Knapp über Cardmarket (bis +5 %): offen dazuschreiben
    if (p.trend && best.total > p.trend) info.push(`${eur0(best.total - p.trend)} über Cardmarket-Trend (dort kommt Versand dazu)`);
    // Kauftipp: deutlicher Vorteil (≥ 8 %) UND inkl. Versand nicht teurer als der Cardmarket-Trend
    const buy = score >= 0.08 && (!p.trend || best.total <= p.trend);
    if (reasons.length) opportunities.push({ p, lang: g.lang, best, second, reasons: [...reasons, ...info], score, buy });
  }
  opportunities.sort((x, y) => y.score - x.score);

  // ---------- Cardmarket-Bewegungen ----------
  const movers = [];
  for (const p of products) {
    if (!isDisplay(p) || !p.trend || p.trend < 30) continue;
    const t7 = trendAgo(p.id, 7);
    if (!t7) continue;
    const hist = (cmHist.get(p.id) ?? []).map((r) => r.trend).filter(Boolean);
    movers.push({
      p,
      c: p.trend / t7 - 1,
      isLow: hist.length >= 14 && p.trend <= Math.min(...hist),
      isHigh: hist.length >= 14 && p.trend >= Math.max(...hist),
      days: hist.length,
    });
  }
  const fallers = movers.filter((m) => m.c <= -0.05).sort((x, y) => x.c - y.c);
  const risers = movers.filter((m) => m.c >= 0.05).sort((x, y) => y.c - x.c);

  // ---------- Japan/China-Aufpreis ----------
  const asiaPrem = [...groups.values()].filter((g) => g.p.region !== 'international' && g.p.trend).map((g) => g.offers[0].total / g.p.trend - 1);

  // ---------- Wieder lieferbar ----------
  const yesterday = addDays(shopsLatest.date, -1);
  const yRows = shopHist.filter((r) => r.date === yesterday);
  const wasOut = new Set(yRows.filter((r) => r.stock !== 'in').map((r) => `${r.shop}|${r.key}`));
  const restocks = yRows.length ? shopsLatest.offers.filter((o) => o.cmId && o.stock === 'in' && wasOut.has(`${o.shop}|${offerKey(o.url)}`)) : [];

  // ---------- Fazit (als Daten) ----------
  const verdict = [];
  const intl = market.find((m) => m.region === 'international');
  const jp = market.find((m) => m.region === 'japanese');
  const buys = opportunities.filter((o) => o.buy).slice(0, 2);
  for (const o of buys) {
    verdict.push({
      kind: 'buy',
      icon: '🛒',
      label: 'Kaufen',
      text: `${setTitle(o.p, o.lang)} ${fmtName(o.p)} ${FLAG[o.lang]} für ${eur(o.best.total)} bei ${shopName[o.best.shop]} – ${o.reasons[0]}.`,
      url: o.best.url,
      productId: o.p.id,
    });
  }
  if (!buys.length) verdict.push({ kind: 'buy', icon: '🛒', label: 'Kaufen', text: 'heute kein klarer Deal – Geduld zahlt sich aus.' });
  const watch = [...fallers].sort((x, y) => y.isLow - x.isLow || (x.p.region === 'international' ? -1 : 1) || x.c - y.c)[0];
  if (watch) {
    verdict.push({
      kind: 'watch',
      icon: '👀',
      label: 'Beobachten',
      text: `${cmTitle(watch.p)} ${fmtName(watch.p)}${watch.p.region !== 'international' ? ' ' + REGION_FLAG[watch.p.region] : ''} fällt (${delta(watch.c)} in 7 T${watch.isLow ? ', Tiefstand' : ''}) – Boden abwarten, dann zuschlagen.`,
      productId: watch.p.id,
    });
  }
  if (asiaPrem.length >= 3 && median(asiaPrem) > 0.1) {
    verdict.push({
      kind: 'asia',
      icon: '⏳',
      label: 'Japan/China',
      text: `lieber auf Cardmarket kaufen – deutsche Shops liegen im Schnitt ${pctAbs(median(asiaPrem))} darüber.`,
    });
  }
  const m7 = intl?.m7 ?? 0;
  verdict.push({
    kind: 'market',
    icon: '🧭',
    label: 'Markt',
    text:
      (m7 > 0.03
        ? 'steigende Preise – wer ein Display sicher will, eher früher kaufen.'
        : m7 < -0.03
          ? 'fallende Preise – Abwarten kann sich lohnen.'
          : 'ruhiger, stabiler Markt – kein Grund zur Eile, auf gezielte Deals warten.') +
      (jp && jp.m7 < -0.02 ? ' Japan gibt leicht nach.' : ''),
  });

  // ---------- neueste internationale Sets ----------
  const recentSets = products
    .filter((p) => p.region === 'international' && p.type === 'booster-box' && !/Enhanced/.test(p.name))
    .sort((x, y) => y.added.localeCompare(x.added))
    .slice(0, 8);

  return {
    products,
    byId,
    priceDate,
    cmHist,
    cmDates,
    shopsLatest,
    shopHist,
    shopDates,
    shopName,
    trendAgo,
    market,
    groups,
    opportunities,
    topOps: opportunities.slice(0, 5),
    fallers,
    risers,
    asiaPrem,
    restocks,
    verdict,
    recentSets,
  };
}
