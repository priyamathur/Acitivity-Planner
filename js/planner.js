// Pure recommendation engine — no DOM, so it can be unit-tested in Node.
import { ACTIVITIES, SEASONS } from './data.js';
import { tasteBoost } from './taste.js';

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
  // Learned taste: lifts activities like the ones this family saved and did (see taste.js).
  s += tasteBoost(activity, ctx.taste);
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

// ======================= Weekend planning =======================

export const VIBES = {
  adventure: { label: 'Adventure', emoji: '🗺️', desc: 'Get out and explore' },
  mix: { label: 'Mix', emoji: '⚖️', desc: 'One outing, one cosy time' },
  cosy: { label: 'Cosy', emoji: '🛋️', desc: 'Mostly home and close by' },
};

export const DAY = { start: 9 * 60, end: 18 * 60, lunch: [12 * 60 + 30, 13 * 60 + 30] };
const BUFFER = 15; // travel/transition time around a class
const MIN_WINDOW = 45;

export const toMin = (hhmm) => {
  const [h, m] = String(hhmm).split(':').map(Number);
  return h * 60 + (m || 0);
};
export const fmtTime = (mins) => `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;

const iso = (d) => {
  const z = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return z.toISOString().slice(0, 10);
};

export const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
export const DAY_NAMES = { mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday', sun: 'Sunday' };

// The Monday–Sunday week around the weekend being planned. On a Saturday or
// Sunday "this week" is the current one (days already over are marked past);
// on a weekday it's the week ending in the coming weekend.
export function weekDays(now = new Date(), offset = 0) {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dow = d.getDay(); // 0 Sun … 6 Sat
  const mon = new Date(d);
  mon.setDate(d.getDate() - ((dow + 6) % 7) + offset * 7);
  const today = iso(d);
  return DAY_KEYS.map((key, i) => {
    const day = new Date(mon);
    day.setDate(mon.getDate() + i);
    const date = iso(day);
    return { key, name: DAY_NAMES[key], date, past: date < today, today: date === today, weekend: i >= 5 };
  });
}

export const weekendDays = (now = new Date(), offset = 0) => weekDays(now, offset).slice(5);

// The days a class happens on (older saves stored a single `day`).
export const classDays = (c) => (Array.isArray(c.days) && c.days.length ? c.days : c.day ? [c.day] : []);

// Classes and one-off plans that happen on this day.
// class: { id, title, kid, days: ['tue', 'thu'], start: 'HH:MM', end: 'HH:MM', where, repeat: 'weekly'|'once', date?, skip?: {date: true} }
export function bookedFor(classes, day) {
  return classes
    .filter((c) => (c.repeat === 'once' ? c.date === day.date : classDays(c).includes(day.key) && !c.skip?.[day.date]))
    .map((c) => ({ ...c, s: toMin(c.start), e: toMin(c.end) }))
    .filter((c) => c.e > c.s)
    .sort((a, b) => a.s - b.s);
}

// Free time between classes (with a buffer around each), split at lunch.
export function freeWindows(booked, dayKey) {
  const busy = booked.map((b) => [b.s - BUFFER, b.e + BUFFER]);
  busy.push(DAY.lunch);
  busy.sort((a, b) => a[0] - b[0]);
  const out = [];
  let cur = DAY.start;
  for (const [s, e] of busy) {
    if (s - cur >= MIN_WINDOW) out.push([cur, s]);
    cur = Math.max(cur, e);
  }
  if (DAY.end - cur >= MIN_WINDOW) out.push([cur, DAY.end]);
  return out
    .map(([s, e]) => [Math.max(s, DAY.start), Math.min(e, DAY.end)])
    .filter(([s, e]) => e - s >= MIN_WINDOW)
    .map(([s, e]) => ({ id: `${dayKey}@${fmtTime(s)}`, day: dayKey, start: fmtTime(s), end: fmtTime(e), mins: e - s, part: s < DAY.lunch[0] ? 'morning' : 'afternoon' }));
}

// What kind of activity suits a window, given the vibe and weather.
export function windowPlace(win, vibe, weather) {
  if (vibe === 'cosy') return win.part === 'morning' && weather !== 'wet' ? 'outside' : 'home';
  if (vibe === 'adventure') return win.part === 'morning' || win.mins >= 150 ? 'out' : 'outside';
  return win.part === 'morning' ? 'out' : 'home';
}

// One activity per free window, no repeats across the weekend.
// days: [{ key, weather, windows }]
export function fillWeekend(days, { ages = [], vibe = 'mix', recentIds = [], favIds = [], taste = null } = {}, seed = Date.now()) {
  const used = [];
  const picks = {};
  let n = 0;
  for (const day of days) {
    for (const win of day.windows) {
      const base = { ages, maxMins: win.mins, weather: day.weather, recentIds: [...recentIds, ...used], favIds, taste };
      const place = windowPlace(win, vibe, day.weather);
      let [a] = recommend({ ...base, place, energy: win.part === 'morning' ? 'active' : 'any' }, { count: 1, seed: seed + n++ }).filter((x) => !used.includes(x.id));
      if (!a) [a] = recommend({ ...base, place: 'any', energy: 'any' }, { count: 1, seed: seed + n++ }).filter((x) => !used.includes(x.id));
      if (!a) continue;
      used.push(a.id);
      picks[win.id] = { id: a.id };
    }
  }
  return picks;
}

// A replacement for one window that isn't already in the plan.
export function swapPick(day, win, { ages = [], vibe = 'mix', exclude = [], favIds = [], taste = null } = {}, seed = Date.now()) {
  const base = { ages, maxMins: win.mins, weather: day.weather, recentIds: exclude, favIds, taste };
  const pool = [...recommend({ ...base, place: windowPlace(win, vibe, day.weather) }, { count: 6, seed }), ...recommend({ ...base, place: 'any' }, { count: 6, seed: seed + 1 })];
  return pool.find((a) => !exclude.includes(a.id)) || null;
}

// A friendly label for a class, also the only part of a class we send to the AI.
const CLASS_KINDS = [
  [/\b(party|birthday)/i, '🎉', 'Party'], [/swim/i, '🏊', 'Swimming'], [/\b(foot ?ball|soccer)/i, '⚽', 'Football'], [/basketball/i, '🏀', 'Basketball'],
  [/tennis/i, '🎾', 'Tennis'], [/ballet|danc/i, '🩰', 'Dance'], [/\bgym|tumbl/i, '🤸', 'Gymnastics'], [/karate|judo|taekwondo|martial/i, '🥋', 'Martial arts'],
  [/piano|music|violin|guitar|\bsing|choir/i, '🎹', 'Music'], [/\b(art|arts|draw|drawing|paint|painting|pottery)\b/i, '🎨', 'Art'], [/\bchess/i, '♟️', 'Chess'],
  [/\b(coding|code|robotics?|stem|science)\b/i, '💻', 'STEM'], [/drama|theat(re|er)/i, '🎭', 'Drama'],
  [/church|temple|mosque|sunday school/i, '🕊️', 'Faith'], [/tutor|\bmaths?\b|reading|language|school|lesson/i, '📚', 'Lesson'],
];
export function classKind(title) {
  const k = CLASS_KINDS.find(([re]) => re.test(title));
  return k ? { emoji: k[1], kind: k[2] } : { emoji: '📌', kind: 'Booked' };
}

// Who an activity is mainly for: something the family does together (outings,
// connection, nature), or kids' own play (sensory, art, STEM, movement, life skills).
export function audienceOf(a) {
  return a.setting === 'out' || a.cat === 'together' || a.cat === 'nature' ? 'family' : 'kids';
}
