// Production resilience: keyboard-only use, offline (service worker), time zones far from UTC,
// failing and slow APIs, and load time on a throttled phone.
// Usage: node tests/resilience.mjs   (needs `playwright` resolvable, e.g. NODE_PATH=$(npm root -g))
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const PORT = 8768;
const BASE = `http://localhost:${PORT}/`;
const server = spawn('python3', ['-m', 'http.server', String(PORT)], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 800));
const out = [];
const ok = (m) => out.push('PASS ' + m);
const bad = (m) => out.push('FAIL ' + m);
const seed = { onboarded: true, family: { name: 'Mathur', kids: [{ name: 'Mia', birthYear: 2021 }, { name: 'Leo', birthYear: 2018 }] }, location: { lat: 47.53, lon: -122.03, label: 'Issaquah' }, classes: [{ id: 'c1', title: 'Swimming', kid: '0', days: ['sat'], start: '09:00', end: '10:00', repeat: 'weekly' }] };

try {
  const browser = await chromium.launch();
  const mk = async (opts = {}, { fixed = '2026-10-07T10:00:00', state = seed, routes = true } = {}) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'en-GB', ...opts });
    if (fixed) await ctx.clock.setFixedTime(new Date(fixed));
    await ctx.route('https://fonts.googleapis.com/**', (r) => r.fulfill({ contentType: 'text/css', body: '' }));
    if (routes) {
      await ctx.route('https://api.open-meteo.com/**', (r) => r.fulfill({ json: { daily: { time: ['2026-10-10'], weather_code: [0], temperature_2m_max: [18], precipitation_probability_max: [0] }, daily_units: { temperature_2m_max: '°C' } } }));
    }
    if (state) await ctx.addInitScript((s) => { if (!localStorage.getItem('littleroam:v1')) localStorage.setItem('littleroam:v1', JSON.stringify(s)); }, state);
    const page = await ctx.newPage();
    page.errs = [];
    page.on('pageerror', (e) => page.errs.push(e.message));
    return { ctx, page };
  };

  // 1) Keyboard only: reach the tabs, open a sheet, focus lands in it, Tab stays in it, Escape returns focus.
  {
    const { ctx, page } = await mk();
    await page.goto(BASE + '#home');
    let reachedTab = false;
    for (let i = 0; i < 60 && !reachedTab; i++) {
      await page.keyboard.press('Tab');
      reachedTab = await page.evaluate(() => document.activeElement?.closest?.('.tabbar') != null);
    }
    reachedTab ? ok('keyboard reaches the tab bar') : bad('keyboard cannot reach the tab bar');
    const focusRing = await page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle);
    focusRing !== 'none' ? ok('visible focus ring on focused tab') : bad('no visible focus ring');
    await page.goto(BASE + '#profile');
    await page.locator('#edit-family').focus();
    await page.keyboard.press('Enter');
    await page.waitForTimeout(250);
    (await page.evaluate(() => document.activeElement?.id)) === 'sheet-title' ? ok('focus moves into an opened sheet') : bad('focus not moved into sheet');
    let escaped = false;
    for (let i = 0; i < 25; i++) { await page.keyboard.press('Tab'); if (!(await page.evaluate(() => document.querySelector('.sheet-panel').contains(document.activeElement)))) escaped = true; }
    !escaped ? ok('Tab stays inside the sheet') : bad('Tab escapes the sheet');
    await page.keyboard.press('Shift+Tab');
    (await page.evaluate(() => document.querySelector('.sheet-panel').contains(document.activeElement))) ? ok('Shift+Tab stays inside the sheet') : bad('Shift+Tab escapes');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);
    (await page.evaluate(() => document.activeElement?.id)) === 'edit-family' ? ok('Escape returns focus to the button that opened the sheet') : bad('focus not returned after close');
    (await page.locator('.sheet-panel').getAttribute('aria-labelledby')) === 'sheet-title' ? ok('sheet dialog is named after its heading') : bad('dialog unnamed');
    // Discover and ideas: Enter on a pin opens details.
    await page.goto(BASE + '#discover');
    await page.locator('.pin-main').first().focus();
    await page.keyboard.press('Enter');
    await page.locator('#sheet-body .detail').waitFor({ timeout: 3000 }).then(() => ok('Enter on a feed card opens it'), () => bad('Enter on a feed card does nothing'));
    page.errs.length ? bad('keyboard: page errors ' + page.errs.join('|')) : ok('keyboard run: no page errors');
    await ctx.close();
  }

  // 2) Offline: after one visit the app (and saved data) open with no network.
  {
    const { ctx, page } = await mk({}, { fixed: null });
    await page.goto(BASE + '#home');
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload();
    await page.waitForTimeout(500);
    const ctrl = await page.evaluate(() => Boolean(navigator.serviceWorker.controller));
    ctrl ? ok('service worker installed and controlling the page') : bad('service worker not controlling');
    await ctx.setOffline(true);
    for (const v of ['home', 'discover', 'profile', 'weekend', 'ideas']) {
      await page.goto(BASE + '#' + v).catch((e) => bad(`offline #${v}: ${e.message}`));
      await page.waitForTimeout(300);
      const has = await page.evaluate(() => document.getElementById('view')?.children.length > 0);
      has ? ok(`offline: #${v} works`) : bad(`offline: #${v} blank`);
    }
    // Planning the weekend works offline (on-device engine).
    await page.goto(BASE + '#weekend');
    await page.getByRole('button', { name: /Plan our weekend/ }).click();
    await page.locator('.tl-act').first().waitFor({ timeout: 4000 }).then(() => ok('offline: weekend plan made on the phone'), () => bad('offline: cannot plan weekend'));
    // Offline place search explains itself.
    await page.goto(BASE + '#near');
    await page.waitForTimeout(1500);
    const placeMsg = await page.locator('#places').innerText();
    /offline/i.test(placeMsg) && !/Failed to fetch/.test(placeMsg) ? ok('offline: places show a clear message: ' + placeMsg.split('\n')[0]) : bad('offline: places message unclear: ' + placeMsg.slice(0, 80));
    page.errs.length ? bad('offline: page errors ' + page.errs.join('|')) : ok('offline: no page errors');
    await ctx.close();
  }

  // 3) Time zones: weekend dates and "today" are right far from UTC, incl. late-night and Sunday.
  for (const [tz, when, expect] of [
    ['America/Los_Angeles', '2026-10-07T23:30:00-07:00', '10 Oct – 11 Oct'],
    ['Asia/Kolkata', '2026-10-08T00:30:00+05:30', '10 Oct – 11 Oct'],
    ['Pacific/Auckland', '2026-10-11T22:00:00+13:00', '10 Oct – 11 Oct'],
    ['America/New_York', '2026-12-31T23:30:00-05:00', '2 Jan – 3 Jan'],
  ]) {
    const { ctx, page } = await mk({ timezoneId: tz }, { fixed: when });
    await page.goto(BASE + '#weekend');
    const t = await page.locator('.wk-head .eyebrow').innerText().catch(() => '');
    t.includes(expect) ? ok(`${tz} ${when}: weekend ${t}`) : bad(`${tz} ${when}: expected ${expect}, got ${t}`);
    const today = await page.evaluate(() => window.__littleroam.store.isoDate());
    today === when.slice(0, 10) ? ok(`${tz}: today is ${today}`) : bad(`${tz}: today ${today} != ${when.slice(0, 10)}`);
    page.errs.length && bad(`${tz}: errors ${page.errs.join('|')}`);
    await ctx.close();
  }

  // 4) Failing networks: weather and map APIs down or slow, server errors.
  {
    const { ctx, page } = await mk({}, { routes: false });
    await ctx.route('https://api.open-meteo.com/**', (r) => r.fulfill({ status: 500, body: 'down' }));
    await ctx.route('https://overpass-api.de/**', (r) => r.fulfill({ status: 429, body: 'busy' }));
    await ctx.route('**/api/health', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<html>captive portal</html>' }));
    await page.goto(BASE + '#home');
    await page.waitForTimeout(600);
    (await page.locator('.home-list .act').count()) === 5 ? ok('weather down: Home still shows ideas') : bad('weather down breaks Home');
    await page.goto(BASE + '#near');
    await page.waitForTimeout(1500);
    const msg = await page.locator('#places').innerText();
    /try again|busy|couldn|could not/i.test(msg) ? ok('map API 429: clear message + retry: ' + msg.split('\n')[0]) : bad('map API 429 message: ' + msg.slice(0, 80));
    (await page.locator('#retry').count()) ? ok('retry button offered') : bad('no retry button');
    page.errs.length ? bad('network failures: errors ' + page.errs.join('|')) : ok('network failures: no page errors');
    await ctx.close();
  }
  {
    // Slow map API: the user can leave and nothing breaks when the answer arrives late.
    const { ctx, page } = await mk();
    await ctx.route('https://overpass-api.de/**', async (r) => { await new Promise((res) => setTimeout(res, 3000)); r.fulfill({ json: { elements: [] } }); });
    await page.goto(BASE + '#near');
    await page.waitForTimeout(300);
    await page.goto(BASE + '#discover');
    await page.waitForTimeout(3500);
    (await page.getByRole('heading', { name: 'Discover', exact: true }).count()) ? ok('late map answer does not hijack another screen') : bad('late answer replaced screen');
    page.errs.length ? bad('slow API errors ' + page.errs.join('|')) : ok('slow API: no page errors');
    await ctx.close();
  }

  // 5) Performance: page weight and load time on a throttled phone network.
  {
    const { ctx, page } = await mk({}, { fixed: null });
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 });
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    let bytes = 0;
    page.on('response', async (r) => { try { if (r.url().startsWith(BASE)) bytes += (await r.body()).length; } catch {} });
    const t0 = Date.now();
    await page.goto(BASE + '#home', { waitUntil: 'load' });
    await page.locator('.home-list .act').first().waitFor();
    const ms = Date.now() - t0;
    const fcp = await page.evaluate(() => performance.getEntriesByName('first-contentful-paint')[0]?.startTime || 0);
    out.push(`INFO slow 3G-ish + 4x CPU: ideas visible after ${ms} ms, first paint ${Math.round(fcp)} ms, ${Math.round(bytes / 1024)} KB of app files (uncompressed)`);
    ms < 6000 ? ok('loads under 6 s on a slow phone connection') : bad(`slow load: ${ms} ms`);
    const t1 = Date.now();
    for (const v of ['discover', 'profile', 'home']) { await page.evaluate((x) => (location.hash = x), v); await page.waitForFunction((x) => document.body.dataset.view === x, v); }
    out.push(`INFO tab switches (3, throttled CPU): ${Date.now() - t1} ms total`);
    await ctx.close();
  }

  console.log(out.join('\n'));
  const failed = out.filter((x) => x.startsWith('FAIL')).length;
  console.log(failed ? `RESILIENCE FAILED: ${failed} of ${out.filter((x) => /^(PASS|FAIL)/.test(x)).length}` : `RESILIENCE PASSED (${out.filter((x) => x.startsWith('PASS')).length} checks)`);
  if (failed) process.exitCode = 1;
  await browser.close();
} finally {
  server.kill();
}
