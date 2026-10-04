// "Just talk" chat: Claude reads what the parent says and changes the app with
// tools. The family's data lives on their phone, so the tools run in the
// browser. This server only adds the system prompt, tool definitions and API
// key, then makes one Claude call per step. The browser drives the loop:
// it sends messages, runs any tool calls, then sends the results back.
import Anthropic from '@anthropic-ai/sdk';
import { CATALOG, AIError } from './ai.js';

const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const PLACE_TYPES = ['playground', 'park', 'nature', 'library', 'museum', 'animals', 'water', 'picnic', 'market', 'treat'];
// Venues where kids' classes happen (no timetables in map data).
const CLASS_VENUES = ['swimming', 'dance', 'martial', 'music', 'art', 'sports', 'community'];

const str = (description) => ({ type: 'string', description });
const tool = (name, description, properties) => ({
  name,
  description,
  strict: true,
  input_schema: { type: 'object', additionalProperties: false, required: Object.keys(properties), properties },
});

export const TOOLS = [
  tool('add_to_calendar', "Add a child's class or a family event/plan to the calendar. Use kind 'event' + repeat 'once' with an exact date for things like a festival, party or visit. Use repeat 'weekly' with days for regular classes.", {
    title: str('Short name, e.g. "Pumpkin festival" or "Football"'),
    kind: { type: 'string', enum: ['class', 'event'] },
    repeat: { type: 'string', enum: ['weekly', 'once'] },
    days: { type: 'array', items: { type: 'string', enum: DAYS }, description: 'Weekly: the days it repeats. Once: leave empty (the date decides the day).' },
    date: str('Once: the date as YYYY-MM-DD. Weekly: empty string.'),
    start: str('Start time, 24h HH:MM'),
    end: str('End time, 24h HH:MM'),
    who: str("A child's nickname exactly as listed in the app state, or empty string for the whole family"),
    where: str('Place name, or empty string'),
  }),
  tool('update_calendar_item', 'Change an existing class or event. Use empty strings / an empty days list for anything that stays the same.', {
    id: str('The item id from the app state'),
    title: str('New title or empty'),
    days: { type: 'array', items: { type: 'string', enum: DAYS }, description: 'New weekly days, or empty to keep' },
    start: str('New start HH:MM or empty'),
    end: str('New end HH:MM or empty'),
    who: str('New child nickname, "everyone", or empty to keep'),
    where: str('New place or empty'),
  }),
  tool('remove_calendar_item', 'Delete a class or event completely.', { id: str('The item id from the app state') }),
  tool('skip_class_once', 'Skip a weekly class on one date only (holiday, cancelled session).', {
    id: str('The item id from the app state'),
    date: str('The date to skip, YYYY-MM-DD'),
  }),
  tool('plan_weekend', "Fill all the free slots of a weekend with activities from the library (replaces that weekend's current plan). Afterwards you can fine-tune individual slots with set_slot.", {
    week: { type: 'string', enum: ['this', 'next'] },
    vibe: { type: 'string', enum: ['adventure', 'mix', 'cosy'] },
  }),
  tool('set_slot', 'Put one library activity into one free slot of a weekend.', {
    week: { type: 'string', enum: ['this', 'next'] },
    slot_id: str('A free slot id from the app state, e.g. "sat@10:15"'),
    activity_id: str('An activity id from the CATALOG'),
    reason: str('One short, warm sentence on why it fits'),
  }),
  tool('clear_slot', 'Empty one slot of a weekend plan.', {
    week: { type: 'string', enum: ['this', 'next'] },
    slot_id: str('The slot id'),
  }),
  tool('find_places', "Look up places near the family's saved area (OpenStreetMap): free family places, or venues for kids' classes (swimming, dance, martial, music, art, sports, community). Returns names, distances and websites, but not class times.", {
    type: { type: 'string', enum: [...PLACE_TYPES, ...CLASS_VENUES] },
    radius_km: { type: 'integer', enum: [2, 5, 10, 25] },
  }),
];

const WEB_SEARCH = { type: 'web_search_20260209', name: 'web_search', max_uses: 3 };

// Frozen system prompt: identical bytes on every request, so it can be cached.
export const SYSTEM_CHAT = `You are LittleRoam's family weekend assistant, inside the LittleRoam app. Parents chat with you to plan weekends around their kids' classes, add events they're excited about, and change their plans. You change the app directly with tools. Talk like a helpful friend: warm, brief, practical.

How to work:
- Every user message comes with <app_state>: today's date, the kids, their classes and events (with ids), and both weekends with their free slots and current plan. Treat it as the truth, and use ids and slot ids exactly as given.
- Act, don't just describe. When the parent wants something changed, call the tool, then confirm in one or two short sentences what you changed (day, date and time).
- An event the parent mentions ("there's a pumpkin festival this Saturday, let's go"): if they gave the date and time, add it. If not, use web_search to find the official date, times and place, then add it with add_to_calendar (kind "event", repeat "once"). Say where you found the details and suggest they double-check opening times. If search doesn't give a clear date and time, ask one short question instead of guessing. Never invent event details.
- Turn relative dates ("this Saturday", "next Sunday", "tomorrow") into exact YYYY-MM-DD dates using today's date in the app state. Planning covers Saturday and Sunday from 09:00 to 18:00. Classes can be on any day.
- Finding classes for a child ("find a Saturday swimming class for Mia"): use find_places with the class venue type to find venues near them, then web_search for the venues' class timetables (day, time, age group). Suggest one or two options that fit the child's age and the free time in their week, with the source. Add one with add_to_calendar only once the parent says yes, or if they asked you to add it. Never invent timetables.
- If the parent wants a weekend planned, call plan_weekend. Then, if their message gives preferences (rainy, tired, a birthday, one child poorly), adjust single slots with set_slot. Only use activity ids from the CATALOG, and only put an activity in a slot that is long enough for it.
- If an event or class now overlaps a planned activity, the app recalculates the free slots automatically. Mention it if a planned activity was dropped.
- If something is ambiguous (which child, which week, what time), ask one short question. Don't make several changes based on a guess.
- If a tool returns an error, explain it simply and fix it or ask.
- Keep children safe: suggest age-appropriate activities, mention supervision for water, heat, roads and heights, and never give medical advice.
- Privacy: never ask for full names, addresses, schools or photos of children.
- Formatting: plain sentences. No markdown tables or headings. Short lists are fine. Use at most one emoji per message.

CATALOG of library activities (id | title | category | ages | duration | setting | energy | mess 0-2 | weather | skills):
${CATALOG}`;

export async function chatStep(env, messages) {
  const client = new Anthropic({
    apiKey: env.ANTHROPIC_API_KEY,
    ...(env.ANTHROPIC_BASE_URL ? { baseURL: env.ANTHROPIC_BASE_URL } : {}),
    maxRetries: 1,
  });
  try {
    const response = await client.beta.messages.create({
      model: env.AI_MODEL || 'claude-opus-5-5',
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'medium' },
      cache_control: { type: 'ephemeral' },
      system: [{ type: 'text', text: SYSTEM_CHAT }],
      tools: [...TOOLS, WEB_SEARCH],
      messages,
    });
    return { content: response.content, stop_reason: response.stop_reason };
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) throw new AIError('The AI is busy right now. Please try again in a minute.', 503);
    if (err instanceof Anthropic.AuthenticationError) throw new AIError('AI is not configured correctly on the server.', 503);
    if (err instanceof Anthropic.BadRequestError) throw new AIError('This chat got into a state the AI could not continue. Please start a new chat.', 400);
    if (err instanceof Anthropic.APIError) throw new AIError(`AI request failed (${err.status ?? 'network'}).`, 502);
    throw err;
  }
}

// Basic shape and size checks on the conversation the browser sends.
export function validMessages(messages) {
  if (!Array.isArray(messages) || !messages.length || messages.length > 80) return false;
  if (messages[0].role !== 'user') return false;
  return messages.every((m) => m && (m.role === 'user' || m.role === 'assistant') && (typeof m.content === 'string' || Array.isArray(m.content)));
}

// A new thing the parent said (not just tool results or a paused-turn resume).
export function isNewUserTurn(messages) {
  const last = messages.at(-1);
  if (last.role !== 'user') return false;
  return typeof last.content === 'string' || last.content.some((b) => b?.type === 'text');
}
