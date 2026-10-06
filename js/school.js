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

// School events that touch [fromIso, toIso], across all linked schools (only the child's grade).
export function schoolEventsBetween(schools, fromIso, toIso) {
  return (schools || []).flatMap((s) => forGrade(s.events || [], s.grade).filter((e) => e.end >= fromIso && e.date <= toIso).map((e) => ({ ...e, school: s.name, kid: s.kid })))
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

// ---------- Grades ----------
// 'prek' (preschool / pre-K), 'k', then '1'…'12'.
export const GRADES = [['prek', 'Preschool / Pre-K'], ['k', 'Kindergarten'], ...Array.from({ length: 12 }, (_, i) => [String(i + 1), `Grade ${i + 1}`])];
const gradeNum = (g) => (g === 'prek' ? -1 : g === 'k' ? 0 : Number(g));
export const gradeLabel = (g) => (GRADES.find(([k]) => k === g) || [, ''])[1];

// Which grades an event title is limited to, or null if it's for everyone.
export function gradesMentioned(title) {
  const t = ` ${String(title || '').toLowerCase()} `;
  const set = new Set();
  const add = (a, b = a) => { for (let n = Math.min(a, b); n <= Math.max(a, b); n++) set.add(n); };
  if (/\b(pre-?k|pre-?school|preschool|pre-?kindergarten|tk)\b/.test(t)) add(-1);
  if (/\bkindergarten\b|\bkinder\b|\bk(?:-| )only\b/.test(t) && !/pre-?kindergarten/.test(t)) add(0);
  for (const m of t.matchAll(/\bk\s*(?:-|–|to)\s*(\d{1,2})\b/g)) add(0, Number(m[1]));
  for (const m of t.matchAll(/\bgrades?\s+(\d{1,2})(?:\s*(?:-|–|to|through|&|and)\s*(\d{1,2}))?/g)) add(Number(m[1]), Number(m[2] ?? m[1]));
  for (const m of t.matchAll(/\b(\d{1,2})(?:st|nd|rd|th)(?:\s*(?:-|–|to|&|and)\s*(\d{1,2})(?:st|nd|rd|th))?\s*grade/g)) add(Number(m[1]), Number(m[2] ?? m[1]));
  if (/\b(middle school|middle schools|ms only|junior high)\b/.test(t)) add(6, 8);
  if (/\b(high school|high schools|hs only)\b/.test(t)) add(9, 12);
  if (/\bseniors?\b|\bgraduation\b/.test(t)) add(12);
  if (/\belementary\b/.test(t) && !set.size) add(0, 5);
  return set.size ? set : null;
}

// Keep events for everyone, plus those that name this child's grade.
export function forGrade(events, grade) {
  if (!grade) return events;
  const g = gradeNum(grade);
  return events.filter((e) => { const s = gradesMentioned(e.title); return !s || s.has(g); });
}

// ---------- Finding a school's calendar feed on its website ----------
const googleIcs = (id) => `https://calendar.google.com/calendar/ical/${encodeURIComponent(id)}/public/basic.ics`;

// Feed links (.ics, webcal, Google Calendar) and likely calendar pages in a web page.
export function extractCalendarLinks(html, baseUrl) {
  const base = new URL(baseUrl);
  const rootDomain = (h) => h.split('.').slice(-2).join('.');
  const feeds = new Set();
  const pages = new Map();
  const abs = (v) => { try { return new URL(v.replace(/&amp;/g, '&').trim(), base).href; } catch { return null; } };
  const consider = (raw, text = '') => {
    if (!raw || /^(#|mailto:|tel:|javascript:)/i.test(raw)) return;
    if (/^webcals?:\/\//i.test(raw)) return void feeds.add(raw.replace(/^webcals?:\/\//i, 'https://'));
    const u = abs(raw);
    if (!u) return;
    const url = new URL(u);
    if (url.hostname === 'calendar.google.com') {
      const src = url.searchParams.get('src');
      if (src) feeds.add(googleIcs(src));
      else if (/\/calendar\/ical\//.test(url.pathname)) feeds.add(u);
      return;
    }
    if (/\.ics$/i.test(url.pathname) || /[?&](format|type|output)=(ical|ics)\b/i.test(url.search) || /\/(ical|icalfeed|ics)(\/|$)/i.test(url.pathname)) return void feeds.add(u);
    if (!/^https?:$/.test(url.protocol) || rootDomain(url.hostname) !== rootDomain(base.hostname)) return;
    const hay = `${url.pathname} ${text}`.toLowerCase();
    const s = (/calendar/.test(hay) ? 3 : 0) + (/academic|school year|district calendar|instructional/.test(hay) ? 2 : 0) + (/events?/.test(hay) ? 1 : 0);
    if (s && url.href !== base.href) pages.set(url.href.split('#')[0], Math.max(s, pages.get(url.href.split('#')[0]) || 0));
  };
  for (const m of html.matchAll(/<a\b[^>]*?href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]{0,200}?)<\/a>/gi)) consider(m[1], m[2].replace(/<[^>]+>/g, ' '));
  for (const m of html.matchAll(/\b(?:src|data-[a-z-]+|value|content)\s*=\s*["']([^"']+)["']/gi)) consider(m[1]);
  for (const m of html.matchAll(/(webcals?:\/\/[^\s"'<>]+|https:\/\/calendar\.google\.com\/calendar\/(?:embed|ical)[^\s"'<>]+)/gi)) consider(m[1]);
  return { feeds: [...feeds].slice(0, 6), pages: [...pages.entries()].sort((a, b) => b[1] - a[1]).map(([u]) => u).slice(0, 4) };
}

// Normalised key for caching a school's calendar ("Grand Ridge Elementary School" ≈ "grand ridge elementary").
export const schoolKey = (name, cell = '') => `${String(name).toLowerCase().replace(/\b(school|the)\b/g, '').replace(/[^a-z0-9]+/g, ' ').trim()}|${cell}`;
