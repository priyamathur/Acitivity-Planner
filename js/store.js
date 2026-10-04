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
  fam: null, // random device id, used only for anonymous counting and AI daily limits
  custom: {}, // AI-created activities, keyed by id
  shareNearby: false, // remembered choice for the anonymous share checkbox
};

let state = load();
const listeners = new Set();

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...structuredClone(DEFAULT), ...JSON.parse(raw) } : structuredClone(DEFAULT);
  } catch {
    return structuredClone(DEFAULT);
  }
}

export function get() {
  return state;
}

export function set(mutator) {
  mutator(state);
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch (e) {
    console.warn('Could not save', e);
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
  if (typeof parsed !== 'object' || !Array.isArray(parsed.memories)) throw new Error('Not a LittleRoam backup file.');
  set((s) => Object.assign(s, structuredClone(DEFAULT), parsed));
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

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

export function isoDate(d = new Date()) {
  const z = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return z.toISOString().slice(0, 10);
}
