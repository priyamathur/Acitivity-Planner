// Pure recommendation engine — no DOM, so it can be unit-tested in Node.
import { ACTIVITIES, SEASONS } from './data.js';

export const TIME_OPTIONS = [
  { id: 'quick', label: '15–30 min', max: 30 },
  { id: 'hour', label: 'About an hour', max: 60 },
  { id: 'half', label: 'Half a day', max: 180 },
  { id: 'full', label: 'All day', max: 600 },
];

export const PLACE_OPTIONS = [
  { id: 'home', label: 'At home' },
  { id: 'outside', label: 'Outside, close by' },
  { id: 'out', label: 'Go somewhere' },
  { id: 'any', label: 'Surprise me' },
];

export const ENERGY_OPTIONS = [
  { id: 'calm', label: 'Calm & cosy' },
  { id: 'active', label: 'Burn energy' },
  { id: 'any', label: 'Either' },
];

export function currentSeason(date = new Date()) {
  const m = date.getMonth();
  return Object.keys(SEASONS).find((k) => SEASONS[k].months.includes(m));
}

export function fitsAges(activity, ages) {
  if (!ages || !ages.length) return true;
  const [lo, hi] = activity.ages;
  return ages.every((a) => a >= lo - 1 && a <= hi + 1);
}

// Score an activity for the given context. Higher is better; -Infinity = excluded.
export function score(activity, ctx) {
  const { ages = [], maxMins = 600, place = 'any', energy = 'any', weather = null, recentIds = [], favIds = [], mess = 2 } = ctx;
  if (!fitsAges(activity, ages)) return -Infinity;
  if (activity.mins > maxMins) return -Infinity;
  if (place !== 'any' && activity.setting !== place) return -Infinity;
  if (activity.mess > mess) return -Infinity;
  if (weather === 'wet' && activity.weather === 'dry' && activity.setting !== 'home') return -Infinity;

  let s = 10;
  if (energy !== 'any') s += activity.energy === energy ? 4 : -3;
  // Prefer activities that use a good chunk of the available time.
  s += Math.min(activity.mins / maxMins, 1) * 3;
  if (weather === 'wet' && activity.weather === 'wet') s += 3;
  if (weather === 'dry' && activity.setting !== 'home') s += 2;
  if (favIds.includes(activity.id)) s += 1.5;
  if (recentIds.includes(activity.id)) s -= 6; // keep things fresh
  // A centred age fit is better than an edge fit.
  if (ages.length) {
    const [lo, hi] = activity.ages;
    const mid = (lo + hi) / 2;
    const avg = ages.reduce((a, b) => a + b, 0) / ages.length;
    s -= Math.abs(avg - mid) * 0.15;
  }
  return s;
}

// Deterministic-per-seed shuffle so "Show me others" gives a new set.
function seeded(seed) {
  let x = seed % 2147483647;
  if (x <= 0) x += 2147483646;
  return () => (x = (x * 16807) % 2147483647) / 2147483647;
}

export function recommend(ctx, { count = 3, seed = Date.now(), pool = ACTIVITIES } = {}) {
  const rand = seeded(seed);
  const scored = pool
    .map((a) => ({ a, s: score(a, ctx) }))
    .filter((x) => x.s > -Infinity)
    .map((x) => ({ ...x, s: x.s + rand() * 4 })) // jitter for variety
    .sort((p, q) => q.s - p.s);

  // Diversity: avoid three picks from the same category.
  const out = [];
  const cats = new Set();
  for (const { a } of scored) {
    if (out.length >= count) break;
    if (cats.has(a.cat) && scored.length > count * 2) continue;
    out.push(a);
    cats.add(a.cat);
  }
  for (const { a } of scored) {
    if (out.length >= count) break;
    if (!out.includes(a)) out.push(a);
  }
  return out;
}

// Weekend plan: one "out" adventure + one home activity per day.
export function planWeekend(ctx, seed = Date.now()) {
  const sat = [...recommend({ ...ctx, place: 'out', maxMins: 180 }, { count: 1, seed }), ...recommend({ ...ctx, place: 'home', maxMins: 60 }, { count: 1, seed: seed + 1 })];
  const used = sat.map((a) => a.id);
  const sun = [...recommend({ ...ctx, place: 'outside', maxMins: 120, recentIds: [...(ctx.recentIds || []), ...used] }, { count: 1, seed: seed + 2 }), ...recommend({ ...ctx, place: 'home', maxMins: 60, recentIds: [...(ctx.recentIds || []), ...used] }, { count: 1, seed: seed + 3 })];
  return { sat, sun };
}

export function ageFromBirthYear(year, now = new Date()) {
  return Math.max(0, now.getFullYear() - Number(year));
}

// WMO weather codes (Open-Meteo) → simple buckets.
export function weatherBucket(code) {
  if (code == null) return null;
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82) || code >= 95) return 'wet';
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow';
  return 'dry';
}

export function weatherLabel(code) {
  if (code == null) return '';
  if (code === 0) return 'Clear';
  if (code <= 3) return 'Partly cloudy';
  if (code === 45 || code === 48) return 'Foggy';
  if (code >= 51 && code <= 57) return 'Drizzle';
  if (code >= 61 && code <= 67) return 'Rain';
  if (code >= 71 && code <= 77) return 'Snow';
  if (code >= 80 && code <= 82) return 'Showers';
  if (code === 85 || code === 86) return 'Snow showers';
  if (code >= 95) return 'Thunderstorms';
  return '';
}

export function haversineKm(a, b) {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
