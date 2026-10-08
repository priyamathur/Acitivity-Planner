// Local-first storage. Nothing leaves the device: settings & plans in
// localStorage, memory photos in IndexedDB.
const KEY = 'littleroam:v1';

const DEFAULT = {
  onboarded: false,
  family: { name: '', kids: [] }, // kids: [{ name, birthYear }]
  location: null, // { lat, lon, label }
  classes: [], // kids' classes & one-off plans: { id, title, kid, day, start, end, where, repeat, date?, skip? }
  weekends: {}, // Saturday 'YYYY-MM-DD' -> { vibe, picks: { windowId: { id, why?, place? } }, done: { windowId: true }, message }
  lastVibe: 'mix',
  memories: [], // { id, date, title, activityId?, note, quote, mood, photoId? }
  favs: [],
  recent: [], // last activity ids suggested/done
  plusInterest: false,
  plusWaitlist: false,
  fam: null, // random device id, used only for anonymous counting and AI daily limits
  custom: {}, // AI-created activities, keyed by id
  shareNearby: false, // remembered choice for the anonymous share checkbox
  schools: [], // linked school calendars: { id, kid, name, source: 'feed'|'file'|'photo', url?, events: [{ date, end, title, kind, start?, finish? }], updated }
};

const listeners = new Set();

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const str = (v) => (typeof v === 'string' ? v : '');

// Saved data can be from an older version, edited by hand or half-written, so
// every field is checked against the shape the app expects before it's used.
export function sanitize(raw) {
  const d = structuredClone(DEFAULT);
  if (!isObj(raw)) return d;
  for (const k of Object.keys(raw)) {
    const def = DEFAULT[k];
    const v = raw[k];
    if (def === undefined) d[k] = v; // unknown keys (e.g. plusInterest) kept as-is
    else if (Array.isArray(def)) d[k] = Array.isArray(v) ? v : def;
    else if (isObj(def)) d[k] = isObj(v) ? v : def;
    else if (def === null) d[k] = v ?? null;
    else d[k] = typeof v === typeof def ? v : def;
  }
  const fam = isObj(raw.family) ? raw.family : {};
  d.family = {
    name: str(fam.name).slice(0, 60),
    kids: (Array.isArray(fam.kids) ? fam.kids : []).filter(isObj).map((k) => ({ name: str(k.name).slice(0, 30), birthYear: Number.isInteger(Number(k.birthYear)) ? Number(k.birthYear) : new Date().getFullYear() - 4 })).slice(0, 8),
  };
  d.location = isObj(raw.location) && Number.isFinite(raw.location.lat) && Number.isFinite(raw.location.lon) ? { lat: raw.location.lat, lon: raw.location.lon, label: str(raw.location.label) || 'Your location' } : null;
  const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
  d.classes = d.classes.filter((c) => isObj(c) && typeof c.id === 'string' && typeof c.title === 'string' && TIME.test(c.start) && TIME.test(c.end))
    .map((c) => ({ ...c, kid: c.kid == null ? '' : String(c.kid), where: str(c.where), repeat: c.repeat === 'once' ? 'once' : 'weekly', ...(Array.isArray(c.days) ? { days: c.days.filter((x) => typeof x === 'string') } : {}) }))
    .filter((c) => (c.days?.length || typeof c.day === 'string'));
  d.memories = d.memories.filter((m) => isObj(m) && typeof m.id === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(m.date)).map((m) => ({ ...m, title: str(m.title), note: str(m.note), quote: str(m.quote), mood: str(m.mood) }));
  d.favs = d.favs.filter((x) => typeof x === 'string');
  d.recent = d.recent.filter((x) => typeof x === 'string');
  d.schools = d.schools.filter((x) => isObj(x) && typeof x.name === 'string' && Array.isArray(x.events))
    .map((x) => ({ ...x, id: str(x.id) || uid(), kid: String(x.kid ?? ''), updated: Number(x.updated) || 0, events: x.events.filter((e) => isObj(e) && /^\d{4}-\d{2}-\d{2}$/.test(e.date) && typeof e.title === 'string').map((e) => ({ ...e, end: /^\d{4}-\d{2}-\d{2}$/.test(e.end) && e.end >= e.date ? e.end : e.date })) }));
  for (const [key, w] of Object.entries(d.weekends)) if (!isObj(w) || !isObj(w.picks)) delete d.weekends[key]; else w.done = isObj(w.done) ? w.done : {};
  if (!isObj(d.custom)) d.custom = {};
  return d;
}

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? sanitize(JSON.parse(raw)) : structuredClone(DEFAULT);
  } catch {
    return structuredClone(DEFAULT);
  }
}

// Defined after sanitize() and its helpers, which load() needs.
let saveFailed = false;
export const lastSaveFailed = () => saveFailed;
let state = load();

export function get() {
  return state;
}

export function set(mutator) {
  mutator(state);
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
    saveFailed = false;
  } catch (e) {
    console.warn('Could not save', e);
    saveFailed = true;
  }
  listeners.forEach((fn) => fn(state));
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function reset() {
  localStorage.removeItem(KEY);
  state = structuredClone(DEFAULT);
}

export function exportJSON() {
  return JSON.stringify(state, null, 2);
}

export function importJSON(text) {
  const parsed = JSON.parse(text);
  if (!isObj(parsed) || !Array.isArray(parsed.memories)) throw new Error('Not a LittleRoam backup file.');
  const clean = sanitize(parsed);
  set((s) => { for (const k of Object.keys(s)) delete s[k]; Object.assign(s, clean); });
}

// ---------- Photos (IndexedDB) ----------
let dbp;
function db() {
  dbp ??= new Promise((resolve, reject) => {
    const req = indexedDB.open('littleroam-photos', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('photos');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

async function tx(mode, fn) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const t = d.transaction('photos', mode);
    const r = fn(t.objectStore('photos'));
    t.oncomplete = () => resolve(r?.result);
    t.onerror = () => reject(t.error);
  });
}

export const putPhoto = (id, blob) => tx('readwrite', (s) => s.put(blob, id));
export const getPhoto = (id) => tx('readonly', (s) => s.get(id));
export const deletePhoto = (id) => tx('readwrite', (s) => s.delete(id));

// Downscale photos so a year of memories stays small on the phone.
export async function compressImage(file, maxSide = 1280, quality = 0.82) {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
  return new Promise((r) => canvas.toBlob(r, 'image/jpeg', quality));
}

export function uid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

export function isoDate(d = new Date()) {
  const z = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return z.toISOString().slice(0, 10);
}
