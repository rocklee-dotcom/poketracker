// Einordnung der Cardmarket-Produkte: Kategorie, Produkttyp, Setname, Region.

export const CATEGORY = {
  52: 'booster', // "Pokémon Booster"
  53: 'display', // "Pokémon Display" (Booster Boxes, Cases, Bundles)
};

// Cardmarket-Kategorien, die es (fast) nur bei internationalen Sets gibt.
// Bewusst NICHT: Theme Decks (54) und Blisters (1083) – japanische Sets haben
// Starter Decks und "Special Sets", die Cardmarket in diese Kategorien einsortiert.
const INTL_ONLY_CATEGORIES = new Set([
  1016, // Pokémon Elite Trainer Boxes
]);

// Produktformate, die es nur bei internationalen Sets gibt.
// (Nicht "Blister": indonesische/thailändische Sets haben "2-Pack Blister".)
const INTL_ONLY_NAMES =
  /Sleeved Booster|Booster Bundle|Booster Box \(18 Boosters\)|Elite Trainer Box|Build & Battle|Checklane/i;

// Region aus eindeutigen Hinweisen im Produktnamen.
const NAME_MARKERS = [
  ['chinese', /^[A-Za-z0-9.]+C:|\bS-Ch\b|\bT-Ch\b|Chinese|Taiwan|Family Mart|Gem Pack|Mission Reward/i],
  ['other', /Korean|Indonesian|Thai\b|\bID\/TH\b/i],
  ['japanese', /\bJP\b|Japanese|\bJapan\b|Pokémon Card Gym|Extra Battle Day|GET Campaign|Get Challenge/i],
  ['international', /Prize Pack|General Mills|Trick or Trade|World Championships|First Partner Illustration/i],
];

// Formate, die es nur in Indonesien/Thailand gibt.
// ("Special Set ... 2-Pack Blister" trifft genau die ID/TH-Sets; einfache "2-Pack Blister" gibt es auch international,
//  "10-Pack Set Plus" auch in japanischen Sets.)
const ID_TH_FORMATS = /Special Set .*2-Pack Blister|\bID\/TH\b/i;

// Formate, die es nur in Japan gibt.
const JP_ONLY_NAMES = /Enhanced Expansion Pack|Strength Expansion Pack|High Class Pack|Concept Pack/i;

export function productType(p) {
  const n = p.name;
  if (p.idCategory === 53) {
    if (/Sleeved Booster Case/i.test(n)) return 'sleeved-case';
    if (/Case\b/i.test(n)) return 'case';
    if (/Booster Bundle/i.test(n)) return 'bundle';
    if (/Jumbo Booster Box/i.test(n)) return 'jumbo-box';
    if (/\(18 Boosters\)|Half Booster Box/i.test(n)) return 'half-box';
    if (/Booster Box|Display/i.test(n)) return 'booster-box';
    return 'other-display';
  }
  if (p.idCategory === 52) {
    if (/Sleeved Booster/i.test(n)) return 'sleeved-booster';
    if (/Jumbo Booster/i.test(n)) return 'jumbo-booster';
    if (/Fun Pack|Promo|Prize Pack|General Mills|Card Gym|Reward Pack|Happy Pack|Family Mart|Toys|Valentine/i.test(n))
      return 'promo-pack';
    return 'booster';
  }
  return 'other';
}

// Stückzahl nur bei Cases entfernen ("6 Booster Box Case"), sonst gehört sie
// zum Setnamen ("Base Set 2 Booster Box").
const CASE_SUFFIX = /\s+\d+\s+(Sleeved\s+)?Booster (Box )?Case\s*$/i;
const TYPE_SUFFIX =
  /\s*(Sleeved\s+)?(Jumbo\s+)?(Half\s+)?(Booster Box Case|Booster Box|Booster Bundle|Booster Case|Booster|Display|Case)(\s*\(.*\))?\s*$/i;

export function setName(name) {
  const stripped = name.replace(CASE_SUFFIX, '').replace(TYPE_SUFFIX, '').trim();
  return stripped || name;
}

const norm = (s) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/**
 * Bestimmt die Region jedes Produkts.
 * @param allProducts kompletter Nonsingles-Katalog (für Hinweise auf Set-Ebene)
 * @param intlSetNames Namen internationaler Sets (pokemontcg.io), optional
 * @param overrides { [idProduct]: region } manuelle Korrekturen
 */
export function buildRegionResolver(allProducts, intlSetNames = [], overrides = {}) {
  // Hinweise auf Set-Ebene sammeln
  const intlExpansions = new Set();
  const jpExpansions = new Set();
  const otherExpansions = new Set(); // indonesische/thailändische Sets (an typischen Formaten erkennbar)
  for (const p of allProducts) {
    if (ID_TH_FORMATS.test(p.name)) otherExpansions.add(p.idExpansion);
    if (INTL_ONLY_CATEGORIES.has(p.idCategory) || INTL_ONLY_NAMES.test(p.name)) {
      if (!markerRegion(p.name)) intlExpansions.add(p.idExpansion);
    }
    if (JP_ONLY_NAMES.test(p.name)) jpExpansions.add(p.idExpansion);
  }
  const intlNames = intlSetNames.map(norm).filter(Boolean);

  return function region(p) {
    if (overrides[p.idProduct]) return { region: overrides[p.idProduct], reason: 'override' };
    const m = markerRegion(p.name);
    if (m) return { region: m, reason: 'name-marker' };
    if (otherExpansions.has(p.idExpansion)) return { region: 'other', reason: 'other-region-set' };
    if (jpExpansions.has(p.idExpansion)) return { region: 'japanese', reason: 'jp-only-format' };
    if (intlExpansions.has(p.idExpansion)) return { region: 'international', reason: 'intl-only-format' };
    // Abgleich mit internationalen Setnamen: exakt, oder per Wortanfang nur bei
    // mehrteiligen Namen ("Dragon Blade" ist NICHT das internationale Set "Dragon").
    const n = norm(setName(p.name)).replace(/^ex /, '');
    const match = intlNames.some((s) => n === s || n === s + ' set' || (s.includes(' ') && n.startsWith(s + ' ')));
    if (match) return { region: 'international', reason: 'intl-set-name' };
    return { region: 'japanese', reason: 'fallback' };
  };
}

function markerRegion(name) {
  for (const [region, re] of NAME_MARKERS) if (re.test(name)) return region;
  return null;
}
