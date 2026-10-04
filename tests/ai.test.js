// Validation of model output before it reaches families (needs worker/ deps: `cd worker && npm install`).
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalisePicks, normaliseCustom, buildUserPrompt } from '../worker/src/ai.js';

const windows = [{ id: 'sat@10:15', mins: 135 }, { id: 'sat@16:15', mins: 105 }, { id: 'sun@09:00', mins: 210 }, { id: 'sun@13:30', mins: 270 }];
const empty = { title: '', emoji: '', cat: '', minAge: 0, maxAge: 0, mins: 0, setting: '', energy: '', mess: 0, materials: [], steps: [], skills: [], tip: '' };
let n = 0;
const uid = () => `t${++n}`;

test('drops unknown ids/windows, duplicates, overlong picks and unlisted places', () => {
  const r = normalisePicks({ message: 'Hi', picks: [
    { windowId: 'sun@09:00', activityId: 'hike', why: 'w', placeName: 'Discovery Park', custom: empty },
    { windowId: 'sun@13:30', activityId: 'hike', why: 'dup activity', placeName: '', custom: empty },
    { windowId: 'sun@09:00', activityId: 'picnic', why: 'dup window', placeName: '', custom: empty },
    { windowId: 'sat@10:15', activityId: 'made-up', why: 'x', placeName: '', custom: empty },
    { windowId: 'mon@09:00', activityId: 'volcano', why: 'bad window', placeName: '', custom: empty },
    { windowId: 'sat@16:15', activityId: 'zoo-day', why: '180 min > 105', placeName: '', custom: empty },
    { windowId: 'sat@10:15', activityId: 'picnic', why: 'y', placeName: 'Imaginary Lake', custom: empty },
  ] }, { maxCustom: 1, placeNames: new Set(['Discovery Park']), windows, uid });
  assert.deepEqual(r.picks.map((p) => [p.windowId, p.activityId, p.placeName]), [['sun@09:00', 'hike', 'Discovery Park'], ['sat@10:15', 'picnic', '']]);
});

test('custom ideas are capped and clamped to safe ranges and their window', () => {
  const custom = { title: 'Moon jump', emoji: '🌙🌙🌙', cat: 'bogus', minAge: -4, maxAge: 99, mins: 9999, setting: 'space', energy: 'wild', mess: 7, materials: [], steps: ['One', 'Two'], skills: [], tip: '' };
  const r = normalisePicks({ picks: [
    { windowId: 'sat@16:15', activityId: '', why: 'a', placeName: '', custom },
    { windowId: 'sun@09:00', activityId: '', why: 'b', placeName: '', custom },
  ] }, { maxCustom: 1, placeNames: new Set(), windows, uid });
  assert.equal(r.picks.length, 1);
  const c = r.picks[0].custom;
  assert.deepEqual([c.cat, c.ages, c.mins, c.setting, c.energy, c.mess], ['together', [0, 12], 105, 'home', 'calm', 2]);
  assert.equal([...c.emoji].length, 2);
  assert.ok(c.id.startsWith('ai-') && c.ai);
});

test('custom ideas without real steps are rejected', () => {
  assert.equal(normaliseCustom({ ...empty, title: 'Vague', steps: ['Just play'] }, 'x'), null);
  assert.equal(normaliseCustom(null, 'x'), null);
});

test('prompt lists windows and bookings, and only claims popularity when there is data', () => {
  const base = { ages: [4], vibe: 'mix', season: 'Autumn', note: '', recentIds: [], favIds: [], places: [], maxCustom: 1,
    days: [{ label: 'Saturday 10 Oct', weather: 'Rain', booked: ['Swimming 09:00–10:00'], windows: [{ id: 'sat@10:15', start: '10:15', end: '12:30', mins: 135 }] }] };
  const p = buildUserPrompt({ ...base, trends: [] });
  assert.match(p, /\[sat@10:15\] 10:15–12:30 \(135 min\)/);
  assert.match(p, /Already booked: Swimming 09:00–10:00/);
  assert.match(p, /no data yet/);
  assert.match(buildUserPrompt({ ...base, trends: [{ activity: 'hike', families: 4 }] }), /hike \(4 families\)/);
});

test('popularity claims are removed unless the activity is really trending', () => {
  const picks = [
    { windowId: 'sun@09:00', activityId: 'hike', why: 'Popular with families near you!', placeName: '', custom: empty },
    { windowId: 'sun@13:30', activityId: 'picnic', why: 'Popular with 4 families near you.', placeName: '', custom: empty },
    { windowId: 'sat@10:15', activityId: 'kindness-mission', why: 'A gentle way to end the day.', placeName: '', custom: empty },
  ];
  const r = normalisePicks({ picks }, { maxCustom: 0, placeNames: new Set(), windows, trendIds: new Set(['picnic']), uid });
  assert.deepEqual(r.picks.map((p) => p.why), ['', 'Popular with 4 families near you.', 'A gentle way to end the day.']);
});
