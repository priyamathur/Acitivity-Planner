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
const ctx = await browser.newContext({ locale: 'en-GB', viewport: { width: 390, height: 844 }, geolocation: { latitude: 47.6062, longitude: -122.3321 }, permissions: ['geolocation', 'clipboard-read', 'clipboard-write'] });
// Freeze "today" to Wednesday 7 Oct 2026 so this weekend is Sat 10 – Sun 11 Oct.
await ctx.clock.setFixedTime(new Date('2026-10-07T10:00:00'));
const page = await ctx.newPage();
// Web fonts are optional; keep tests offline.
await ctx.route('https://fonts.googleapis.com/**', (r) => r.fulfill({ contentType: 'text/css', body: '' }));
await page.addInitScript(() => { delete Navigator.prototype.share; });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
// The app probes /api/health to see if a server is present; a 404 there is expected on static hosting.
page.on('console', (m) => m.type() === 'error' && !(m.location()?.url || '').includes('/api/health') && errors.push(m.text()));

const overpassQueries = [];
await page.route('https://overpass-api.de/**', (r) => (overpassQueries.push(r.request().postData()), r.fulfill({ json: { elements: [
  { type: 'node', id: 11, lat: 47.607, lon: -122.333, tags: { name: 'Pioneer Square Playground', wheelchair: 'yes' } },
  { type: 'way', id: 12, center: { lat: 47.62, lon: -122.35 }, tags: { name: 'Seattle Center Playground', website: 'https://example.org' } },
] } })));
await page.route('https://api.open-meteo.com/**', (r) => r.fulfill({ json: { daily: { time: ['2026-10-10', '2026-10-11'], weather_code: [63, 0], temperature_2m_max: [12.3, 19.6], precipitation_probability_max: [85, 5] }, daily_units: { temperature_2m_max: '°C' } } }));
await page.route('https://nominatim.openstreetmap.org/**', (r) => r.fulfill({ json: [{ lat: '51.5', lon: '-0.12', display_name: 'London, Greater London, England' }] }));

try {
  await page.goto(BASE);
  await page.getByText('Welcome to LittleRoam').waitFor();
  await page.screenshot({ path: `${SHOTS}/01-onboarding.png` });

  // Onboarding → two kids
  await page.getByRole('button', { name: "Add my kids' ages" }).click();
  await page.fill('input[name=name]', 'Mathur');
  await page.fill('.kid >> nth=0 >> input[name=kname]', 'Mia');
  await page.selectOption('.kid >> nth=0 >> select[name=kyear]', '2021');
  await page.getByRole('button', { name: '+ Add a child' }).click();
  await page.fill('.kid >> nth=1 >> input[name=kname]', 'Leo');
  await page.selectOption('.kid >> nth=1 >> select[name=kyear]', '2018');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByRole('heading', { name: 'This weekend' }).waitFor();
  await page.getByText('10 Oct – 11 Oct').waitFor();

  // Location (for weather + places)
  await page.locator('.explore').getByRole('link', { name: 'Places near us' }).click();
  await page.getByRole('button', { name: /Use my location/ }).click();
  await page.getByText('Pioneer Square Playground').waitFor();
  await page.getByText('Make it an adventure').waitFor();
  await page.screenshot({ path: `${SHOTS}/04-near.png`, fullPage: true });
  await page.locator('nav.tabs').getByRole('link', { name: /Weekend/ }).click();

  async function openClassForm() {
    await page.locator('#add-class-top').click();
  }
  async function addClass({ title, kid, days, start, end, once = false }) {
    await openClassForm();
    await page.fill('input[name=title]', title);
    await page.selectOption('select[name=kid]', { label: kid });
    for (const k of ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']) await page.locator(`input[name=days][value=${k}]`).setChecked(days.includes(k), { force: true });
    await page.fill('input[name=start]', start);
    await page.fill('input[name=end]', end);
    if (once) await page.getByLabel('This week only').check();
    await page.locator('#cls').getByRole('button', { name: 'Add', exact: true }).click();
  }
  await addClass({ title: 'Swimming', kid: 'Mia (5)', days: ['sat'], start: '09:00', end: '10:00' });
  await addClass({ title: "Sam's birthday party", kid: 'Everyone', days: ['sat'], start: '14:00', end: '16:00', once: true });
  // Weekday class on two days: counted for the week, doesn't touch weekend time.
  await addClass({ title: 'Football', kid: 'Leo (8)', days: ['tue', 'thu'], start: '16:00', end: '17:00' });
  await page.getByText('4 classes this week').waitFor();
  // Booked classes preview on the timeline before planning.
  await page.locator('#timeline-wk').getByText("Sam's birthday party").waitFor();
  // The week sheet groups by day; Tuesday is over.
  await page.locator('#classes-btn').click();
  await page.locator('.cls-day.past', { hasText: 'Tuesday' }).getByText('Football').waitFor();
  await page.locator('.cls-day', { hasText: 'Thursday' }).getByText('Football').waitFor();
  await page.getByText('this week only').waitFor();
  // Edge cases in the form: a one-off can only be on one day; no day; end before start.
  await page.locator('#sheet-body #add-class').click();
  await page.fill('input[name=title]', 'Dentist');
  await page.locator('input[name=days][value=sat]').setChecked(false, { force: true });
  await page.locator('#cls').getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByText('Pick at least one day.').waitFor();
  await page.locator('input[name=days][value=mon]').check({ force: true });
  await page.locator('input[name=days][value=tue]').check({ force: true });
  await page.getByLabel('This week only').check();
  await page.locator('#cls').getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByText(/one-off plan happens on one day/).waitFor();
  await page.locator('input[name=days][value=tue]').setChecked(false, { force: true });
  await page.fill('input[name=start]', '15:00');
  await page.fill('input[name=end]', '14:00');
  await page.locator('#cls').getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByText(/end time needs to be after/).waitFor();
  await page.locator('[data-close]').click();
  await page.screenshot({ path: `${SHOTS}/02-weekend-setup.png`, fullPage: true });

  // Find classes nearby → venue list → "Add as a class" pre-fills the form
  await page.locator('#find-classes-top').click();
  await page.getByRole('heading', { name: 'Find classes nearby' }).waitFor();
  await page.getByRole('button', { name: '🥋 Martial arts' }).click();
  await page.locator('.venue').first().waitFor();
  const q = decodeURIComponent((overpassQueries.at(-1) || '').replace(/\+/g, ' '));
  if (!q.includes('"amenity"="dojo"')) fail('martial arts venues not queried: ' + q);
  if (await page.getByRole('button', { name: /Ask chat for times/ }).count()) fail('chat button shown without AI');
  await page.locator('[data-add-venue]').first().click();
  if ((await page.inputValue('input[name=title]')) !== 'Martial arts') fail('class title not pre-filled');
  if ((await page.inputValue('input[name=where]')) !== 'Pioneer Square Playground') fail('venue not pre-filled');
  await page.locator('[data-close]').click();

  // Plan it (no server → on-device engine)
  await page.getByText('Big adventure').click();
  await page.getByRole('button', { name: /Plan our weekend/ }).click();
  await page.locator('.tl-act').first().waitFor();
  if ((await page.locator('.tl-act').count()) !== 4) fail('expected 4 planned slots');
  await page.getByText(/12° · 85% rain/).waitFor();
  const satText = await page.locator('.day').nth(0).innerText();
  for (const t of ['09:00', 'Swimming', 'until 10:00', '10:15', "Sam's birthday party", '16:15']) if (!satText.includes(t)) fail(`Saturday timeline missing ${t}`);
  if (satText.indexOf('Swimming') > satText.indexOf('10:15')) fail('timeline not in time order');
  if (satText.includes('Football')) fail('weekday class shown on the weekend');
  await page.screenshot({ path: `${SHOTS}/03-plan.png`, fullPage: true });

  // Swap the first slot
  const firstTitle = await page.locator('.tl-act .tl-body').first().innerText();
  await page.locator('.tl-act [data-swap]').first().click();
  if ((await page.locator('.tl-act .tl-body').first().innerText()) === firstTitle) fail('swap did not change the activity');

  // Tap a slot → details → We did it → memory dated Saturday
  await page.locator('.tl-act .tl-body').first().click();
  await page.locator('#sheet-body').getByRole('button', { name: '✅ We did it' }).click();
  if ((await page.inputValue('input[name=date]')) !== '2026-10-10') fail('memory should default to the slot date');
  await page.fill('textarea[name=note]', 'Best Saturday ever');
  await page.fill('textarea[name=quote]', 'Again! Again!');
  await page.getByRole('button', { name: 'Save memory' }).click();
  await page.locator('.tl-act.done').waitFor();

  // Remove a slot from its details, then refill it
  await page.locator('.tl-act .tl-body').nth(1).click();
  await page.locator('#sheet-body').getByRole('button', { name: 'Remove' }).click();
  await page.getByRole('button', { name: '+ Add something' }).click();
  if ((await page.locator('.tl-act').count()) !== 4) fail('refill failed');

  // Send to partner (clipboard fallback)
  await page.getByRole('button', { name: /Send to my partner/ }).click();
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  for (const t of ['Our weekend', 'Classes this week', 'Thu 16:00–17:00 ⚽ Football (Leo)', 'Saturday 10 Oct', '09:00–10:00 🏊 Swimming (Mia)', "🎉 Sam's birthday party", 'Sunday 11 Oct']) if (!clip.includes(t)) fail(`shared text missing ${t}: ${clip}`);
  if (clip.includes('Tue 16:00')) fail('past weekday class in shared text');

  // Next weekend: one-off party gone, swimming stays, no plan yet
  await page.getByRole('tab', { name: 'Next' }).click();
  await page.getByText('17 Oct – 18 Oct').waitFor();
  if (await page.getByText("Sam's birthday party").count()) fail('one-off plan leaked into next weekend');
  await page.locator('#timeline-wk').getByText('Swimming').waitFor();
  await page.getByRole('button', { name: /Plan our weekend/ }).waitFor();

  // Skip swimming next weekend only
  await page.locator('#classes-btn').click();
  await page.locator('.cls-day', { hasText: 'Saturday' }).getByText('Swimming').click();
  await page.getByRole('button', { name: /Skip on Sat,? 17 Oct only/ }).click();
  await page.waitForTimeout(200);
  if (await page.locator('#timeline-wk').getByText('Swimming').count()) fail('skip did not apply');
  await page.getByRole('tab', { name: 'This' }).click();
  await page.locator('#timeline-wk').getByText('Swimming').waitFor();

  // Ideas → add to weekend
  await page.locator('.explore').getByRole('link', { name: 'All ideas' }).click();
  await page.fill('#q', 'volcano');
  await page.getByText('Kitchen volcano').click();
  await page.getByRole('button', { name: /Add to our weekend/ }).click();
  await page.locator('.slot-pick').first().click();
  await page.locator('#timeline-wk').getByText('Kitchen volcano').waitFor();

  // Favourites still work
  await page.locator('.explore').getByRole('link', { name: 'All ideas' }).click();
  await page.fill('#q', 'volcano');
  await page.locator('[data-fav="volcano"]').first().click();
  await page.getByRole('button', { name: '♥ Saved' }).click();
  if ((await page.locator('#idea-list .act').count()) !== 1) fail('favourite filter failed');
  await page.fill('#q', '');
  await page.getByRole('button', { name: '✨ All' }).click();
  await page.screenshot({ path: `${SHOTS}/05-ideas.png` });

  // Memories
  await page.evaluate(() => (location.hash = 'memories'));
  await page.getByText('Best Saturday ever').waitFor();
  await page.getByText('Again! Again!').waitFor();
  await page.getByText('weekends with an adventure').waitFor();
  await page.screenshot({ path: `${SHOTS}/07-memories.png`, fullPage: true });
  await page.getByRole('button', { name: /Our year so far/ }).click();
  await page.getByText(/memor(y|ies) made together/).waitFor();

  // Persistence across reload + deep link
  await page.goto(BASE + '#a/stargaze');
  await page.getByText('Backyard star party').waitFor();
  await page.keyboard.press('Escape');
  await page.locator('nav.tabs').getByRole('link', { name: /Weekend/ }).click();
  await page.locator('.tl-act').first().waitFor();
  await page.getByText("Sam's birthday party").first().waitFor();

  // Just two tabs; Places, Ideas and Past weekends live under Weekend, each with a way back
  if ((await page.locator('nav.tabs .tab').count()) !== 2) fail('expected 2 tabs');
  for (const [link, heading] of [['Places near us', 'Places near us'], ['All ideas', 'All ideas'], ['Past weekends', 'Past weekends']]) {
    await page.locator('nav.tabs').getByRole('link', { name: /Weekend/ }).click();
    await page.locator('.explore').getByRole('link', { name: link }).click();
    await page.getByRole('heading', { name: heading }).waitFor();
    if (!(await page.locator('nav.tabs .tab[aria-current=page]').innerText()).includes('Weekend')) fail(`${link} should highlight the Weekend tab`);
    await page.getByRole('link', { name: '‹ Weekend' }).click();
    await page.getByRole('heading', { name: 'This weekend' }).waitFor();
  }

  // Chat without a server: explains it needs AI instead of failing
  await page.locator('nav.tabs').getByRole('link', { name: /Chat/ }).click();
  await page.getByText(/Chat uses AI, which is switched on/).waitFor();
  if (await page.locator('#chat-input').count()) fail('chat input shown without AI');

  // Plus sheet
  await page.locator('#settings-btn').click();
  await page.getByRole('button', { name: /About LittleRoam Plus/ }).click();
  await page.getByText('$4.99').waitFor();
  await page.screenshot({ path: `${SHOTS}/08-plus.png` });

  // Desktop + dark mode render check
  const dark = await browser.newPage({ viewport: { width: 1200, height: 900 }, colorScheme: 'dark' });
  await dark.route('https://fonts.googleapis.com/**', (r) => r.fulfill({ contentType: 'text/css', body: '' }));
  dark.on('pageerror', (e) => errors.push(e.message));
  await dark.goto(BASE + '#weekend');
  await dark.getByText('Plan our weekend').waitFor();
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
