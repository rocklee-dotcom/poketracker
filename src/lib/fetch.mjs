// Robuster JSON-Download mit Wiederholungen und Timeout.

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function fetchJson(url, { attempts = 4, timeoutMs = 60_000, headers = {} } = {}) {
  let lastError;
  for (let i = 1; i <= attempts; i++) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'poketracker (personal price tracker)', ...headers },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
      return await res.json();
    } catch (err) {
      lastError = err;
      if (i < attempts) {
        const wait = 2_000 * 2 ** (i - 1);
        console.warn(`  Versuch ${i}/${attempts} für ${url} fehlgeschlagen (${err.message}), neuer Versuch in ${wait / 1000}s`);
        await sleep(wait);
      }
    }
  }
  throw new Error(`Download fehlgeschlagen: ${url} – ${lastError?.message}`);
}
