// "Things to do near me" — free, key-less open data:
//   places:    OpenStreetMap via the Overpass API
//   geocoding: OpenStreetMap Nominatim (manual location search)
//   weather:   Open-Meteo
import { haversineKm } from './planner.js';

export const PLACE_TYPES = {
  playground: { label: 'Playgrounds', emoji: '🛝', filters: ['["leisure"="playground"]'], pair: 'playground-games' },
  park:       { label: 'Parks', emoji: '🌳', filters: ['["leisure"="park"]'], pair: 'scavenger' },
  nature:     { label: 'Nature & trails', emoji: '🥾', filters: ['["leisure"="nature_reserve"]', '["boundary"="protected_area"]'], pair: 'hike' },
  library:    { label: 'Libraries', emoji: '📚', filters: ['["amenity"="library"]'], pair: 'library-quest' },
  museum:     { label: 'Museums', emoji: '🏛️', filters: ['["tourism"="museum"]', '["amenity"="arts_centre"]'], pair: 'museum-mission' },
  animals:    { label: 'Zoos & aquariums', emoji: '🦒', filters: ['["tourism"="zoo"]', '["tourism"="aquarium"]'], pair: 'zoo-day' },
  water:      { label: 'Beaches & splash', emoji: '🏖️', filters: ['["natural"="beach"]', '["leisure"="water_park"]', '["playground"="splash_pad"]'], pair: 'picnic' },
  picnic:     { label: 'Picnic spots', emoji: '🧺', filters: ['["tourism"="picnic_site"]'], pair: 'picnic' },
  market:     { label: 'Farms & markets', emoji: '🍓', filters: ['["amenity"="marketplace"]', '["shop"="farm"]'], pair: 'local-farm' },
  treat:      { label: 'Ice cream', emoji: '🍦', filters: ['["amenity"="ice_cream"]', '["shop"="ice_cream"]'], pair: null },
};

// Where kids' classes happen. OpenStreetMap knows the venues, not their timetables,
// so the app links to each venue's website and the chat can look up class times.
export const CLASS_TYPES = {
  swimming:  { label: 'Swimming', emoji: '🏊', title: 'Swimming', filters: ['["leisure"="swimming_pool"]["name"]', '["leisure"="sports_centre"]["sport"~"swimming"]'] },
  dance:     { label: 'Dance', emoji: '🩰', title: 'Dance', filters: ['["leisure"="dance"]', '["amenity"="dancing_school"]'] },
  martial:   { label: 'Martial arts', emoji: '🥋', title: 'Martial arts', filters: ['["amenity"="dojo"]', '["sport"~"martial_arts|karate|judo|taekwondo|jiu-jitsu|aikido"]'] },
  music:     { label: 'Music', emoji: '🎹', title: 'Music lessons', filters: ['["amenity"="music_school"]'] },
  art:       { label: 'Art & craft', emoji: '🎨', title: 'Art class', filters: ['["amenity"="arts_centre"]', '["craft"="pottery"]["name"]'] },
  sports:    { label: 'Sports clubs', emoji: '⚽', title: 'Sports club', filters: ['["club"="sport"]', '["leisure"="sports_centre"]["name"]'] },
  community: { label: 'Community centres', emoji: '🏘️', title: 'Class', filters: ['["amenity"="community_centre"]', '["amenity"="library"]'] },
};

const typeDef = (type) => PLACE_TYPES[type] || CLASS_TYPES[type];

const OVERPASS = 'https://overpass-api.de/api/interpreter';

export function buildQuery(type, lat, lon, radiusM) {
  const t = typeDef(type);
  const parts = t.filters.map((f) => `nwr${f}(around:${radiusM},${lat},${lon});`).join('');
  return `[out:json][timeout:25];(${parts});out center tags 80;`;
}

// Map data is user-edited: only plain web links are ever shown (no javascript: etc.).
// fetch() with a message a parent can act on when the phone is offline or the server is unreachable.
async function net(url, opts) {
  try {
    return await fetch(url, opts);
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    throw new Error(navigator.onLine === false ? "You're offline. Places need an internet connection; your plans and ideas still work." : "Couldn't reach the map service. Check your connection and try again.");
  }
}

export function safeWebsite(raw) {
  if (typeof raw !== 'string') return null;
  const v = raw.trim().split(';')[0].trim();
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(v) ? v : `https://${v}`;
  try {
    const u = new URL(withScheme);
    return /^https?:$/.test(u.protocol) && u.hostname.includes('.') ? u.href : null;
  } catch { return null; }
}

export function parsePlaces(json, origin, type) {
  const seen = new Set();
  return (json.elements || [])
    .map((e) => {
      const lat = e.lat ?? e.center?.lat;
      const lon = e.lon ?? e.center?.lon;
      const tags = e.tags || {};
      if (lat == null || lon == null) return null;
      if (tags.access === 'private' || tags.access === 'no') return null;
      const name = tags.name || tags['name:en'] || `Unnamed ${typeDef(type).label.toLowerCase().replace(/s$/, '')}`;
      return {
        id: `${e.type}/${e.id}`,
        name,
        named: Boolean(tags.name),
        type,
        lat, lon,
        km: haversineKm(origin, { lat, lon }),
        website: safeWebsite(tags.website || tags['contact:website']),
        hours: tags.opening_hours || null,
        fee: tags.fee || null,
        wheelchair: tags.wheelchair || null,
        toilets: tags.toilets || null,
      };
    })
    .filter(Boolean)
    .filter((p) => (seen.has(p.name + p.km.toFixed(1)) ? false : seen.add(p.name + p.km.toFixed(1))))
    .sort((a, b) => Number(b.named) - Number(a.named) || a.km - b.km);
}

export async function findPlaces(type, origin, radiusKm = 5, { signal, endpoint = OVERPASS } = {}) {
  const body = 'data=' + encodeURIComponent(buildQuery(type, origin.lat, origin.lon, Math.round(radiusKm * 1000)));
  const res = await net(endpoint, { method: 'POST', body, headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, signal });
  if (!res.ok) throw new Error(`Place search failed (${res.status}). The free map server may be busy — try again in a minute.`);
  return parsePlaces(await res.json(), origin, type);
}

export async function geocode(q) {
  const res = await net(`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(q)}`, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error('Location search failed.');
  const [hit] = await res.json();
  if (!hit) throw new Error(`Couldn't find "${q}". Try a city or postcode.`);
  return { lat: Number(hit.lat), lon: Number(hit.lon), label: hit.display_name.split(',').slice(0, 2).join(',') };
}

export async function getWeather({ lat, lon }) {
  const res = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code&timezone=auto`);
  if (!res.ok) throw new Error('weather unavailable');
  const j = await res.json();
  return { temp: j.current?.temperature_2m, code: j.current?.weather_code, unit: j.current_units?.temperature_2m || '°C' };
}

// Daily forecast for the coming days: { 'YYYY-MM-DD': { code, max, rain } }.
export async function getForecast({ lat, lon }) {
  const res = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=weather_code,temperature_2m_max,precipitation_probability_max&timezone=auto&forecast_days=14`);
  if (!res.ok) throw new Error('forecast unavailable');
  const j = await res.json();
  const d = j.daily || {};
  const unit = j.daily_units?.temperature_2m_max || '°C';
  return Object.fromEntries((d.time || []).map((t, i) => [t, { code: d.weather_code?.[i], max: d.temperature_2m_max?.[i], rain: d.precipitation_probability_max?.[i], unit }]));
}

export function getPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('Location is not available on this device.'));
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lon: p.coords.longitude, label: 'Your location' }),
      () => reject(new Error('Location permission was denied. Type a city or postcode instead.')),
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 600000 },
    );
  });
}

export function directionsUrl(p) {
  return `https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lon}`;
}
export function osmUrl(p) {
  return `https://www.openstreetmap.org/${p.id}`;
}
