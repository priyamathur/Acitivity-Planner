// What this family seems to enjoy, learned on the phone from what they do in the
// app. Nothing here leaves the device. Pure functions, so it can be unit-tested.
//
// Signals (strongest first): a memory saved with 😍, an activity they did, a
// heart, keeping a planned activity; swapping one away counts against it.
// Each signal is spread over the activity's traits (category, indoors/outdoors,
// energy, mess, length, skills), so a saved "Kitchen volcano" also lifts other
// messy science at home, not just the volcano itself.

const LOVE = { '😍': 2, '😄': 1, '🙂': 0.5, '😅': -0.5, '😴': -1 };
const lengthBucket = (m) => (m <= 30 ? 'short' : m <= 90 ? 'medium' : 'long');
export const traitsOf = (a) => [
  `cat:${a.cat}`, `set:${a.setting}`, `energy:${a.energy}`, `mess:${a.mess}`, `len:${lengthBucket(a.mins)}`,
  ...(a.skills || []).slice(0, 4).map((s) => `skill:${String(s).toLowerCase()}`),
];

// Returns { weights: {trait: number}, signals: [{id, w, why}], strength } from saved app state.
export function learnTaste(state, byId) {
  const signals = [];
  const push = (id, w, why) => { if (byId[id]) signals.push({ id, w, why }); };
  for (const id of state.favs || []) push(id, 3, 'saved');
  for (const m of state.memories || []) if (m.activityId) push(m.activityId, 3 + (LOVE[m.mood] ?? 0), 'did');
  for (const w of Object.values(state.weekends || {})) {
    for (const p of Object.values(w.picks || {})) push(p.id, 0.5, 'planned');
    for (const ids of Object.values(w.swapped || {})) for (const id of ids || []) push(id, -1.5, 'swapped');
  }
  const sum = {};
  const n = {};
  for (const { id, w } of signals) {
    for (const t of traitsOf(byId[id])) { sum[t] = (sum[t] || 0) + w; n[t] = (n[t] || 0) + 1; }
  }
  // Smoothed average, so one heart doesn't swing everything.
  const weights = Object.fromEntries(Object.keys(sum).map((t) => [t, sum[t] / (n[t] + 2)]));
  const strength = signals.filter((s) => s.w > 0).length;
  return { weights, signals, strength };
}

// Extra points for an activity, capped so taste nudges rather than takes over.
export function tasteBoost(activity, taste) {
  if (!taste || !taste.strength) return 0;
  const raw = traitsOf(activity).reduce((s, t) => s + (taste.weights[t] || 0), 0);
  const scale = Math.min(1, taste.strength / 5); // grows as the family uses the app
  return Math.max(-4, Math.min(4, raw * scale));
}

// "Because you saved Kitchen volcano": the liked activity this one is most like.
export function because(activity, taste, byId) {
  if (!taste?.strength) return null;
  const mine = new Set(traitsOf(activity));
  let best = null;
  for (const s of taste.signals) {
    if (s.w <= 0 || s.why === 'planned' || s.id === activity.id) continue; // only things the family chose: saved or did
    const other = byId[s.id];
    const shared = traitsOf(other).filter((t) => mine.has(t)).length + (other.cat === activity.cat ? 2 : 0);
    if (shared >= 4 && (!best || shared > best.shared || (shared === best.shared && s.w > best.w))) best = { shared, w: s.w, a: other, why: s.why };
  }
  return best ? { title: best.a.title, why: best.why } : null;
}

// The family's favourite kinds of activity, for a short "your taste" line.
export function topCategories(taste, n = 2) {
  if (!taste?.strength) return [];
  return Object.entries(taste.weights).filter(([t, w]) => t.startsWith('cat:') && w > 0.3).sort((a, b) => b[1] - a[1]).slice(0, n).map(([t]) => t.slice(4));
}
