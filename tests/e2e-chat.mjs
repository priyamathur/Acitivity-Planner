// Browser test of the chat: real Worker (wrangler dev) + scripted mock Claude API.
// Covers web-search lookups with a paused turn, tool calls that edit the app,
// tool errors, daily limits and recovering afterwards. Usage: node tests/e2e-chat.mjs
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { startMockAnthropic } from './mock-anthropic.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const PORT = 8789;
const BASE = `http://127.0.0.1:${PORT}/`;
const SHOTS = process.env.SHOTS || 'tests/screenshots';
mkdirSync(SHOTS, { recursive: true });

const mock = await startMockAnthropic(9913);
writeFileSync('worker/.dev.vars', 'ANTHROPIC_API_KEY=test-key\nANTHROPIC_BASE_URL=http://127.0.0.1:9913\n');
const dev = spawn('npx', ['wrangler', 'dev', '--port', String(PORT), '--ip', '127.0.0.1', '--var', 'CHAT_DAILY_LIMIT:8', '--persist-to', '/tmp/littleroam-chat-' + Date.now()], {
  cwd: 'worker', env: { ...process.env, WRANGLER_SEND_METRICS: 'false' }, stdio: 'ignore', detached: true,
});
for (let i = 0; i < 60; i++) {
  try { if ((await fetch(BASE + 'api/health')).ok) break; } catch {}
  await new Promise((r) => setTimeout(r, 500));
}

const fail = (m) => { throw new Error(m); };
const browser = await chromium.launch();
const ctx = await browser.newContext({ locale: 'en-GB', viewport: { width: 390, height: 844 } });
await ctx.clock.setFixedTime(new Date('2026-10-07T10:00:00'));
const page = await ctx.newPage();
// Web fonts are optional; keep tests offline.
await ctx.route('https://fonts.googleapis.com/**', (r) => r.fulfill({ contentType: 'text/css', body: '' }));
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.route('https://overpass-api.de/**', (r) => r.fulfill({ json: { elements: [{ type: 'node', id: 7, lat: 47.61, lon: -122.33, tags: { name: 'Queen Anne Pool', website: 'https://example.org/pool' } }] } }));
await page.route('https://api.open-meteo.com/**', (r) => r.fulfill({ json: { daily: { time: ['2026-10-10', '2026-10-11', '2026-10-17', '2026-10-18'], weather_code: [1, 1, 2, 63], temperature_2m_max: [17, 16, 15, 12], precipitation_probability_max: [5, 10, 20, 80] }, daily_units: { temperature_2m_max: '°C' } } }));
await page.addInitScript(() => {
  if (localStorage.getItem('littleroam:v1')) return;
  localStorage.setItem('littleroam:v1', JSON.stringify({
    onboarded: true, family: { name: 'Mathur', kids: [{ name: 'Mia', birthYear: 2021 }, { name: 'Leo', birthYear: 2018 }] },
    location: { lat: 47.6062, lon: -122.3321, label: 'Your location' },
    classes: [
      { id: 'swim1', title: 'Swimming', kid: '0', days: ['sat'], start: '09:00', end: '10:00', where: '', repeat: 'weekly' },
      { id: 'foot1', title: 'Football', kid: '1', days: ['tue', 'thu'], start: '16:00', end: '17:00', where: '', repeat: 'weekly' },
    ],
  }));
});

// Send a message and wait until the whole reply (including tool steps) is done.
const send = async (msg) => {
  const n = await page.locator('.chat-log .bubble.bot').count();
  await page.fill('#chat-input', msg);
  await page.getByRole('button', { name: 'Send' }).click();
  await page.waitForFunction((k) => document.querySelectorAll('.chat-log .bubble.bot:not(:has(.typing))').length > k && !document.querySelector('#chat-input')?.disabled, n);
};
const lastBot = () => page.locator('.chat-log .bubble.bot').last().innerText();

try {
  await page.goto(BASE + '#chat');
  await page.getByRole('heading', { name: 'Ask LittleRoam' }).waitFor();
  await page.getByText("There's a pumpkin festival nearby this Saturday, let's go").waitFor();
  await page.getByText(/kids' nicknames, ages, classes/).waitFor();

  // 1. An event looked up on the web (paused turn → resume → tool call → confirmation)
  await page.getByText("There's a pumpkin festival nearby this Saturday, let's go").click();
  if ((await page.inputValue('#chat-input')) !== "There's a pumpkin festival nearby this Saturday, let's go") fail('suggestion did not fill the input');
  await send(await page.inputValue('#chat-input'));
  await page.getByText('🔎 Searched: pumpkin festival Saturday near me').waitFor();
  await page.getByText(/Found it: the Valley Pumpkin Festival/).waitFor();
  await page.getByRole('link', { name: 'Valley Pumpkin Festival' }).waitFor();
  await page.getByText(/✓ Added 📌 Pumpkin festival · Sat,? 10 Oct 11:00–14:00/).waitFor();
  if (!(await lastBot()).includes('double-check opening times')) fail('no confirmation');
  await page.screenshot({ path: `${SHOTS}/20-chat-event.png`, fullPage: true });
  // The paused turn was resumed by sending the assistant turn back unchanged.
  const resume = mock.requests.find((r) => r.body.tools && r.body.messages.at(-1).role === 'assistant');
  if (!resume || resume.body.messages.at(-1).content[0].type !== 'server_tool_use') fail('pause_turn not resumed correctly');
  const first = mock.requests.find((r) => r.body.tools);
  const tools = first.body.tools.map((t) => t.name);
  for (const t of ['add_to_calendar', 'update_calendar_item', 'remove_calendar_item', 'skip_class_once', 'plan_weekend', 'set_slot', 'clear_slot', 'find_places', 'web_search']) if (!tools.includes(t)) fail(`tool ${t} missing`);
  if (!first.body.tools.filter((t) => t.input_schema).every((t) => t.strict)) fail('client tools should be strict');
  const sentState = JSON.stringify(first.body.messages[0]);
  if (!sentState.includes('Today: Wednesday 2026-10-07') || !sentState.includes('id foot1: Football')) fail('app state missing');
  if (sentState.includes('47.60')) fail('coordinates leaked');

  await page.evaluate(() => (location.hash = 'weekend'));
  await page.locator('.day').first().waitFor();
  const sat = await page.locator('.day').nth(0).innerText();
  if (!sat.includes('Pumpkin festival') || !sat.includes('11:00')) fail('event not on the weekend timeline');
  await page.evaluate(() => (location.hash = 'chat'));
  await page.locator('.chat-log .bubble.me').first().waitFor();
  if ((await page.locator('.chat-log .bubble.me').count()) !== 1) fail('chat history lost when switching tabs');

  // 2. Move a weekday class
  await send("Leo's football on Thursday moved to 5–6pm");
  await page.getByText(/✓ Updated ⚽ Football · every Tue & Thu 17:00–18:00 · Leo/).waitFor();

  // 3. Plan next weekend, then fine-tune a slot
  await send('It\'s going to rain on Sunday. Make it cosy and plan next weekend');
  await page.getByText(/✓ Planned next weekend \(Cosy\)/).waitFor();
  await page.getByText(/✓ 🏕️ Blanket fort story night at Sun/).waitFor();
  await page.evaluate(() => (location.hash = 'weekend'));
  await page.getByRole('tab', { name: 'Next' }).click();
  await page.locator('.day').nth(1).getByText('Blanket fort story night').waitFor();
  const titles = await page.locator('.tl-act .tl-body').allInnerTexts();
  if (new Set(titles.map((t) => t.split('\n')[0])).size !== titles.length) fail('an activity appears twice in one weekend');
  if ((await page.locator('.tl-act').count()) < 3) fail('next weekend not planned');
  await page.evaluate(() => (location.hash = 'chat'));
  await page.locator('#chat-input').waitFor();

  // 4. Bad tool inputs are rejected and nothing changes
  const before = await page.evaluate(() => JSON.stringify(window.__littleroam.store.get().classes));
  await send('Book the zoo all day');
  await page.getByText("Sorry, 2 of those didn't work. Which day would you like the zoo?").waitFor();
  const errs = mock.requests.at(-1).body.messages.at(-1).content;
  if (!(errs.length === 2 && errs.every((r) => r.is_error))) fail('tool errors not reported back');
  if (!JSON.parse(errs[0].content).error.includes('No free slot sat@99:99')) fail('slot error message');
  if (!/past|Times must be|No child/.test(JSON.parse(errs[1].content).error)) fail('calendar error message');
  if ((await page.evaluate(() => JSON.stringify(window.__littleroam.store.get().classes))) !== before) fail('a failed tool changed the app');

  // 5. Skip a class for one week
  await send('skip swimming next week');
  await page.getByText(/✓ Skipping Swimming on Sat,? 17 Oct/).waitFor();
  await page.screenshot({ path: `${SHOTS}/21-chat-thread.png`, fullPage: true });

  // 6. Find a class: the chat uses the class-venue finder
  await send('Find a Saturday morning swimming class for Mia near us');
  await page.getByText(/The nearest pool is Queen Anne Pool \(0\.\d km\)\. Want me to look up their Saturday lessons\?/).waitFor();
  const fp = mock.requests.at(-1).body.messages.at(-1).content[0];
  if (!JSON.parse(fp.content).places[0].website) fail('venue website not passed to Claude');

  // 7. Venue → "Ask chat for times" pre-fills the chat
  await page.evaluate(() => (location.hash = 'weekend'));
  await page.locator('#add-class-top').click();
  await page.locator('#find-from-form').click();
  await page.locator('[data-ask-venue]').first().click();
  await page.locator('#chat-input').waitFor();
  if (!(await page.inputValue('#chat-input')).startsWith('Find swimming classes for the kids at Queen Anne Pool (https://example.org/pool)')) fail('chat not pre-filled from venue');
  await page.fill('#chat-input', '');

  // 8. The Ask bar on Home starts a chat message
  await page.evaluate(() => (location.hash = 'home'));
  await page.fill('#ask-q', 'What can we do this afternoon?');
  await page.getByRole('button', { name: 'Ask', exact: true }).click();
  await page.getByRole('heading', { name: 'Ask LittleRoam' }).waitFor();
  await page.locator('.chat-log .bubble.me', { hasText: 'What can we do this afternoon?' }).waitFor();
  await page.waitForFunction(() => !document.querySelector('#chat-input')?.disabled);

  // 9. Daily limit (8): message 8 works, message 9 is refused politely, and the chat recovers
  await send('hello');
  await send('hello again');
  await page.getByText(/sent today's 8 chat messages/).waitFor();
  // Only new messages count (6 scenarios + ask bar + 1 hello = 8); the many tool steps were free.

  // 10. New chat clears the thread but keeps the plan
  await page.getByRole('button', { name: 'New chat' }).click();
  if (await page.locator('.chat-log .bubble').count()) fail('new chat did not clear');
  await page.evaluate(() => (location.hash = 'weekend'));
  await page.getByRole('tab', { name: 'This' }).click();
  await page.locator('.day').nth(0).getByText('Pumpkin festival').waitFor();

  if (errors.length) fail('page errors:\n' + errors.join('\n'));
  console.log('CHAT E2E PASSED');
} catch (e) {
  await page.screenshot({ path: `${SHOTS}/chat-failure.png`, fullPage: true }).catch(() => {});
  console.error('CHAT E2E FAILED:', e.message);
  process.exitCode = 1;
} finally {
  await browser.close();
  try { process.kill(-dev.pid, 'SIGTERM'); } catch {}
  mock.close();
  process.exit();
}
