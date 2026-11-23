// Erzeugt die App-Icons (PNG) ohne externe Abhängigkeiten: dunkler Hintergrund, rot-weißer Ball, gelber Holo-Ring.
// Aufruf: node src/tools/make-icons.mjs
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const OUT = join(fileURLToPath(new URL('../..', import.meta.url)), 'docs', 'icons');
mkdirSync(OUT, { recursive: true });

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};
function png(size, pixel) {
  const SS = 4; // Supersampling für glatte Kanten
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++)
        for (let sx = 0; sx < SS; sx++) {
          const [pr, pg, pb, pa] = pixel((x + (sx + 0.5) / SS) / size, (y + (sy + 0.5) / SS) / size);
          r += pr * pa; g += pg * pa; b += pb * pa; a += pa;
        }
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = a ? Math.round(r / a) : 0;
      raw[o + 1] = a ? Math.round(g / a) : 0;
      raw[o + 2] = a ? Math.round(b / a) : 0;
      raw[o + 3] = Math.round((a / (SS * SS)) * 255);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const NAVY = [16, 23, 46], NAVY2 = [43, 29, 85], RED = [255, 90, 78], WHITE = [244, 246, 251], DARK = [16, 23, 46], GOLD = [255, 203, 5];
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

/** scale: Anteil des Balls am Icon (kleiner für "maskable"), rounded: abgerundetes Quadrat */
const painter = (scale, rounded) => (u, v) => {
  // Hintergrund: Nacht-Verlauf, ggf. abgerundete Ecken
  if (rounded) {
    const rr = 0.22, cx = Math.min(Math.max(u, rr), 1 - rr), cy = Math.min(Math.max(v, rr), 1 - rr);
    if (Math.hypot(u - cx, v - cy) > rr) return [0, 0, 0, 0];
  }
  let col = mix(NAVY, NAVY2, (u + v) / 2);
  const dx = u - 0.5, dy = v - 0.5, d = Math.hypot(dx, dy);
  const R = 0.5 * scale;
  // Gelber Glanz-Ring
  if (d > R && d < R * 1.12) col = mix(col, GOLD, 0.85 * (1 - (d - R) / (R * 0.12)));
  if (d <= R) {
    const band = 0.085 * R * 2, ring = R * 0.06;
    if (d > R - ring) col = DARK; // Außenring
    else if (Math.abs(dy) < band / 2) col = DARK; // Mittelband
    else col = dy < 0 ? RED : WHITE;
    // Glanzlicht oben links
    if (dy < 0 && d < R - ring) col = mix(col, [255, 255, 255], Math.max(0, 0.35 - Math.hypot(dx + R * 0.35, dy + R * 0.45) / R));
    const btn = R * 0.3;
    if (d < btn) col = d > btn * 0.72 ? DARK : WHITE; // Knopf
  }
  return [...col, 1];
};

writeFileSync(join(OUT, 'icon-192.png'), png(192, painter(0.78, true)));
writeFileSync(join(OUT, 'icon-512.png'), png(512, painter(0.78, true)));
writeFileSync(join(OUT, 'icon-maskable-512.png'), png(512, painter(0.58, false)));
writeFileSync(join(OUT, 'apple-touch-icon.png'), png(180, painter(0.74, false)));
console.log('Icons erzeugt in', OUT);
