// LittleRoam public MCP server (Streamable HTTP, stateless, no login).
// Lets AI assistants such as Claude, ChatGPT or Gemini search family and kids'
// activities, find family places and class venues near a location, check the
// weather and plan a day. It stores nothing and needs no personal data.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { z } from 'zod';
import { ACTIVITIES, CATEGORIES } from '../../js/data.js';
import { recommend, freeWindows, fillWeekend, toMin, audienceOf, weatherBucket, weatherLabel } from '../../js/planner.js';
import { PLACE_TYPES, CLASS_TYPES, findPlaces, directionsUrl } from '../../js/near.js';

const byId = Object.fromEntries(ACTIVITIES.map((a) => [a.id, a]));
const SITE = 'https://github.com/priyamathur/Acitivity-Planner';
const UA = `LittleRoam-MCP/1.0 (+${SITE})`;
const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true };

const summary = (a) => ({
  id: a.id, title: a.title, emoji: a.emoji, for: audienceOf(a), category: CATEGORIES[a.cat].label,
  ages: `${a.ages[0]}-${a.ages[1]}`, minutes: a.mins, setting: a.setting, energy: a.energy,
  mess: ['none', 'some', 'messy'][a.mess], good_in_rain: a.weather !== 'dry',
});
const ok = (data) => ({ content: [{ type: 'text', text: JSON.stringify(data, null, 1) }], structuredContent: data });
const err = (message) => ({ content: [{ type: 'text', text: message }], isError: true });

async function geocode(q, env) {
  const res = await fetch(`${env.NOMINATIM_URL || 'https://nominatim.openstreetmap.org'}/search?format=json&limit=1&q=${encodeURIComponent(q)}`, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
  if (!res.ok) throw new Error('Location lookup failed. Try again, or pass latitude and longitude.');
  const [hit] = await res.json();
  if (!hit) throw new Error(`Couldn't find "${q}". Try a city plus country, a postcode, or pass latitude and longitude.`);
  return { lat: Number(hit.lat), lon: Number(hit.lon), label: hit.display_name };
}

async function resolveLocation({ location, latitude, longitude }, env) {
  if (Number.isFinite(latitude) && Number.isFinite(longitude)) return { lat: latitude, lon: longitude, label: `${latitude.toFixed(3)}, ${longitude.toFixed(3)}` };
  if (location) return geocode(location, env);
  throw new Error('Give either "location" (e.g. "Seattle, WA") or both "latitude" and "longitude".');
}

async function dayWeather(loc, date, env) {
  const res = await fetch(`${env.OPENMETEO_URL || 'https://api.open-meteo.com'}/v1/forecast?latitude=${loc.lat}&longitude=${loc.lon}&daily=weather_code,temperature_2m_max,precipitation_probability_max&timezone=auto&start_date=${date}&end_date=${date}`);
  if (!res.ok) return null;
  const d = (await res.json()).daily;
  if (!d?.time?.length) return null;
  const code = d.weather_code[0];
  const rain = d.precipitation_probability_max?.[0] ?? 0;
  return { summary: weatherLabel(code), max_temp_c: d.temperature_2m_max[0], rain_chance_pct: rain, wet: ['wet', 'snow'].includes(weatherBucket(code)) || rain >= 60 };
}

const HHMM = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use 24h HH:MM, e.g. "09:30"');
const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const ages = z.array(z.number().int().min(0).max(17)).max(8).optional().describe("Children's ages in years, e.g. [4, 8]. Activities must suit all of them.");
const locationFields = {
  location: z.string().max(120).optional().describe('Place name, e.g. "Seattle, WA" or "SW1A 1AA". Not needed if latitude/longitude are given.'),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
};

export function buildServer(env = {}) {
  const server = new McpServer({ name: 'littleroam-mcp-server', version: '1.0.0' });

  server.registerTool('littleroam_search_activities', {
    title: 'Search family & kids activities',
    description: `Search LittleRoam's curated library of ${ACTIVITIES.length} screen-free activities for children aged 0–12. Use "for": "family" for things to do together (outings, nature, connection) or "kids" for children's own play (sensory, art, STEM, movement, life skills). Returns short summaries; call littleroam_get_activity for materials, steps and safety tips.`,
    inputSchema: {
      for: z.enum(['family', 'kids', 'any']).default('any').describe('Family activities together, kids activities, or both'),
      ages,
      max_minutes: z.number().int().min(10).max(600).optional().describe('Time available, in minutes'),
      setting: z.enum(['home', 'outside', 'out', 'any']).default('any').describe('home = indoors, outside = garden/street/park nearby, out = a trip somewhere'),
      rainy: z.boolean().optional().describe('true if it is raining, to prefer indoor or rain-friendly ideas'),
      energy: z.enum(['calm', 'active', 'any']).default('any'),
      category: z.enum(Object.keys(CATEGORIES)).optional().describe(`One of: ${Object.entries(CATEGORIES).map(([k, c]) => `${k} (${c.label})`).join(', ')}`),
      query: z.string().max(80).optional().describe('Keyword to match, e.g. "baking", "bugs", "slime"'),
      limit: z.number().int().min(1).max(20).default(8),
    },
    annotations: READ_ONLY,
  }, async (a) => {
    const q = (a.query || '').toLowerCase();
    let pool = ACTIVITIES.filter((x) => (a.for === 'any' || audienceOf(x) === a.for) && (!a.category || x.cat === a.category)
      && (!q || [x.title, x.tip, ...x.skills, ...x.materials, ...x.steps].join(' ').toLowerCase().includes(q)));
    const results = recommend({ ages: a.ages || [], maxMins: a.max_minutes || 600, place: a.setting, energy: a.energy, weather: a.rainy ? 'wet' : null }, { count: a.limit, seed: 7, pool });
    if (!results.length) return err('No activities match. Try fewer filters: remove "query" or "category", allow more minutes, or use setting "any".');
    return ok({ count: results.length, activities: results.map(summary) });
  });

  server.registerTool('littleroam_get_activity', {
    title: 'Get activity details',
    description: 'Full details for one activity from littleroam_search_activities: what you need, step-by-step instructions, what children learn and safety tips.',
    inputSchema: { id: z.string().describe('Activity id, e.g. "scavenger"') },
    annotations: READ_ONLY,
  }, async ({ id }) => {
    const a = byId[id];
    if (!a) return err(`Unknown activity id "${id}". Use littleroam_search_activities to find ids.`);
    return ok({ ...summary(a), materials: a.materials, steps: a.steps, skills: a.skills, tip: a.tip || null });
  });

  const placeTypes = { ...Object.fromEntries(Object.entries(PLACE_TYPES).map(([k, t]) => [k, t.label])), ...Object.fromEntries(Object.entries(CLASS_TYPES).map(([k, t]) => [k, `${t.label} classes (venues)`])) };
  server.registerTool('littleroam_find_places', {
    title: 'Find family places & class venues nearby',
    description: `Find places near a location from OpenStreetMap. Family places: ${Object.keys(PLACE_TYPES).join(', ')}. Venues for kids' classes: ${Object.keys(CLASS_TYPES).join(', ')}. Returns names, distance, website and a directions link. Map data has venues but not class timetables or event times, so check the venue's website for those.`,
    inputSchema: {
      type: z.enum(Object.keys(placeTypes)).describe(Object.entries(placeTypes).map(([k, l]) => `${k} = ${l}`).join('; ')),
      ...locationFields,
      radius_km: z.number().min(0.5).max(25).default(5),
      limit: z.number().int().min(1).max(20).default(10),
    },
    annotations: { ...READ_ONLY, openWorldHint: true },
  }, async (a) => {
    try {
      const loc = await resolveLocation(a, env);
      const places = (await findPlaces(a.type, loc, a.radius_km, { endpoint: env.OVERPASS_URL || undefined })).filter((p) => p.named).slice(0, a.limit);
      if (!places.length) return err(`No ${placeTypes[a.type].toLowerCase()} found within ${a.radius_km} km of ${loc.label}. Try a larger radius_km (up to 25).`);
      return ok({ near: loc.label, places: places.map((p) => ({ name: p.name, distance_km: Number(p.km.toFixed(1)), website: p.website, opening_hours: p.hours, free: p.fee === 'no' ? true : undefined, toilets: p.toilets === 'yes' ? true : undefined, wheelchair: p.wheelchair || undefined, directions: directionsUrl(p) })), source: 'OpenStreetMap contributors (ODbL)' });
    } catch (e) {
      return err(e.message);
    }
  });

  server.registerTool('littleroam_get_weather', {
    title: 'Weather for a day',
    description: 'Daily forecast (up to about 2 weeks ahead) for a location: summary, max temperature and chance of rain. "wet" is true when indoor plans are wiser.',
    inputSchema: { date: DATE, ...locationFields },
    annotations: { ...READ_ONLY, openWorldHint: true },
  }, async (a) => {
    try {
      const loc = await resolveLocation(a, env);
      const w = await dayWeather(loc, a.date, env);
      if (!w) return err('No forecast for that date. Forecasts cover today and roughly the next 14 days.');
      return ok({ near: loc.label, date: a.date, ...w, source: 'Open-Meteo' });
    } catch (e) {
      return err(e.message);
    }
  });

  server.registerTool('littleroam_plan_day', {
    title: 'Plan a family day around classes',
    description: 'Plan a screen-free day (09:00–18:00) for a family. It works around things already booked (classes, parties) with travel buffers and a lunch break, then fills each free slot with one activity that fits its length, the children\'s ages and the weather. If a location is given, the real forecast is used.',
    inputSchema: {
      date: DATE.describe('The day to plan, YYYY-MM-DD'),
      ages,
      booked: z.array(z.object({ title: z.string().max(60), start: HHMM, end: HHMM })).max(10).default([]).describe('Things already on, e.g. [{"title":"Swimming","start":"09:00","end":"10:00"}]'),
      vibe: z.enum(['adventure', 'mix', 'cosy']).default('mix').describe('adventure = more trips out, mix = one outing plus home time, cosy = mostly home and close by'),
      rainy: z.boolean().optional().describe('Set when you know the weather; otherwise pass a location to use the forecast'),
      ...locationFields,
    },
    annotations: { ...READ_ONLY, idempotentHint: false, openWorldHint: true },
  }, async (a) => {
    const booked = a.booked.map((b) => ({ ...b, s: toMin(b.start), e: toMin(b.end) })).filter((b) => b.e > b.s).sort((x, y) => x.s - y.s);
    let weather = null;
    if (a.rainy == null && (a.location || Number.isFinite(a.latitude))) {
      try { weather = await dayWeather(await resolveLocation(a, env), a.date, env); } catch { /* plan without it */ }
    }
    const wet = a.rainy ?? weather?.wet ?? null;
    const windows = freeWindows(booked, 'day');
    if (!windows.length) return err('No free time between 09:00 and 18:00 once the bookings, travel time and lunch are allowed for.');
    const picks = fillWeekend([{ key: 'day', weather: wet == null ? null : wet ? 'wet' : 'dry', windows }], { ages: a.ages || [], vibe: a.vibe }, Date.parse(a.date) || 1);
    const schedule = [
      ...booked.map((b) => ({ start: b.start, end: b.end, type: 'booked', title: b.title })),
      { start: '12:30', end: '13:30', type: 'lunch', title: 'Lunch & rest' },
      ...windows.map((w) => ({ start: w.start, end: w.end, type: 'activity', ...(picks[w.id] ? summary(byId[picks[w.id].id]) : { title: 'Free time' }) })),
    ].sort((x, y) => toMin(x.start) - toMin(y.start));
    return ok({ date: a.date, weather, schedule, note: 'Call littleroam_get_activity with an id for steps and materials.' });
  });

  return server;
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Accept, Mcp-Session-Id, Mcp-Protocol-Version, Last-Event-ID',
  'Access-Control-Expose-Headers': 'Mcp-Session-Id, Mcp-Protocol-Version',
};

// One fresh server + transport per request (stateless JSON mode).
export async function handleMcp(request, env = {}) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  const server = buildServer(env);
  await server.connect(transport);
  const res = await transport.handleRequest(request);
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(CORS)) headers.set(k, v);
  return new Response(res.body, { status: res.status, headers });
}
