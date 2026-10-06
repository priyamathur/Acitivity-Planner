import test from 'node:test';
import assert from 'node:assert/strict';
import { parseICS, kindOf, normaliseFeedUrl, nextDayOff, cleanEvents, schoolEventsBetween } from '../js/school.js';
import { feedUrlOk } from '../worker/src/school.js';

// A school feed in the shape most calendar systems publish: folded lines,
// escaped commas, all-day events with exclusive end dates, a cancelled event.
const ICS = [
  'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//School//Calendar//EN',
  'BEGIN:VEVENT', 'UID:1', 'DTSTART;VALUE=DATE:20261009', 'DTEND;VALUE=DATE:20261010', 'SUMMARY:No School - Professional', '  Learning Day', 'END:VEVENT',
  'BEGIN:VEVENT', 'UID:2', 'DTSTART;TZID=America/Los_Angeles:20261014T133000', 'DTEND;TZID=America/Los_Angeles:20261014T150000', 'SUMMARY:Early Release', 'END:VEVENT',
  'BEGIN:VEVENT', 'UID:3', 'DTSTART;VALUE=DATE:20270215', 'DTEND;VALUE=DATE:20270220', 'SUMMARY:Mid-Winter Break', 'END:VEVENT',
  'BEGIN:VEVENT', 'UID:4', 'DTSTART:20261217T190000', 'DTEND:20261217T200000', 'SUMMARY:Holiday Concert\\, Gym', 'END:VEVENT',
  'BEGIN:VEVENT', 'UID:5', 'DTSTART;VALUE=DATE:20261020', 'SUMMARY:Book fair', 'STATUS:CANCELLED', 'END:VEVENT',
  'BEGIN:VEVENT', 'UID:6', 'DTSTART;VALUE=DATE:20250101', 'SUMMARY:Old event', 'END:VEVENT',
  'BEGIN:VEVENT', 'UID:7', 'DTSTART:20261008T170000Z', 'SUMMARY:Curriculum night', 'END:VEVENT',
  'END:VCALENDAR',
].join('\r\n');

test('parseICS reads school feeds', () => {
  const ev = parseICS(ICS, { today: '2026-10-07' });
  assert.deepEqual(ev.map((e) => e.title), ['Curriculum night', 'No School - Professional Learning Day', 'Early Release', 'Holiday Concert, Gym', 'Mid-Winter Break']);
  const off = ev.find((e) => e.title.startsWith('No School'));
  assert.deepEqual([off.date, off.end, off.kind], ['2026-10-09', '2026-10-09', 'off'], 'all-day DTEND is exclusive');
  const early = ev.find((e) => e.title === 'Early Release');
  assert.deepEqual([early.date, early.start, early.finish, early.kind], ['2026-10-14', '13:30', '15:00', 'early']);
  const brk = ev.find((e) => e.title === 'Mid-Winter Break');
  assert.deepEqual([brk.date, brk.end, brk.kind], ['2027-02-15', '2027-02-19', 'off']);
  assert.equal(ev.find((e) => e.title.startsWith('Holiday Concert')).kind, 'event', 'a concert is not a day off');
  assert.ok(!ev.some((e) => e.title === 'Book fair'), 'cancelled events are dropped');
  assert.ok(!ev.some((e) => e.title === 'Old event'), 'events long past are dropped');
});

test('parseICS rejects things that are not calendars', () => {
  assert.throws(() => parseICS('<html><body>Calendar</body></html>'), /isn't a calendar file/);
  assert.throws(() => parseICS(''), /isn't a calendar file/);
  assert.deepEqual(parseICS('BEGIN:VCALENDAR\nEND:VCALENDAR'), []);
  // An event without a title or date is skipped rather than breaking the import.
  assert.deepEqual(parseICS('BEGIN:VCALENDAR\nBEGIN:VEVENT\nSUMMARY:x\nEND:VEVENT\nBEGIN:VEVENT\nDTSTART:20261009\nEND:VEVENT\nEND:VCALENDAR', { today: '2026-10-07' }), []);
});

test('kindOf spots days off and early release', () => {
  for (const t of ['No School', 'Thanksgiving Break', 'Teacher Work Day - no students', 'Veterans Day (schools closed)', 'Snow Day', 'Winter Break', 'Non-Student Day', 'LOA Day - Professional Development']) assert.equal(kindOf(t), 'off', t);
  for (const t of ['Early Release', 'Early Dismissal 12:30', 'Late Start Monday', 'Half-day']) assert.equal(kindOf(t), 'early', t);
  for (const t of ['Picture Day', 'Book fair before winter break', 'Holiday Concert', 'Back to School Night', 'School resumes after break', 'PTA meeting', 'Thanksgiving Feast']) assert.equal(kindOf(t), 'event', t);
});

test('feed links: webcal is accepted, unsafe hosts are not fetched by the server', () => {
  assert.equal(normaliseFeedUrl('webcal://calendar.school.org/feed.ics'), 'https://calendar.school.org/feed.ics');
  assert.equal(normaliseFeedUrl('  https://a.org/x.ics '), 'https://a.org/x.ics');
  assert.equal(normaliseFeedUrl('ftp://a.org/x.ics'), null);
  assert.equal(normaliseFeedUrl('not a link'), null);
  assert.ok(feedUrlOk('https://grandridge.isd411.org/calendar.ics'));
  for (const bad of ['http://localhost/x.ics', 'https://127.0.0.1/x.ics', 'https://[::1]/x.ics', 'https://10.0.0.5/x.ics', 'https://intranet/x.ics', 'https://printer.local/x', 'https://user:pw@a.org/x.ics', 'https://a.org:8080/x.ics', 'file:///etc/passwd']) assert.equal(feedUrlOk(bad), null, bad);
});

test('nextDayOff finds the next weekday off and skips weekends', () => {
  const schools = [{ name: 'Grand Ridge', kid: '1', events: parseICS(ICS, { today: '2026-10-07' }) }];
  const off = nextDayOff(schools, '2026-10-07');
  assert.equal(off.firstWeekday, '2026-10-09');
  assert.equal(off.school, 'Grand Ridge');
  // A break that starts on a Saturday counts from the Monday.
  const wk = [{ name: 'S', kid: '0', events: [{ date: '2026-10-10', end: '2026-10-14', title: 'Break', kind: 'off' }] }];
  assert.equal(nextDayOff(wk, '2026-10-08').firstWeekday, '2026-10-12');
  // Only the weekend → nothing.
  assert.equal(nextDayOff([{ name: 'S', kid: '0', events: [{ date: '2026-10-10', end: '2026-10-11', title: 'Closed', kind: 'off' }] }], '2026-10-08'), null);
  // Already started: today counts.
  assert.equal(nextDayOff(wk, '2026-10-13').firstWeekday, '2026-10-13');
  assert.equal(nextDayOff([], '2026-10-07'), null);
  assert.equal(schoolEventsBetween(schools, '2026-10-07', '2026-10-15').length, 3);
});

test('cleanEvents checks AI-read dates', () => {
  const out = cleanEvents([
    { date: '2026-11-11', end: '2026-11-11', title: 'Veterans Day – no school', kind: 'off' },
    { date: '2026-11-25', end: '2026-11-27', title: 'Thanksgiving break', kind: 'off' },
    { date: '2026-13-40', end: '', title: 'Bad date', kind: 'off' },
    { date: '2026-10-20', end: '2026-10-19', title: 'End before start', kind: 'weird' },
    { date: '2026-10-21', end: '2027-06-01', title: 'Too long', kind: 'event' },
    { date: '2026-10-22', title: '   ', kind: 'event' },
    { date: '2020-01-01', end: '2020-01-01', title: 'Ancient', kind: 'event' },
    null,
  ], { today: '2026-10-07' });
  assert.deepEqual(out.map((e) => [e.date, e.end, e.kind]), [['2026-11-11', '2026-11-11', 'off'], ['2026-11-25', '2026-11-27', 'off'], ['2026-10-20', '2026-10-20', 'event'], ['2026-10-21', '2026-10-21', 'event']]);
  assert.deepEqual(cleanEvents('nope'), []);
});
