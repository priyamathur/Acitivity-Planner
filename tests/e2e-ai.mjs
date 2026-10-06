// Browser test of the AI planner + "Popular near you", against the real Worker
// (wrangler dev) and a mock Claude API. Usage: node tests/e2e-ai.mjs
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { startMockAnthropic } from './mock-anthropic.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const PORT = 8788;
const BASE = `http://127.0.0.1:${PORT}/`;
const SHOTS = process.env.SHOTS || 'tests/screenshots';
mkdirSync(SHOTS, { recursive: true });

const mock = await startMockAnthropic(9912);
writeFileSync('worker/.dev.vars', 'ANTHROPIC_API_KEY=test-key\nANTHROPIC_BASE_URL=http://127.0.0.1:9912\n');
const dev = spawn('npx', ['wrangler', 'dev', '--port', String(PORT), '--ip', '127.0.0.1', '--var', 'MIN_FAMILIES:2', '--persist-to', '/tmp/littleroam-e2e-' + Date.now()], {
  cwd: 'worker', env: { ...process.env, WRANGLER_SEND_METRICS: 'false' }, stdio: 'ignore', detached: true,
});
for (let i = 0; i < 60; i++) {
  try { if ((await fetch(BASE + 'api/health')).ok) break; } catch {}
  await new Promise((r) => setTimeout(r, 500));
}

const fail = (m) => { throw new Error(m); };
const browser = await chromium.launch();
const ctx = await browser.newContext({ locale: 'en-GB', viewport: { width: 390, height: 844 }, geolocation: { latitude: 47.6062, longitude: -122.3321 }, permissions: ['geolocation'] });
await ctx.clock.setFixedTime(new Date('2026-10-07T10:00:00'));
const page = await ctx.newPage();
// Web fonts are optional; keep tests offline.
await ctx.route('https://fonts.googleapis.com/**', (r) => r.fulfill({ contentType: 'text/css', body: '' }));
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
// The app must work under its Content-Security-Policy.
page.on('console', (m) => /Content Security Policy|Refused to/.test(m.text()) && errors.push('CSP: ' + m.text()));
await page.route('https://overpass-api.de/**', (r) => r.fulfill({ json: { elements: [
  { type: 'node', id: 11, lat: 47.607, lon: -122.333, tags: { name: 'Pioneer Square Playground' } },
] } }));
await page.route('https://api.open-meteo.com/**', (r) => r.fulfill({ json: { daily: { time: ['2026-10-10', '2026-10-11'], weather_code: [0, 61], temperature_2m_max: [18, 14], precipitation_probability_max: [5, 70] }, daily_units: { temperature_2m_max: '°C' } } }));

// Another family nearby (same age band) already shared the scavenger hunt.
await fetch(BASE + 'api/share', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ fam: 'neighbour-family-1', cell: '952:-2447', bands: ['4-5'], activity: 'scavenger' }) });

try {
  await page.goto(BASE);
  await page.getByRole('button', { name: "Add my kids' ages" }).click();
  await page.fill('input[name=kname]', 'Mia');
  await page.selectOption('select[name=kyear]', '2021');
  await page.getByRole('button', { name: 'Save', exact: true }).click();

  // Set area via Near me (also loads named places the AI can mention).
  await page.evaluate(() => (location.hash = 'near'));
  await page.getByRole('button', { name: /Use my location/ }).click();
  await page.getByText('Pioneer Square Playground').waitFor();
  await page.evaluate(() => (location.hash = 'weekend'));

  // Below threshold (1 family, needs 2): honest empty state on Home.
  await page.evaluate(() => (location.hash = 'home'));
  await page.getByText(/Not enough families near you have shared yet.*at least 2 families/).waitFor();
  await page.evaluate(() => (location.hash = 'weekend'));

  // Add Mia's swimming class.
  await page.locator('#add-class-top').click();
  await page.fill('input[name=title]', "Mia's swimming");
  await page.fill('input[name=start]', '09:00');
  await page.fill('input[name=end]', '10:00');
  await page.locator('#cls').getByRole('button', { name: 'Add', exact: true }).click();

  // AI plan with a note.
  await page.locator('#wk-note').waitFor();
  await page.fill('#wk-note', 'Grandma visits Sunday lunch');
  await page.getByRole('button', { name: /Plan our weekend/ }).click();
  await page.getByText(/A gentle weekend that works around your plans/).waitFor();
  await page.getByText(/AI plans left today/).waitFor();
  if ((await page.locator('.tl-act').count()) !== 4) fail('every free window should be filled (AI + library fallback)');
  const sat = page.locator('.day').nth(0);
  await sat.getByText('Nature scavenger hunt').waitFor();
  await sat.getByText('📍 Pioneer Square Playground').waitFor();
  await sat.getByText('Dinosaur dig in a tray').waitFor();
  // The mock claims popularity that the data doesn't support; the server must strip it.
  if (await page.getByText(/Popular with 3 families/).count()) fail('unsupported popularity claim shown');
  await page.screenshot({ path: `${SHOTS}/10-ai-plan.png`, fullPage: true });

  // What reached the AI: class type + times and the note, but not the child's name or coordinates.
  const sent = JSON.stringify(mock.requests.at(-1).body);
  for (const t of ['Swimming 09:00–10:00', 'sat@10:15', 'Grandma visits Sunday lunch', 'Pioneer Square Playground', 'Light rain|Rain']) if (!new RegExp(t).test(sent)) fail(`AI request missing ${t}`);
  if (sent.includes('Mia')) fail("child's name leaked to AI");
  if (sent.includes('47.60') || sent.includes('-122.33')) fail('raw coordinates leaked to AI');

  // The AI-written idea: disclaimer; it can't be shared to the community.
  await sat.locator('.tl-body', { hasText: 'Dinosaur dig in a tray' }).click();
  await page.getByText(/written by AI/).waitFor();
  await page.locator('#sheet-body').getByRole('button', { name: /We did it/ }).click();
  if (await page.locator('label.share').count()) fail('AI ideas must not be shareable');
  await page.getByRole('button', { name: 'Save memory' }).click();

  // Done on the library pick + share anonymously → crosses the threshold.
  await page.locator('.tl-body', { hasText: 'Nature scavenger hunt' }).click();
  await page.locator('#sheet-body').getByRole('button', { name: '✅ We did it' }).click();
  await page.locator('label.share input').check();
  await page.screenshot({ path: `${SHOTS}/11-share.png` });
  await page.getByRole('button', { name: 'Save memory' }).click();
  await page.waitForTimeout(300);
  await page.goto(BASE + '#home');
  await page.getByText(/Families with kids ages 4–5 near you, last 30 days/).waitFor();
  await page.locator('#popular').getByText('Nature scavenger hunt').waitFor();
  await page.locator('#popular').getByText('2 families did this').waitFor();
  await page.screenshot({ path: `${SHOTS}/12-popular.png`, fullPage: true });

  // AI idea and plan survive reload; memories saved.
  await page.evaluate(() => (location.hash = 'weekend'));
  await page.locator('.day').nth(0).getByText('Dinosaur dig in a tray').waitFor();
  await page.evaluate(() => (location.hash = 'memories'));
  await page.getByText('Dinosaur dig in a tray').first().waitFor();

  // Discover puts real "families near you" picks first.
  await page.evaluate(() => (location.hash = 'discover'));
  await page.locator('.pin').first().getByText('2 families near you did this').waitFor();
  if ((await page.locator('.pin').first().getAttribute('data-id')) !== 'scavenger') fail('popular pick should lead the feed');
  if ((await page.locator('.pin[data-id="scavenger"]').count()) !== 1) fail('popular pick should not be repeated in the feed');

  // Profile → link Mia's preschool from a newsletter photo (AI reads, parent checks).
  await page.evaluate(() => (location.hash = 'profile'));
  await page.locator('.kid-row', { hasText: 'Mia' }).getByRole('button', { name: 'Link school' }).click();
  await page.fill('[name=school]', 'Synergy Learning Academy');
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
  const before = mock.requests.length;
  await page.setInputFiles('#photo-file', { name: 'newsletter.png', mimeType: 'image/png', buffer: png });
  await page.getByRole('heading', { name: 'Check these dates' }).waitFor();
  await page.getByText('This looks like the October newsletter.').waitFor();
  if ((await page.locator('.review-row').count()) !== 3) fail('expected 3 dates to review (bad date dropped)');
  const sentImg = mock.requests.slice(before).find((r) => Array.isArray(r.body.messages?.[0]?.content));
  if (!sentImg || sentImg.body.messages[0].content[0].source.media_type !== 'image/jpeg') fail('photo should be sent to Claude as a compressed JPEG');
  if (JSON.stringify(sentImg.body).includes('Mia')) fail("the child's name must not be sent with the photo");
  await page.locator('.review-row', { hasText: 'Harvest parade' }).locator('input').uncheck();
  await page.getByRole('button', { name: /Save Synergy Learning Academy dates/ }).click();
  await page.getByRole('heading', { name: 'Synergy Learning Academy' }).waitFor();
  await page.getByText(/Dates from a photo · just now · 2 upcoming dates/).first().waitFor();
  if ((await page.locator('.avatar').innerText()) !== '🌱') fail('avatar without a family name should be the sprout, not a broken character');
  // A second newsletter adds to the dates (no duplicates).
  await page.getByRole('button', { name: 'Link a different way' }).click();
  await page.setInputFiles('#photo-file', { name: 'newsletter2.png', mimeType: 'image/png', buffer: png });
  await page.getByRole('button', { name: /Save Synergy Learning Academy dates/ }).click();
  await page.locator('#sheet-body').getByText(/3 upcoming dates/).waitFor();
  await page.keyboard.press('Escape');
  await page.screenshot({ path: `${SHOTS}/13-school-photo.png`, fullPage: true });
  // With the server, "Use in Claude or ChatGPT" gives the MCP address.
  await page.getByRole('button', { name: /Use in Claude or ChatGPT/ }).click();
  if (!(await page.inputValue('#mcp-url')).endsWith('/mcp')) fail('MCP address should end in /mcp');
  await page.keyboard.press('Escape');

  if (errors.length) fail('page errors:\n' + errors.join('\n'));
  console.log('AI E2E PASSED');
} catch (e) {
  await page.screenshot({ path: `${SHOTS}/ai-failure.png`, fullPage: true }).catch(() => {});
  console.error('AI E2E FAILED:', e.message);
  process.exitCode = 1;
} finally {
  await browser.close();
  try { process.kill(-dev.pid, 'SIGTERM'); } catch {}
  mock.close();
  process.exit();
}
