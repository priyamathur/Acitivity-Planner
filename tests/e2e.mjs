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
// blocked.example is a calendar link the test blocks on purpose.
page.on('console', (m) => m.type() === 'error' && !/\/api\/health|blocked\.example/.test(m.location()?.url || '') && errors.push(m.text()));

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
  await page.getByRole('heading', { name: /Hi, Mathur family/ }).waitFor();
  await page.getByRole('link', { name: /Plan the weekend/ }).click();
  await page.getByRole('heading', { name: 'This weekend' }).waitFor();
  await page.getByText('10 Oct – 11 Oct').waitFor();

  // Location (for weather + places)
  await page.evaluate(() => (location.hash = 'near'));
  await page.getByRole('button', { name: /Use my location/ }).click();
  await page.getByText('Pioneer Square Playground').waitFor();
  await page.getByText('Make it an adventure').waitFor();
  await page.screenshot({ path: `${SHOTS}/04-near.png`, fullPage: true });
  await page.evaluate(() => (location.hash = 'weekend'));

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
  await page.getByText(/3 classes · 1 plan this week/).waitFor();
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
  await page.locator('#add-class-top').click();
  await page.locator('#find-from-form').click();
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
  await page.locator('.vibe', { hasText: 'Adventure' }).click();
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
  await page.evaluate(() => (location.hash = 'ideas'));
  await page.fill('#q', 'volcano');
  await page.getByText('Kitchen volcano').click();
  await page.getByRole('button', { name: /Add to our weekend/ }).click();
  await page.locator('.slot-pick').first().click();
  await page.locator('#timeline-wk').getByText('Kitchen volcano').waitFor();

  // Favourites still work
  await page.evaluate(() => (location.hash = 'ideas'));
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
  await page.getByText(/^weekends? with an adventure$/).waitFor();
  await page.screenshot({ path: `${SHOTS}/07-memories.png`, fullPage: true });
  await page.getByRole('button', { name: /Our year so far/ }).click();
  await page.getByText(/memor(y|ies) made together/).waitFor();

  // Persistence across reload + deep link
  await page.goto(BASE + '#a/stargaze');
  await page.getByText('Backyard star party').waitFor();
  await page.keyboard.press('Escape');
  await page.evaluate(() => (location.hash = 'weekend'));
  await page.locator('.tl-act').first().waitFor();
  await page.getByText("Sam's birthday party").first().waitFor();

  // Home: Family | Kids sections, ask bar, classes, no bottom tabs
  await page.goto(BASE + '#home');
  // Three bottom tabs: Plan · Discover · Profile.
  if ((await page.locator('nav.tabbar .tab').allInnerTexts()).map((t) => t.trim()).join('|') !== 'Plan|Discover|Profile') fail('expected tabs Plan, Discover, Profile');
  if ((await page.locator('.tab[aria-current=page]').innerText()).trim() !== 'Plan') fail('Plan tab should be current on Home');
  await page.getByRole('heading', { name: /Hi, Mathur family/ }).waitFor();
  await page.getByRole('link', { name: /Plan the weekend/ }).waitFor();
  const famTitles = await page.locator('.home-list .act-text strong').allInnerTexts();
  if (famTitles.length !== 5) fail('expected 5 family ideas');
  await page.getByRole('tab', { name: /Kids/ }).click();
  await page.getByRole('heading', { name: 'Play ideas' }).waitFor();
  const kidTitles = await page.locator('.home-list .act-text strong').allInnerTexts();
  if (kidTitles.some((t) => famTitles.includes(t))) fail('family and kids lists should differ');
  await page.getByRole('button', { name: 'Leo (8)' }).click();
  const leoMeta = await page.locator('.home-list .meta').allInnerTexts();
  for (const m of leoMeta) { const [lo, hi] = m.match(/ages (\d+)–(\d+)/).slice(1).map(Number); if (lo - 1 > 8 || hi + 1 < 8) fail(`not for an 8-year-old: ${m}`); }
  await page.selectOption('#h-time', '30');
  for (const m of await page.locator('.home-list .meta').allInnerTexts()) if (/\d h/.test(m)) fail(`over 30 min: ${m}`);
  await page.getByText('Classes this week').waitFor();
  await page.locator('.class-list').getByText('Football').waitFor();
  await page.locator('#h-add-class').click();
  await page.getByRole('heading', { name: 'Add a class or plan' }).waitFor();
  await page.locator('[data-close]').click();
  await page.getByRole('link', { name: /See all kids ideas/ }).click();
  await page.getByRole('heading', { name: 'All ideas' }).waitFor();
  if (!(await page.locator('[data-aud="kids"]').getAttribute('class')).includes('on')) fail('See all should open the kids filter');
  await page.getByRole('link', { name: '‹ Home' }).click();
  // Ask bar without AI falls back to searching ideas
  await page.fill('#ask-q', 'volcano');
  await page.getByRole('button', { name: 'Search' }).click();
  await page.getByRole('heading', { name: 'All ideas' }).waitFor();
  await page.getByText('Kitchen volcano').waitFor();
  if ((await page.locator('#idea-list .act').count()) !== 1) fail('ask-bar search should filter ideas');
  await page.evaluate(() => (location.hash = 'home'));
  await page.getByRole('tab', { name: /Family/ }).click();
  await page.getByRole('link', { name: /Parks/ }).click();
  await page.getByRole('heading', { name: 'Places near us' }).waitFor();
  if (!(await page.locator('[data-type="park"]').getAttribute('class')).includes('on')) fail('place chip should open that type');
  await page.screenshot({ path: `${SHOTS}/00-home.png`, fullPage: true });

  // Chat without a server: explains it needs AI instead of failing
  await page.evaluate(() => (location.hash = 'chat'));
  await page.getByText(/Chat uses AI, which is switched on/).waitFor();
  if (await page.locator('#chat-input').count()) fail('chat input shown without AI');

  // Chat is a full screen: no tab bar under its message box.
  if (await page.locator('nav.tabbar').isVisible()) fail('tab bar should be hidden in chat');

  // ---------- Tabs: each screen highlights the right tab ----------
  for (const [hash, tab] of [['home', 'Plan'], ['weekend', 'Plan'], ['ideas', 'Plan'], ['near', 'Plan'], ['discover', 'Discover'], ['profile', 'Profile'], ['memories', 'Profile']]) {
    await page.evaluate((h) => (location.hash = h), hash);
    await page.waitForFunction((h) => document.body.dataset.view === h, hash);
    if ((await page.locator('.tab[aria-current=page]').innerText()).trim() !== tab) fail(`#${hash} should highlight ${tab}`);
  }
  await page.locator('.tabbar').getByRole('link', { name: 'Discover' }).click();
  await page.getByRole('heading', { name: 'Discover', exact: true }).waitFor();

  // ---------- Discover feed ----------
  const lib = async (ids) => page.evaluate(async (ids) => { const { ACTIVITIES } = await import('./js/data.js'); return ids.map((id) => ACTIVITIES.find((a) => a.id === id)); }, ids);
  const pinIds = async () => page.locator('.pin').evaluateAll((els) => els.map((e) => e.dataset.id));
  await page.getByText('Picked for Mia (5) and Leo (8)').waitFor();
  let ids = await pinIds();
  if (ids.length < 8) fail(`feed too short: ${ids.length}`);
  if (new Set(ids).size !== ids.length) fail('feed repeats an idea');
  for (const a of await lib(ids)) if (a.ages[1] < 5 || a.ages[0] > 8) fail(`feed idea not for ages 5–8: ${a.id}`);
  await page.getByRole('tab', { name: 'Rainy day' }).click();
  for (const a of await lib(await pinIds())) if (a.weather === 'dry' || a.setting === 'outside') fail(`rainy-day feed has a dry-weather idea: ${a.id}`);
  await page.getByRole('tab', { name: 'This weekend' }).click();
  for (const a of await lib(await pinIds())) if (a.setting === 'home') fail(`weekend feed should be out and about: ${a.id}`);
  await page.getByRole('tab', { name: 'Free days' }).click();
  await page.getByText(/Link the kids' school calendars in Profile/).waitFor();
  await page.getByRole('tab', { name: 'For you' }).click();
  ids = await pinIds();
  await page.getByRole('button', { name: 'Show me different ideas' }).click();
  if ((await pinIds()).join() === ids.join()) fail('"Show me different ideas" should change the feed');
  // Save from the feed → shows up in saved ideas; tap a pin → its details.
  const savedId = (await pinIds())[0];
  await page.locator(`.pin[data-id="${savedId}"] .pin-fav`).click();
  if ((await page.locator(`.pin[data-id="${savedId}"] .pin-fav`).getAttribute('aria-pressed')) !== 'true') fail('heart did not toggle');
  await page.locator(`.pin[data-id="${savedId}"] .pin-main`).click();
  await page.locator('#sheet-body').getByRole('heading', { level: 2 }).waitFor();
  await page.keyboard.press('Escape');
  await page.screenshot({ path: `${SHOTS}/10-discover.png`, fullPage: true });

  // ---------- Profile ----------
  await page.locator('.tabbar').getByRole('link', { name: 'Profile' }).click();
  await page.getByRole('heading', { name: 'Mathur family' }).waitFor();
  await page.locator('.kid-row', { hasText: 'Mia · 5' }).getByText('No school linked').waitFor();
  await page.locator('.kid-row', { hasText: 'Leo · 8' }).waitFor();
  // Share toggle is remembered.
  await page.locator('#share-toggle').check();
  if (!(await page.evaluate(() => window.__littleroam.store.get().shareNearby))) fail('share toggle not saved');
  await page.locator('#share-toggle').uncheck();
  // MCP sheet on static hosting explains it needs the server.
  await page.getByRole('button', { name: /Use in Claude or ChatGPT/ }).click();
  await page.getByText(/MCP server runs with the full LittleRoam server/).waitFor();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: /Backup & your data/ }).click();
  await page.getByRole('button', { name: /Export backup/ }).waitFor();
  await page.keyboard.press('Escape');

  // ---------- Link a school: Grand Ridge (calendar link) for Leo ----------
  const GR_ICS = ['BEGIN:VCALENDAR', 'VERSION:2.0',
    'BEGIN:VEVENT', 'DTSTART;VALUE=DATE:20261009', 'DTEND;VALUE=DATE:20261010', 'SUMMARY:No School - Professional Learning Day', 'END:VEVENT',
    'BEGIN:VEVENT', 'DTSTART:20261014T133000', 'DTEND:20261014T150000', 'SUMMARY:Early Release', 'END:VEVENT',
    'BEGIN:VEVENT', 'DTSTART;VALUE=DATE:20261013', 'SUMMARY:Picture Day', 'END:VEVENT',
    'BEGIN:VEVENT', 'DTSTART;VALUE=DATE:20261111', 'SUMMARY:Veterans Day - No School', 'END:VEVENT',
    'END:VCALENDAR'].join('\r\n');
  await page.route('https://calendar.grandridge.example/**', (r) => r.fulfill({ contentType: 'text/calendar', headers: { 'access-control-allow-origin': '*' }, body: GR_ICS }));
  await page.route('https://school.example/page', (r) => r.fulfill({ contentType: 'text/html', headers: { 'access-control-allow-origin': '*' }, body: '<html>Calendar</html>' }));
  await page.route('https://blocked.example/**', (r) => r.abort());
  await page.locator('.kid-row', { hasText: 'Leo · 8' }).getByRole('button', { name: 'Link school' }).click();
  await page.getByRole('heading', { name: "Link Leo's school" }).waitFor();
  // Photo reading needs AI: explained, not offered.
  await page.getByText(/Reading photos uses AI/).waitFor();
  if (await page.locator('#photo-file').count()) fail('photo option shown without AI');
  await page.fill('[name=url]', 'https://calendar.grandridge.example/feed.ics');
  await page.getByRole('button', { name: 'Link', exact: true }).click();
  await page.getByText('Add the school name first.').waitFor();
  await page.fill('[name=school]', 'Grand Ridge Elementary');
  await page.fill('[name=url]', 'not a link');
  await page.getByRole('button', { name: 'Link', exact: true }).click();
  await page.getByText(/starts with https:\/\/ or webcal/).waitFor();
  await page.fill('[name=url]', 'https://school.example/page');
  await page.getByRole('button', { name: 'Link', exact: true }).click();
  await page.getByText(/isn't a calendar file/).waitFor();
  await page.fill('[name=url]', 'https://blocked.example/feed.ics');
  await page.getByRole('button', { name: 'Link', exact: true }).click();
  await page.getByText(/can't be read from the browser/).waitFor();
  await page.fill('[name=url]', 'webcal://calendar.grandridge.example/feed.ics');
  await page.getByRole('button', { name: 'Link', exact: true }).click();
  await page.getByRole('heading', { name: 'Grand Ridge Elementary' }).waitFor();
  await page.getByText(/4 upcoming dates/).first().waitFor();
  const coming = await page.locator('#sheet-body .cls-row').allInnerTexts();
  if (!coming[0].includes('No School - Professional Learning Day') || !coming[0].includes('No school')) fail('first coming-up date should be the day off: ' + coming[0]);
  if (!coming.some((t) => t.includes('Early release'))) fail('early release not recognised');
  if ((await page.evaluate(() => window.__littleroam.store.get().schools[0].url)) !== 'https://calendar.grandridge.example/feed.ics') fail('webcal link should be stored as https');
  await page.keyboard.press('Escape');
  await page.locator('.kid-row', { hasText: 'Leo · 8' }).getByText(/Calendar linked/).waitFor();
  await page.screenshot({ path: `${SHOTS}/11-profile.png`, fullPage: true });

  // ---------- Synergy Learning Academy (calendar file) for Mia ----------
  await page.locator('.kid-row', { hasText: 'Mia · 5' }).getByRole('button', { name: 'Link school' }).click();
  await page.fill('[name=school]', 'Synergy Learning Academy');
  await page.setInputFiles('#ics-file', { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') });
  await page.getByText(/isn't a calendar file/).waitFor();
  const SLA_ICS = 'BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nDTSTART;VALUE=DATE:20261023\r\nSUMMARY:School Closed - Staff Training\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nDTSTART:20261030T100000\r\nDTEND:20261030T113000\r\nSUMMARY:Pumpkin patch field trip\r\nEND:VEVENT\r\nEND:VCALENDAR';
  await page.setInputFiles('#ics-file', { name: 'synergy.ics', mimeType: 'text/calendar', buffer: Buffer.from(SLA_ICS) });
  await page.getByRole('heading', { name: 'Synergy Learning Academy' }).waitFor();
  await page.getByText(/Calendar file imported/).first().waitFor();
  if (await page.locator('#sc-refresh').count()) fail('an imported file cannot be refreshed');
  await page.keyboard.press('Escape');

  // ---------- School dates show up across the app ----------
  await page.locator('.tabbar').getByRole('link', { name: 'Plan' }).click();
  await page.getByText(/No school Fri,? 9 Oct for Leo · Grand Ridge Elementary/).waitFor();
  await page.getByRole('tab', { name: /Kids/ }).click();
  await page.getByRole('heading', { name: 'School this week' }).waitFor();
  const wkSchool = await page.locator('.school-list').innerText();
  for (const t of ['No School - Professional Learning Day', 'Grand Ridge Elementary · Leo']) if (!wkSchool.includes(t)) fail(`School this week missing ${t}`);
  if (wkSchool.includes('Early Release')) fail('next week\'s early release should not be in this week');
  await page.locator('#day-off').click();
  await page.getByRole('heading', { name: 'Discover', exact: true }).waitFor();
  if ((await page.getByRole('tab', { name: 'Free days' }).getAttribute('aria-selected')) !== 'true') fail('day-off notice should open Free days');
  const freeList = await page.locator('#view .class-list').innerText();
  for (const t of ['No School - Professional Learning Day', 'School Closed - Staff Training', 'Veterans Day - No School']) if (!freeList.includes(t)) fail(`Free days missing ${t}`);
  if (freeList.includes('Picture Day') || freeList.includes('field trip')) fail('ordinary school events are not days off');
  for (const a of await lib(await pinIds())) if (a.mins < 60) fail(`free-day ideas should be bigger: ${a.id}`);

  // Unlink, and editing the family keeps schools with the right child.
  await page.locator('.tabbar').getByRole('link', { name: 'Profile' }).click();
  await page.getByRole('button', { name: 'Edit' }).click();
  await page.locator('.kid', { has: page.locator('input[value=Mia]') }).getByRole('button', { name: 'Remove child' }).click();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.locator('.kid-row', { hasText: 'Leo · 8' }).getByText('Grand Ridge Elementary').waitFor();
  const after = await page.evaluate(() => window.__littleroam.store.get());
  if (after.schools.length !== 1 || after.schools[0].kid !== '0' || after.schools[0].name !== 'Grand Ridge Elementary') fail('school should follow Leo: ' + JSON.stringify(after.schools));
  if (after.classes.find((c) => c.title === 'Football').kid !== '0') fail("Leo's class should follow Leo");
  if (after.classes.find((c) => c.title === 'Swimming').kid !== '') fail("Mia's class should become everyone's when Mia is removed");
  await page.locator('.kid-row').getByRole('button', { name: 'Manage' }).click();
  await page.getByRole('button', { name: /Unlink Grand Ridge/ }).click();
  await page.locator('.kid-row').getByText('No school linked').waitFor();
  await page.goto(BASE + '#home');
  if (await page.locator('#day-off').count()) fail('day-off notice should go once unlinked');

  // Plus
  await page.evaluate(() => (location.hash = 'profile'));
  await page.locator('#plus-btn').click();
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

  for (const h of ['home', 'discover', 'profile', 'weekend', 'ideas', 'memories']) {
    await page.evaluate((x) => (location.hash = x), h);
    await page.waitForFunction((x) => document.body.dataset.view === x, h);
    if (await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)) fail(`horizontal overflow on mobile: #${h}`);
  }
  for (const h of ['discover', 'profile']) {
    await dark.goto(BASE + '#' + h);
    await dark.waitForTimeout(300);
    await dark.screenshot({ path: `${SHOTS}/12-dark-${h}.png` });
  }
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
