// Shops, die täglich abgefragt werden.
// shipping: Versandkosten nach Deutschland für ein Paket mit einem Display (Stand 23.11.2026,
// von den Versandseiten der Shops abgelesen). freeFrom: kostenloser Versand ab Bestellwert.
// langHint: Sprache, wenn der Titel keine nennt (nur für Listen, die eindeutig eine Sprache haben).

export const SHOPS = [
  {
    id: 'card-corner',
    name: 'Card-Corner',
    adapter: 'jtl',
    sources: [{ url: 'https://www.card-corner.de/Pokemon-Display' }],
    shipping: { cost: 5.49, freeFrom: 200, source: 'https://www.card-corner.de/Versandinformationen' },
  },
  {
    id: 'gate-to-the-games',
    name: 'Gate to the Games',
    adapter: 'jtl',
    sources: [
      { url: 'https://www.gate-to-the-games.de/Pokemon-Karten/Pokemon-Displays/' },
      { url: 'https://www.gate-to-the-games.de/Pokemon-japanische-Booster-Display-Boxen-guenstig-online-kaufen', langHint: 'jp' },
    ],
    shipping: { cost: 6.49, freeFrom: null, source: 'https://www.gate-to-the-games.de/info/Versandinformationen' },
  },
  {
    id: 'trader-online',
    name: 'Trader-Online',
    adapter: 'oxid',
    sources: [{ url: 'https://trader-online.de/Pokemon/Displays-Boxen/Booster-Displays/' }],
    shipping: { cost: 6.99, freeFrom: null, source: 'https://trader-online.de/Zahlung-und-Lieferung' },
  },
  {
    id: 'cardcosmos',
    name: 'Cardcosmos',
    adapter: 'shopify',
    base: 'https://cardcosmos.de',
    sources: [{ collection: 'pokemon-booster-displays' }],
    shipping: { cost: 4.99, freeFrom: null, source: 'https://cardcosmos.de/policies/shipping-policy' },
  },
  {
    id: 'balucards',
    name: 'Balucards',
    adapter: 'shopify',
    base: 'https://balucards.de',
    sources: [{ collection: 'booster-displays' }, { collection: 'japanische-produkte', langHint: 'jp' }],
    shipping: { cost: 4.95, freeFrom: 200, source: 'https://balucards.de/policies/shipping-policy' },
  },
  {
    id: 'tcg-24',
    name: 'TCG-24',
    adapter: 'woocommerce',
    base: 'https://tcg-24.de',
    sources: [{ search: 'display' }, { search: 'booster box' }],
    shipping: { cost: 5.99, freeFrom: 150, source: 'https://tcg-24.de/versand/' },
  },
  {
    id: 'loco-tcg',
    name: 'Loco TCG',
    adapter: 'woocommerce',
    base: 'https://loco-tcg.de',
    sources: [{ search: 'display' }, { search: 'booster box' }],
    shipping: { cost: 5.99, freeFrom: null, source: 'https://loco-tcg.de/versandarten/' },
  },
];

// eBay: offizielle Browse API. Läuft nur, wenn EBAY_CLIENT_ID und EBAY_CLIENT_SECRET gesetzt sind.
// Suchbegriffe werden täglich aus den neuesten Sets gebaut (siehe ebaySources).
SHOPS.push({
  id: 'ebay',
  name: 'eBay',
  adapter: 'ebay',
  requiresEnv: ['EBAY_CLIENT_ID', 'EBAY_CLIENT_SECRET'],
  maxPerProduct: 3, // nur die 3 günstigsten passenden Angebote je Display und Sprache behalten
  shipping: { cost: 6.99, freeFrom: null, estimated: true, source: 'Angebot (falls nicht angegeben: Schätzung)' },
  dynamicSources: ebaySources,
});

/** eBay-Suchen: neueste internationale Sets (DE- und EN-Suche) und neueste japanische Sets */
export function ebaySources(products) {
  const newest = (filter, n) =>
    products
      .filter(filter)
      .sort((a, b) => b.added.localeCompare(a.added))
      .slice(0, n);
  const intl = newest((p) => p.region === 'international' && p.type === 'booster-box' && !/Enhanced/.test(p.name) && p.trend, 12);
  const jp = newest((p) => p.region === 'japanese' && p.type === 'booster-box' && p.trend, 10);
  return [
    ...intl.flatMap((p) => [
      ...(p.setDe ? [{ q: `pokemon ${p.setDe} display` }] : []),
      { q: `pokemon ${p.set} booster box` },
    ]),
    ...jp.map((p) => ({ q: `pokemon ${p.set} booster box japanese`, langHint: 'jp' })),
  ];
}

export function shippingFor(shop, price) {
  const { cost, freeFrom } = shop.shipping;
  return freeFrom !== null && price >= freeFrom ? 0 : cost;
}
