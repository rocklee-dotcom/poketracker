// Adapter je Shopsystem. Jeder liefert eine Liste roher Angebote:
// { title, url, price, stock: 'in'|'out'|'preorder', langHint?, langAttr? }

import { decodeHtml, get, parseEuro } from './http.mjs';

const MAX_PAGES = 15;
const PREORDER = /vorbestell|pre-?order|vorverkauf|erscheint am|release/i;

// ---------- Shopify: /collections/<handle>/products.json ----------
async function shopify(shop, source) {
  const out = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const url = `${shop.base}/collections/${source.collection}/products.json?limit=250&page=${page}`;
    const { products } = await get(url, { json: true });
    if (!products?.length) break;
    for (const p of products) {
      const variants = p.variants ?? [];
      const avail = variants.filter((v) => v.available);
      const pool = avail.length ? avail : variants;
      const price = Math.min(...pool.map((v) => Number(v.price)).filter((n) => n > 0));
      const tagText = (p.tags ?? []).join(' ');
      out.push({
        title: p.title,
        url: `${shop.base}/products/${p.handle}`,
        price: Number.isFinite(price) ? price : null,
        stock: !avail.length ? 'out' : PREORDER.test(p.title + ' ' + tagText) ? 'preorder' : 'in',
        langHint: source.langHint,
        langAttr: tagText,
      });
    }
    if (products.length < 250) break;
  }
  return out;
}

// ---------- WooCommerce: Store API ----------
async function woocommerce(shop, source) {
  const out = [];
  // Kleine Seiten: TCG-24 (Cloudflare) blockt größere per_page-Werte mit 403.
  const PER_PAGE = 20;
  for (let page = 1; page <= MAX_PAGES * 3; page++) {
    const url = `${shop.base}/wp-json/wc/store/v1/products?search=${encodeURIComponent(source.search)}&per_page=${PER_PAGE}&page=${page}`;
    const items = await get(url, { json: true });
    if (!Array.isArray(items) || !items.length) break;
    for (const p of items) {
      const cats = (p.categories ?? []).map((c) => c.name).join(' ');
      const name = decodeHtml(p.name);
      if (!/pok[eé]mon/i.test(name + ' ' + cats)) continue;
      const minor = p.prices?.currency_minor_unit ?? 2;
      const price = p.prices?.price ? Number(p.prices.price) / 10 ** minor : null;
      const stockText = p.stock_availability?.text ?? '';
      out.push({
        title: name,
        url: p.permalink,
        price,
        stock: p.is_on_backorder || PREORDER.test(name + ' ' + stockText) ? 'preorder' : p.is_in_stock ? 'in' : 'out',
        langHint: source.langHint,
        langAttr: (p.attributes ?? []).map((a) => (a.terms ?? []).map((t) => t.name).join(' ')).join(' '),
      });
    }
    if (items.length < PER_PAGE) break;
  }
  return out;
}

// ---------- JTL-Shop: Kategorieseiten mit schema.org-Microdata ----------
async function jtl(shop, source) {
  const out = [];
  const seen = new Set();
  for (let page = 1; page <= MAX_PAGES; page++) {
    const url = page === 1 ? source.url : `${source.url}_s${page}`;
    let html;
    try {
      html = await get(url);
    } catch (err) {
      if (page > 1) break; // keine weitere Seite
      throw err;
    }
    const blocks = html.split(/itemtype=["']https?:\/\/schema\.org\/Product["']/).slice(1);
    let added = 0;
    for (const b of blocks) {
      const purl = b.match(/itemprop=["']url["'][^>]*content=["']([^"']+)/)?.[1];
      if (!purl || seen.has(purl)) continue;
      seen.add(purl);
      const title = decodeHtml(b.match(/class=["']productbox-title["'][^>]*>([\s\S]*?)<\/div>/)?.[1] ?? '');
      const price = Number(b.match(/<meta itemprop=["']price["'] content=["']([\d.]+)/)?.[1] ?? NaN);
      const status = decodeHtml(b.match(/class=["']signal_image[^>]*>([\s\S]*?)<\/div>/)?.[1] ?? '');
      out.push({
        title,
        url: purl,
        price: Number.isFinite(price) ? price : null,
        stock: PREORDER.test(status + ' ' + title)
          ? 'preorder'
          : /lager|sofort|verfügbar|lieferbar/i.test(status) && !/nicht|ausverkauft/i.test(status)
            ? 'in'
            : 'out',
        stockText: status,
        langHint: source.langHint,
      });
      added++;
    }
    if (!added) break;
  }
  return out;
}

// ---------- OXID (Trader-Online): Produktkarten ----------
async function oxid(shop, source) {
  const out = [];
  const seen = new Set();
  for (let page = 0; page < MAX_PAGES; page++) {
    const url = `${source.url}?_artperpage=100${page ? `&pgNr=${page}` : ''}`;
    const html = await get(url);
    const blocks = html.split(/class="card product-card/).slice(1);
    let added = 0;
    for (const b of blocks) {
      const href = b.match(/href="(https:\/\/[^"]+?\.html)/)?.[1];
      if (!href || seen.has(href)) continue;
      seen.add(href);
      const title = decodeHtml(b.match(/class="h5 card-title">([\s\S]*?)<\/div>/)?.[1] ?? '');
      const priceHtml = b.match(/class="text-nowrap grid-price[^"]*">([\s\S]*?)<\/div>/)?.[1] ?? '';
      const price = parseEuro(decodeHtml(priceHtml).replace(/\s+/g, ''));
      const lang = decodeHtml(b.match(/Sprache:<\/strong>\s*<span>([^<]*)/)?.[1] ?? '');
      const out_ = /notOnStock|Zum Lieferalarm|OutOfStock/.test(b);
      const pre = /Vorbestell/i.test(b);
      out.push({
        title,
        url: href,
        price,
        stock: pre ? 'preorder' : out_ ? 'out' : 'in',
        langHint: source.langHint,
        langAttr: lang,
      });
      added++;
    }
    if (!added) break;
  }
  return out;
}

// ---------- eBay (offizielle Browse API, braucht EBAY_CLIENT_ID + EBAY_CLIENT_SECRET) ----------
let ebayToken = null;
async function ebayAuth() {
  if (ebayToken && ebayToken.exp > Date.now()) return ebayToken.value;
  const basic = Buffer.from(`${process.env.EBAY_CLIENT_ID}:${process.env.EBAY_CLIENT_SECRET}`).toString('base64');
  const res = await fetch('https://api.ebay.com/identity/v1/oauth2/token', {
    method: 'POST',
    headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials&scope=' + encodeURIComponent('https://api.ebay.com/oauth/api_scope'),
    signal: AbortSignal.timeout(30_000),
  });
  const j = await res.json();
  if (!j.access_token) throw new Error(`eBay-Anmeldung fehlgeschlagen: ${j.error_description ?? j.error ?? res.status}`);
  ebayToken = { value: j.access_token, exp: Date.now() + (j.expires_in - 60) * 1000 };
  return ebayToken.value;
}

/**
 * Sucht Sofort-Kaufen-Angebote auf ebay.de. source: { q, langHint? }
 * Filter: neu, Festpreis, Versand nach DE, Verkäufer mit ≥ 98 % positiv und ≥ 50 Bewertungen.
 */
async function ebay(shop, source) {
  const token = await ebayAuth();
  const params = new URLSearchParams({
    q: source.q,
    limit: '50',
    sort: 'price',
    filter: 'buyingOptions:{FIXED_PRICE},conditionIds:{1000},deliveryCountry:DE,priceCurrency:EUR,price:[25..20000]',
  });
  const res = await fetch(`https://api.ebay.com/buy/browse/v1/item_summary/search?${params}`, {
    headers: { Authorization: `Bearer ${token}`, 'X-EBAY-C-MARKETPLACE-ID': 'EBAY_DE', 'Accept-Language': 'de-DE' },
    signal: AbortSignal.timeout(30_000),
  });
  if (res.status === 429) throw new Error('eBay: Abruflimit erreicht');
  const j = await res.json();
  if (!res.ok) throw new Error(`eBay ${res.status}: ${j.errors?.[0]?.message ?? ''}`);
  const out = [];
  for (const it of j.itemSummaries ?? []) {
    const seller = it.seller ?? {};
    if (Number(seller.feedbackPercentage ?? 0) < 98 || Number(seller.feedbackScore ?? 0) < 50) continue;
    const price = Number(it.price?.value);
    if (!price || it.price?.currency !== 'EUR') continue;
    const ship = it.shippingOptions?.[0]?.shippingCost;
    out.push({
      title: it.title,
      url: it.itemWebUrl,
      price,
      shipping: ship && ship.currency === 'EUR' ? Number(ship.value) : null, // null = unbekannt
      stock: 'in',
      langHint: source.langHint,
      seller: `${seller.username ?? ''} (${seller.feedbackPercentage ?? '?'} %)`,
    });
  }
  return out;
}

export const ADAPTERS = { shopify, woocommerce, jtl, oxid, ebay };
