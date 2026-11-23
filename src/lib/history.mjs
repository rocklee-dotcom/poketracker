// Preis-Historie: eine CSV pro Monat unter data/history/YYYY-MM.csv
// Spalten: date,id,trend,avg,low

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const HEADER = 'date,id,trend,avg,low';

export function monthFile(dir, date) {
  return join(dir, `${date.slice(0, 7)}.csv`);
}

export function readMonth(file) {
  if (!existsSync(file)) return [];
  const lines = readFileSync(file, 'utf8').trim().split(/\r?\n/).slice(1);
  return lines.filter(Boolean).map((l) => {
    const [date, id, trend, avg, low] = l.split(',');
    return { date, id: Number(id), trend: num(trend), avg: num(avg), low: num(low) };
  });
}

/** Ersetzt alle Zeilen eines Datums durch die neuen Zeilen (Wiederholung ist ungefährlich). */
export function writeDay(dir, date, rows, { overwrite = true } = {}) {
  mkdirSync(dir, { recursive: true });
  const file = monthFile(dir, date);
  const existing = readMonth(file);
  const hasDay = existing.some((r) => r.date === date);
  if (hasDay && !overwrite) return { file, written: 0, skipped: true };
  const kept = existing.filter((r) => r.date !== date);
  const all = [...kept, ...rows.map((r) => ({ ...r, date }))].sort(
    (a, b) => a.date.localeCompare(b.date) || a.id - b.id,
  );
  const body = all.map((r) => [r.date, r.id, fmt(r.trend), fmt(r.avg), fmt(r.low)].join(','));
  writeFileSync(file, [HEADER, ...body].join('\n') + '\n');
  return { file, written: rows.length, skipped: false };
}

const num = (s) => (s === '' || s === undefined ? null : Number(s));
const fmt = (v) => (v === null || v === undefined ? '' : String(v));

/** Preis normieren: auf 2 Nachkommastellen runden, 0/negativ/fehlend -> null */
export function price(v) {
  return typeof v === 'number' && v > 0 ? Math.round(v * 100) / 100 : null;
}
