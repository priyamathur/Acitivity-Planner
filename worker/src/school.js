// School calendars for the app: a small fetcher for published .ics feeds (school
// sites don't allow browsers to read them directly) and reading dates off a
// photo of a newsletter or printed calendar with Claude.
import Anthropic from '@anthropic-ai/sdk';
import { normaliseFeedUrl, cleanEvents } from '../../js/school.js';
import { AIError } from './ai.js';

const MAX_ICS = 2_000_000;

// Only fetch calendar feeds from ordinary public hostnames, never raw IPs or local names.
export function feedUrlOk(raw) {
  const href = normaliseFeedUrl(raw);
  if (!href) return null;
  const u = new URL(href);
  if (u.username || u.password || (u.port && !['80', '443'].includes(u.port))) return null;
  const host = u.hostname.toLowerCase();
  if (!host.includes('.') || host.endsWith('.local') || host.endsWith('.internal') || host === 'localhost' || host.endsWith('.localhost')) return null;
  if (/^[\d.]+$/.test(host) || host.startsWith('[')) return null;
  return href;
}

export async function fetchICS(raw) {
  const href = feedUrlOk(raw);
  if (!href) throw new AIError("That doesn't look like a calendar link. It should start with https:// or webcal://.", 400);
  let res;
  try {
    res = await fetch(href, { headers: { accept: 'text/calendar, */*;q=0.5', 'user-agent': 'LittleRoam/1.0 (family planner; school calendar subscribe)' }, redirect: 'follow', signal: AbortSignal.timeout(10000) });
  } catch {
    throw new AIError("Couldn't reach that calendar. Check the link, or download the .ics file and import it instead.", 502);
  }
  if (!res.ok) throw new AIError(`The school's calendar server said “${res.status}”. Check the link is the public “Subscribe” / iCal link.`, 502);
  const reader = res.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > MAX_ICS) { reader.cancel(); throw new AIError('That calendar is too big to import.', 413); }
    chunks.push(value);
  }
  const all = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) { all.set(c, at); at += c.length; }
  const text = new TextDecoder().decode(all);
  // This is not a general web proxy: only calendar files are passed back.
  if (!/BEGIN:VCALENDAR/i.test(text.slice(0, 4000))) throw new AIError("That link opens a web page, not a calendar feed. On the school's calendar page look for “Subscribe”, “iCal” or “Add to calendar” and copy that link.", 422);
  return text;
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
    response = await client.beta.messages.create({
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
    });
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) throw new AIError('The AI is busy right now. Please try again in a minute.', 503);
    if (err instanceof Anthropic.AuthenticationError) throw new AIError('AI is not configured correctly on the server.', 503);
    if (err instanceof Anthropic.APIError) throw new AIError(`AI request failed (${err.status ?? 'network'}).`, 502);
    throw err;
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
