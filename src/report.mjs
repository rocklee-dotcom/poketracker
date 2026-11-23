// Morgenbericht für Telegram: Auf einen Blick, Kaufchancen, Bestpreise, Markt, Bewegungen, Fazit.
//
// node src/report.mjs          -> Bericht nur anzeigen (Text-Vorschau) und speichern
// node src/report.mjs --send   -> zusätzlich per Telegram senden

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { esc, sendHtml } from './lib/telegram.mjs';
import {
  analyze, eur, eur0, delta, delta1, plural, FLAG, REGION_FLAG, fmtName, setTitle, cmTitle, cmLink, cmFilterLinks, releaseCalendar,
} from './lib/analysis.mjs';

/** "nur 🇩🇪 · nur 🇬🇧" – Cardmarket-Produktseite mit Sprachfilter (mit lang: nur diese Sprache) */
const cmLangLinks = (p, lang = null) => cmFilterLinks(p, lang).map((l) => `<a href="${esc(l.url)}">nur ${FLAG[l.lang]}</a>`).join(' · ');

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DATA = join(ROOT, 'data');
export const DASHBOARD_URL = process.env.DASHBOARD_URL || 'https://rocklee-dotcom.github.io/poketracker/';

const A = analyze();
const { priceDate, shopsLatest, shopName, market, topOps, fallers, risers, restocks, verdict, recentSets, groups, byId } = A;

const a = (url, text) => `<a href="${esc(url)}">${esc(text)}</a>`;
const dash = (id) => `${DASHBOARD_URL}#/p/${id}`;
const SEP = '━━━━━━━━━━━━━━━━━━';
const SPARK = '▁▂▃▄▅▆▇█';
const sparkline = (vals) => {
  const v = vals.filter((x) => x != null);
  if (v.length < 3) return '';
  const lo = Math.min(...v);
  const hi = Math.max(...v);
  return v.map((x) => SPARK[hi - lo < 1e-9 ? 3 : Math.round(((x - lo) / (hi - lo)) * 7)]).join('');
};

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
  const cards = topOps.map(({ p, lang, best, reasons }, i) => {
    const cm = p.trend ? ` · CM-Trend ${eur0(p.trend)}` : '';
    const where =
      best.shop === 'cardmarket'
        ? `${a(best.url, 'Cardmarket')} <i>(ab ${eur(best.price)} + ca. ${eur0(best.shipping)} Versand)</i>`
        : a(best.url, shopName[best.shop]);
    return (
      `${nums[i]} <b>${a(dash(p.id), setTitle(p, lang === 'mix' ? null : lang))}</b> · ${fmtName(p)} ${FLAG[lang]}\n` +
      `      💶 <b>${eur(best.total)}</b> bei ${where}\n` +
      `      ✅ ${esc(reasons.join(' · '))}${cm}\n` +
      `      🔎 Auf Cardmarket prüfen: ${cmLangLinks(p, lang)}`
    );
  });
  return `🎯 <b>KAUFCHANCEN</b>  <i>lieferbar · inkl. Versand</i>\n\n${cards.join('\n\n')}`;
}

function bestPriceSection() {
  const rows = recentSets.slice(0, 6).map((p) => {
    const offers = ['de', 'en']
      .map((lang) => groups.get(`${p.id}|${lang}`))
      .filter((g) => g && A.shopOnly(g).length)
      .map((g) => {
        const o = A.shopOnly(g)[0];
        return `${FLAG[g.lang]} ${a(o.url, eur(o.total))} <i>${esc(shopName[o.shop])}</i>`;
      });
    const t7 = A.trendAgo(p.id, 7);
    const cmo = A.cmOffers.get(p.id);
    const cmBuy = cmo && !cmo.suspicious ? `🛒 ${a(cmo.url, 'CM ' + eur(cmo.total))} <i>inkl. ca. Versand</i> · ` : '';
    const cm = p.trend
      ? `${cmBuy}📊 Trend ${a(cmLink(p), eur(p.trend))}${t7 ? ` ${delta(p.trend / t7 - 1)}` : ''}\n🔎 Cardmarket ${cmLangLinks(p)}`
      : '';
    return `<b>${a(dash(p.id), p.setDe ?? p.set)}</b>\n${offers.length ? offers.join('  ') : '<i>derzeit nirgends lieferbar</i>'}${cm ? '\n' + cm : ''}`;
  });
  return `🏷️ <b>BESTPREISE NEUE SETS</b>  <i>36er · inkl. Versand</i>\n<blockquote expandable>${rows.join('\n\n')}</blockquote>`;
}

function marketSection() {
  const lines = market.map(
    (m) =>
      `${REGION_FLAG[m.region]} <b>${m.name}</b>  <code>${sparkline(m.index.slice(-14).map((x) => x.value))}</code>\n` +
      `      7 T ${delta1(m.m7)}${m.m30 != null ? ` · 30 T ${delta1(m.m30)}` : ''}  <i>(${m.down}↓ ${m.up}↑)</i>`,
  );
  return `📊 <b>MARKT</b>  <i>Cardmarket-Trend Displays · Verlauf 14 T</i>\n${lines.join('\n')}`;
}

function moversSection() {
  if (!fallers.length && !risers.length) return null;
  const row = (m) =>
    `${m.c < 0 ? '🔻' : '🔺'} ${a(dash(m.p.id), cmTitle(m.p) + ' ' + fmtName(m.p))}${m.p.region !== 'international' ? ' ' + REGION_FLAG[m.p.region] : ''}\n` +
    `      ${delta(m.c)} → <b>${eur(m.p.trend)}</b>${m.isLow ? ` · <i>Tief seit ${m.days} T</i>` : m.isHigh ? ` · <i>Hoch seit ${m.days} T</i>` : ''}`;
  const body = [...fallers.slice(0, 5).map(row), ...risers.slice(0, 3).map(row)].join('\n');
  return `📉 <b>BEWEGUNGEN</b>  <i>Cardmarket · 7 Tage</i>\n<blockquote expandable>${body}</blockquote>`;
}

function restockSection() {
  if (!restocks.length) return null;
  const rows = restocks.slice(0, 6).map((o) => {
    const p = byId.get(o.cmId);
    return `📦 ${a(o.url, setTitle(p, o.lang) + ' ' + fmtName(p))} ${FLAG[o.lang] ?? ''} · ${eur(o.total)} · <i>${esc(shopName[o.shop])}</i>`;
  });
  return `📦 <b>WIEDER LIEFERBAR</b>\n${rows.join('\n')}`;
}

/** Nächste Releases (max. 3) mit Countdown */
function calendarSection() {
  const cal = releaseCalendar(A);
  const next = cal.upcoming.slice(0, 3);
  if (!next.length) return null;
  const when = (d) => (d === 0 ? 'heute' : d === 1 ? 'morgen' : `in ${d} Tagen`);
  const lines = next.map((u) => {
    const flag = u.region === 'international' ? '🇩🇪🇬🇧' : u.region === 'japanese' ? '🇯🇵' : '🇨🇳';
    const date = u.date.split('-').reverse().join('.');
    const pre = Object.values(u.offers ?? {}).sort((x, y) => x.total - y.total)[0];
    return (
      `${flag} <b>${esc(u.nameDe ?? u.name)}</b> · ${date} (${when(u.days)})${u.status !== 'offiziell' ? ' <i>– gemeldet</i>' : ''}` +
      (pre ? `\n      🛒 ab ${a(pre.url, eur(pre.total))} bei ${esc(shopName[pre.shop])}` : u.cmTrend ? `\n      📊 Cardmarket ${eur(u.cmTrend)}` : '')
    );
  });
  return `📅 <b>DEMNÄCHST</b>\n${lines.join('\n')}\n🔗 ${a(`${DASHBOARD_URL}#/kalender`, 'Kompletter Release-Kalender')}`;
}

function verdictSection() {
  const lines = verdict.map((v) => {
    const p = v.productId ? byId.get(v.productId) : null;
    const cmCheck = v.kind === 'buy' && p ? ` · 🔎 CM ${cmLangLinks(p, v.lang)}` : '';
    return `${v.icon} <b>${esc(v.label)}:</b> ${v.url ? `${esc(v.text)} ${a(v.url, '→ Kaufen')}${cmCheck}` : esc(v.text)}`;
  });
  return `💡 <b>FAZIT</b>\n<blockquote>${lines.join('\n')}</blockquote>`;
}

function footer() {
  const okShops = shopsLatest.shops.filter((s) => s.ok);
  const problems = shopsLatest.shops.filter((s) => !s.ok || s.warning);
  return (
    `🔗 ${a(DASHBOARD_URL, 'Zum Dashboard')}\n` +
    `<i>Stand: Cardmarket ${priceDate.split('-').reverse().join('.')} (${plural(A.cmDates.length, 'Tag', 'Tage')} Verlauf) · ` +
    `${okShops.length}/${shopsLatest.shops.length} Shops (${plural(A.shopDates.length, 'Tag', 'Tage')} Verlauf)` +
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
  calendarSection(),
  SEP,
  verdictSection(),
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
