// Höflicher HTTP-Client für Shop-Seiten: eindeutiger User-Agent, Pause zwischen Abrufen, Wiederholungen.

const UA = 'Mozilla/5.0 (compatible; poketracker/0.2; private Preisbeobachtung, 1x taeglich)';
const DELAY_MS = 1500;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let last = 0;

export async function get(url, { json = false, attempts = 3 } = {}) {
  let lastErr;
  for (let i = 1; i <= attempts; i++) {
    const wait = last + DELAY_MS - Date.now();
    if (wait > 0) await sleep(wait);
    last = Date.now();
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': UA, 'Accept-Language': 'de-DE,de;q=0.9', Accept: json ? 'application/json' : 'text/html' },
        signal: AbortSignal.timeout(45_000),
      });
      if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}`);
      if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { fatal: true });
      return json ? await res.json() : await res.text();
    } catch (err) {
      lastErr = err;
      if (err.fatal || i === attempts) break;
      await sleep(5_000 * i);
    }
  }
  throw new Error(`${url}: ${lastErr?.message}`);
}

export function decodeHtml(s) {
  return s
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&euro;/g, '€')
    .replace(/\s+/g, ' ')
    .trim();
}

/** "1.234,56 €" -> 1234.56 */
export function parseEuro(s) {
  const m = String(s).match(/(\d{1,3}(?:\.\d{3})*|\d+)(?:,(\d{1,2}))?/);
  if (!m) return null;
  return Number(m[1].replace(/\./g, '') + '.' + (m[2] ?? '0').padEnd(2, '0'));
}
