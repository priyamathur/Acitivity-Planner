import test from 'node:test';
import assert from 'node:assert/strict';
import { ACTIVITIES, CATEGORIES, BUCKET_LISTS, SEASONS } from '../js/data.js';
import { recommend, planWeekend, score, weatherBucket, currentSeason, haversineKm } from '../js/planner.js';
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
  for (const k of Object.keys(SEASONS)) assert.equal(BUCKET_LISTS[k].length, 10);
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

test('planWeekend returns two items per day with no repeats', () => {
  const { sat, sun } = planWeekend({ ages: [5] }, 42);
  assert.equal(sat.length, 2);
  assert.equal(sun.length, 2);
  assert.equal(sat[0].setting, 'out');
  const ids = [...sat, ...sun].map((a) => a.id);
  assert.equal(new Set(ids).size, 4);
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
