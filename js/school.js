// School calendars: read the dates a school publishes (an iCalendar / .ics feed
// or file) and spot the ones that matter to a family planner: days off and early
// release. Only dates and titles are kept; nothing about the child.

const OFF = /\b(no school|no classes|no students|non[- ]?student|school (is )?closed|schools? closed|closure|closed|holiday|break|vacation|recess|teacher (work|planning|prep)|in[- ]?service|staff development|professional (development|learning)|pd day|snow day|inclement weather|conference(s)? day|labor day|memorial day|thanksgiving|veterans day|presidents'? day|mlk|martin luther king|juneteenth|independence day|new year'?s day|christmas)\b/i;
const EARLY = /\b(early (release|dismissal|out)|half[- ]day|late start|late arrival|minimum day)\b/i;
// Words that look like a day off but aren't one ("Book fair before winter break").
const NOT_OFF = /\b(before|after|ends?|returns?|back to school|resumes?|first day|last day|fair|sale|drive|meeting|lunch|reminder|registration|concert|party|program|performance|celebration|bazaar|sing-?along|show|feast|assembly|spirit|dress)\b/i;

export function kindOf(title) {
  const t = String(title || '');
  if (EARLY.test(t)) return 'early';
  if (OFF.test(t) && !NOT_OFF.test(t)) return 'off';
  return 'event';
}

// Accept https:// and webcal:// links; webcal is just https for calendar apps.
export function normaliseFeedUrl(raw) {
  const s = String(raw || '').trim().replace(/^webcals?:\/\//i, 'https://');
  let u;
  try { u = new URL(s); } catch { return null; }
  if (!/^https?:$/.test(u.protocol)) return null;
  return u.href;
}

const unescape = (v) => v.replace(/\\n/gi, ' ').replace(/\\([,;\\])/g, '$1').trim();
const pad = (n) => String(n).padStart(2, '0');
const isoOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

// "20261009", "20261009T080000", "20261009T150000Z" → { date, time, allDay }
function parseWhen(value, params) {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(value.trim());
  if (!m) return null;
  const [, y, mo, d, h, mi, , z] = m;
  if (/VALUE=DATE(?!-)/i.test(params) || h == null) return { date: `${y}-${mo}-${d}`, time: null, allDay: true };
  if (z) {
    // UTC: show it in the phone's own time zone.
    const dt = new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi));
    return { date: isoOf(dt), time: `${pad(dt.getHours())}:${pad(dt.getMinutes())}`, allDay: false };
  }
  // Floating or TZID time: taken as local wall-clock time (right when the school
  // and the family are in the same time zone, which is the normal case).
  return { date: `${y}-${mo}-${d}`, time: `${h}:${mi}`, allDay: false };
}

function addDays(iso, n) {
  const d = new Date(iso + 'T12:00');
  d.setDate(d.getDate() + n);
  return isoOf(d);
}

// Parse an iCalendar file. Keeps events from `from` (default 30 days ago) up to
// a year ahead, oldest first, at most `max`.
export function parseICS(text, { today = isoOf(new Date()), max = 400 } = {}) {
  const src = String(text || '');
  if (!/BEGIN:VCALENDAR/i.test(src)) throw new Error("That isn't a calendar file. Look for a link or file ending in .ics, or a “Subscribe” / “iCal” button.");
  const lines = src.replace(/\r\n?/g, '\n').replace(/\n[ \t]/g, '').split('\n');
  const from = addDays(today, -30);
  const until = addDays(today, 366);
  const events = [];
  let ev = null;
  for (const line of lines) {
    if (/^BEGIN:VEVENT/i.test(line)) { ev = {}; continue; }
    if (/^END:VEVENT/i.test(line)) {
      if (ev?.start && ev.title && !/CANCELLED/i.test(ev.status || '')) {
        let end = ev.end?.date || ev.start.date;
        // All-day DTEND is exclusive ("20261010" ends a one-day event on the 9th).
        if (ev.start.allDay && ev.end?.allDay && end > ev.start.date) end = addDays(end, -1);
        if (end < ev.start.date) end = ev.start.date;
        if (end >= from && ev.start.date <= until) {
          events.push({
            date: ev.start.date, end, title: ev.title.slice(0, 120),
            ...(ev.start.time ? { start: ev.start.time, ...(ev.end?.time && ev.end.date === ev.start.date ? { finish: ev.end.time } : {}) } : {}),
            kind: kindOf(ev.title),
          });
        }
      }
      ev = null;
      continue;
    }
    if (!ev) continue;
    const i = line.indexOf(':');
    if (i < 0) continue;
    const [name, ...params] = line.slice(0, i).split(';');
    const value = line.slice(i + 1);
    const key = name.toUpperCase();
    if (key === 'SUMMARY') ev.title = unescape(value);
    else if (key === 'DTSTART') ev.start = parseWhen(value, params.join(';'));
    else if (key === 'DTEND') ev.end = parseWhen(value, params.join(';'));
    else if (key === 'STATUS') ev.status = value;
  }
  events.sort((a, b) => a.date.localeCompare(b.date) || (a.start || '').localeCompare(b.start || ''));
  return events.slice(0, max);
}

// Dates from AI (newsletter photo) are checked the same way before they're saved.
export function cleanEvents(list, { today = isoOf(new Date()) } = {}) {
  const ISO = /^\d{4}-\d{2}-\d{2}$/;
  const from = addDays(today, -30);
  return (Array.isArray(list) ? list : [])
    .filter((e) => e && ISO.test(e.date) && typeof e.title === 'string' && e.title.trim() && !Number.isNaN(new Date(e.date + 'T12:00').getTime()))
    .map((e) => {
      const end = ISO.test(e.end || '') && e.end >= e.date && e.end <= addDays(e.date, 21) ? e.end : e.date;
      return { date: e.date, end, title: e.title.trim().slice(0, 120), kind: ['off', 'early', 'event'].includes(e.kind) ? e.kind : kindOf(e.title) };
    })
    .filter((e) => e.end >= from && e.date <= addDays(today, 400))
    .slice(0, 60);
}

// Is this date inside the event (inclusive)?
export const covers = (e, iso) => e.date <= iso && iso <= e.end;

// School events that touch [fromIso, toIso], across all linked schools.
export function schoolEventsBetween(schools, fromIso, toIso) {
  return (schools || []).flatMap((s) => (s.events || []).filter((e) => e.end >= fromIso && e.date <= toIso).map((e) => ({ ...e, school: s.name, kid: s.kid })))
    .sort((a, b) => a.date.localeCompare(b.date));
}

// The next weekday a child is off school (or out early), within `days` days.
export function nextDayOff(schools, today, days = 14) {
  const until = addDays(today, days);
  return schoolEventsBetween(schools, today, until)
    .filter((e) => e.kind !== 'event')
    .find((e) => {
      // Ignore weekends: kids are home anyway.
      for (let d = e.date < today ? today : e.date; d <= e.end && d <= until; d = addDays(d, 1)) {
        const wd = new Date(d + 'T12:00').getDay();
        if (wd !== 0 && wd !== 6) return (e.firstWeekday = d);
      }
      return false;
    }) || null;
}

export { addDays, isoOf };
