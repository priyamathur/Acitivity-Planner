// Validation of model output before it reaches families (needs worker/ deps: `cd worker && npm install`).
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalisePicks, normaliseCustom, buildUserPrompt } from '../worker/src/ai.js';

const empty = { title: '', emoji: '', cat: '', minAge: 0, maxAge: 0, mins: 0, setting: '', energy: '', mess: 0, materials: [], steps: [], skills: [], tip: '' };
let n = 0;
const uid = () => `t${++n}`;

test('drops unknown ids, duplicates and places not in the list', () => {
  const r = normalisePicks({ message: 'Hi', picks: [
    { activityId: 'hike', why: 'w', placeName: 'Discovery Park', custom: empty },
    { activityId: 'hike', why: 'dup', placeName: '', custom: empty },
    { activityId: 'made-up', why: 'x', placeName: '', custom: empty },
    { activityId: 'picnic', why: 'y', placeName: 'Imaginary Lake', custom: empty },
  ] }, { maxCustom: 1, placeNames: new Set(['Discovery Park']), uid });
  assert.deepEqual(r.picks.map((p) => [p.activityId, p.placeName]), [['hike', 'Discovery Park'], ['picnic', '']]);
});

test('custom ideas are capped and clamped to safe ranges', () => {
  const custom = { title: 'Moon jump', emoji: '🌙🌙🌙', cat: 'bogus', minAge: -4, maxAge: 99, mins: 9999, setting: 'space', energy: 'wild', mess: 7, materials: [], steps: ['One', 'Two'], skills: [], tip: '' };
  const r = normalisePicks({ picks: [
    { activityId: '', why: 'a', placeName: '', custom },
    { activityId: '', why: 'b', placeName: '', custom },
  ] }, { maxCustom: 1, placeNames: new Set(), uid });
  assert.equal(r.picks.length, 1);
  const c = r.picks[0].custom;
  assert.deepEqual([c.cat, c.ages, c.mins, c.setting, c.energy, c.mess], ['together', [0, 12], 600, 'home', 'calm', 2]);
  assert.equal([...c.emoji].length, 2);
  assert.ok(c.id.startsWith('ai-') && c.ai);
});

test('custom ideas without real steps are rejected', () => {
  assert.equal(normaliseCustom({ ...empty, title: 'Vague', steps: ['Just play'] }, 'x'), null);
  assert.equal(normaliseCustom(null, 'x'), null);
});

test('prompt only claims popularity when there is data', () => {
  const base = { ages: [4], maxMins: 60, place: 'home', energy: 'calm', when: 'Monday', season: 'Autumn', weather: '', recentIds: [], favIds: [], places: [], maxCustom: 1, question: '' };
  assert.match(buildUserPrompt({ ...base, trends: [] }), /no data yet/);
  assert.match(buildUserPrompt({ ...base, trends: [{ activity: 'hike', families: 4 }] }), /hike \(4 families\)/);
});

test('popularity claims are removed unless the activity is really trending', () => {
  const picks = [
    { activityId: 'hike', why: 'Popular with families near you!', placeName: '', custom: empty },
    { activityId: 'picnic', why: 'Popular with 4 families near you.', placeName: '', custom: empty },
    { activityId: 'kindness-mission', why: 'A gentle way to end the day.', placeName: '', custom: empty },
  ];
  const r = normalisePicks({ picks }, { maxCustom: 0, placeNames: new Set(), trendIds: new Set(['picnic']), uid });
  assert.deepEqual(r.picks.map((p) => p.why), ['', 'Popular with 4 families near you.', 'A gentle way to end the day.']);
});
