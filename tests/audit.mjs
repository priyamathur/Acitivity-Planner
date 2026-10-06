// Production audit: accessibility (axe-core, WCAG 2.1 AA, light + dark), XSS through every
// user-controlled field, unsafe links from map data, damaged saved data, and screens from 320 px to desktop.
// Usage: node tests/audit.mjs   (needs `playwright` and `axe-core` resolvable, e.g. NODE_PATH=$(npm root -g))
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const PORT = 8767;
const BASE = `http://localhost:${PORT}/`;
const server = spawn('python3', ['-m', 'http.server', String(PORT)], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 800));
const AXE = fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
const XSS = '<img src=x onerror="window.__xss=1">';
const seed = (extra = {}) => ({
  onboarded: true,
  family: { name: 'Mathur' + XSS, kids: [{ name: 'Mia' + XSS, birthYear: 2021 }, { name: 'Leo', birthYear: 2018 }] },
  location: { lat: 47.53, lon: -122.03, label: 'Issaquah' + XSS },
  classes: [{ id: 'c1', title: 'Swimming' + XSS, kid: '0', days: ['sat'], start: '09:00', end: '10:00', where: 'Pool' + XSS, repeat: 'weekly' }],
  schools: [{ id: 's1', kid: '1', name: 'Grand Ridge' + XSS, source: 'feed', url: 'https://x.example/a.ics', updated: Date.now(), events: [{ date: '2026-10-09', end: '2026-10-09', title: 'No School' + XSS, kind: 'off' }] }],
  memories: [{ id: 'm1', date: '2026-10-03', title: 'Park' + XSS, mood: '😄', note: 'n' + XSS, quote: 'q' + XSS }],
  ...extra,
});
const results = { axe: {}, problems: [] };
const problem = (m) => { results.problems.push(m); console.log('PROBLEM:', m); };

try {
  const browser = await chromium.launch();
  async function ctxFor(state, opts = {}) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'en-GB', ...opts });
    await ctx.clock.setFixedTime(new Date('2026-10-07T10:00:00'));
    await ctx.route('https://fonts.googleapis.com/**', (r) => r.fulfill({ contentType: 'text/css', body: '' }));
    await ctx.route('https://api.open-meteo.com/**', (r) => r.fulfill({ json: { daily: { time: ['2026-10-07', '2026-10-10', '2026-10-11'], weather_code: [0, 63, 0], temperature_2m_max: [16, 12, 19], precipitation_probability_max: [0, 85, 5] }, daily_units: { temperature_2m_max: '°C' } } }));
    await ctx.route('https://overpass-api.de/**', (r) => r.fulfill({ json: { elements: [{ type: 'node', id: 1, lat: 47.53, lon: -122.03, tags: { name: 'Park' + XSS, website: 'javascript:alert(1)' } }] } }));
    if (state !== undefined) await ctx.addInitScript((s) => { if (!sessionStorage.getItem('seeded')) { localStorage.setItem('littleroam:v1', typeof s === 'string' ? s : JSON.stringify(s)); sessionStorage.setItem('seeded', '1'); } }, state);
    const page = await ctx.newPage();
    page.errors = [];
    page.on('pageerror', (e) => page.errors.push(e.message));
    return { ctx, page };
  }
  async function axe(page, label) {
    await page.addScriptTag({ content: AXE });
    const r = await page.evaluate(async () => (await window.axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] })).violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.slice(0, 3).map((n) => n.target.join(' ') + ' :: ' + (n.failureSummary || '').split('\n')[1]) })));
    results.axe[label] = r;
    for (const v of r) console.log(`AXE [${label}] ${v.impact} ${v.id}: ${v.help}\n   ${v.nodes.join('\n   ')}`);
  }

  // 1) Accessibility + XSS across every screen, light and dark.
  for (const scheme of ['light', 'dark']) {
    const { ctx, page } = await ctxFor(seed(), { colorScheme: scheme });
    for (const v of ['home', 'discover', 'profile', 'weekend', 'ideas', 'memories', 'near', 'chat']) {
      await page.goto(BASE + '#' + v);
      await page.waitForTimeout(400);
      await axe(page, `${scheme}:${v}`);
    }
    // Kids tab and key sheets
    await page.goto(BASE + '#home');
    await page.getByRole('tab', { name: 'Kids' }).click();
    await axe(page, `${scheme}:home-kids`);
    await page.goto(BASE + '#profile');
    await page.locator('[data-school="0"]').click();
    await page.waitForTimeout(300);
    await axe(page, `${scheme}:sheet-link-school`);
    await page.keyboard.press('Escape');
    await page.locator('[data-school="1"]').click();
    await page.waitForTimeout(300);
    await axe(page, `${scheme}:sheet-manage-school`);
    await page.keyboard.press('Escape');
    await page.goto(BASE + '#weekend');
    await page.locator('#add-class-top').click();
    await page.waitForTimeout(300);
    await axe(page, `${scheme}:sheet-class-form`);
    if (await page.evaluate(() => window.__xss)) problem('XSS fired');
    if (page.errors.length) problem(`${scheme} page errors: ${page.errors.join(' | ')}`);
    await ctx.close();
  }

  // 2) javascript: links from map data must not be clickable.
  {
    const { ctx, page } = await ctxFor(seed());
    await page.goto(BASE + '#near');
    await page.waitForTimeout(800);
    const hrefs = await page.locator('#places a').evaluateAll((as) => as.map((a) => a.getAttribute('href')));
    if (hrefs.some((h) => /^javascript:/i.test(h || ''))) problem('javascript: URL from map data rendered as a link: ' + hrefs.join(', '));
    await ctx.close();
  }

  // 3) Bad stored data: corrupted JSON, old-version state, wrong types.
  for (const [label, state] of [
    ['corrupt-json', '{not json'],
    ['old-v5-state', { onboarded: true, family: { name: 'Old', kids: [{ name: 'A', birthYear: 2020 }] }, classes: [{ id: 'x', title: 'Ballet', kid: '0', day: 'sat', start: '10:00', end: '11:00', repeat: 'weekly' }], weekends: {}, memories: [], favs: [] }],
    ['null-fields', { onboarded: true, family: null, classes: null, schools: null, memories: null, favs: null, weekends: null }],
    ['wrong-types', { onboarded: true, family: { name: 5, kids: 'x' }, classes: {}, schools: 'x', memories: {}, favs: 'a' }],
  ]) {
    const { ctx, page } = await ctxFor(state);
    for (const v of ['home', 'discover', 'profile', 'weekend', 'memories', 'ideas']) {
      await page.goto(BASE + '#' + v);
      await page.waitForTimeout(250);
      const empty = await page.evaluate(() => document.getElementById('view').children.length === 0);
      if (empty) problem(`${label}: #${v} rendered nothing`);
    }
    if (page.errors.length) problem(`${label}: page errors: ${[...new Set(page.errors)].join(' | ')}`);
    await ctx.close();
  }

  // 4) Small and large screens, big text.
  for (const [w, h] of [[320, 640], [360, 740], [768, 1024], [1440, 900]]) {
    const { ctx, page } = await ctxFor(seed(), { viewport: { width: w, height: h } });
    for (const v of ['home', 'discover', 'profile', 'weekend']) {
      await page.goto(BASE + '#' + v);
      await page.waitForTimeout(250);
      if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)) problem(`overflow at ${w}px on #${v}`);
    }
    await ctx.close();
  }
  {
    const { ctx, page } = await ctxFor(seed(), { viewport: { width: 375, height: 700 } });
    await page.goto(BASE + '#home');
    await page.addStyleTag({ content: 'html{font-size:150%}' });
    if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)) problem('overflow with 150% text size');
    await ctx.close();
  }

  const total = Object.values(results.axe).flat().length;
  if (total || results.problems.length) { console.error(`AUDIT FAILED: ${total} accessibility violations, ${results.problems.length} problems`); process.exitCode = 1; }
  else console.log(`AUDIT PASSED (${Object.keys(results.axe).length} screens and sheets checked, light and dark)`);
  await browser.close();
} finally {
  server.kill();
}
