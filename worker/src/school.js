// School calendars for the app: finding a school's published calendar (its
// .ics feed, found on the school website, or the official dates found with
// Claude's web search), fetching feeds (school sites don't allow browsers to
// read them directly), and reading dates off a newsletter photo with Claude.
import Anthropic from '@anthropic-ai/sdk';
import { normaliseFeedUrl, cleanEvents, parseICS, extractCalendarLinks, gradeLabel } from '../../js/school.js';
import { AIError, createMessage, aiError } from './ai.js';

const MAX_ICS = 2_000_000;
const MAX_PAGE = 1_500_000;
const UA = 'LittleRoam/1.0 (family planner; finds public school calendars)';

// Only fetch from ordinary public hostnames, never raw IPs or local names.
// allowOrigin exists only for the offline test suite (SCHOOL_FETCH_TEST_ORIGIN, one exact
// origin such as http://127.0.0.1:9922); never set it in production.
export function feedUrlOk(raw, { allowOrigin = '' } = {}) {
  const href = normaliseFeedUrl(raw);
  if (!href) return null;
  const u = new URL(href);
  if (allowOrigin && u.origin === allowOrigin) return href;
  if (u.username || u.password || (u.port && !['80', '443'].includes(u.port))) return null;
  const host = u.hostname.toLowerCase();
  if (!host.includes('.') || host.endsWith('.local') || host.endsWith('.internal') || host === 'localhost' || host.endsWith('.localhost')) return null;
  if (/^[\d.]+$/.test(host) || host.startsWith('[')) return null;
  return href;
}

// GET with every redirect hop checked and a size cap. Returns { text, url } or throws AIError.
async function safeGet(raw, { accept, max, allowOrigin, what = 'that page' }) {
  let next = feedUrlOk(raw, { allowOrigin });
  if (!next) throw new AIError("That doesn't look like a calendar link. It should start with https:// or webcal://.", 400);
  let res;
  for (let hop = 0; ; hop++) {
    try {
      res = await fetch(next, { headers: { accept, 'user-agent': UA }, redirect: 'manual', signal: AbortSignal.timeout(10000) });
    } catch {
      throw new AIError(`Couldn't reach ${what}. Check the link, or download the .ics file and import it instead.`, 502);
    }
    if (res.status < 300 || res.status >= 400 || !res.headers.get('location')) break;
    const to = feedUrlOk(new URL(res.headers.get('location'), next).href, { allowOrigin });
    if (!to || hop >= 4) throw new AIError('That link redirects somewhere we can\'t follow. Try the link the school gives for “Subscribe” or “iCal”.', 502);
    next = to;
  }
  if (!res.ok) throw new AIError(`The school's server said “${res.status}”. Check the link is the public “Subscribe” / iCal link.`, 502);
  const reader = res.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > max) { reader.cancel(); throw new AIError('That file is too big to import.', 413); }
    chunks.push(value);
  }
  const all = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) { all.set(c, at); at += c.length; }
  return { text: new TextDecoder().decode(all), url: next };
}

export async function fetchICS(raw, { allowOrigin = '' } = {}) {
  const { text } = await safeGet(raw, { accept: 'text/calendar, */*;q=0.5', max: MAX_ICS, allowOrigin, what: 'that calendar' });
  // This is not a general web proxy: only calendar files are passed back.
  if (!/BEGIN:VCALENDAR/i.test(text.slice(0, 4000))) throw new AIError("That link opens a web page, not a calendar feed. On the school's calendar page look for “Subscribe”, “iCal” or “Add to calendar” and copy that link.", 422);
  return text;
}

// Look on the school's website (home page, then up to 3 likely calendar pages) for a
// working calendar feed. Returns { url, events, page } or { page } (a calendar page with no feed) or null.
export async function discoverFeed(website, { today, allowOrigin = false, maxPages = 3 } = {}) {
  const tryFeeds = async (feeds) => {
    for (const f of feeds.slice(0, 3)) {
      try {
        const events = parseICS(await fetchICS(f, { allowOrigin }), { today });
        if (events.length) return { url: normaliseFeedUrl(f), events };
      } catch { /* try the next one */ }
    }
    return null;
  };
  let home;
  try { home = await safeGet(website, { accept: 'text/html', max: MAX_PAGE, allowOrigin }); } catch { return null; }
  const first = extractCalendarLinks(home.text, home.url);
  const direct = await tryFeeds(first.feeds);
  if (direct) return { ...direct, page: home.url };
  for (const page of first.pages.slice(0, maxPages)) {
    let html;
    try { html = await safeGet(page, { accept: 'text/html', max: MAX_PAGE, allowOrigin }); } catch { continue; }
    const found = await tryFeeds(extractCalendarLinks(html.text, html.url).feeds);
    if (found) return { ...found, page: html.url };
  }
  return first.pages[0] ? { page: first.pages[0] } : null;
}

// ---------- Claude web search for a school's official calendar ----------
const REPORT_TOOL = {
  name: 'report_school_calendar',
  description: "Report what you found about this school's official calendar. Call this exactly once, at the end.",
  strict: true,
  input_schema: {
    type: 'object',
    additionalProperties: false,
    required: ['found', 'school', 'calendar_page', 'feed_url', 'events', 'sources', 'note'],
    properties: {
      found: { type: 'boolean', description: 'true only if you found the official calendar for this school (or its district) for the current school year' },
      school: { type: 'string', description: 'The school as named on the official site, with its town and district' },
      calendar_page: { type: 'string', description: 'URL of the official calendar page or PDF, or empty' },
      feed_url: { type: 'string', description: 'A subscribable calendar feed (.ics / webcal / Google Calendar iCal link) if the official site offers one, else empty' },
      events: {
        type: 'array',
        description: 'Dated items printed in the official calendar from TODAY onward, up to 12 months',
        items: {
          type: 'object', additionalProperties: false, required: ['date', 'end', 'title', 'kind'],
          properties: {
            date: { type: 'string', description: 'YYYY-MM-DD' },
            end: { type: 'string', description: 'Last day (inclusive) YYYY-MM-DD; same as date for one day' },
            title: { type: 'string', description: 'Short title as written, keeping any grade it applies to, e.g. "No school – kindergarten conferences"' },
            kind: { type: 'string', enum: ['off', 'early', 'event'] },
          },
        },
      },
      sources: { type: 'array', items: { type: 'string' }, description: 'The official URLs the dates came from' },
      note: { type: 'string', description: 'One short sentence for the parent: what you found and anything to double-check' },
    },
  },
};

const SEARCH_SYSTEM = `You find a school's official calendar for a family planning app, so parents don't have to.

Rules:
- Use web search to find the OFFICIAL calendar from the school's or its district's own website (or the provider's own site for a preschool). Don't use third-party listing sites for dates.
- Make sure it is the right school: match the name AND the town. If several schools share the name, use the one in the given town. If you can't be sure, set found to false.
- Many public schools use their district calendar; that counts. Prefer the current school year; include the next one too if it's published.
- List only dates you actually read in the official source: days with no school, early release / late start, the first and last day, breaks, conferences and other whole-school days. Never add dates from memory or "typical" holidays.
- Keep any grade an item applies to in its title (e.g. "No school for kindergarten").
- If the official site offers a subscribable calendar (iCal / .ics / webcal / Google Calendar), put that link in feed_url.
- Finish by calling report_school_calendar once. No other output is needed.`;

export async function searchSchoolCalendar(env, { name, town, district, website, grade, today }) {
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, ...(env.ANTHROPIC_BASE_URL ? { baseURL: env.ANTHROPIC_BASE_URL } : {}), maxRetries: 1 });
  const messages = [{
    role: 'user',
    content: `TODAY: ${today}\nSCHOOL: ${name}\nTOWN: ${town || 'unknown'}\nDISTRICT: ${district || 'unknown'}\nWEBSITE: ${website || 'unknown'}\nCHILD'S GRADE: ${gradeLabel(grade) || 'unknown'}\nFind this school's official calendar.`,
  }];
  for (let step = 0; step < 6; step++) {
    let res;
    try {
      res = await createMessage(client, {
        model: env.AI_MODEL || 'claude-opus-5-5',
        max_tokens: 16000,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        output_config: { effort: 'low' }, // cost: answers are cached per school, so one careful-enough look is enough
        system: [{ type: 'text', text: SEARCH_SYSTEM, cache_control: { type: 'ephemeral' } }],
        tools: [REPORT_TOOL, { type: 'web_search_20260209', name: 'web_search', max_uses: 3 }],
        messages,
      }, env.meter);
    } catch (err) {
      throw aiError(err);
    }
    if (res.stop_reason === 'refusal') throw new AIError("The AI couldn't look that up.", 422);
    const report = res.content.find((b) => b.type === 'tool_use' && b.name === REPORT_TOOL.name);
    if (report) return report.input;
    // A long search pauses; send the turn back unchanged to let it continue.
    if (res.stop_reason === 'pause_turn') { messages.push({ role: 'assistant', content: res.content }); continue; }
    break;
  }
  throw new AIError("Couldn't find that school's calendar automatically. Try the school's own calendar link or a photo of the newsletter.", 502);
}

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['events', 'note'],
  properties: {
    note: { type: 'string', description: 'One short sentence for the parent, e.g. what the picture was and anything unclear.' },
    events: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['date', 'end', 'title', 'kind'],
        properties: {
          date: { type: 'string', description: 'First day, YYYY-MM-DD' },
          end: { type: 'string', description: 'Last day (inclusive), YYYY-MM-DD; same as date for one day' },
          title: { type: 'string', description: 'Short title as written, e.g. "No school – teacher planning day"' },
          kind: { type: 'string', enum: ['off', 'early', 'event'], description: 'off = no school for students; early = early release / late start; event = anything else' },
        },
      },
    },
  },
};

const SYSTEM = `You read school newsletters, flyers and printed school calendars for a family planning app, and list the dated items in them.

Rules:
- Only list items that are actually printed in the image, with a date you can read. Never guess or add typical holidays that aren't shown.
- Work out the year from the image; if no year is shown, use the next occurrence on or after TODAY (given below).
- Multi-day items (e.g. "Mid-winter break Feb 16–20") are one item with date and end.
- kind: "off" only when students have no school that day; "early" for early release, early dismissal or late start; everything else is "event".
- Skip children's names, grades, phone numbers and other personal details. Titles should be short.
- If the image is not a school notice or calendar, return no events and say so in note.`;

export async function datesFromPhoto(env, { image, mediaType, today, school }) {
  const client = new Anthropic({
    apiKey: env.ANTHROPIC_API_KEY,
    ...(env.ANTHROPIC_BASE_URL ? { baseURL: env.ANTHROPIC_BASE_URL } : {}),
    maxRetries: 1,
  });
  let response;
  try {
    response = await createMessage(client, {
      model: env.AI_MODEL || 'claude-opus-5-5',
      max_tokens: 8000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
      system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: image } },
          { type: 'text', text: `TODAY: ${today}\nSCHOOL: ${school || 'not given'}\nList the dated items in this picture.` },
        ],
      }],
    }, env.meter);
  } catch (err) {
    throw aiError(err);
  }
  if (response.stop_reason === 'refusal') throw new AIError("The AI couldn't read that picture.", 422);
  let raw;
  try {
    raw = JSON.parse(response.content.filter((b) => b.type === 'text').map((b) => b.text).join(''));
  } catch {
    throw new AIError('The AI returned an unexpected answer. Please try again.', 502);
  }
  return { events: cleanEvents(raw.events, { today }), note: String(raw.note || '').slice(0, 300) };
}
