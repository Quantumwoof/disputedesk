// Small shared helpers: deterministic RNG, money, dates, hashing.
import { createHash } from 'node:crypto';

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const pick = (rng, arr) => arr[Math.floor(rng() * arr.length)];
export const int = (rng, lo, hi) => lo + Math.floor(rng() * (hi - lo + 1));

export const money = (value, currency = 'USD') => ({ currency_code: currency, value: Number(value).toFixed(2) });
export const amountOf = (m) => Number(m?.value ?? 0);
export const fmtMoney = (m) => `${m.currency_code} ${Number(m.value).toFixed(2)}`;

export const iso = (d) => new Date(d).toISOString();
export const isoDay = (d) => new Date(d).toISOString().slice(0, 10);
export const addDays = (d, n) => new Date(new Date(d).getTime() + n * 86400000);
export const addHours = (d, n) => new Date(new Date(d).getTime() + n * 3600000);
export const daysBetween = (a, b) => Math.round((new Date(b) - new Date(a)) / 86400000);
export const hoursUntil = (when, now) => (new Date(when) - new Date(now)) / 3600000;

export const sha256 = (s) => createHash('sha256').update(s).digest('hex');
export const norm = (s) => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
