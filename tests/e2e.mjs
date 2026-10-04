// End-to-end smoke test. Serves the app locally and mocks the external
// map/weather APIs so it runs offline and deterministically.
// Usage: node tests/e2e.mjs   (needs `playwright` resolvable, e.g. NODE_PATH=$(npm root -g))
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const PORT = 8765;
const BASE = `http://localhost:${PORT}/`;
const SHOTS = process.env.SHOTS || 'tests/screenshots';
mkdirSync(SHOTS, { recursive: true });

const server = spawn('python3', ['-m', 'http.server', String(PORT)], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 800));

const fail = (m) => { throw new Error(m); };
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, geolocation: { latitude: 47.6062, longitude: -122.3321 }, permissions: ['geolocation'] });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
// The app probes /api/health to see if a server is present; a 404 there is expected on static hosting.
page.on('console', (m) => m.type() === 'error' && !(m.location()?.url || '').includes('/api/health') && errors.push(m.text()));

await page.route('https://overpass-api.de/**', (r) => r.fulfill({ json: { elements: [
  { type: 'node', id: 11, lat: 47.607, lon: -122.333, tags: { name: 'Pioneer Square Playground', wheelchair: 'yes' } },
  { type: 'way', id: 12, center: { lat: 47.62, lon: -122.35 }, tags: { name: 'Seattle Center Playground', website: 'https://example.org' } },
] } }));
await page.route('https://api.open-meteo.com/**', (r) => r.fulfill({ json: { current: { temperature_2m: 12.3, weather_code: 63 }, current_units: { temperature_2m: '°C' } } }));
await page.route('https://nominatim.openstreetmap.org/**', (r) => r.fulfill({ json: [{ lat: '51.5', lon: '-0.12', display_name: 'London, Greater London, England' }] }));

try {
  await page.goto(BASE);
  await page.getByText('Welcome to LittleRoam').waitFor();
  await page.screenshot({ path: `${SHOTS}/01-onboarding.png` });

  // Onboarding → add a child
  await page.getByRole('button', { name: "Add my kids' ages" }).click();
  await page.fill('input[name=name]', 'Mathur');
  await page.selectOption('select[name=kyear]', String(new Date().getFullYear() - 5));
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByText('Hi, Mathur family').waitFor();

  // Planner bot
  await page.getByText('your 5-year-old').waitFor();
  await page.getByRole('button', { name: 'About an hour' }).click();
  await page.getByRole('button', { name: 'At home' }).click();
  await page.getByRole('button', { name: 'Burn energy' }).click();
  const picks = page.locator('.picks .act');
  await picks.first().waitFor();
  if ((await picks.count()) !== 3) fail('expected 3 picks');
  await page.screenshot({ path: `${SHOTS}/02-bot.png`, fullPage: true });

  // Open detail, save memory
  await picks.first().locator('.act-main').click();
  await page.getByText('How to').waitFor();
  if (!page.url().includes('#a/')) fail('deep link not set');
  await page.screenshot({ path: `${SHOTS}/03-detail.png` });
  await page.getByRole('button', { name: /We did it/ }).click();
  await page.fill('textarea[name=note]', 'Best afternoon ever');
  await page.fill('textarea[name=quote]', 'Again! Again!');
  await page.getByRole('button', { name: 'Save memory' }).click();

  // Weekend plan
  await page.getByRole('button', { name: /Plan my weekend/ }).click();
  await page.getByText('Your weekend plan').waitFor();
  await page.getByRole('button', { name: /Save to my plan/ }).click();

  // Near me
  await page.locator('nav.tabs').getByRole('link', { name: /Near me/ }).click();
  await page.getByRole('button', { name: /Use my location/ }).click();
  await page.getByText('Pioneer Square Playground').waitFor();
  await page.getByText('Make it an adventure').waitFor();
  await page.screenshot({ path: `${SHOTS}/04-near.png`, fullPage: true });
  await page.fill('#loc-q', 'London');
  await page.getByRole('button', { name: 'Go' }).click();
  await page.getByText('London, Greater London').waitFor();

  // Today now shows weather (rain → mocked code 63)
  await page.locator('nav.tabs').getByRole('link', { name: /Today/ }).click();
  await page.getByText(/Rain · 12/).waitFor();

  // Ideas search + favourite
  await page.getByRole('link', { name: /Ideas/ }).click();
  await page.fill('#q', 'volcano');
  await page.getByText('Kitchen volcano').waitFor();
  await page.locator('[data-fav="volcano"]').first().click();
  await page.getByRole('button', { name: '♥ Saved' }).click();
  if ((await page.locator('#idea-list .act').count()) !== 1) fail('favourite filter failed');
  await page.fill('#q', '');
  await page.getByRole('button', { name: '✨ All' }).click();
  await page.screenshot({ path: `${SHOTS}/05-ideas.png` });

  // Plans
  await page.getByRole('link', { name: /Plans/ }).click();
  await page.locator('.plan-item').first().waitFor();
  if ((await page.locator('.plan-item').count()) < 4) fail('weekend not saved to plan');
  await page.screenshot({ path: `${SHOTS}/06-plan-week.png`, fullPage: true });
  await page.getByRole('tab', { name: 'Bucket list' }).click();
  await page.locator('[data-b]').first().check();
  await page.getByText('Save a memory').waitFor();
  await page.locator('[data-close]').click();
  await page.getByRole('tab', { name: 'Life skills' }).click();
  await page.locator('details[open] [data-s]').first().check();
  await page.getByRole('tab', { name: 'Traditions' }).click();
  await page.getByRole('button', { name: 'Adopt' }).first().click();
  await page.getByRole('button', { name: '✓ Ours' }).waitFor();

  // Memories
  await page.locator('nav.tabs').getByRole('link', { name: /Memories/ }).click();
  await page.getByText('Best afternoon ever').waitFor();
  await page.getByText('Again! Again!').waitFor();
  await page.screenshot({ path: `${SHOTS}/07-memories.png`, fullPage: true });
  await page.getByRole('button', { name: /Our year so far/ }).click();
  await page.getByText(/memor(y|ies) made together/).waitFor();

  // Persistence across reload + deep link
  await page.goto(BASE + '#a/stargaze');
  await page.getByText('Backyard star party').waitFor();
  await page.keyboard.press('Escape');
  await page.locator('nav.tabs').getByRole('link', { name: /Memories/ }).click();
  await page.getByText('Best afternoon ever').waitFor();

  // Plus sheet
  await page.locator('#settings-btn').click();
  await page.getByRole('button', { name: /About LittleRoam Plus/ }).click();
  await page.getByText('$4.99').waitFor();
  await page.screenshot({ path: `${SHOTS}/08-plus.png` });

  // Desktop + dark mode render check
  const dark = await browser.newPage({ viewport: { width: 1200, height: 900 }, colorScheme: 'dark' });
  dark.on('pageerror', (e) => errors.push(e.message));
  await dark.goto(BASE + '#ideas');
  await dark.getByText('Idea library').waitFor();
  await dark.waitForTimeout(400); // let the onboarding sheet finish animating
  await dark.screenshot({ path: `${SHOTS}/09-desktop-dark.png` });

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  if (overflow) fail('horizontal overflow on mobile');
  if (errors.length) fail('console errors:\n' + errors.join('\n'));
  console.log('E2E PASSED');
} catch (e) {
  await page.screenshot({ path: `${SHOTS}/failure.png`, fullPage: true }).catch(() => {});
  console.error('E2E FAILED:', e.message);
  process.exitCode = 1;
} finally {
  await browser.close();
  server.kill();
}
