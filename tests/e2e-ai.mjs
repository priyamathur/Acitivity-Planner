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
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, geolocation: { latitude: 47.6062, longitude: -122.3321 }, permissions: ['geolocation'] });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.route('https://overpass-api.de/**', (r) => r.fulfill({ json: { elements: [
  { type: 'node', id: 11, lat: 47.607, lon: -122.333, tags: { name: 'Pioneer Square Playground' } },
] } }));
await page.route('https://api.open-meteo.com/**', (r) => r.fulfill({ json: { current: { temperature_2m: 18, weather_code: 0 }, current_units: { temperature_2m: '°C' } } }));

// Another family nearby (same age band) already shared the scavenger hunt.
await fetch(BASE + 'api/share', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ fam: 'neighbour-family-1', cell: '952:-2447', bands: ['4-5'], activity: 'scavenger' }) });

try {
  await page.goto(BASE);
  await page.getByRole('button', { name: "Add my kids' ages" }).click();
  await page.selectOption('select[name=kyear]', String(new Date().getFullYear() - 5));
  await page.getByRole('button', { name: 'Save', exact: true }).click();

  // Set area via Near me (also loads named places the AI can mention).
  await page.locator('nav.tabs').getByRole('link', { name: /Near me/ }).click();
  await page.getByRole('button', { name: /Use my location/ }).click();
  await page.getByText('Pioneer Square Playground').waitFor();
  await page.locator('nav.tabs').getByRole('link', { name: /Today/ }).click();

  // Below threshold (1 family, needs 2): honest empty state.
  await page.getByText(/Not enough families near you have shared yet.*at least 2 families/).waitFor();

  // Ask box is visible because the server has AI.
  await page.getByText('Ask for something specific').waitFor();

  // Guided bot → AI picks with reasons.
  await page.getByRole('button', { name: 'About an hour' }).click();
  await page.getByRole('button', { name: 'Go somewhere' }).click();
  await page.getByRole('button', { name: 'Burn energy' }).click();
  await page.getByText('Three ideas that fit your afternoon.').waitFor();
  // The mock claims popularity that the data doesn't support; the server must strip it.
  if (await page.getByText(/Popular with 3 families/).count()) fail('unsupported popularity claim shown');
  await page.getByText('📍 Pioneer Square Playground').waitFor();
  await page.getByText('Dinosaur dig in a tray').waitFor();
  if ((await page.locator('.picks .act').count()) !== 2) fail('expected 2 valid AI picks (hallucinated one dropped)');
  await page.getByText(/AI suggestions · \d+ left today/).waitFor();
  await page.screenshot({ path: `${SHOTS}/10-ai-picks.png`, fullPage: true });

  // The request carried the nearby place and the kid's age band, and no coordinates.
  const sent = JSON.stringify(mock.requests.at(-1).body);
  if (!sent.includes('Pioneer Square Playground')) fail('nearby place not sent to AI');
  if (sent.includes('47.60') || sent.includes('-122.33')) fail('raw coordinates leaked to AI');

  // Open the AI-written idea: shows disclaimer; save memory (no share option for AI ideas).
  await page.getByText('Dinosaur dig in a tray').click();
  await page.getByText(/written by AI/).waitFor();
  await page.getByRole('button', { name: /We did it/ }).click();
  if (await page.locator('label.share').count()) fail('AI ideas must not be shareable');
  await page.getByRole('button', { name: 'Save memory' }).click();

  // Save a memory for the library pick and share it anonymously → crosses the threshold.
  await page.locator('.picks [data-open="scavenger"]').click();
  await page.getByRole('button', { name: /We did it/ }).click();
  await page.locator('label.share input').check();
  await page.screenshot({ path: `${SHOTS}/11-share.png` });
  await page.getByRole('button', { name: 'Save memory' }).click();
  await page.waitForTimeout(300);
  await page.reload();
  await page.getByText(/What 2 families with kids ages 4–5 near you/).waitFor();
  await page.locator('#popular').getByText('Nature scavenger hunt').waitFor();
  await page.locator('#popular').getByText('2 families did this').waitFor();
  await page.screenshot({ path: `${SHOTS}/12-popular.png`, fullPage: true });

  // Free-text question.
  await page.fill('#ask-q', 'A calm idea for a 5 year old with a broken arm');
  await page.getByRole('button', { name: 'Ask', exact: true }).click();
  await page.getByText('Here are some gentle ideas for a quiet day.').waitFor();
  if (!JSON.stringify(mock.requests.at(-1).body).includes('broken arm')) fail('question not sent');

  // AI idea survives reload and can be planned.
  await page.reload();
  await page.locator('nav.tabs').getByRole('link', { name: /Memories/ }).click();
  await page.getByText('Dinosaur dig in a tray').first().waitFor();

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
