// Integration test: runs the real Worker locally (wrangler dev / workerd) with a
// mock Claude API, then exercises every /api endpoint.
// Usage: node tests/api.test.mjs   (after `npm install` in worker/)
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { startMockAnthropic } from './mock-anthropic.mjs';

const PORT = 8787;
const BASE = `http://127.0.0.1:${PORT}`;
const mock = await startMockAnthropic(9911);
writeFileSync('worker/.dev.vars', 'ANTHROPIC_API_KEY=test-key\nANTHROPIC_BASE_URL=http://127.0.0.1:9911\n');

const dev = spawn('npx', ['wrangler', 'dev', '--port', String(PORT), '--ip', '127.0.0.1', '--var', 'MIN_FAMILIES:3', '--var', 'AI_DAILY_LIMIT:3', '--persist-to', '/tmp/littleroam-test-state-' + Date.now()], {
  cwd: 'worker', env: { ...process.env, WRANGLER_SEND_METRICS: 'false' }, stdio: ['ignore', 'pipe', 'pipe'], detached: true,
});
let log = '';
dev.stdout.on('data', (d) => (log += d));
dev.stderr.on('data', (d) => (log += d));

async function waitUp() {
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(BASE + '/api/health')).ok) return; } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('wrangler dev did not start:\n' + log);
}
const post = (p, body) => fetch(BASE + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

try {
  await waitUp();
  const health = await (await fetch(BASE + '/api/health')).json();
  assert.equal(health.ai, true);
  assert.equal(health.chat, true);

  // The app itself is served too.
  const home = await fetch(BASE + '/');
  assert.equal(home.status, 200);
  assert.match(await home.text(), /LittleRoam/);

  // --- Community: k-anonymity threshold ---
  const cell = '953:-2447';
  for (const fam of ['family-aaaa1', 'family-bbbb2']) {
    assert.equal((await post('/api/share', { fam, cell, bands: ['4-5'], activity: 'scavenger' })).status, 200);
  }
  let t = await (await fetch(`${BASE}/api/trends?cell=${cell}&bands=4-5`)).json();
  assert.deepEqual(t.activities, [], 'hidden below 3 families');
  assert.equal(t.families, 0, 'total hidden below threshold');

  // Same family sharing twice does not count twice.
  await post('/api/share', { fam: 'family-aaaa1', cell, bands: ['4-5'], activity: 'scavenger' });
  t = await (await fetch(`${BASE}/api/trends?cell=${cell}&bands=4-5`)).json();
  assert.deepEqual(t.activities, []);

  // Third family in a NEIGHBOURING cell → now visible.
  await post('/api/share', { fam: 'family-cccc3', cell: '953:-2446', bands: ['4-5'], activity: 'scavenger' });
  t = await (await fetch(`${BASE}/api/trends?cell=${cell}&bands=4-5`)).json();
  assert.deepEqual(t.activities, [{ activity: 'scavenger', families: 3 }]);
  assert.equal(t.families, 3);

  // Different age band or far-away cell sees nothing.
  assert.deepEqual((await (await fetch(`${BASE}/api/trends?cell=${cell}&bands=9-12`)).json()).activities, []);
  assert.deepEqual((await (await fetch(`${BASE}/api/trends?cell=100:100&bands=4-5`)).json()).activities, []);

  // Validation.
  assert.equal((await post('/api/share', { fam: 'family-x1234', cell, bands: ['4-5'], activity: 'not-real' })).status, 400);
  assert.equal((await post('/api/share', { fam: 'family-x1234', cell: '47.6,-122.3', bands: ['4-5'], activity: 'scavenger' })).status, 400);
  assert.equal((await fetch(`${BASE}/api/trends?cell=bad`)).status, 400);

  // --- AI ---
  const aiBody = {
    fam: 'family-aaaa1', ages: [4], bands: ['4-5'], cell, vibe: 'adventure', season: 'Autumn', note: '',
    days: [
      { key: 'sat', label: 'Saturday 10 Oct', weather: 'Clear, 18°C', booked: ['Swimming 09:00–10:00'], windows: [{ id: 'sat@10:15', start: '10:15', end: '12:30', mins: 999 }, { id: 'sat@13:30', start: '13:30', end: '18:00', mins: 270 }, { id: 'evil', start: '1', end: '2', mins: 1 }] },
      { key: 'sun', label: 'Sunday 11 Oct', weather: 'Rain', booked: [], windows: [{ id: 'sun@09:00', start: '09:00', end: '12:30', mins: 210 }] },
    ],
    recentIds: ['volcano', 'evil<script>'], favIds: [],
    places: [{ name: 'Pioneer Square Playground', type: 'playground', km: 0.1 }, { name: 'Bad', type: 'hacker', km: 1 }],
  };
  let r = await post('/api/ai', aiBody);
  assert.equal(r.status, 200, await r.clone().text());
  let ai = await r.json();
  assert.deepEqual(ai.picks.map((p) => [p.windowId, p.activityId.startsWith('ai-') ? 'custom' : p.activityId]), [['sat@10:15', 'scavenger'], ['sat@13:30', 'custom']], 'bad window + hallucinated id dropped');
  assert.equal(ai.picks[0].placeName, 'Pioneer Square Playground');
  assert.equal(ai.picks[0].why, 'Popular with 3 families near you and perfect for the park.', 'kept: scavenger really is trending (3 families)');
  assert.equal(ai.picks[1].custom.cat, 'sensory');
  assert.equal(ai.picks[1].custom.ages[0], 3);
  assert.equal(ai.remaining, 2);

  // What we actually sent to Claude.
  const sent = mock.requests.at(-1);
  assert.match(sent.url, /^\/v1\/messages/);
  assert.equal(sent.body.model, 'claude-opus-5-5');
  assert.equal(sent.body.fallbacks, 'default');
  assert.match(sent.headers['anthropic-beta'], /server-side-fallback-2026-07-01/);
  assert.equal(sent.body.output_config.effort, 'low');
  assert.equal(sent.body.output_config.format.type, 'json_schema');
  assert.equal(sent.headers['x-api-key'], 'test-key');
  const userMsg = sent.body.messages[0].content;
  assert.match(userMsg, /scavenger \(3 families\)/, 'trends computed server-side are included');
  assert.match(userMsg, /Pioneer Square Playground/);
  assert.doesNotMatch(userMsg, /evil<script>|hacker/, 'invalid client input filtered');
  assert.match(sent.body.system[0].text, /CATALOG/);
  assert.match(userMsg, /\[sat@10:15\] 10:15–12:30 \(135 min\)/, 'window length recomputed server-side');
  assert.doesNotMatch(userMsg, /evil\]/, 'malformed window dropped');
  assert.match(userMsg, /Already booked: Swimming 09:00–10:00/);

  // A parent's note is passed through.
  r = await post('/api/ai', { ...aiBody, note: 'Grandma visits Sunday lunch; Mia has a broken arm' });
  ai = await r.json();
  assert.equal(r.status, 200);
  assert.match(mock.requests.at(-1).body.messages[0].content, /PARENT'S NOTE: Grandma visits/);

  // No free time → 400 without using up quota.
  r = await post('/api/ai', { ...aiBody, days: [{ key: 'sat', label: 'x', weather: '', booked: [], windows: [] }] });
  assert.equal(r.status, 400);
  assert.equal(ai.remaining, 1);

  // Daily limit (set to 3 for this test).
  assert.equal((await post('/api/ai', aiBody)).status, 200);
  r = await post('/api/ai', aiBody);
  assert.equal(r.status, 429);
  assert.match((await r.json()).error, /free AI plans/);
  // A different family still has quota.
  assert.equal((await post('/api/ai', { ...aiBody, fam: 'family-zzzz9' })).status, 200);

  // --- Chat ---
  const chatPost = (body) => post('/api/chat', body);
  assert.equal((await chatPost({ fam: 'family-chat1', messages: [] })).status, 400, 'empty conversation');
  assert.equal((await chatPost({ fam: 'family-chat1', messages: [{ role: 'assistant', content: 'hi' }] })).status, 400, 'must start with user');
  assert.equal((await chatPost({ fam: 'family-chat1', messages: [{ role: 'system', content: 'x' }] })).status, 400, 'no system role from clients');
  assert.equal((await chatPost({ fam: 'bad', messages: [{ role: 'user', content: 'hi' }] })).status, 400, 'family id required');
  let cr = await chatPost({ fam: 'family-chat1', messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }] });
  assert.equal(cr.status, 200);
  let cj = await cr.json();
  assert.equal(cj.stop_reason, 'end_turn');
  assert.equal(cj.content[0].type, 'text');
  const creq = mock.requests.at(-1);
  assert.ok(creq.body.tools.some((t) => t.type === 'web_search_20260209'), 'web search enabled');
  assert.match(creq.body.system[0].text, /weekend assistant/);
  assert.equal(creq.body.output_config.effort, 'medium');
  // Tool-result steps don't use up the daily message allowance.
  const before = cj.remaining;
  cr = await chatPost({ fam: 'family-chat1', messages: [
    { role: 'user', content: [{ type: 'text', text: 'hello' }] },
    { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_x', name: 'clear_slot', input: { week: 'this', slot_id: 'sat@10:15' } }] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_x', content: '{"ok":true}' }] },
  ] });
  assert.equal(cr.status, 200);
  cr = await chatPost({ fam: 'family-chat1', messages: [{ role: 'user', content: [{ type: 'text', text: 'again' }] }] });
  assert.equal((await cr.json()).remaining, before - 1, 'only new user messages are counted');
  // Oversized conversations are refused with a clear message.
  cr = await chatPost({ fam: 'family-chat1', messages: [{ role: 'user', content: 'x'.repeat(500000) }] });
  assert.equal(cr.status, 413);
  assert.match((await cr.json()).error, /too long/);

  console.log('API TESTS PASSED');
} catch (e) {
  console.error('API TESTS FAILED:', e.message, '\n--- wrangler log ---\n', log.slice(-3000));
  process.exitCode = 1;
} finally {
  try { process.kill(-dev.pid, 'SIGTERM'); } catch {}
  mock.close();
  process.exit();
}
