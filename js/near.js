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

const OVERPASS = 'https://overpass-api.de/api/interpreter';

export function buildQuery(type, lat, lon, radiusM) {
  const t = PLACE_TYPES[type];
  const parts = t.filters.map((f) => `nwr${f}(around:${radiusM},${lat},${lon});`).join('');
  return `[out:json][timeout:25];(${parts});out center tags 80;`;
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
      const name = tags.name || tags['name:en'] || `Unnamed ${PLACE_TYPES[type].label.toLowerCase().replace(/s$/, '')}`;
      return {
        id: `${e.type}/${e.id}`,
        name,
        named: Boolean(tags.name),
        type,
        lat, lon,
        km: haversineKm(origin, { lat, lon }),
        website: tags.website || tags['contact:website'] || null,
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

export async function findPlaces(type, origin, radiusKm = 5, { signal } = {}) {
  const body = 'data=' + encodeURIComponent(buildQuery(type, origin.lat, origin.lon, Math.round(radiusKm * 1000)));
  const res = await fetch(OVERPASS, { method: 'POST', body, headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, signal });
  if (!res.ok) throw new Error(`Place search failed (${res.status}). The free map server may be busy — try again in a minute.`);
  return parsePlaces(await res.json(), origin, type);
}

export async function geocode(q) {
  const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(q)}`, { headers: { Accept: 'application/json' } });
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
