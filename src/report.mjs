// Morgenbericht für Telegram: Auf einen Blick, Kaufchancen, Bestpreise, Markt, Bewegungen, Fazit.
//
// node src/report.mjs          -> Bericht nur anzeigen (Text-Vorschau) und speichern
// node src/report.mjs --send   -> zusätzlich per Telegram senden

import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readMonth } from './lib/history.mjs';
import { esc, sendHtml } from './lib/telegram.mjs';
import { SHOPS } from './shops/config.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DATA = join(ROOT, 'data');
const readJson = (f, fb) => (existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : fb);
const DASHBOARD_URL = process.env.DASHBOARD_URL || 'https://github.com/rocklee-dotcom/poketracker';

// ═══════════════════════ Daten laden ═══════════════════════
const { products, priceDate } = readJson(join(DATA, 'products.json'));
const byId = new Map(products.map((p) => [p.id, p]));

const cmHist = new Map(); // id -> [{date, trend, low, avg}] aufsteigend
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
  for (const f of readdirSync(shDir).filter((f) => f.endsWith('.csv'))) {
    for (const line of readFileSync(join(shDir, f), 'utf8').trim().split('\n').slice(1)) {
      const [date, shop, cmId, lang, , total, stock, damaged, key] = line.split(',');
      shopHist.push({ date, shop, cmId: Number(cmId), lang, total: Number(total), stock, damaged: damaged === '1', key });
    }
  }
}
const shopName = Object.fromEntries(SHOPS.map((s) => [s.id, s.name]));

// ═══════════════════════ Hilfen ═══════════════════════
const eur = (v) => (v == null ? '–' : v.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €');
const eur0 = (v) => Math.round(v).toLocaleString('de-DE') + ' €';
const pctAbs = (v) => Math.abs(Math.round(v * 100)) + ' %';
const delta = (v) => (v > 0.005 ? `▲ ${pctAbs(v)}` : v < -0.005 ? `▼ ${pctAbs(v)}` : '● 0 %');
const delta1 = (v) => {
  const s = Math.abs(v * 100).toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + ' %';
  return v > 0.0005 ? `▲ ${s}` : v < -0.0005 ? `▼ ${s}` : `● ${s}`;
};
const addDays = (d, n) => new Date(Date.parse(d + 'T12:00:00Z') + n * 864e5).toISOString().slice(0, 10);
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const median = (a) => {
  const s = [...a].sort((x, y) => x - y);
  return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null;
};
const trimmedMean = (a) => {
  const s = [...a].sort((x, y) => x - y);
  const k = Math.floor(s.length * 0.1);
  const t = s.slice(k, s.length - k);
  return t.length ? t.reduce((x, y) => x + y, 0) / t.length : null;
};
const SPARK = '▁▂▃▄▅▆▇█';
const sparkline = (vals) => {
  const v = vals.filter((x) => x != null);
  if (v.length < 3) return '';
  const lo = Math.min(...v);
  const hi = Math.max(...v);
  return v.map((x) => SPARK[hi - lo < 1e-9 ? 3 : Math.round(((x - lo) / (hi - lo)) * 7)]).join('');
};

function trendAt(id, date) {
  const arr = cmHist.get(id) ?? [];
  for (let i = arr.length - 1; i >= 0; i--) {
    if (arr[i].date <= date) return arr[i].date >= addDays(date, -3) ? arr[i].trend : null;
  }
  return null;
}
const trendAgo = (id, days) => trendAt(id, addDays(priceDate, -days));

const FLAG = { de: '🇩🇪', en: '🇬🇧', jp: '🇯🇵', cn: '🇨🇳' };
const REGION_FLAG = { international: '🌍', japanese: '🇯🇵', chinese: '🇨🇳' };
const fmtName = (p) =>
  p.region === 'international' ? (p.type === 'half-box' ? '18er' : '36er') : p.type === 'jumbo-box' ? 'Jumbo' : 'Display';
const setTitle = (p, lang) => (lang === 'de' && p.setDe ? p.setDe : p.set).replace(/^[A-Za-z0-9.]+C:\s*/, '');
// Für sprachneutrale Stellen (Cardmarket): internationale Sets mit deutschem Namen
const cmTitle = (p) => setTitle(p, p.region === 'international' ? 'de' : null);
const cmLink = (p) => `https://www.cardmarket.com/de/Pokemon/Products/Search?searchString=${encodeURIComponent(p.name)}`;
const a = (url, text) => `<a href="${esc(url)}">${esc(text)}</a>`;
const DISPLAY = (p) => ['booster-box', 'half-box'].includes(p.type) || (p.region !== 'international' && p.type === 'jumbo-box');
const SEP = '━━━━━━━━━━━━━━━━━━';

// ═══════════════════════ Analysen ═══════════════════════

// --- Markt je Region: 7/30-Tage-Veränderung + Index-Verlauf (Sparkline) ---
const REGIONS = [
  ['International', 'international', (p) => p.region === 'international' && p.type === 'booster-box'],
  ['Japan', 'japanese', (p) => p.region === 'japanese' && p.type === 'booster-box'],
  ['China', 'chinese', (p) => p.region === 'chinese' && p.type === 'booster-box'],
];
const market = REGIONS.map(([name, region, f]) => {
  const items = products.filter((p) => f(p) && p.trend >= 20);
  const ch = (days) => items.map((p) => trendAgo(p.id, days)).map((t, i) => (t ? items[i].trend / t - 1 : null)).filter((x) => x != null);
  const ch7 = ch(7);
  const ch30 = ch(30);
  // Index der letzten 14 Datenpunkte: Ø Verhältnis zum ersten Tag
  const days = cmDates.slice(-14);
  const idx = days.map((d) => {
    const r = items.map((p) => [trendAt(p.id, days[0]), trendAt(p.id, d)]).filter(([b, c]) => b && c).map(([b, c]) => c / b);
    return r.length ? trimmedMean(r) : null;
  });
  return {
    name,
    region,
    n: ch7.length,
    m7: ch7.length ? trimmedMean(ch7) : null,
    m30: ch30.length >= 5 ? trimmedMean(ch30) : null,
    up: ch7.filter((c) => c > 0.03).length,
    down: ch7.filter((c) => c < -0.03).length,
    spark: sparkline(idx),
  };
}).filter((m) => m.n);

// --- Shop-Angebote je (Produkt, Sprache), nur lieferbar ---
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

function shopBestHistory(cmId, lang, days) {
  const from = addDays(shopsLatest.date, -days);
  const perDay = new Map();
  for (const r of shopHist) {
    if (r.cmId !== cmId || r.lang !== lang || r.stock !== 'in' || r.damaged || r.date >= shopsLatest.date || r.date < from) continue;
    perDay.set(r.date, Math.min(perDay.get(r.date) ?? Infinity, r.total));
  }
  return [...perDay.values()];
}

// --- Kaufchancen ---
const opportunities = [];
for (const g of groups.values()) {
  const best = g.offers[0];
  const { p } = g;
  if (p.trend && best.total > p.trend * (p.region === 'international' ? 1.4 : 1.1)) continue; // Cardmarket deutlich billiger
  const reasons = [];
  let score = 0;
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
    reasons.push(`unter Cardmarket-Tiefstpreis`);
    score = Math.max(score, 1 - best.total / p.low + 0.05);
  }
  if (p.region !== 'international' && p.trend && best.total < p.trend) {
    reasons.push(`unter Cardmarket-Trend`);
    score = Math.max(score, 1 - best.total / p.trend);
  }
  if (reasons.length) opportunities.push({ g, best, second, reasons, score });
}
opportunities.sort((x, y) => y.score - x.score);
const topOps = opportunities.slice(0, 5);

// --- Cardmarket-Bewegungen ---
const movers = [];
for (const p of products) {
  if (!DISPLAY(p) || !p.trend || p.trend < 30) continue;
  const t7 = trendAgo(p.id, 7);
  if (!t7) continue;
  const hist = (cmHist.get(p.id) ?? []).map((r) => r.trend).filter(Boolean);
  movers.push({ p, c: p.trend / t7 - 1, isLow: hist.length >= 14 && p.trend <= Math.min(...hist), isHigh: hist.length >= 14 && p.trend >= Math.max(...hist), days: hist.length });
}
const fallers = movers.filter((m) => m.c <= -0.05).sort((x, y) => x.c - y.c);
const risers = movers.filter((m) => m.c >= 0.05).sort((x, y) => y.c - x.c);

// --- Japan/China-Aufpreis der Shops ---
const asiaPrem = [...groups.values()].filter((g) => g.p.region !== 'international' && g.p.trend).map((g) => g.offers[0].total / g.p.trend - 1);

// --- Wieder lieferbar ---
const offerKey = (url) => new URL(url).pathname.replace(/\/$/, '').split('/').pop().replace(/[^\w.-]/g, '').slice(0, 100);
const yesterday = addDays(shopsLatest.date, -1);
const yRows = shopHist.filter((r) => r.date === yesterday);
const wasOut = new Set(yRows.filter((r) => r.stock !== 'in').map((r) => `${r.shop}|${r.key}`));
const restocks = yRows.length
  ? shopsLatest.offers.filter((o) => o.cmId && o.stock === 'in' && wasOut.has(`${o.shop}|${offerKey(o.url)}`))
  : [];

// ═══════════════════════ Abschnitte ═══════════════════════
const dateDe = new Date(Date.parse((shopsLatest.date || priceDate) + 'T12:00:00Z')).toLocaleDateString('de-DE', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
});

function header() {
  const intl = market.find((m) => m.region === 'international');
  const mood = (m) => (m == null ? '' : m > 0.02 ? '📈 steigt' : m < -0.02 ? '📉 fällt' : '➡️ stabil');
  const glance = [
    topOps.length ? `🟢 ${plural(topOps.length, 'Kaufchance', 'Kaufchancen')}` : '⚪ keine Kaufchance',
    intl ? `🌍 Markt ${mood(intl.m7)}` : null,
    fallers.length ? `🔻 ${fallers.length} Displays im Minus` : null,
    restocks.length ? `📦 ${restocks.length} wieder da` : null,
  ].filter(Boolean);
  return `☀️ <b>POKETRACKER</b> · ${esc(dateDe)}\n<i>Dein Display-Markt am Morgen</i>\n\n${glance.join('  ·  ')}`;
}

function opportunitySection() {
  if (!topOps.length) return `🎯 <b>KAUFCHANCEN</b>\nHeute nichts Auffälliges – kein Grund, etwas zu überstürzen.`;
  const nums = ['①', '②', '③', '④', '⑤'];
  const cards = topOps.map(({ g, best, reasons }, i) => {
    const p = g.p;
    const cm = p.trend ? ` · CM ${eur0(p.trend)}` : '';
    return (
      `${nums[i]} <b>${esc(setTitle(p, g.lang))}</b> · ${fmtName(p)} ${FLAG[g.lang]}\n` +
      `      💶 <b>${eur(best.total)}</b> bei ${a(best.url, shopName[best.shop])}\n` +
      `      ✅ ${esc(reasons.join(' · '))}${cm}`
    );
  });
  return `🎯 <b>KAUFCHANCEN</b>  <i>lieferbar · inkl. Versand</i>\n\n${cards.join('\n\n')}`;
}

function bestPriceSection() {
  const recent = products
    .filter((p) => p.region === 'international' && p.type === 'booster-box' && !/Enhanced/.test(p.name))
    .sort((x, y) => y.added.localeCompare(x.added))
    .slice(0, 8);
  const rows = recent.map((p) => {
    const offers = ['de', 'en']
      .map((lang) => groups.get(`${p.id}|${lang}`))
      .filter(Boolean)
      .map((g) => `${FLAG[g.lang]} ${a(g.offers[0].url, eur(g.offers[0].total))} <i>${esc(shopName[g.offers[0].shop])}</i>`);
    const t7 = trendAgo(p.id, 7);
    const cm = p.trend ? `📊 ${a(cmLink(p), 'CM ' + eur(p.trend))}${t7 ? ` ${delta(p.trend / t7 - 1)}` : ''}` : '';
    return `<b>${esc(p.setDe ?? p.set)}</b>\n${offers.length ? offers.join('  ') : '<i>derzeit nirgends lieferbar</i>'}${cm ? '\n' + cm : ''}`;
  });
  return `🏷️ <b>BESTPREISE NEUE SETS</b>  <i>36er · inkl. Versand</i>\n<blockquote expandable>${rows.join('\n\n')}</blockquote>`;
}

function marketSection() {
  const lines = market.map(
    (m) =>
      `${REGION_FLAG[m.region]} <b>${m.name}</b>  <code>${m.spark}</code>\n` +
      `      7 T ${delta1(m.m7)}${m.m30 != null ? ` · 30 T ${delta1(m.m30)}` : ''}  <i>(${m.down}↓ ${m.up}↑)</i>`,
  );
  return `📊 <b>MARKT</b>  <i>Cardmarket-Trend Displays · Verlauf 14 T</i>\n${lines.join('\n')}`;
}

function moversSection() {
  if (!fallers.length && !risers.length) return null;
  const row = (m) =>
    `${m.c < 0 ? '🔻' : '🔺'} ${a(cmLink(m.p), cmTitle(m.p) + ' ' + fmtName(m.p))}${m.p.region !== 'international' ? ' ' + REGION_FLAG[m.p.region] : ''}\n` +
    `      ${delta(m.c)} → <b>${eur(m.p.trend)}</b>${m.isLow ? ` · <i>Tief seit ${m.days} T</i>` : m.isHigh ? ` · <i>Hoch seit ${m.days} T</i>` : ''}`;
  const body = [...fallers.slice(0, 5).map(row), ...risers.slice(0, 3).map(row)].join('\n');
  return `📉 <b>BEWEGUNGEN</b>  <i>Cardmarket · 7 Tage</i>\n<blockquote expandable>${body}</blockquote>`;
}

function restockSection() {
  if (!restocks.length) return null;
  const rows = restocks
    .slice(0, 6)
    .map((o) => `📦 ${a(o.url, setTitle(byId.get(o.cmId), o.lang) + ' ' + fmtName(byId.get(o.cmId)))} ${FLAG[o.lang] ?? ''} · ${eur(o.total)} · <i>${esc(shopName[o.shop])}</i>`);
  return `📦 <b>WIEDER LIEFERBAR</b>\n${rows.join('\n')}`;
}

// --- Fazit: regelbasierte Empfehlung ---
function verdict() {
  const lines = [];
  const intl = market.find((m) => m.region === 'international');
  const jp = market.find((m) => m.region === 'japanese');

  // Kaufen: nur echte Deals – deutlicher Vorteil UND nicht teurer als Cardmarket (+5 % Toleranz)
  const buys = topOps.filter((o) => o.score >= 0.08 && (!o.g.p.trend || o.best.total <= o.g.p.trend * 1.05)).slice(0, 2);
  for (const o of buys) {
    lines.push(
      `🛒 <b>Kaufen:</b> ${esc(setTitle(o.g.p, o.g.lang))} ${fmtName(o.g.p)} ${FLAG[o.g.lang]} für <b>${eur(o.best.total)}</b> bei ${a(o.best.url, shopName[o.best.shop])} – ${esc(o.reasons[0])}.`,
    );
  }
  if (!buys.length) lines.push(`🛒 <b>Kaufen:</b> heute kein klarer Deal – Geduld zahlt sich aus.`);

  // Beobachten: fallende Displays (internationale zuerst), am besten mit Tiefstand
  const watch = [...fallers].sort((x, y) => (y.isLow - x.isLow) || (x.p.region === 'international' ? -1 : 1) || x.c - y.c)[0];
  if (watch) {
    lines.push(
      `👀 <b>Beobachten:</b> ${esc(cmTitle(watch.p))} ${fmtName(watch.p)}${watch.p.region !== 'international' ? ' ' + REGION_FLAG[watch.p.region] : ''} fällt (${delta(watch.c)} in 7 T${watch.isLow ? ', Tiefstand' : ''}) – Boden abwarten, dann zuschlagen.`,
    );
  }

  // Abwarten / Japan-Tipp
  if (asiaPrem.length >= 3 && median(asiaPrem) > 0.1) {
    lines.push(`⏳ <b>Japan/China:</b> lieber auf Cardmarket kaufen – deutsche Shops liegen im Schnitt ${pctAbs(median(asiaPrem))} darüber.`);
  }

  // Marktstimmung
  const m7 = intl?.m7 ?? 0;
  const mood =
    m7 > 0.03
      ? 'steigende Preise – wer ein Display sicher will, eher früher kaufen.'
      : m7 < -0.03
        ? 'fallende Preise – Abwarten kann sich lohnen.'
        : 'ruhiger, stabiler Markt – kein Grund zur Eile, auf gezielte Deals warten.';
  lines.push(`🧭 <b>Markt:</b> ${mood}${jp && jp.m7 < -0.02 ? ' Japan gibt leicht nach.' : ''}`);
  return `💡 <b>FAZIT</b>\n<blockquote>${lines.join('\n')}</blockquote>`;
}

function footer() {
  const okShops = shopsLatest.shops.filter((s) => s.ok);
  const problems = shopsLatest.shops.filter((s) => !s.ok || s.warning);
  const shopDays = new Set(shopHist.map((r) => r.date)).size;
  return (
    `🔗 ${a(DASHBOARD_URL, 'Zum Dashboard')}\n` +
    `<i>Stand: Cardmarket ${priceDate.split('-').reverse().join('.')} (${plural(cmDates.length, 'Tag', 'Tage')} Verlauf) · ` +
    `${okShops.length}/${shopsLatest.shops.length} Shops (${plural(shopDays, 'Tag', 'Tage')} Verlauf)` +
    (problems.length ? ` · ⚠️ ${problems.map((s) => esc(s.name)).join(', ')} unvollständig` : '') +
    `</i>`
  );
}

const html = [
  header(),
  SEP,
  opportunitySection(),
  SEP,
  bestPriceSection(),
  marketSection(),
  moversSection(),
  restockSection(),
  SEP,
  verdict(),
  footer(),
]
  .filter(Boolean)
  .join('\n\n');

mkdirSync(join(DATA, 'reports'), { recursive: true });
writeFileSync(join(DATA, 'reports', 'latest.html.txt'), html + '\n');

if (process.argv.includes('--send')) {
  if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_CHAT_ID) {
    console.log('Telegram nicht konfiguriert (TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID) – Bericht nur gespeichert.');
  } else {
    const n = await sendHtml(html);
    console.log(`Bericht per Telegram gesendet (${n} Nachricht${n > 1 ? 'en' : ''}).`);
  }
} else {
  console.log(
    html
      .replace(/<a href="[^"]*">/g, '')
      .replace(/<\/?[a-z]+( [a-z]+)?>/g, '')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>'),
  );
}
