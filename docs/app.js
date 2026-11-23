// PokeTracker Dashboard – statische Seite, liest data/dashboard.json und (bei Bedarf) data/history.json.
// Alle Texte aus den Daten werden per textContent eingesetzt (nie als HTML).

const $app = document.getElementById('app');
const state = { data: null, history: null, filters: { q: '', region: 'all', type: 'all', stock: false, sort: 'new' }, limit: 60 };

// ═══════════ Helfer ═══════════
const SVGNS = 'http://www.w3.org/2000/svg';
function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c != null && c !== false) el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return el;
}
function s(tag, attrs = {}, ...children) {
  const el = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) el.setAttribute(k, v);
  for (const c of children.flat()) if (c != null) el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return el;
}
const eur = (v) => (v == null ? '–' : v.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €');
const eur0 = (v) => (v == null ? '–' : Math.round(v).toLocaleString('de-DE') + ' €');
const pct = (v, d = 0) => Math.abs(v * 100).toLocaleString('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d }) + ' %';
const dateDe = (d) => d.split('-').reverse().join('.');
const shortDate = (d) => {
  const [, m, day] = d.split('-');
  return `${Number(day)}.${Number(m)}.`;
};
// Keine Flaggen-Emojis (Windows zeigt sie nicht an) – stattdessen Sprach-Plaketten.
const CODE = { de: 'DE', en: 'EN', jp: 'JP', cn: 'CN', mix: 'MIX' };
const FLAG = CODE; // für reine Textstellen (Optionen, Tooltips)
const LANG = { de: 'Deutsch', en: 'Englisch', jp: 'Japanisch', cn: 'Chinesisch', mix: 'Sprache gemischt' };
const isCM = (shopId) => shopId === 'cardmarket';
const REGION = { international: ['🌍', 'International'], japanese: ['JP', 'Japan'], chinese: ['CN', 'China'] };
const langBadge = (lang) => h('span', { class: `lang lang-${lang}`, title: LANG[lang], text: CODE[lang] ?? '?' });
const regionBadge = (region) => (region === 'international' ? h('span', { class: 'rg', title: 'International', text: '🌍' }) : h('span', { class: `lang lang-${region === 'japanese' ? 'jp' : 'cn'}`, title: REGION[region][1], text: REGION[region][0] }));
/** Flaggen-Emojis aus Server-Texten (Fazit) in Kürzel umwandeln */
const deflag = (t) => t.replace(/🇩🇪/g, 'DE').replace(/🇬🇧/g, 'EN').replace(/🇯🇵/g, 'JP').replace(/🇨🇳/g, 'CN');
const REGION_COLOR = { international: 'var(--s1)', japanese: 'var(--s2)', chinese: 'var(--s3)' };
const TYPE = { 'booster-box': null, 'half-box': '18er', 'jumbo-box': 'Jumbo' };
const STOCK = { in: 'lieferbar', out: 'ausverkauft', preorder: 'Vorbestellung' };

const fmtName = (p) => (p.region === 'international' ? (p.type === 'half-box' ? '18er' : '36er') : p.type === 'jumbo-box' ? 'Jumbo-Display' : 'Display');
// Setname ohne Code-Präfix ("CSV10.5C:") und ohne Sprachzusatz ("S-Ch", "JP") – die Plakette zeigt die Sprache
const setTitle = (p, lang) =>
  (lang === 'de' && p.setDe ? p.setDe : lang ? p.set : p.region === 'international' ? p.setDe ?? p.set : p.set)
    .replace(/^[A-Za-z0-9.]+C:\s*/, '')
    .replace(/\s+(S-Ch|T-Ch|JP|Simplified Chinese|Traditional Chinese)\b/g, '')
    .trim();
const cmLink = (p) => `https://www.cardmarket.com/de/Pokemon/Products/Search?searchString=${encodeURIComponent(p.name)}`;
const shop = (id) => state.data.shopNames[id] ?? id;
const prod = (id) => state.byId.get(id);

/** Preisänderung: ▼ gefallen (rot), ▲ gestiegen (grün). Pfeil + Text, nie nur Farbe. */
function delta(v, d = 0) {
  if (v == null) return h('span', { class: 'delta flat', text: '–' });
  const cls = v < -0.0005 ? 'down' : v > 0.0005 ? 'up' : 'flat';
  const arrow = v < -0.0005 ? '▼' : v > 0.0005 ? '▲' : '●';
  return h('span', { class: `delta ${cls}`, title: v < 0 ? 'gefallen' : v > 0 ? 'gestiegen' : 'unverändert', text: `${arrow} ${pct(v, d)}` });
}
const go = (hash) => (location.hash = hash);

// ═══════════ Liniendiagramm (SVG, Fadenkreuz + Tooltip) ═══════════
function niceTicks(lo, hi, n = 4) {
  const span = hi - lo || Math.abs(hi) || 1;
  const raw = span / n;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((x) => x >= raw) ?? raw;
  const t = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) t.push(+v.toFixed(10));
  return t;
}

/**
 * @param {{dates:string[], series:{name:string,color:string,values:(number|null)[],dash?:boolean}[], height?:number, yFmt:(v:number)=>string, zero?:boolean}} cfg
 */
function lineChart(cfg) {
  const wrap = h('div', { class: 'chart' });
  const legend = h(
    'div',
    { class: 'legend' },
    cfg.series.map((se) => h('span', {}, h('i', { class: se.dash ? 'dash' : '', style: `border-color:${se.color}` }), se.name)),
  );
  const box = h('div', { style: 'position:relative' });
  const tip = h('div', { class: 'tooltip', role: 'status' });
  box.append(tip);
  wrap.append(cfg.series.length > 1 ? legend : '', box);

  let idx = null;
  function draw() {
    const W = Math.max(280, box.clientWidth || 600);
    const H = cfg.height ?? 220;
    const ends = cfg.series.length <= 4;
    const M = { l: 48, r: ends ? 84 : 12, t: 10, b: 24 };
    const all = cfg.series.flatMap((se) => se.values).filter((v) => v != null);
    box.querySelector('svg')?.remove();
    if (!all.length) {
      box.prepend(h('div', { class: 'empty', text: 'Noch keine Verlaufsdaten.' }));
      return;
    }
    let lo = Math.min(...all);
    let hi = Math.max(...all);
    if (cfg.zero) {
      lo = Math.min(lo, 0);
      hi = Math.max(hi, 0);
    }
    const pad = (hi - lo || Math.abs(hi) * 0.1 || 1) * 0.08;
    lo -= pad;
    hi += pad;
    const ticks = niceTicks(lo, hi);
    lo = Math.min(lo, ticks[0]);
    hi = Math.max(hi, ticks[ticks.length - 1]);
    const n = cfg.dates.length;
    const X = (i) => M.l + (n === 1 ? (W - M.l - M.r) / 2 : (i / (n - 1)) * (W - M.l - M.r));
    const Y = (v) => M.t + (1 - (v - lo) / (hi - lo)) * (H - M.t - M.b);

    const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, height: H, role: 'img', 'aria-label': cfg.label ?? 'Preisverlauf', tabindex: 0 });
    const grid = s('g', { class: 'grid' });
    const axis = s('g', { class: 'axis' });
    for (const t of ticks) {
      grid.append(s('line', { x1: M.l, x2: W - M.r, y1: Y(t), y2: Y(t) }));
      axis.append(s('text', { x: M.l - 6, y: Y(t) + 4, 'text-anchor': 'end' }, cfg.yFmt(t)));
    }
    const xt = n <= 1 ? [0] : [0, Math.round((n - 1) / 3), Math.round((2 * (n - 1)) / 3), n - 1];
    for (const i of [...new Set(xt)]) axis.append(s('text', { x: X(i), y: H - 6, 'text-anchor': i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle' }, shortDate(cfg.dates[i])));
    svg.append(grid, s('line', { class: 'baseline', x1: M.l, x2: W - M.r, y1: H - M.b, y2: H - M.b }), axis);
    if (cfg.zero && lo < 0 && hi > 0) svg.append(s('line', { x1: M.l, x2: W - M.r, y1: Y(0), y2: Y(0), stroke: 'var(--axis)', 'stroke-width': 1 }));

    const labels = [];
    for (const se of cfg.series) {
      let d = '';
      let pen = false;
      se.values.forEach((v, i) => {
        if (v == null) return (pen = false);
        d += `${pen ? 'L' : 'M'}${X(i).toFixed(1)},${Y(v).toFixed(1)}`;
        pen = true;
      });
      svg.append(s('path', { d, fill: 'none', stroke: se.color, 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round', 'stroke-dasharray': se.dash ? '5 4' : null }));
      // Einzelne Punkte ohne Nachbarn als Marker zeichnen
      se.values.forEach((v, i) => {
        if (v != null && se.values[i - 1] == null && se.values[i + 1] == null)
          svg.append(s('circle', { cx: X(i), cy: Y(v), r: 4.5, fill: se.color, stroke: 'var(--surface)', 'stroke-width': 2 }));
      });
      const last = se.values.findLastIndex((v) => v != null);
      if (ends && last >= 0) labels.push({ y: Y(se.values[last]), x: X(last), text: se.short ?? se.name, color: se.color });
    }
    // Endbeschriftungen ohne Überlappung
    labels.sort((a, b) => a.y - b.y);
    for (let i = 1; i < labels.length; i++) if (labels[i].y - labels[i - 1].y < 13) labels[i].y = labels[i - 1].y + 13;
    for (const l of labels) {
      svg.append(s('line', { x1: l.x + 4, x2: W - M.r + 6, y1: l.y, y2: l.y, stroke: l.color, 'stroke-width': 1, opacity: 0.35 }));
      svg.append(s('text', { class: 'endlabel', x: W - M.r + 9, y: l.y + 4 }, l.text));
    }

    const cross = s('line', { class: 'crosshair', y1: M.t, y2: H - M.b, visibility: 'hidden' });
    const dots = s('g');
    svg.append(cross, dots);
    const hit = s('rect', { x: M.l, y: M.t, width: W - M.l - M.r, height: H - M.t - M.b, fill: 'transparent' });
    svg.append(hit);

    function show(i) {
      if (i == null) {
        cross.setAttribute('visibility', 'hidden');
        dots.replaceChildren();
        tip.classList.remove('show');
        return;
      }
      idx = i;
      cross.setAttribute('x1', X(i));
      cross.setAttribute('x2', X(i));
      cross.setAttribute('visibility', 'visible');
      dots.replaceChildren();
      tip.replaceChildren(h('div', { class: 'd', text: dateDe(cfg.dates[i]) }));
      for (const se of cfg.series) {
        const v = se.values[i];
        if (v != null) dots.append(s('circle', { cx: X(i), cy: Y(v), r: 4, fill: se.color, stroke: 'var(--surface)', 'stroke-width': 2 }));
        tip.append(h('div', { class: 'r' }, h('span', {}, h('i', { style: `border-color:${se.color}` }), se.name), h('b', { text: v == null ? '–' : cfg.yFmt(v, true) })));
      }
      tip.classList.add('show');
      const tw = tip.offsetWidth;
      const left = X(i) + 12 + tw > W ? X(i) - 12 - tw : X(i) + 12;
      tip.style.left = `${Math.max(0, left)}px`;
      tip.style.top = `${M.t}px`;
    }
    const pick = (ev) => {
      const r = svg.getBoundingClientRect();
      const x = ((ev.clientX - r.left) / r.width) * W;
      return n === 1 ? 0 : Math.max(0, Math.min(n - 1, Math.round(((x - M.l) / (W - M.l - M.r)) * (n - 1))));
    };
    hit.addEventListener('pointermove', (ev) => show(pick(ev)));
    hit.addEventListener('pointerdown', (ev) => show(pick(ev)));
    hit.addEventListener('pointerleave', () => show(null));
    svg.addEventListener('keydown', (ev) => {
      if (ev.key === 'ArrowLeft') show(Math.max(0, (idx ?? n) - 1));
      else if (ev.key === 'ArrowRight') show(Math.min(n - 1, (idx ?? -1) + 1));
      else if (ev.key === 'Escape') show(null);
      else return;
      ev.preventDefault();
    });
    svg.addEventListener('blur', () => show(null));
    box.prepend(svg);
  }
  new ResizeObserver(() => draw()).observe(box);
  requestAnimationFrame(draw);
  return wrap;
}

function sparkline(values, color) {
  const v = values.map((x, i) => [i, x]).filter(([, x]) => x != null);
  const svg = s('svg', { viewBox: '0 0 100 28', preserveAspectRatio: 'none', 'aria-hidden': 'true' });
  if (v.length < 2) return svg;
  const lo = Math.min(...v.map((p) => p[1]));
  const hi = Math.max(...v.map((p) => p[1]));
  const n = values.length - 1;
  const pts = v.map(([i, x]) => `${((i / n) * 100).toFixed(1)},${(26 - ((x - lo) / (hi - lo || 1)) * 24).toFixed(1)}`).join(' ');
  svg.append(s('polyline', { points: pts, fill: 'none', stroke: color, 'stroke-width': 2, 'vector-effect': 'non-scaling-stroke', 'stroke-linejoin': 'round' }));
  return svg;
}

// ═══════════ Bausteine ═══════════
function section(title, hint, ...content) {
  // führendes Emoji als Symbol-Plakette
  const m = title.match(/^(\S+)\s+(.*)$/u);
  const hasIcon = m && !/[A-Za-zÄÖÜäöü]/.test(m[1]);
  return h(
    'section',
    { class: 'section' },
    h('div', { class: 'section-head' }, hasIcon ? h('span', { class: 'ico', text: m[1] }) : '', h('h2', { text: hasIcon ? m[2] : title }), hint ? h('span', { class: 'hint', text: hint }) : ''),
    ...content,
  );
}
// Energie-Typ je Region (Kartenrahmen-Farbe)
const TYPE_OF = { international: 'water', japanese: 'fire', chinese: 'grass', mix: 'psychic' };
const SPARK_ON_DARK = { international: '#7cc8ff', japanese: '#ff9a5c', chinese: '#6be28a' };

/** Günstigste Kaufmöglichkeiten: Cardmarket (inkl. ca. Versand) und beste Shops je Sprache, billigste zuerst */
function priceCell(p) {
  const rows = Object.entries(p.best).map(([lang, b]) => ({ lang, ...b }));
  if (p.cm && !p.cm.suspicious) rows.push({ lang: p.cm.lang ?? 'mix', shop: 'cardmarket', total: p.cm.total, url: p.cm.url });
  rows.sort((a, b) => a.total - b.total);
  if (!rows.length) return h('span', { class: 'muted', text: 'nirgends lieferbar' });
  return h(
    'div',
    { class: 'stack' },
    rows.slice(0, 3).map((r, i) =>
      h('span', { class: 'num nowrap' }, langBadge(r.lang), ' ', i === 0 ? h('b', { text: eur(r.total) }) : eur(r.total), h('span', { class: `small ${isCM(r.shop) ? 'cm' : 'muted'}`, text: ` ${shop(r.shop)}` })),
    ),
  );
}

// ═══════════ Übersicht ═══════════
function renderHome() {
  const D = state.data;
  const buyCount = D.opportunities.filter((o) => o.buy).length;
  const hour = new Date().getHours();
  const hello = hour < 11 ? 'Guten Morgen' : hour < 18 ? 'Hallo' : 'Guten Abend';
  const bestDeal = D.opportunities.find((o) => o.buy);
  const tiles = h(
    'div',
    { class: 'hero' },
    h('h2', { class: 'hello' }, `${hello}, `, h('span', { text: 'Trainer!' })),
    h('div', { class: 'date', text: `Marktbericht vom ${new Date(D.shopsDate + 'T12:00:00').toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}` }),
    h(
      'div',
      { class: 'hero-stats' },
      h(
        'div',
        { class: 'hstat' },
        h('span', { class: 'l', text: '🎯 Kaufchancen' }),
        h('span', { class: 'v', text: String(D.opportunities.length) }),
        h('span', { class: 'f', text: buyCount ? `★ ${buyCount} Kauftipps${bestDeal ? ` · Top: ${setTitle(prod(bestDeal.id), bestDeal.lang === 'mix' ? null : bestDeal.lang)}` : ''}` : 'heute kein klarer Deal' }),
      ),
      D.market.map((m) =>
        h(
          'div',
          { class: 'hstat' },
          h('span', { class: 'l' }, regionBadge(m.region), ` ${m.name} · 7 T`),
          h('span', { class: 'v' }, delta(m.m7, 1)),
          h('span', { class: 'f', text: `30 T ${m.m30 == null ? '–' : (m.m30 < 0 ? '▼ ' : '▲ ') + pct(m.m30, 1)} · ${m.down}↓ ${m.up}↑` }),
          sparkline(m.index.map((x) => x[1]), SPARK_ON_DARK[m.region]),
        ),
      ),
    ),
  );

  const verdict = h(
    'div',
    { class: 'card pad verdict' },
    D.verdict.map((v) =>
      h(
        'div',
        { class: `verdict-row ${v.kind === 'buy' && v.url ? 'buy' : ''}` },
        h('span', { class: 'ic', text: v.icon }),
        h(
          'div',
          {},
          h('b', { text: `${v.label}:` }),
          deflag(v.text),
          v.url ? h('span', {}, ' ', h('a', { href: v.url, target: '_blank', rel: 'noopener', text: 'Zum Shop →' })) : '',
          v.productId ? h('span', {}, ' ', h('a', { href: `#/p/${v.productId}`, text: 'Verlauf' })) : '',
        ),
      ),
    ),
  );

  /** Kaufchance als Sammelkarte: Rahmen in Energie-Farbe, Preis oben rechts, Gründe als "Attacken" */
  const opCard = (o) => {
    const p = prod(o.id);
    const type = TYPE_OF[o.lang === 'mix' ? 'mix' : p.region];
    const isInfo = (r) => /prüfen|über/.test(r);
    return h(
      'article',
      { class: `tcg type-${type} ${o.buy ? 'tip' : ''}`, onclick: (e) => !e.target.closest('a') && go(`#/p/${o.id}`), tabindex: 0, onkeydown: (e) => e.key === 'Enter' && go(`#/p/${o.id}`) },
      h(
        'div',
        { class: 'tcg-in' },
        o.buy ? h('span', { class: 'ribbon', text: '★ KAUFTIPP' }) : '',
        h(
          'div',
          { class: 'tcg-top' },
          h('div', { class: 'tcg-name', text: setTitle(p, o.lang === 'mix' ? null : o.lang) }),
          h('div', { class: 'tcg-hp' }, h('small', { text: isCM(o.shop) ? 'INKL. CA. VERSAND' : 'INKL. VERSAND' }), h('b', { class: 'num', text: eur(o.total) })),
        ),
        h(
          'div',
          { class: 'tcg-art' },
          h('div', { class: 'fmt' }, h('span', { class: 'energy' }), `${fmtName(p)} · `, langBadge(o.lang), ` ${LANG[o.lang]}`),
          h('div', { class: 'where', text: isCM(o.shop) ? `Cardmarket · ab ${eur(o.price)} + ca. ${eur0(o.shipping)} Versand` : `bei ${shop(o.shop)}${p.trend ? ` · CM-Trend ${eur0(p.trend)}` : ''}` }),
        ),
        h(
          'div',
          { class: 'moves' },
          o.reasons.map((r) => h('div', { class: `move ${isInfo(r) ? 'info' : ''}` }, h('span', { class: 'energy' }), h('span', { text: r }))),
        ),
        h(
          'div',
          { class: 'tcg-foot' },
          h('span', { class: 'sub', text: o.buy ? 'Deutlicher Preisvorteil' : 'Guter Preis – vergleichen' }),
          h('a', { class: `btn ${o.buy ? 'go' : 'primary'}`, href: o.url, target: '_blank', rel: 'noopener', text: `${shop(o.shop)} →` }),
        ),
      ),
    );
  };
  const OPS_SHOWN = 6;
  const opsGrid = h('div', { class: 'ops' }, D.opportunities.slice(0, OPS_SHOWN).map(opCard));
  const moreOps =
    D.opportunities.length > OPS_SHOWN
      ? h('div', { style: 'margin-top:10px' }, h('button', {
          class: 'btn',
          text: `Weitere ${D.opportunities.length - OPS_SHOWN} anzeigen`,
          onclick: (e) => {
            opsGrid.append(...D.opportunities.slice(OPS_SHOWN).map(opCard));
            e.currentTarget.remove();
          },
        }))
      : '';
  const ops = D.opportunities.length ? [opsGrid, moreOps] : [];

  const marketChart = D.market.length
    ? h(
        'div',
        { class: 'card pad' },
        lineChart({
          dates: D.market[0].index.map((x) => x[0]),
          series: D.market.map((m) => ({ name: m.name, short: m.name, color: REGION_COLOR[m.region], values: m.index.map((x) => (x[1] == null ? null : x[1] - 1)) })),
          yFmt: (v) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${pct(v, 1)}`,
          zero: true,
          label: 'Preisindex Displays je Region',
        }),
      )
    : '';

  const recent = h(
    'div',
    { class: 'card' },
    h(
      'table',
      { class: 'table responsive' },
      h('thead', {}, h('tr', {}, h('th', { text: 'Set (36er)' }), h('th', {}, langBadge('de'), ' Bester Shop'), h('th', {}, langBadge('en'), ' Bester Shop'), h('th', { class: 'r', text: 'Cardmarket inkl. ca. Versand' }), h('th', { class: 'r', text: 'Trend 7 T' }))),
      h(
        'tbody',
        {},
        D.recentSets.map((id) => {
          const p = prod(id);
          const cell = (lang) => {
            const b = p.best[lang];
            return b
              ? h('td', { 'data-l': `${CODE[lang]} bester Shop`, class: 'num' }, h('b', { text: eur(b.total) }), h('span', { class: 'muted small', text: ` ${shop(b.shop)}` }))
              : h('td', { 'data-l': `${CODE[lang]} bester Shop`, class: 'muted', text: 'nicht lieferbar' });
          };
          return h(
            'tr',
            { class: 'click', onclick: () => go(`#/p/${id}`) },
            h('td', {}, h('b', { text: p.setDe ?? p.set }), p.setDe ? h('div', { class: 'muted small', text: p.set }) : ''),
            cell('de'),
            cell('en'),
            h(
              'td',
              { class: 'r num', 'data-l': 'Cardmarket' },
              p.cm ? h('a', { href: p.cm.url, target: '_blank', rel: 'noopener', onclick: (e) => e.stopPropagation() }, h('b', { text: eur(p.cm.total) })) : '–',
              p.cm?.suspicious ? h('span', { class: 'muted small', text: ' ⚠ prüfen' }) : '',
              h('div', { class: 'muted small', text: `Trend ${eur(p.trend)}` }),
            ),
            h('td', { class: 'r inl', 'data-l': 'Trend 7 T' }, delta(p.d7)),
          );
        }),
      ),
    ),
  );

  const mvList = (title, list) =>
    h(
      'div',
      { class: 'card' },
      h('h3', {}, h('span', { text: title.startsWith('Gef') ? '🔻' : '🔺' }), title),
      list.length
        ? list.slice(0, 8).map((m) => {
            const p = prod(m.id);
            return h(
              'div',
              { class: 'mv', onclick: () => go(`#/p/${m.id}`) },
              regionBadge(p.region),
              h('span', { class: 'n' }, `${setTitle(p)} ${fmtName(p)}`, m.isLow ? h('span', { class: 'muted small', text: ` · Tief seit ${m.days} T` }) : m.isHigh ? h('span', { class: 'muted small', text: ` · Hoch seit ${m.days} T` }) : ''),
              h('span', { class: 'num nowrap', text: eur(p.trend) }),
              delta(m.c),
            );
          })
        : h('div', { class: 'empty', text: 'keine' }),
    );

  $app.replaceChildren(
    tiles,
    section('💡 Fazit', 'regelbasiert, keine Anlageberatung', verdict),
    section('🎯 Kaufchancen', 'lieferbar · Gesamtpreis inkl. Versand', ops.length ? ops : h('div', { class: 'card empty', text: 'Heute nichts Auffälliges.' })),
    section('📊 Markt', 'Cardmarket-Trend der Displays, Veränderung seit Beginn', marketChart),
    section('🏷️ Neueste Sets', 'günstigstes lieferbares Angebot je Sprache', recent),
    section('📉 Bewegungen', 'Cardmarket · 7 Tage', h('div', { class: 'movers' }, mvList('Gefallen', D.fallers), mvList('Gestiegen', D.risers))),
  );
}

// ═══════════ Display-Explorer ═══════════
function renderDisplays() {
  const F = state.filters;
  const list = h('div', { class: 'card' });
  const count = h('p', { class: 'count' });
  const seg = (key, opts) =>
    h(
      'div',
      { class: 'seg', role: 'group' },
      opts.map(([v, label]) =>
        h('button', {
          class: F[key] === v ? 'on' : '',
          text: label,
          'aria-pressed': String(F[key] === v),
          onclick: (e) => {
            F[key] = v;
            state.limit = 60;
            e.currentTarget.parentElement.querySelectorAll('button').forEach((b) => {
              b.classList.toggle('on', b === e.currentTarget);
              b.setAttribute('aria-pressed', String(b === e.currentTarget));
            });
            update();
          },
        }),
      ),
    );
  const search = h('input', { type: 'search', placeholder: 'Set suchen (deutsch oder englisch) …', value: F.q, 'aria-label': 'Suche' });
  search.addEventListener('input', () => {
    F.q = search.value;
    state.limit = 60;
    update();
  });
  const typeSel = h('select', { 'aria-label': 'Format', onchange: (e) => ((F.type = e.target.value), update()) },
    [['all', 'Alle Formate'], ['booster-box', '36er / Display'], ['half-box', '18er'], ['jumbo-box', 'Jumbo']].map(([v, l]) => h('option', { value: v, selected: F.type === v, text: l })));
  const sortSel = h('select', { 'aria-label': 'Sortierung', onchange: (e) => ((F.sort = e.target.value), update()) },
    [['new', 'Neueste zuerst'], ['d7', 'Stärkster Rückgang (7 T)'], ['d7up', 'Stärkster Anstieg (7 T)'], ['cheap', 'Günstigster Kaufpreis'], ['cm', 'Cardmarket-Preis ↑'], ['cmdesc', 'Cardmarket-Preis ↓']].map(([v, l]) => h('option', { value: v, selected: F.sort === v, text: l })));
  const stock = h('input', { type: 'checkbox', checked: F.stock });
  stock.addEventListener('change', () => ((F.stock = stock.checked), update()));

  function update() {
    const q = F.q.trim().toLowerCase();
    let items = state.data.products.filter(
      (p) =>
        (F.region === 'all' || p.region === F.region) &&
        (F.type === 'all' || p.type === F.type) &&
        (!F.stock || p.inStock > 0) &&
        (!q || `${p.name} ${p.setDe ?? ''}`.toLowerCase().includes(q)),
    );
    const bestOf = (p) => p.cheapest?.total ?? Infinity;
    const by = {
      new: (a, b) => b.added.localeCompare(a.added),
      d7: (a, b) => (a.d7 ?? 9) - (b.d7 ?? 9),
      d7up: (a, b) => (b.d7 ?? -9) - (a.d7 ?? -9),
      cheap: (a, b) => bestOf(a) - bestOf(b),
      cm: (a, b) => (a.trend ?? 1e9) - (b.trend ?? 1e9),
      cmdesc: (a, b) => (b.trend ?? -1) - (a.trend ?? -1),
    }[F.sort];
    items.sort(by);
    count.textContent = `${items.length} Displays`;
    const shown = items.slice(0, state.limit);
    list.replaceChildren(
      h(
        'table',
        { class: 'table responsive' },
        h('thead', {}, h('tr', {}, h('th', { text: 'Display' }), h('th', { class: 'r', text: 'CM-Trend' }), h('th', { class: 'r', text: '7 Tage' }), h('th', { text: 'Günstigste Kaufmöglichkeiten' }))),
        h(
          'tbody',
          {},
          shown.map((p) =>
            h(
              'tr',
              { class: 'click', onclick: () => go(`#/p/${p.id}`) },
              h('td', {}, h('div', { class: 'stack' }, h('b', {}, regionBadge(p.region), ` ${setTitle(p)}`), h('span', { class: 'muted small', text: `${fmtName(p)}${p.setDe ? ' · ' + p.set : ''} · seit ${dateDe(p.added)}` }))),
              h('td', { class: 'r num inl', 'data-l': 'Cardmarket', text: eur(p.trend) }),
              h('td', { class: 'r inl', 'data-l': '7 Tage' }, delta(p.d7)),
              h('td', { 'data-l': 'Shop' }, priceCell(p)),
            ),
          ),
        ),
      ),
      items.length > shown.length
        ? h('div', { class: 'pad', style: 'text-align:center' }, h('button', { class: 'btn', text: `Weitere ${Math.min(60, items.length - shown.length)} anzeigen`, onclick: () => ((state.limit += 60), update()) }))
        : '',
      !items.length ? h('div', { class: 'empty', text: 'Keine Displays für diese Filter.' }) : '',
    );
  }

  $app.replaceChildren(
    h(
      'div',
      { class: 'filters' },
      search,
      seg('region', [['all', 'Alle'], ['international', 'International'], ['japanese', 'Japan'], ['chinese', 'China']]),
      typeSel,
      sortSel,
      h('label', { class: 'check' }, stock, 'nur lieferbar'),
    ),
    count,
    list,
  );
  update();
}

// ═══════════ Detailansicht ═══════════
async function loadHistory() {
  if (!state.history) state.history = await fetch('data/history.json', { cache: 'no-cache' }).then((r) => r.json());
  return state.history;
}

async function renderDetail(id) {
  const p = prod(id);
  if (!p) {
    $app.replaceChildren(h('div', { class: 'card empty', text: 'Display nicht gefunden.' }));
    return;
  }
  const langs = p.region === 'international' ? ['de', 'en'] : p.region === 'japanese' ? ['jp'] : ['cn'];
  const cheapest = p.cheapest;
  // Angebote inkl. Cardmarket als eigene Zeile, nach Gesamtpreis sortiert (lieferbare zuerst)
  const rows = [...p.offers];
  if (p.cm)
    rows.push({ shop: 'cardmarket', lang: p.cm.lang ?? 'mix', price: p.cm.price, total: p.cm.total, stock: 'in', url: p.cm.url, title: 'Günstigstes Angebot auf Cardmarket · Versand geschätzt', suspicious: p.cm.suspicious });
  rows.sort((a, b) => (b.stock === 'in') - (a.stock === 'in') || a.total - b.total);
  const chartBox = h('div', { class: 'card pad' }, h('div', { class: 'empty', text: 'Verlauf lädt …' }));

  const stat = (label, value, foot, color) =>
    h('div', { class: 'card tile', style: color ? `--tile-c:${color}` : null }, h('span', { class: 'label', text: label }), h('span', { class: 'value num' }, value), foot ? h('span', { class: 'foot' }, foot) : '');
  const offersTable = rows.length
    ? h(
        'div',
        { class: 'card' },
        h(
          'table',
          { class: 'table responsive' },
          h('thead', {}, h('tr', {}, h('th', { text: 'Shop' }), h('th', { text: 'Sprache' }), h('th', { class: 'r', text: 'Preis' }), h('th', { class: 'r', text: 'Gesamt inkl. Versand' }), h('th', { text: 'Status' }), h('th', { text: '' }))),
          h(
            'tbody',
            {},
            rows.map((o) =>
              h(
                'tr',
                { class: isCM(o.shop) ? 'cm-row' : '' },
                h('td', {}, h('b', { text: shop(o.shop) }), h('div', { class: 'muted small', text: o.title })),
                h('td', { 'data-l': 'Sprache' }, o.lang ? [langBadge(o.lang), ` ${LANG[o.lang]}`] : 'unbekannt'),
                h('td', { class: 'r num', 'data-l': 'Preis', text: eur(o.price) }),
                h('td', { class: 'r num', 'data-l': 'Gesamt' }, h('b', { text: eur(o.total) }), isCM(o.shop) ? h('div', { class: 'muted small', text: `inkl. ca. ${eur0(state.data.cmShippingEst)} Versand` }) : ''),
                h(
                  'td',
                  { 'data-l': 'Status' },
                  o.suspicious
                    ? h('span', { class: 'status-warn', text: 'auffällig günstig – Sprache/Zustand prüfen' })
                    : h('span', { class: o.stock === 'in' ? 'status-ok' : 'status-warn', text: STOCK[o.stock] + (o.damaged ? ' (Verpackung beschädigt)' : '') }),
                ),
                h('td', {}, h('a', { href: o.url, target: '_blank', rel: 'noopener', text: 'Zum Shop →' })),
              ),
            ),
          ),
        ),
      )
    : h('div', { class: 'card empty', text: 'In keinem der beobachteten Shops gelistet.' });

  $app.replaceChildren(
    h('div', { class: 'back' }, h('a', { href: '#/displays', class: 'btn', text: '← Alle Displays', onclick: (e) => (history.length > 1 ? (e.preventDefault(), history.back()) : null) })),
    h(
      'div',
      { class: 'hero detail-hero' },
      h(
        'div',
        { class: 'row' },
        h('div', { class: 'stack', style: 'flex:1;min-width:0' }, h('h2', { text: `${setTitle(p)} · ${fmtName(p)}` }), h('span', { class: 'meta' }, regionBadge(p.region), ` ${REGION[p.region][1]} · Cardmarket: ${p.name} · seit ${dateDe(p.added)}`)),
        h('a', { class: 'btn go', href: cmLink(p), target: '_blank', rel: 'noopener', text: 'Auf Cardmarket →' }),
      ),
    ),
    h(
      'div',
      { class: 'stats' },
      stat('Günstigster Kaufpreis', cheapest ? eur(cheapest.total) : '–', cheapest ? h('span', {}, langBadge(cheapest.lang), ` ${shop(cheapest.shop)} · inkl. ${isCM(cheapest.shop) ? 'ca. ' : ''}Versand`) : 'nirgends lieferbar', 'linear-gradient(90deg,#ffe066,#ffbf00)'),
      stat('Cardmarket-Trend', eur(p.trend), h('span', {}, '7 T ', delta(p.d7), ' · 30 T ', delta(p.d30)), 'linear-gradient(90deg,#3fa9f5,#1b5fd1)'),
      stat('Cardmarket ab', eur(p.low), p.cm?.suspicious ? '⚠ auffällig günstig – prüfen' : `+ ca. ${eur0(state.data.cmShippingEst)} Versand (geschätzt)`, 'linear-gradient(90deg,#5fd37a,#179b54)'),
      stat('Lieferbar in Shops', String(p.inStock), `von ${p.offers.length} Angeboten in ${new Set(p.offers.map((o) => o.shop)).size} Shops`, 'linear-gradient(90deg,#c07cf2,#7b3fd6)'),
    ),
    section('📈 Preisverlauf', 'Cardmarket täglich · Shops: günstigster lieferbarer Gesamtpreis', chartBox),
    section('🛒 Kaufmöglichkeiten', 'Shops + Cardmarket · günstigste zuerst', offersTable),
  );

  try {
    const H = await loadHistory();
    const dates = [...new Set([...H.cmDates, ...H.shopDates])].sort();
    const at = (srcDates, arr) => {
      if (!arr) return dates.map(() => null);
      const m = new Map(srcDates.map((d, i) => [d, arr[i]]));
      return dates.map((d) => m.get(d) ?? null);
    };
    const series = [{ name: 'Cardmarket-Trend', short: 'CM-Trend', color: 'var(--s1)', values: at(H.cmDates, H.cm[id]) }];
    const shopColors = ['var(--s2)', 'var(--s4)'];
    const shopSeries = langs.filter((l) => H.shop[id]?.[l]).map((l, i) => ({ name: `Shop ${LANG[l]}`, short: `Shop ${CODE[l]}`, color: shopColors[i], values: at(H.shopDates, H.shop[id][l]) }));
    if (shopSeries[0]) series.push(shopSeries[0]);
    series.push({ name: 'Cardmarket ab (ohne Versand)', short: 'CM ab', color: 'var(--s3)', values: at(H.cmDates, H.low[id]), dash: true });
    if (shopSeries[1]) series.push(shopSeries[1]);
    chartBox.replaceChildren(lineChart({ dates, series, yFmt: (v, full) => (full ? eur(v) : eur0(v)), label: `Preisverlauf ${p.name}` }));
    if (H.shopDates.length < 7)
      chartBox.append(h('p', { class: 'muted small', text: `Shop-Preise werden seit ${dateDe(H.shopDates[0] ?? p.added)} täglich gesammelt – der Verlauf wächst mit jedem Tag.` }));
  } catch (e) {
    chartBox.replaceChildren(h('div', { class: 'empty', text: 'Verlauf konnte nicht geladen werden.' }));
  }
}

// ═══════════ Routing & Start ═══════════
function route() {
  const hash = location.hash || '#/';
  const m = hash.match(/^#\/p\/(\d+)/);
  document.querySelectorAll('.tabs a').forEach((a) => a.classList.toggle('active', (a.dataset.tab === 'displays') === (hash.startsWith('#/displays') || !!m)));
  if (m) renderDetail(Number(m[1]));
  else if (hash.startsWith('#/displays')) renderDisplays();
  else renderHome();
  if (!m || !state.routed) window.scrollTo(0, 0);
  state.routed = true;
}

function renderChrome() {
  const D = state.data;
  document.getElementById('stand').textContent = `Stand ${dateDe(D.shopsDate || D.priceDate)} · ${D.products.length} Displays`;
  document.getElementById('foot').replaceChildren(
    h('div', { text: `Cardmarket-Preisübersicht vom ${dateDe(D.priceDate)} (${D.cmDays} Tage Verlauf) · Shops vom ${dateDe(D.shopsDate)} (${D.shopDays} ${D.shopDays === 1 ? 'Tag' : 'Tage'} Verlauf) · Preise ohne Gewähr, keine Anlageberatung.` }),
    h('div', { class: 'chips' }, D.shops.map((sh) => h('span', { class: `chip ${sh.ok && !sh.warning ? 'status-ok' : 'status-warn'}`, title: sh.warning ?? '', text: `${sh.name} · ${sh.matched}` }))),
  );
}

document.getElementById('theme').addEventListener('click', () => {
  const root = document.documentElement;
  const dark = root.dataset.theme ? root.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  root.dataset.theme = dark ? 'light' : 'dark';
  try {
    localStorage.setItem('pt-theme', root.dataset.theme);
  } catch (e) {}
});

(async function start() {
  try {
    state.data = await fetch('data/dashboard.json', { cache: 'no-cache' }).then((r) => r.json());
  } catch (e) {
    $app.replaceChildren(h('div', { class: 'card empty', text: 'Daten konnten nicht geladen werden.' }));
    return;
  }
  state.byId = new Map(state.data.products.map((p) => [p.id, p]));
  renderChrome();
  window.addEventListener('hashchange', route);
  route();
})();
