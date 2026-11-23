// Morgenbericht: Marktlage (Cardmarket), Kaufchancen (Shops), Bestpreise, Bewegungen.
//
// node src/report.mjs          -> Bericht nur anzeigen
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

// ---------- Daten laden ----------
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

const shopsLatest = readJson(join(DATA, 'shops', 'latest.json'), { offers: [], shops: [] });
const shopHist = []; // {date, shop, cmId, lang, total, stock, key}
const shDir = join(DATA, 'shop-history');
if (existsSync(shDir)) {
  for (const f of readdirSync(shDir).filter((f) => f.endsWith('.csv'))) {
    for (const line of readFileSync(join(shDir, f), 'utf8').trim().split('\n').slice(1)) {
      const [date, shop, cmId, lang, price, total, stock, damaged, key] = line.split(',');
      shopHist.push({ date, shop, cmId: Number(cmId), lang, total: Number(total), stock, damaged: damaged === '1', key });
    }
  }
}
const shopName = Object.fromEntries(SHOPS.map((s) => [s.id, s.name]));

// ---------- Hilfen ----------
const eur = (v) => (v == null ? '–' : v.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €');
const pct = (v) => (v > 0 ? '+' : '') + Math.round(v * 100) + ' %';
const addDays = (d, n) => new Date(Date.parse(d + 'T12:00:00Z') + n * 864e5).toISOString().slice(0, 10);
/** Mittelwert ohne die extremsten 10 % oben und unten (robust gegen Ausreißer) */
const trimmedMean = (a) => {
  const s = [...a].sort((x, y) => x - y);
  const k = Math.floor(s.length * 0.1);
  const t = s.slice(k, s.length - k);
  return t.length ? t.reduce((x, y) => x + y, 0) / t.length : null;
};
const pct1 = (v) => (v > 0 ? '+' : '') + (v * 100).toLocaleString('de-DE', { maximumFractionDigits: 1, minimumFractionDigits: 1 }) + ' %';
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const median = (a) => {
  const s = [...a].sort((x, y) => x - y);
  return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null;
};

/** Trend vor n Tagen (letzter Wert am oder vor dem Stichtag, max. 3 Tage älter) */
function trendAgo(id, days) {
  const target = addDays(priceDate, -days);
  const arr = cmHist.get(id) ?? [];
  for (let i = arr.length - 1; i >= 0; i--) {
    if (arr[i].date <= target) return arr[i].date >= addDays(target, -3) ? arr[i].trend : null;
  }
  return null;
}

const LANG_LABEL = { de: 'DE', en: 'EN', jp: 'JP', cn: 'CN' };
function label(p, lang) {
  const name = lang === 'de' && p.setDe ? p.setDe : p.set;
  const fmt =
    p.region === 'international'
      ? p.type === 'half-box'
        ? '18er'
        : '36er'
      : p.type === 'jumbo-box'
        ? 'Jumbo-Display'
        : 'Display';
  return `${name} ${fmt}${lang ? ' ' + LANG_LABEL[lang] : ''}`.trim();
}
const cmLink = (p) => `https://www.cardmarket.com/de/Pokemon/Products/Search?searchString=${encodeURIComponent(p.name)}`;

const DISPLAY = (p) => ['booster-box', 'half-box'].includes(p.type) || (p.region !== 'international' && p.type === 'jumbo-box');

// ---------- 1) Marktlage Cardmarket ----------
function marketSection() {
  const groups = [
    ['🌍 International', (p) => p.region === 'international' && p.type === 'booster-box'],
    ['🇯🇵 Japan', (p) => p.region === 'japanese' && p.type === 'booster-box'],
    ['🇨🇳 China', (p) => p.region === 'chinese' && p.type === 'booster-box'],
  ];
  const lines = [];
  for (const [name, f] of groups) {
    const ch7 = [];
    const ch30 = [];
    for (const p of products.filter((p) => f(p) && p.trend >= 20)) {
      const t7 = trendAgo(p.id, 7);
      const t30 = trendAgo(p.id, 30);
      if (t7) ch7.push(p.trend / t7 - 1);
      if (t30) ch30.push(p.trend / t30 - 1);
    }
    if (!ch7.length) continue;
    const up = ch7.filter((c) => c > 0.03).length;
    const down = ch7.filter((c) => c < -0.03).length;
    const m7 = trimmedMean(ch7);
    const arrow = m7 > 0.01 ? '📈' : m7 < -0.01 ? '📉' : '➡️';
    lines.push(
      `${name}: ${arrow} 7 T ${pct1(m7)}` +
        (ch30.length >= 5 ? ` · 30 T ${pct1(trimmedMean(ch30))}` : '') +
        `\n   <i>${down} gefallen, ${up} gestiegen, ${ch7.length - up - down} stabil (±3 %)</i>`,
    );
  }
  return lines.length ? `<b>📊 Marktlage Displays (Cardmarket-Trend, Ø)</b>\n${lines.join('\n')}` : null;
}

// ---------- 2) Shop-Angebote gruppieren ----------
const groups = new Map(); // "cmId|lang" -> { p, lang, offers: [...in stock] }
for (const o of shopsLatest.offers) {
  if (!o.cmId || !o.total || o.stock !== 'in' || o.damaged || !o.lang) continue;
  const p = byId.get(o.cmId);
  if (!p) continue;
  const k = `${o.cmId}|${o.lang}`;
  if (!groups.has(k)) groups.set(k, { p, lang: o.lang, offers: [] });
  groups.get(k).offers.push(o);
}
for (const g of groups.values()) g.offers.sort((a, b) => a.total - b.total);

/** Eigener Shop-Verlauf: bester Gesamtpreis (lieferbar) je Tag der letzten n Tage, ohne heute */
function shopBestHistory(cmId, lang, days) {
  const from = addDays(shopsLatest.date, -days);
  const perDay = new Map();
  for (const r of shopHist) {
    if (r.cmId !== cmId || r.lang !== lang || r.stock !== 'in' || r.damaged || r.date >= shopsLatest.date || r.date < from) continue;
    perDay.set(r.date, Math.min(perDay.get(r.date) ?? Infinity, r.total));
  }
  return [...perDay.values()];
}

function opportunities() {
  const out = [];
  for (const g of groups.values()) {
    const best = g.offers[0];
    const { p } = g;
    // Kein Kauftipp, wenn Cardmarket deutlich günstiger ist (typisch für Japan/China-Ware in deutschen Shops)
    if (p.trend) {
      const maxRatio = p.region === 'international' ? 1.4 : 1.1;
      if (best.total > p.trend * maxRatio) continue;
    }
    const reasons = [];
    let score = 0;
    // a) deutlich günstiger als der nächste Shop (gleiche Sprache)
    const second = g.offers.find((o) => o.shop !== best.shop);
    if (second) {
      const s = 1 - best.total / second.total;
      if (s >= 0.08 && second.total - best.total >= 10) {
        reasons.push(`${eur(second.total - best.total)} günstiger als ${shopName[second.shop]}`);
        score = Math.max(score, s);
      }
    }
    // b) unter dem eigenen Shop-Verlauf (sobald genug Tage gesammelt)
    const hist = shopBestHistory(p.id, g.lang, 14);
    if (hist.length >= 3) {
      const ref = median(hist);
      const s = 1 - best.total / ref;
      if (s >= 0.05) {
        reasons.push(`${pct(-s)} unter dem Shop-Schnitt der letzten ${hist.length} Tage`);
        score = Math.max(score, s * 1.2);
      }
    }
    // c) Shop (inkl. Versand) unter dem günstigsten Cardmarket-Angebot (ohne Versand)
    if (p.low && best.total <= p.low) {
      reasons.push(`unter Cardmarket-Tiefstpreis (${eur(p.low)})`);
      score = Math.max(score, 1 - best.total / p.low + 0.05);
    }
    // d) Japan/China: Shop günstiger als Cardmarket-Trend (selten!)
    if (p.region !== 'international' && p.trend && best.total < p.trend) {
      reasons.push(`unter Cardmarket-Trend (${eur(p.trend)})`);
      score = Math.max(score, 1 - best.total / p.trend);
    }
    if (reasons.length) out.push({ g, best, reasons, score });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, 6);
}

function opportunitySection() {
  const ops = opportunities();
  if (!ops.length) return `<b>🎯 Kaufchancen</b>\nHeute nichts Auffälliges.`;
  const lines = ops.map(
    ({ g, best, reasons }) =>
      `• <b>${esc(label(g.p, g.lang))}</b>: <a href="${esc(best.url)}">${eur(best.total)}</a> bei ${esc(shopName[best.shop])}\n   ↳ ${reasons.map(esc).join(' · ')}`,
  );
  return `<b>🎯 Kaufchancen</b> <i>(lieferbar, inkl. Versand)</i>\n${lines.join('\n')}`;
}

// ---------- 3) Bestpreise der neuesten internationalen Sets ----------
function bestPriceSection() {
  const recent = products
    .filter((p) => p.region === 'international' && p.type === 'booster-box' && !/Enhanced/.test(p.name))
    .sort((a, b) => b.added.localeCompare(a.added))
    .slice(0, 8);
  const lines = [];
  for (const p of recent) {
    const parts = [];
    for (const lang of ['de', 'en']) {
      const g = groups.get(`${p.id}|${lang}`);
      if (g) parts.push(`${LANG_LABEL[lang]} <a href="${esc(g.offers[0].url)}">${eur(g.offers[0].total)}</a> (${esc(shopName[g.offers[0].shop])})`);
    }
    const t7 = trendAgo(p.id, 7);
    const cm = p.trend ? `CM ${eur(p.trend)}${t7 ? ` ${pct(p.trend / t7 - 1)}` : ''}` : '';
    lines.push(`• <b>${esc(p.setDe ?? p.set)}</b>: ${parts.length ? parts.join(' · ') : '<i>in keinem Shop lieferbar</i>'}${cm ? `\n   ↳ <a href="${cmLink(p)}">${cm}</a>` : ''}`);
  }
  return `<b>🏷️ Bestpreise 36er-Displays (neueste Sets)</b>\n${lines.join('\n')}`;
}

// ---------- 4) Bewegungen Cardmarket ----------
function moversSection() {
  const rows = [];
  for (const p of products) {
    if (!DISPLAY(p) || !p.trend || p.trend < 30) continue;
    const t7 = trendAgo(p.id, 7);
    if (!t7) continue;
    const c = p.trend / t7 - 1;
    const hist = (cmHist.get(p.id) ?? []).map((r) => r.trend).filter(Boolean);
    const isLow = hist.length >= 14 && p.trend <= Math.min(...hist);
    rows.push({ p, c, isLow, days: hist.length });
  }
  const fall = rows.filter((r) => r.c <= -0.05).sort((a, b) => a.c - b.c).slice(0, 5);
  const rise = rows.filter((r) => r.c >= 0.05).sort((a, b) => b.c - a.c).slice(0, 3);
  if (!fall.length && !rise.length) return null;
  const flag = (p) => (p.region === 'japanese' ? ' 🇯🇵' : p.region === 'chinese' ? ' 🇨🇳' : '');
  const fmt = (r) =>
    `• <a href="${cmLink(r.p)}">${esc(label(r.p, null))}</a>${flag(r.p)} ${pct(r.c)} → ${eur(r.p.trend)}${r.isLow ? ` <i>(Tiefstand seit ${r.days} T)</i>` : ''}`;
  let s = '<b>📉📈 Cardmarket: größte Bewegungen (7 Tage)</b>';
  if (fall.length) s += `\n<i>Gefallen</i>\n${fall.map(fmt).join('\n')}`;
  if (rise.length) s += `\n<i>Gestiegen</i>\n${rise.map(fmt).join('\n')}`;
  return s;
}

// ---------- 5) Japan/China: Shop vs. Cardmarket ----------
function asiaSection() {
  const prem = [];
  for (const g of groups.values()) {
    if (g.p.region === 'international' || !g.p.trend) continue;
    prem.push(g.offers[0].total / g.p.trend - 1);
  }
  if (prem.length < 3) return null;
  const cheaperCm = prem.filter((x) => x > 0.1).length;
  return `<b>🇯🇵🇨🇳 Japan/China</b>\nBei ${cheaperCm} von ${prem.length} lieferbaren Displays ist Cardmarket günstiger als der beste deutsche Shop (Median-Aufpreis Shop: ${pct(median(prem))}).`;
}

// ---------- 6) Wieder lieferbar ----------
function restockSection() {
  const yesterday = addDays(shopsLatest.date, -1);
  const y = shopHist.filter((r) => r.date === yesterday);
  if (!y.length) return null;
  const wasOut = new Set(y.filter((r) => r.stock !== 'in').map((r) => `${r.shop}|${r.key}`));
  const items = shopsLatest.offers.filter((o) => o.cmId && o.stock === 'in' && wasOut.has(`${o.shop}|${new URL(o.url).pathname.replace(/\/$/, '').split('/').pop().replace(/[^\w.-]/g, '').slice(0, 100)}`));
  if (!items.length) return null;
  const lines = items
    .slice(0, 8)
    .map((o) => `• <a href="${esc(o.url)}">${esc(label(byId.get(o.cmId), o.lang))}</a> bei ${esc(shopName[o.shop])}: ${eur(o.total)}`);
  return `<b>📦 Wieder lieferbar</b>\n${lines.join('\n')}`;
}

// ---------- Zusammenbauen ----------
const dateDe = new Date(Date.parse(shopsLatest.date || priceDate)).toLocaleDateString('de-DE', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
});
const okShops = shopsLatest.shops.filter((s) => s.ok);
const failed = shopsLatest.shops.filter((s) => !s.ok || s.warning);
const cmDays = new Set([...cmHist.values()].flatMap((a) => a.map((r) => r.date))).size;
const shopDays = new Set(shopHist.map((r) => r.date)).size;

const sections = [
  `<b>☀️ PokeTracker – ${esc(dateDe)}</b>`,
  marketSection(),
  opportunitySection(),
  bestPriceSection(),
  moversSection(),
  asiaSection(),
  restockSection(),
  `<i>Daten: Cardmarket ${priceDate} (${plural(cmDays, 'Tag', 'Tage')} Verlauf) · ${okShops.length}/${shopsLatest.shops.length} Shops (${plural(shopDays, 'Tag', 'Tage')} Verlauf)` +
    (failed.length ? ` · ⚠️ ${failed.map((s) => esc(s.name) + (s.warning ? ': ' + esc(s.warning) : ' ausgefallen')).join(', ')}` : '') +
    `</i>\n🔗 <a href="${esc(DASHBOARD_URL)}">Dashboard</a>`,
].filter(Boolean);

const html = sections.join('\n\n');
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
  console.log(html.replace(/<a href="[^"]*">/g, '').replace(/<\/?[a-z]+>/g, ''));
}
