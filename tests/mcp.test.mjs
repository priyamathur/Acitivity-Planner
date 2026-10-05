// End-to-end test of the public MCP server: a real MCP client (official SDK)
// talks to the Worker (wrangler dev) over Streamable HTTP. Map, geocoding and
// weather services are replaced with local fixtures. Usage: node tests/mcp.test.mjs
import { spawn } from 'node:child_process';
import http from 'node:http';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { Client } from '../worker/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js';
import { StreamableHTTPClientTransport } from '../worker/node_modules/@modelcontextprotocol/sdk/dist/esm/client/streamableHttp.js';

const PORT = 8790;
const FIX = 9920;
const seen = [];
const fixtures = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    seen.push({ url: req.url, ua: req.headers['user-agent'], body: decodeURIComponent(body) });
    res.writeHead(200, { 'content-type': 'application/json' });
    if (req.url.startsWith('/search')) return res.end(JSON.stringify(req.url.includes('Nowhereville') ? [] : [{ lat: '47.6062', lon: '-122.3321', display_name: 'Seattle, King County, Washington, United States' }]));
    if (req.url.startsWith('/v1/forecast')) return res.end(JSON.stringify({ daily: { time: ['2026-10-10'], weather_code: [63], temperature_2m_max: [12.4], precipitation_probability_max: [85] } }));
    // Overpass
    const q = decodeURIComponent(body);
    const n = (id, name, extra = {}) => ({ type: 'node', id, lat: 47.607 + id / 1000, lon: -122.333, tags: { name, ...extra } });
    return res.end(JSON.stringify({ elements: q.includes('swimming_pool') ? [n(1, 'Queen Anne Pool', { website: 'https://example.org/pool' })] : [n(2, 'Pioneer Square Playground', { toilets: 'yes' }), n(3, 'Waterfront Playground')] }));
  });
}).listen(FIX);

writeFileSync('worker/.dev.vars', `OVERPASS_URL=http://127.0.0.1:${FIX}/api/interpreter\nNOMINATIM_URL=http://127.0.0.1:${FIX}\nOPENMETEO_URL=http://127.0.0.1:${FIX}\n`);
const dev = spawn('npx', ['wrangler', 'dev', '--port', String(PORT), '--ip', '127.0.0.1', '--persist-to', '/tmp/littleroam-mcp-' + Date.now()], {
  cwd: 'worker', env: { ...process.env, WRANGLER_SEND_METRICS: 'false' }, stdio: 'ignore', detached: true,
});
for (let i = 0; i < 60; i++) {
  try { if ((await fetch(`http://127.0.0.1:${PORT}/api/health`)).ok) break; } catch {}
  await new Promise((r) => setTimeout(r, 500));
}

const data = (r) => r.structuredContent;
try {
  const client = new Client({ name: 'littleroam-test-client', version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${PORT}/mcp`)));
  assert.equal(client.getServerVersion().name, 'littleroam-mcp-server');

  // Tools are listed with descriptions, schemas and read-only annotations.
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((t) => t.name).sort(), ['littleroam_find_places', 'littleroam_get_activity', 'littleroam_get_weather', 'littleroam_plan_day', 'littleroam_search_activities']);
  for (const t of tools) {
    assert.ok(t.description.length > 40, `${t.name} needs a useful description`);
    assert.equal(t.inputSchema.type, 'object');
    assert.equal(t.annotations.readOnlyHint, true, `${t.name} is read-only`);
  }

  // Search: family vs kids, ages, time, rain
  let r = await client.callTool({ name: 'littleroam_search_activities', arguments: { for: 'kids', ages: [3], max_minutes: 30, rainy: true } });
  let d = data(r);
  assert.ok(d.count > 0);
  for (const a of d.activities) {
    assert.equal(a.for, 'kids');
    assert.ok(a.minutes <= 30);
    assert.ok(a.good_in_rain, `${a.id} should be fine in the rain`);
  }
  r = await client.callTool({ name: 'littleroam_search_activities', arguments: { for: 'family', setting: 'out', limit: 5 } });
  d = data(r);
  assert.ok(d.activities.every((a) => a.for === 'family' && a.setting === 'out') && d.activities.length === 5);
  r = await client.callTool({ name: 'littleroam_search_activities', arguments: { query: 'volcano' } });
  assert.equal(data(r).activities[0].id, 'volcano');
  r = await client.callTool({ name: 'littleroam_search_activities', arguments: { query: 'zzzz-nothing' } });
  assert.equal(r.isError, true, 'no results → helpful error');
  assert.match(r.content[0].text, /fewer filters/);

  // Invalid input is rejected by the schema
  r = await client.callTool({ name: 'littleroam_search_activities', arguments: { ages: [99] } });
  assert.equal(r.isError, true, 'age 99 rejected');

  // Details
  r = await client.callTool({ name: 'littleroam_get_activity', arguments: { id: 'scavenger' } });
  d = data(r);
  assert.equal(d.title, 'Nature scavenger hunt');
  assert.ok(d.steps.length >= 2 && d.materials.length >= 1);
  r = await client.callTool({ name: 'littleroam_get_activity', arguments: { id: 'nope' } });
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /littleroam_search_activities/);

  // Places by name (geocoded) and class venues by coordinates
  r = await client.callTool({ name: 'littleroam_find_places', arguments: { type: 'playground', location: 'Seattle, WA' } });
  d = data(r);
  assert.match(d.near, /Seattle/);
  assert.equal(d.places[0].name, 'Pioneer Square Playground');
  assert.equal(d.places[0].toilets, true);
  assert.match(d.places[0].directions, /google\.com\/maps/);
  const geo = seen.find((x) => x.url.startsWith('/search'));
  assert.match(geo.ua, /LittleRoam-MCP/, 'Nominatim requires an identifying User-Agent');
  r = await client.callTool({ name: 'littleroam_find_places', arguments: { type: 'swimming', latitude: 47.6, longitude: -122.3 } });
  d = data(r);
  assert.equal(d.places[0].website, 'https://example.org/pool');
  assert.ok(seen.at(-1).body.includes('"leisure"="swimming_pool"'), 'class venue query sent to Overpass');
  r = await client.callTool({ name: 'littleroam_find_places', arguments: { type: 'park' } });
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /location/);
  r = await client.callTool({ name: 'littleroam_find_places', arguments: { type: 'park', location: 'Nowhereville' } });
  assert.match(r.content[0].text, /Couldn't find/);

  // Weather
  r = await client.callTool({ name: 'littleroam_get_weather', arguments: { date: '2026-10-10', location: 'Seattle' } });
  d = data(r);
  assert.equal(d.wet, true);
  assert.equal(d.rain_chance_pct, 85);

  // Plan a day around swimming and a party, using the (rainy) forecast
  r = await client.callTool({ name: 'littleroam_plan_day', arguments: {
    date: '2026-10-10', ages: [5, 8], vibe: 'adventure', location: 'Seattle',
    booked: [{ title: 'Swimming', start: '09:00', end: '10:00' }, { title: "Sam's party", start: '14:00', end: '16:00' }],
  } });
  d = data(r);
  assert.equal(d.weather.wet, true);
  assert.deepEqual(d.schedule.map((s) => [s.start, s.type]), [['09:00', 'booked'], ['10:15', 'activity'], ['12:30', 'lunch'], ['14:00', 'booked'], ['16:15', 'activity']]);
  const acts = d.schedule.filter((s) => s.type === 'activity');
  assert.equal(new Set(acts.map((a) => a.id)).size, 2, 'no repeats');
  for (const a of acts) assert.ok(a.good_in_rain, `${a.id} suits a rainy day`);
  assert.ok(acts[0].minutes <= 135 && acts[1].minutes <= 105, 'activities fit their slots');
  r = await client.callTool({ name: 'littleroam_plan_day', arguments: { date: '2026-10-10', booked: [{ title: 'All day trip', start: '08:00', end: '19:00' }] } });
  assert.equal(r.isError, true);
  r = await client.callTool({ name: 'littleroam_plan_day', arguments: { date: '10/10/2026' } });
  assert.equal(r.isError, true, 'bad date format rejected');

  await client.close();

  // Browser-based MCP clients need CORS.
  const pre = await fetch(`http://127.0.0.1:${PORT}/mcp`, { method: 'OPTIONS' });
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get('access-control-allow-origin'), '*');
  console.log('MCP TESTS PASSED');
} catch (e) {
  console.error('MCP TESTS FAILED:', e.message);
  process.exitCode = 1;
} finally {
  try { process.kill(-dev.pid, 'SIGTERM'); } catch {}
  fixtures.close();
  process.exit();
}
