import test from 'node:test';
import assert from 'node:assert/strict';
import { ACTIVITIES, CATEGORIES } from '../js/data.js';
import { recommend, score, weatherBucket, currentSeason, haversineKm, weekendDays, bookedFor, freeWindows, fillWeekend, swapPick, classKind } from '../js/planner.js';
import { buildQuery, parsePlaces, PLACE_TYPES } from '../js/near.js';

test('activity library is well-formed', () => {
  const ids = new Set();
  for (const a of ACTIVITIES) {
    assert.ok(!ids.has(a.id), `duplicate id ${a.id}`);
    ids.add(a.id);
    assert.ok(CATEGORIES[a.cat], `bad category on ${a.id}`);
    assert.ok(['home', 'outside', 'out'].includes(a.setting), a.id);
    assert.ok(['calm', 'active'].includes(a.energy), a.id);
    assert.ok(a.ages[0] <= a.ages[1], a.id);
    assert.ok(a.steps.length >= 2 && a.materials.length >= 1 && a.skills.length >= 1, a.id);
  }
  assert.ok(ACTIVITIES.length >= 50);
  for (const t of Object.values(PLACE_TYPES)) if (t.pair) assert.ok(ids.has(t.pair), `missing pair ${t.pair}`);
});

test('recommend respects time, place and age constraints', () => {
  for (let seed = 1; seed < 40; seed++) {
    const picks = recommend({ ages: [3], maxMins: 30, place: 'home', energy: 'any' }, { seed });
    assert.ok(picks.length > 0);
    for (const a of picks) {
      assert.ok(a.mins <= 30);
      assert.equal(a.setting, 'home');
      assert.ok(a.ages[0] - 1 <= 3 && a.ages[1] + 1 >= 3);
    }
  }
});

test('recommend gives 3 distinct picks and varies by seed', () => {
  const a = recommend({ maxMins: 600, place: 'any', energy: 'any' }, { seed: 1 }).map((x) => x.id);
  const b = recommend({ maxMins: 600, place: 'any', energy: 'any' }, { seed: 99 }).map((x) => x.id);
  assert.equal(new Set(a).size, 3);
  assert.notDeepEqual(a, b);
});

test('wet weather excludes dry-only outdoor activities', () => {
  const dryOutdoor = ACTIVITIES.find((x) => x.weather === 'dry' && x.setting !== 'home');
  assert.equal(score(dryOutdoor, { weather: 'wet' }), -Infinity);
});

test('weekendDays picks the right Saturday and Sunday', () => {
  // Wednesday 7 Oct 2026 → 10–11 Oct
  assert.deepEqual(weekendDays(new Date(2026, 9, 7)).map((d) => [d.date, d.past]), [['2026-10-10', false], ['2026-10-11', false]]);
  // Saturday → today and tomorrow
  assert.deepEqual(weekendDays(new Date(2026, 9, 10)).map((d) => [d.date, d.past]), [['2026-10-10', false], ['2026-10-11', false]]);
  // Sunday → Saturday is over
  assert.deepEqual(weekendDays(new Date(2026, 9, 11)).map((d) => [d.date, d.past]), [['2026-10-10', true], ['2026-10-11', false]]);
  // Next weekend
  assert.equal(weekendDays(new Date(2026, 9, 11), 1)[0].date, '2026-10-17');
});

const classes = [
  { id: 'a', title: 'Swimming', kid: '0', day: 'sat', start: '09:00', end: '10:00', repeat: 'weekly' },
  { id: 'b', title: 'Birthday party', kid: '', day: 'sat', start: '14:00', end: '16:00', repeat: 'once', date: '2026-10-10' },
  { id: 'c', title: 'Ballet', kid: '1', day: 'sun', start: '10:00', end: '11:00', repeat: 'weekly', skip: { '2026-10-11': true } },
];

test('classes: weekly, one-off and skipped weeks', () => {
  const [sat, sun] = weekendDays(new Date(2026, 9, 7));
  assert.deepEqual(bookedFor(classes, sat).map((c) => c.id), ['a', 'b']);
  assert.deepEqual(bookedFor(classes, sun).map((c) => c.id), [], 'ballet skipped this week');
  const [sat2, sun2] = weekendDays(new Date(2026, 9, 7), 1);
  assert.deepEqual(bookedFor(classes, sat2).map((c) => c.id), ['a'], 'party was one-off');
  assert.deepEqual(bookedFor(classes, sun2).map((c) => c.id), ['c']);
});

test('free windows go around classes (with travel buffer) and lunch', () => {
  const [sat] = weekendDays(new Date(2026, 9, 7));
  const w = freeWindows(bookedFor(classes, sat), 'sat');
  assert.deepEqual(w.map((x) => [x.start, x.end, x.mins, x.part]), [['10:15', '12:30', 135, 'morning'], ['16:15', '18:00', 105, 'afternoon']]);
  assert.deepEqual(freeWindows([], 'sun').map((x) => x.id), ['sun@09:00', 'sun@13:30']);
});

test('fillWeekend: one fitting activity per window, no repeats, weather-aware', () => {
  const days = [
    { key: 'sat', weather: 'wet', windows: freeWindows([], 'sat') },
    { key: 'sun', weather: 'dry', windows: freeWindows([], 'sun') },
  ];
  for (let seed = 1; seed < 30; seed++) {
    const picks = fillWeekend(days, { ages: [5], vibe: 'adventure' }, seed);
    const ids = Object.values(picks).map((p) => p.id);
    assert.equal(ids.length, 4);
    assert.equal(new Set(ids).size, 4);
    for (const day of days) for (const w of day.windows) {
      const a = ACTIVITIES.find((x) => x.id === picks[w.id].id);
      assert.ok(a.mins <= w.mins, `${a.id} fits ${w.id}`);
      if (day.weather === 'wet') assert.ok(!(a.weather === 'dry' && a.setting !== 'home'), `${a.id} is rain-friendly`);
    }
  }
  const cosy = fillWeekend(days, { ages: [5], vibe: 'cosy' }, 3);
  assert.ok(Object.values(cosy).every((p) => ACTIVITIES.find((x) => x.id === p.id).setting !== 'out'), 'cosy weekend stays close to home');
});

test('swapPick returns a different fitting activity', () => {
  const day = { key: 'sun', weather: 'dry', windows: freeWindows([], 'sun') };
  const w = day.windows[0];
  const a = swapPick(day, w, { ages: [5], vibe: 'mix', exclude: ['hike', 'scavenger'] }, 9);
  assert.ok(a && !['hike', 'scavenger'].includes(a.id) && a.mins <= w.mins);
});

test('classKind gives a generic label (what the AI sees)', () => {
  assert.deepEqual(classKind("Mia's swimming lesson"), { emoji: '🏊', kind: 'Swimming' });
  assert.equal(classKind('U7 Football').kind, 'Football');
  assert.equal(classKind('Something else').kind, 'Booked');
  assert.equal(classKind("Sam's birthday party").kind, 'Party', 'party is not Art');
  assert.equal(classKind('Art club').kind, 'Art');
  assert.equal(classKind('Solar system talk').kind, 'Booked', 'system is not STEM');
});

test('weather codes and seasons', () => {
  assert.equal(weatherBucket(0), 'dry');
  assert.equal(weatherBucket(63), 'wet');
  assert.equal(weatherBucket(81), 'wet');
  assert.equal(weatherBucket(95), 'wet');
  assert.equal(weatherBucket(73), 'snow');
  assert.equal(currentSeason(new Date(2026, 9, 4)), 'autumn');
  assert.equal(currentSeason(new Date(2026, 0, 4)), 'winter');
});

test('overpass query + parsing', () => {
  const q = buildQuery('playground', 47.6, -122.3, 5000);
  assert.match(q, /nwr\["leisure"="playground"\]\(around:5000,47.6,-122.3\);/);
  const origin = { lat: 47.6, lon: -122.3 };
  const places = parsePlaces({ elements: [
    { type: 'node', id: 1, lat: 47.61, lon: -122.3, tags: { name: 'Far Park' } },
    { type: 'way', id: 2, center: { lat: 47.601, lon: -122.3 }, tags: { name: 'Near Park', fee: 'no' } },
    { type: 'node', id: 3, lat: 47.6005, lon: -122.3, tags: {} },
    { type: 'node', id: 4, lat: 47.6005, lon: -122.3, tags: { name: 'Private', access: 'private' } },
  ] }, origin, 'park');
  assert.deepEqual(places.map((p) => p.name), ['Near Park', 'Far Park', 'Unnamed park']);
  assert.ok(Math.abs(haversineKm(origin, { lat: 47.61, lon: -122.3 }) - 1.11) < 0.02);
});

// ---------- Community privacy helpers ----------
import { cellFor, neighbourCells, isValidCell, bandsForAges } from '../js/community.js';

test('location is coarsened to a grid cell; neighbours cover edges', () => {
  const c = cellFor({ lat: 47.6062, lon: -122.3321 });
  assert.equal(c, '952:-2447');
  assert.ok(isValidCell(c));
  assert.equal(cellFor({ lat: 47.6099, lon: -122.3399 }), c, 'nearby points share a cell');
  assert.equal(neighbourCells(c).length, 9);
  assert.ok(neighbourCells(c).includes('953:-2446'));
  assert.ok(!isValidCell('47.6,-122.3'));
  assert.deepEqual(bandsForAges([2, 3, 5, 11]), ['0-3', '4-5', '9-12']);
});
