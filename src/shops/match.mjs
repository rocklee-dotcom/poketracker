// Shop-Titel verstehen (Sprache, Format, Zustand) und dem passenden Cardmarket-Produkt zuordnen.

// Wortgrenzen, die auch Umlaute als Buchstaben behandeln ("Schäden" ist kein "S-Ch").
const w = (src) => new RegExp(`(?<![\\p{L}\\p{N}])(?:${src})(?![\\p{L}\\p{N}])`, 'giu');
const LANGS = [
  ['de', w('deutsch|german|DE|GER')],
  ['en', w('englisch|english|EN|ENG')],
  ['jp', w('japanisch|japanese|JP|JPN|japan')],
  ['cn', w('chinesisch|chinese|CN|CHN|TCHN|SCHN|S-Ch|T-Ch')],
  ['kr', w('koreanisch|korean|KR|KOR')],
];
// Japanische Set-Codes in Klammern, z.B. "(sv11B)", "[M2a]", "(s10b)", "(sm12a)"
const JP_CODE = /[([](?:sv|sm|s|m|xy|bw)\d+[a-z]?[)\]]/i;

const REGION_OF_LANG = { de: 'international', en: 'international', jp: 'japanese', cn: 'chinese' };
const LANG_OF_REGION = { japanese: 'jp', chinese: 'cn' };

// Keine Booster-Displays (oder Zubehör)
const NOT_A_DISPLAY = w(
  'mini[- ]?tin|tin|acryl|acrylic|case|sleeved|sleeves?|blister|elite trainer|etb|top trainer|special set|plüsch|plush|deck|binder|ordner|album|spielmatte|playmat|einzelbooster|poster' +
    // Marktplatz-Fallen: leere Displays, Karton, Deko, Fälschungen, einzelne Packs
    '|leer|leeres|empty|ohne booster|karton|aufbewahrung|deko|replica|fake|proxy|custom|lose booster|single booster|1x booster|einzeln',
);
const IS_DISPLAY = /display|booster ?box/i;
const DAMAGED = /schäden|beschädigt|eindrücke|eingedrückt|damaged|dent/i;

// Serien-Namen, die in Titeln vor dem eigentlichen Set stehen ("Karmesin & Purpur Stellarkrone")
const SERIES = new Set(['scarlet and violet', 'karmesin and purpur', 'sword and shield', 'schwert and schild', 'sun and moon', 'sonne and mond', 'mega evolution', 'mega entwicklung', 'xy', 'black and white', 'schwarz and weiss']);

// Füllwörter in Shop-Titeln, die nichts über das Set aussagen
const FILLER = new Set(
  'pokemon display displays booster boosters box boxen sealed versiegelt deutsch englisch german english japanisch japanese chinesisch koreanisch base basis enhanced neu original verpackt absolute raritat rarität selten leichte eindrucke schaden verpackung inhalt pack packs karten card cards game trading'.split(' '),
);

export const norm = (s) =>
  String(s)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ß/g, 'ss')
    .replace(/&/g, ' and ')
    .replace(/\bund\b/g, ' and ')
    .replace(/\bvol\b\.?/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const test = (re, s) => {
  re.lastIndex = 0;
  return re.test(s);
};

export function detectLang(offer) {
  for (const text of [offer.title, offer.langAttr]) {
    if (!text) continue;
    // Bei mehreren Treffern gewinnt der zuletzt im Text stehende (Sprache steht meist am Ende)
    let best = null;
    for (const [lang, re] of LANGS) {
      const m = [...text.matchAll(re)].pop();
      if (m && (!best || m.index > best.index)) best = { lang, index: m.index };
    }
    if (best) return best.lang;
  }
  if (JP_CODE.test(offer.title)) return 'jp';
  return offer.langHint ?? null;
}

export function detectFormat(title) {
  if (!IS_DISPLAY.test(title) || test(NOT_A_DISPLAY, title)) return null;
  // "Kollektion/Collection" ist meist eine Box – außer z.B. "25th Anniversary Collection Display"
  if (/\b(kollektion|collection)\b/i.test(title) && !/\b(kollektion|collection)\s+(display|booster)/i.test(title)) return null;
  // Zahl darf nicht an Buchstaben hängen ("ME06 Booster" ist ein Set-Code, keine Anzahl)
  const count = Number(title.match(/(?<![A-Za-z\d.])(\d+)\s*(?:er\b|x\s*booster|\s*booster|\s*packs?\b)/i)?.[1] ?? NaN);
  return {
    jumbo: /jumbo/i.test(title),
    count: Number.isFinite(count) ? count : null,
  };
}

/**
 * Baut den Index der Cardmarket-Displays: Alias (normalisiert) -> Produkte, Set-Code -> Produkte.
 * @param setNamesDe  { "Englischer Setname": "Deutscher Setname" }
 * @param shopAliases { "Shop-Schreibweise": "Cardmarket-Setname" }
 */
export function buildIndex(products, setNamesDe, shopAliases = {}) {
  const DISPLAY_TYPES = new Set(['booster-box', 'half-box', 'jumbo-box']);
  const deEntries = Object.entries(setNamesDe).filter(([k, v]) => !k.startsWith('_') && typeof v === 'string');
  const aliasEntries = Object.entries(shopAliases).filter(([k]) => !k.startsWith('_'));
  const aliases = new Map();
  const codes = new Map();
  const aliasLang = new Map(); // alias -> Set('de'|'en'|'?') – verrät bei internationalen Sets die Sprache
  const add = (map, key, p) => {
    if (!key || key.length < 3) return;
    if (!map.has(key)) map.set(key, []);
    if (!map.get(key).includes(p)) map.get(key).push(p);
  };
  const tagLang = (key, lang) => {
    if (!aliasLang.has(key)) aliasLang.set(key, new Set());
    aliasLang.get(key).add(lang);
  };

  for (const p of products) {
    if (!DISPLAY_TYPES.has(p.type) || p.region === 'other') continue;
    let set = p.set;
    const code = set.match(/^([A-Za-z0-9.]+C):\s*/);
    if (code) {
      add(codes, norm(code[1]).replace(/\s/g, ''), p);
      set = set.slice(code[0].length);
    }
    const base = set.replace(/\b(S-Ch|T-Ch|JP|Simplified Chinese|Traditional Chinese|Indonesian & Thai)\b/g, '').replace(/\s+/g, ' ').trim();
    const names = new Map(); // name -> lang
    for (const n of [set, base, base.replace(/^The\s+/i, '')]) names.set(n, 'en');
    for (const [en, de] of deEntries) {
      if (base === en) names.set(de, 'de');
      else if (base.startsWith(en + ' ')) names.set(de + base.slice(en.length), 'de'); // "Journey Together Enhanced"
    }
    for (const [shopName, cmName] of aliasEntries) if (base === cmName) names.set(shopName, '?');
    for (const [n, lang] of names) {
      add(aliases, norm(n), p);
      if (p.region === 'international') tagLang(norm(n), lang);
    }
  }
  return { aliases, codes, aliasLang };
}

/** Ordnet ein Shop-Angebot einem Cardmarket-Produkt zu. */
export function matchOffer(offer, index) {
  const fmt = detectFormat(offer.title);
  if (!fmt) return { skip: 'kein Display' };
  let lang = detectLang(offer);
  if (lang === 'kr') return { skip: 'koreanisch', lang };
  const damaged = DAMAGED.test(offer.title);

  const t = ' ' + norm(offer.title) + ' ';
  const tCompact = t.replace(/\s/g, '');

  // Punkte je Produkt: Set-Code-Treffer (+100) plus Länge des längsten Namens-Treffers.
  const score = new Map(); // id -> { p, code, name, series }
  const entry = (p) => score.get(p.id) ?? score.set(p.id, { p, code: false, name: 0, series: true }).get(p.id);
  for (const [code, ps] of index.codes) if (tCompact.includes(code)) for (const p of ps) entry(p).code = true;

  // Namens-Treffer mit Position; Treffer, die komplett in einem längeren Treffer stecken, fallen weg
  // ("evolution" in "mega evolution").
  let hits = [];
  for (const [alias, ps] of index.aliases) {
    let from = 0;
    let i;
    while ((i = t.indexOf(' ' + alias + ' ', from)) !== -1) {
      hits.push({ alias, ps, start: i + 1, end: i + 1 + alias.length });
      from = i + 1;
    }
  }
  hits = hits.filter((h) => !hits.some((o) => o !== h && o.end - o.start > h.end - h.start && o.start <= h.start && o.end >= h.end));

  // Nur Serienname erkannt, aber noch unbekannte Wörter im Titel -> wahrscheinlich ein Set,
  // dessen Schreibweise wir nicht kennen. Lieber nicht zuordnen.
  if (hits.length && hits.every((h) => SERIES.has(h.alias)) && !Array.from(score.values()).some((c) => c.code)) {
    let rest = t;
    for (const h of hits) rest = rest.replace(' ' + h.alias + ' ', ' ');
    const leftover = rest
      .split(' ')
      .filter((x) => x.length >= 4 && !FILLER.has(x) && !/^\d+(er)?$/.test(x) && !/^(sv|swsh|sm|me|xy)\d+[a-z]*$/.test(x));
    if (leftover.length) return { lang, fmt, damaged, reason: `nur Serienname erkannt (unbekannt: ${leftover.join(' ')})` };
  }

  for (const { alias, ps } of hits) {
    for (const p of ps) {
      const e = entry(p);
      if (alias.length > e.name || (e.series && !SERIES.has(alias))) {
        if (alias.length >= e.name) e.alias = alias;
        e.name = Math.max(e.name, alias.length);
        e.series = e.series && SERIES.has(alias);
      }
    }
  }
  let candidates = [...score.values()];
  if (lang) candidates = candidates.filter((c) => c.p.region === REGION_OF_LANG[lang]);
  // Serien-Namen ("Karmesin & Purpur") nur verwenden, wenn sonst nichts passt
  if (candidates.some((c) => c.code || !c.series)) candidates = candidates.filter((c) => c.code || !c.series);
  if (!candidates.length) return { lang, fmt, damaged, reason: 'kein passendes Set' };

  const wanted = (p) => {
    if (p.region === 'international') {
      if (fmt.count === 18) return p.type === 'half-box';
      if (fmt.count === null || fmt.count === 36) return p.type === 'booster-box';
      return false; // andere Größen (z.B. 24er Sleeved-Display) gibt es nicht als Cardmarket-Display
    }
    return fmt.jumbo ? p.type === 'jumbo-box' : p.type === 'booster-box';
  };
  candidates = candidates.filter((c) => wanted(c.p));
  if (!candidates.length) return { lang, fmt, damaged, reason: 'Format nicht auf Cardmarket' };

  const s = (c) => (c.code ? 100 : 0) + c.name;
  const max = Math.max(...candidates.map(s));
  const bestC = candidates.filter((c) => s(c) === max);
  if (bestC.length > 1) return { lang, fmt, damaged, reason: `mehrdeutig: ${bestC.map((c) => c.p.name).join(' / ')}` };

  const { p, alias } = bestC[0];
  let langSource = lang ? 'titel' : null;
  if (!lang && p.region === 'international' && alias) {
    // Sprache aus dem verwendeten Setnamen: "Obsidianflammen" -> de, "Obsidian Flames" -> en
    const langs = index.aliasLang.get(alias);
    if (langs?.size === 1 && !langs.has('?')) {
      lang = [...langs][0];
      langSource = 'setname';
    }
  }
  if (!lang && LANG_OF_REGION[p.region]) {
    lang = LANG_OF_REGION[p.region];
    langSource = 'region';
  }
  return { lang, langSource, fmt, damaged, product: p };
}
