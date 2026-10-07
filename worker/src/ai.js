// AI weekend planning using the Claude API. The app works out the family's free
// time windows around the kids' classes; the model fills each window, preferring
// the curated library. Every response is validated against the windows and the
// library, and clamped to safe ranges, before it reaches the app.
import Anthropic from '@anthropic-ai/sdk';
import { ACTIVITIES, CATEGORIES } from '../../js/data.js';

const byId = Object.fromEntries(ACTIVITIES.map((a) => [a.id, a]));

export const CATALOG = ACTIVITIES.map((a) =>
  `${a.id} | ${a.title} | ${a.cat} | ages ${a.ages[0]}-${a.ages[1]} | ${a.mins} min | ${a.setting} | ${a.energy} | mess ${a.mess} | weather ${a.weather} | ${a.skills.join(', ')}`,
).join('\n');

// Frozen system prompt: identical bytes on every request, so it can be cached.
const SYSTEM = `You are LittleRoam's family weekend planner. You plan screen-free, offline weekends for families with children aged 0–12, working around the classes and plans they already have.

Rules:
- You are given the FREE WINDOWS for each day (already excluding classes, travel time and lunch). Fill each window with at most one activity, using its exact window id. You may leave a window empty if the family needs rest (for example after a long class or a busy morning), but fill most of them.
- An activity must fit in its window: its duration must not exceed the window's minutes.
- Balance the weekend: mix outings with home time, active with calm, and avoid repeating a category back-to-back. Consider what's booked around a window: after sport, something calm; before an afternoon class, something close to home.
- Match the family's chosen vibe: "adventure" means more trips out, "cosy" means mostly home and close by, "mix" means one outing a day and some home time.
- Use each day's weather: on wet days choose indoor activities or rain-friendly ones.
- Strongly prefer activities from the CATALOG below. Refer to them by their exact id. Never use the same activity twice in a weekend.
- Only invent a new activity ("custom") when nothing in the catalog fits, or when the parent's note asks for something the catalog doesn't cover. Leave "activityId" empty for a custom idea.
- Suggestions must be safe and age-appropriate. Include a supervision note in "tip" for anything involving water, heat, cooking, sharp tools, small parts (choking risk under 3), heights or roads.
- Never give medical, dietary or therapeutic advice. If a question needs a professional, say so briefly in "message" and still offer gentle, safe activities.
- "Popular near you" data is anonymous counts of families nearby. Mention it in "why" only for activities that actually appear in that data, using the exact number given. Never invent popularity, other families, events, or opening times.
- Mention a nearby place only if it appears in the NEARBY PLACES list. Don't claim facilities (toilets, fees, hours) that aren't listed.
- Avoid activities they've seen recently unless nothing else fits.
- "why" is one warm, specific sentence (under 25 words) on why this fits this slot (weather, what's before or after it, the kids' ages).
- "message" is one short friendly sentence summing up the weekend.
- For catalog picks, fill "custom" with empty strings, zeros and empty arrays. They are ignored.
- Use simple British/US-neutral English. No emojis except the single "emoji" field.

Categories: ${Object.keys(CATEGORIES).join(', ')}.
Settings: home (indoors), outside (garden/street/park nearby), out (a trip somewhere).

CATALOG (id | title | category | ages | duration | setting | energy | mess 0-2 | weather | skills):
${CATALOG}`;

const str = { type: 'string' };
const strArr = { type: 'array', items: str };
const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['message', 'picks'],
  properties: {
    message: str,
    picks: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['windowId', 'activityId', 'why', 'placeName', 'custom'],
        properties: {
          windowId: str,
          activityId: str,
          why: str,
          placeName: str,
          custom: {
            type: 'object',
            additionalProperties: false,
            required: ['title', 'emoji', 'cat', 'minAge', 'maxAge', 'mins', 'setting', 'energy', 'mess', 'materials', 'steps', 'skills', 'tip'],
            properties: {
              title: str, emoji: str, cat: str,
              minAge: { type: 'integer' }, maxAge: { type: 'integer' }, mins: { type: 'integer' },
              setting: { type: 'string', enum: ['home', 'outside', 'out', ''] },
              energy: { type: 'string', enum: ['calm', 'active', ''] },
              mess: { type: 'integer' },
              materials: strArr, steps: strArr, skills: strArr, tip: str,
            },
          },
        },
      },
    },
  },
};

const clip = (s, n) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const clamp = (v, lo, hi, d) => (Number.isFinite(Number(v)) ? Math.min(hi, Math.max(lo, Math.round(Number(v)))) : d);
const list = (a, n, len) => (Array.isArray(a) ? a.map((x) => clip(x, len)).filter(Boolean).slice(0, n) : []);

export function normaliseCustom(c, uid, maxMins = 600) {
  const title = clip(c?.title, 70);
  const steps = list(c?.steps, 8, 220);
  if (!title || steps.length < 2) return null;
  const minAge = clamp(c.minAge, 0, 12, 2);
  return {
    id: `ai-${uid}`,
    ai: true,
    title,
    emoji: [...clip(c.emoji, 8)].slice(0, 2).join('') || '✨',
    cat: CATEGORIES[c.cat] ? c.cat : 'together',
    ages: [minAge, clamp(c.maxAge, minAge, 12, 12)],
    mins: clamp(c.mins, 5, maxMins, Math.min(30, maxMins)),
    setting: ['home', 'outside', 'out'].includes(c.setting) ? c.setting : 'home',
    energy: c.energy === 'active' ? 'active' : 'calm',
    mess: clamp(c.mess, 0, 2, 1),
    weather: 'any',
    materials: list(c.materials, 10, 120).length ? list(c.materials, 10, 120) : ['Nothing special'],
    steps,
    skills: list(c.skills, 4, 40).length ? list(c.skills, 4, 40) : ['Connection'],
    tip: clip(c.tip, 240),
  };
}

// Turns the model's raw JSON into the picks the app will show.
// Claims about other families are only allowed for activities that really are trending.
const POPULARITY = /\b(popular|trending|other famil|famil(y|ies) (near|nearby|around|in your))/i;

// Turns the model's raw JSON into the plan the app will show: at most one activity
// per known window, no repeats, everything fitting its window.
export function normalisePicks(raw, { maxCustom, placeNames, windows, trendIds = new Set(), uid = () => crypto.randomUUID().slice(0, 8) }) {
  const winById = new Map(windows.map((w) => [w.id, w]));
  const out = [];
  const usedWin = new Set();
  const usedAct = new Set();
  let customs = 0;
  for (const p of Array.isArray(raw?.picks) ? raw.picks : []) {
    const win = winById.get(p?.windowId);
    if (!win || usedWin.has(win.id)) continue;
    const placeName = placeNames.has(p.placeName) ? p.placeName : '';
    let why = clip(p.why, 200);
    if (POPULARITY.test(why) && !trendIds.has(p.activityId)) why = '';
    if (p.activityId && byId[p.activityId]) {
      if (usedAct.has(p.activityId) || byId[p.activityId].mins > win.mins) continue;
      usedAct.add(p.activityId);
      usedWin.add(win.id);
      out.push({ windowId: win.id, activityId: p.activityId, why, placeName });
    } else if (!p.activityId && customs < maxCustom) {
      const custom = normaliseCustom(p.custom, uid(), win.mins);
      if (!custom) continue;
      customs++;
      usedWin.add(win.id);
      out.push({ windowId: win.id, activityId: custom.id, why, placeName, custom });
    }
  }
  return { message: clip(raw?.message, 200), picks: out };
}

export function buildUserPrompt(ctx) {
  const lines = [];
  if (ctx.note) lines.push(`PARENT'S NOTE: ${clip(ctx.note, 300)}`);
  lines.push(`Children's ages: ${ctx.ages.length ? ctx.ages.join(', ') : 'not given'}`);
  lines.push(`Vibe: ${ctx.vibe}`);
  lines.push(`Season: ${ctx.season || 'unknown'}`);
  for (const d of ctx.days) {
    lines.push('', `${d.label.toUpperCase()}. Weather: ${d.weather || 'unknown'}.`);
    lines.push(`Already booked: ${d.booked.length ? d.booked.join('; ') : 'nothing'}`);
    lines.push(`FREE WINDOWS: ${d.windows.length ? d.windows.map((w) => `[${w.id}] ${w.start}–${w.end} (${w.mins} min)`).join('; ') : 'none'}`);
  }
  lines.push('');
  if (ctx.recentIds.length) lines.push(`Recently planned (avoid): ${ctx.recentIds.join(', ')}`);
  if (ctx.favIds.length) lines.push(`Family favourites: ${ctx.favIds.join(', ')}`);
  lines.push(ctx.trends.length
    ? `POPULAR NEAR YOU (last 30 days, families with kids in the same age band): ${ctx.trends.map((t) => `${t.activity} (${t.families} families)`).join('; ')}`
    : 'POPULAR NEAR YOU: no data yet. Don\'t mention popularity.');
  lines.push(ctx.places.length
    ? `NEARBY PLACES: ${ctx.places.map((p) => `${p.name} (${p.type}, ${p.km} km)`).join('; ')}`
    : 'NEARBY PLACES: none provided.');
  lines.push(`Maximum ${ctx.maxCustom} custom idea(s).`);
  return lines.join('\n');
}

export class AIError extends Error {
  constructor(message, status = 502) {
    super(message);
    this.status = status;
  }
}

// Anthropic's own reason for a failed request (no secrets in it), for logs and for the parent.
export const apiReason = (err) => String(err?.error?.error?.message || err?.message || '').replace(/\s+/g, ' ').slice(0, 240);

// Every Claude call goes through here. The server-side fallback option isn't enabled on
// every account; if the API rejects it, the same request is retried once without it.
export async function createMessage(client, params) {
  try {
    return await client.beta.messages.create(params);
  } catch (err) {
    if (err instanceof Anthropic.BadRequestError && params.fallbacks && /fallback|beta/i.test(apiReason(err))) {
      console.warn('Claude rejected the fallback option; retrying without it:', apiReason(err));
      const { fallbacks, betas = [], ...rest } = params;
      const keep = betas.filter((b) => !b.startsWith('server-side-fallback'));
      return client.beta.messages.create({ ...rest, ...(keep.length ? { betas: keep } : {}) });
    }
    throw err;
  }
}

// Turn an SDK error into a message a parent (or the person running the app) can act on.
export function aiError(err, { badRequest } = {}) {
  if (!(err instanceof Anthropic.APIError)) return err;
  const why = apiReason(err);
  console.error('Claude API error', err.status, why);
  if (err instanceof Anthropic.RateLimitError) return new AIError('The AI is busy right now. Please try again in a minute.', 503);
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) return new AIError(`AI is not configured correctly on the server (${why || err.status}). Check the ANTHROPIC_API_KEY secret.`, 503);
  if (err instanceof Anthropic.BadRequestError && badRequest) return new AIError(`${badRequest} (${why})`, 400);
  return new AIError(`AI request failed (${err.status ?? 'network'}${why ? `: ${why}` : ''}).`, 502);
}

export async function suggest(env, ctx) {
  const client = new Anthropic({
    apiKey: env.ANTHROPIC_API_KEY,
    ...(env.ANTHROPIC_BASE_URL ? { baseURL: env.ANTHROPIC_BASE_URL } : {}),
    maxRetries: 1,
  });
  let response;
  try {
    response = await createMessage(client, {
      model: env.AI_MODEL || 'claude-opus-5-5',
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
      system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: buildUserPrompt(ctx) }],
    });
  } catch (err) {
    throw aiError(err);
  }
  if (response.stop_reason === 'refusal') throw new AIError('The AI could not help with that request. Try rephrasing it.', 422);
  const text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new AIError('The AI returned an unexpected answer. Please try again.', 502);
  }
  return normalisePicks(raw, { maxCustom: ctx.maxCustom, placeNames: new Set(ctx.places.map((p) => p.name)), windows: ctx.days.flatMap((d) => d.windows), trendIds: new Set(ctx.trends.map((t) => t.activity)) });
}
