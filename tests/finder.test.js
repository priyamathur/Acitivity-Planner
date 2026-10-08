import test from 'node:test';
import assert from 'node:assert/strict';
import { gradesMentioned, forGrade, extractCalendarLinks, schoolKey, schoolEventsBetween } from '../js/school.js';
import { buildSchoolQuery, parseSchools } from '../js/near.js';
import { learnTaste, tasteBoost, because, topCategories, traitsOf } from '../js/taste.js';
import { recommend } from '../js/planner.js';
import { ACTIVITIES } from '../js/data.js';

const byId = Object.fromEntries(ACTIVITIES.map((a) => [a.id, a]));

test('grade filter: district calendars only show what applies to the child', () => {
  const ev = (title) => ({ date: '2026-10-09', end: '2026-10-09', title, kind: 'off' });
  const all = ['No School - Professional Learning Day', 'No school for kindergarten - conferences', 'Grades 6-12 early release', 'High School graduation', 'Middle school picture day', '3rd grade field trip', 'K-5 conferences, no school', 'Preschool closed', 'Elementary early release', 'Seniors last day', 'Grade 2 & 3 music concert'].map(ev);
  const titles = (g) => forGrade(all, g).map((e) => e.title);
  assert.deepEqual(titles('k'), ['No School - Professional Learning Day', 'No school for kindergarten - conferences', 'K-5 conferences, no school', 'Elementary early release']);
  assert.deepEqual(titles('3'), ['No School - Professional Learning Day', '3rd grade field trip', 'K-5 conferences, no school', 'Elementary early release', 'Grade 2 & 3 music concert']);
  assert.deepEqual(titles('prek'), ['No School - Professional Learning Day', 'Preschool closed']);
  assert.deepEqual(titles('7'), ['No School - Professional Learning Day', 'Grades 6-12 early release', 'Middle school picture day']);
  assert.equal(forGrade(all, '').length, all.length, 'no grade → everything');
  assert.equal(gradesMentioned('Thanksgiving break'), null);
  assert.equal(gradesMentioned('Pre-Kindergarten open house').has(-1), true);
  assert.equal(gradesMentioned('Pre-Kindergarten open house').has(0), false, 'pre-K is not kindergarten');
  // Linked schools respect the grade everywhere the app reads them.
  const schools = [{ name: 'Grand Ridge', kid: '1', grade: '2', events: all }];
  assert.ok(!schoolEventsBetween(schools, '2026-10-01', '2026-10-31').some((e) => /kindergarten|High School/.test(e.title)));
});

test('finding calendar feeds on a school website', () => {
  const html = `<html><body>
    <a href="/about">About</a>
    <a href="/our-school/upcoming-events/calendar">School Calendar</a>
    <a href="https://www.district.org/about-us/calendars">District calendars 2026-27</a>
    <a href="/news">News &amp; events</a>
    <a href="https://facebook.com/school">Facebook</a>
    <a href="webcal://grandridge.district.org/calendar.ics">Subscribe</a>
    <iframe src="https://calendar.google.com/calendar/embed?src=abc123%40group.calendar.google.com&amp;ctz=America%2FLos_Angeles"></iframe>
    <a href="/events/feed.ics?cat=all">iCal</a>
    <a href="javascript:void(0)">x</a>
  </body></html>`;
  const { feeds, pages } = extractCalendarLinks(html, 'https://grandridge.district.org/');
  assert.deepEqual(feeds, [
    'https://grandridge.district.org/calendar.ics',
    'https://grandridge.district.org/events/feed.ics?cat=all',
    'https://calendar.google.com/calendar/ical/abc123%40group.calendar.google.com/public/basic.ics',
  ]);
  assert.equal(pages[0], 'https://www.district.org/about-us/calendars', 'district calendar page ranks first');
  assert.ok(pages.includes('https://grandridge.district.org/our-school/upcoming-events/calendar'));
  assert.ok(!pages.some((p) => p.includes('facebook')), 'other sites are not crawled');
  assert.deepEqual(extractCalendarLinks('<p>nothing here</p>', 'https://a.org/'), { feeds: [], pages: [] });
  assert.equal(schoolKey('Grand Ridge Elementary School', '953:-2447'), schoolKey('grand ridge elementary', '953:-2447'));
});

test('school search by name: typos in spacing, town typed in, closest + best match first', () => {
  const q = buildSchoolQuery('Grandridge elementary issaquah', 47.53, -122.03);
  const re = new RegExp(q.match(/\["name"~"([^"]+)",i\]/)[1], 'i');
  for (const n of ['Grand Ridge Elementary School', 'Grandridge Elementary']) assert.ok(re.test(n), n);
  assert.match(q, /"amenity"~"\^\(school\|kindergarten\|childcare\)\$"/);
  assert.doesNotMatch(buildSchoolQuery('a"];out;(node(1)', 0, 0), /\(node\(1\)/, 'quotes and brackets are stripped');
  const json = { elements: [
    { type: 'node', id: 1, lat: 47.54, lon: -122.03, tags: { name: 'Grand Ridge Plaza Daycare', amenity: 'childcare' } },
    { type: 'way', id: 2, center: { lat: 47.55, lon: -122.02 }, tags: { name: 'Grand Ridge Elementary School', amenity: 'school', website: 'grandridge.isd411.org', operator: 'Issaquah School District' } },
    { type: 'way', id: 3, center: { lat: 47.55, lon: -122.02 }, tags: { name: 'Grand Ridge Elementary School', amenity: 'school' } },
    { type: 'node', id: 4, lat: 47.53, lon: -122.03, tags: { amenity: 'school' } },
  ] };
  const out = parseSchools(json, { lat: 47.53, lon: -122.03 }, 'Grandridge elementary');
  assert.deepEqual(out.map((s) => s.name), ['Grand Ridge Elementary School', 'Grand Ridge Plaza Daycare'], 'best match first, duplicates and unnamed dropped');
  assert.equal(out[0].website, 'https://grandridge.isd411.org/');
  assert.equal(out[0].district, 'Issaquah School District');
  assert.equal(out[1].kind, 'preschool');
});

test('taste: saves and memories lift similar ideas, swaps lower them', () => {
  const empty = learnTaste({}, byId);
  assert.equal(empty.strength, 0);
  assert.equal(tasteBoost(byId.volcano, empty), 0, 'no signals → no effect');

  const messyScience = ACTIVITIES.filter((a) => a.cat === byId.volcano.cat && a.id !== 'volcano');
  const state = { favs: ['volcano'], memories: [{ activityId: messyScience[0].id, mood: '😍' }], weekends: {} };
  const t = learnTaste(state, byId);
  assert.ok(t.strength >= 2);
  const similar = messyScience[1];
  const different = ACTIVITIES.find((a) => a.cat !== byId.volcano.cat && a.setting !== byId.volcano.setting && a.energy !== byId.volcano.energy);
  assert.ok(tasteBoost(similar, t) > tasteBoost(different, t), 'a similar idea scores higher than an unrelated one');
  assert.ok(Math.abs(tasteBoost(similar, t)) <= 4, 'boost is capped');
  assert.ok(topCategories(t).includes(byId.volcano.cat));
  const b = because(similar, t, byId);
  assert.ok(b && ['Kitchen volcano', messyScience[0].title].includes(b.title), JSON.stringify(b));

  // Swapping something away counts against its kind.
  const swapped = learnTaste({ weekends: { w: { picks: {}, swapped: { x: [different.id, different.id, different.id] } } } }, byId);
  assert.equal(swapped.strength, 0);
  assert.equal(tasteBoost(different, swapped), 0, 'negative-only history has no strength yet');
  const mixed = learnTaste({ favs: ['volcano'], weekends: { w: { picks: {}, swapped: { x: [different.id, different.id] } } } }, byId);
  assert.ok(tasteBoost(different, mixed) < 0, 'swapped-away kinds are pushed down');

  // Recommendations shift toward the family's taste, but stay varied.
  const ctx = { ages: [5, 8], maxMins: 600, place: 'any', recentIds: [], favIds: [] };
  const share = (picks) => picks.filter((a) => a.cat === byId.volcano.cat).length;
  let before = 0;
  let after = 0;
  for (let seed = 1; seed <= 40; seed++) {
    before += share(recommend(ctx, { count: 8, seed }));
    after += share(recommend({ ...ctx, taste: learnTaste({ favs: ['volcano', messyScience[0].id, messyScience[1].id], memories: [{ activityId: messyScience[2]?.id || 'volcano', mood: '😍' }] }, byId) }, { count: 8, seed }));
  }
  assert.ok(after > before, `taste should raise the share of liked categories (${before} → ${after})`);
  const one = recommend({ ...ctx, taste: learnTaste({ favs: ['volcano', ...messyScience.map((a) => a.id)] }, byId) }, { count: 8, seed: 7 });
  assert.ok(new Set(one.map((a) => a.cat)).size >= 4, 'the feed keeps variety even with a strong taste');
  assert.ok(traitsOf(byId.volcano).includes(`cat:${byId.volcano.cat}`));
});

test('monthly AI budget: costs are priced from reported usage', async () => {
  const { costUsd, budgetUsd, monthKey } = await import('../worker/src/budget.js');
  // 1M output tokens on Opus 5.5 = $20; 1M input = $4; cache reads $0.20/M; writes 1.25x input; searches $0.01.
  assert.equal(costUsd('claude-opus-5-5', { output_tokens: 1e6 }), 20);
  assert.equal(costUsd('claude-opus-5-5', { input_tokens: 1e6 }), 4);
  assert.equal(costUsd('claude-opus-5-5', { cache_read_input_tokens: 1e6 }), 0.2);
  assert.equal(costUsd('claude-opus-5-5', { cache_creation_input_tokens: 1e6 }), 5);
  assert.equal(costUsd('claude-opus-5-5', { server_tool_use: { web_search_requests: 3 } }), 0.03);
  assert.equal(costUsd('claude-sonnet-5-5', { output_tokens: 1e6 }), 10);
  assert.ok(costUsd('some-new-model', { output_tokens: 1e6 }) >= 20, 'unknown models are priced high, not free');
  assert.equal(costUsd('claude-opus-5-5', undefined), 0);
  // A typical chat step (cached prompt, short answer) costs about a cent.
  const step = costUsd('claude-opus-5-5', { input_tokens: 800, cache_read_input_tokens: 6000, output_tokens: 400 });
  assert.ok(step > 0.005 && step < 0.02, String(step));
  assert.equal(budgetUsd({}), 4.5);
  assert.equal(budgetUsd({ MONTHLY_AI_BUDGET_USD: '2' }), 2);
  assert.equal(budgetUsd({ MONTHLY_AI_BUDGET_USD: 'x' }), 4.5);
  assert.match(monthKey(Date.UTC(2026, 9, 31, 23)), /^2026-10$/);
});
