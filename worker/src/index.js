// LittleRoam API. Static files are served from ./_site by Cloudflare's assets
// layer; anything that isn't a file (i.e. /api/*) reaches this handler.
import { ACTIVITIES } from '../../js/data.js';
import { isValidCell, isValidBand, neighbourCells } from '../../js/community.js';
import { suggest, AIError } from './ai.js';
import { chatStep, validMessages, isNewUserTurn } from './chat.js';
import { handleMcp } from './mcp.js';

export { Community } from './community.js';

const IDS = new Set(ACTIVITIES.map((a) => a.id));
const PLACE_TYPES = new Set(['playground', 'park', 'nature', 'library', 'museum', 'animals', 'water', 'picnic', 'market', 'treat']);

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
});
const bad = (msg, status = 400) => json({ error: msg }, status);

async function sha256(s) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
}

async function readJSON(request, max = 16000) {
  const text = await request.text();
  if (text.length > max) throw new RangeError('too large');
  return JSON.parse(text);
}

const famOk = (f) => typeof f === 'string' && /^[a-z0-9-]{8,64}$/i.test(f);
const oneOf = (v, opts, d) => (opts.includes(v) ? v : d);

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const community = env.COMMUNITY.get(env.COMMUNITY.idFromName('global'));

    // Public MCP server for AI assistants (Claude, ChatGPT, Gemini…).
    if (url.pathname === '/mcp') {
      if (request.method === 'POST') {
        const ip = await sha256(request.headers.get('cf-connecting-ip') || 'local');
        const usage = await community.consume([{ key: `m:${ip}`, limit: Number(env.MCP_DAILY_LIMIT || 1000) }]);
        if (!usage.ok) return new Response(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message: 'Daily request limit reached for this network. Try again tomorrow.' }, id: null }), { status: 429, headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' } });
      }
      return handleMcp(request, env);
    }

    try {
      if (url.pathname === '/api/health') {
        return json({ ok: true, ai: Boolean(env.ANTHROPIC_API_KEY), chat: Boolean(env.ANTHROPIC_API_KEY), community: true, aiDailyLimit: Number(env.AI_DAILY_LIMIT || 5), chatDailyLimit: Number(env.CHAT_DAILY_LIMIT || 20), minFamilies: Number(env.MIN_FAMILIES || 3) });
      }

      // Anonymous "we did this" signal for Popular near you.
      if (url.pathname === '/api/share' && request.method === 'POST') {
        const b = await readJSON(request);
        if (!famOk(b.fam) || !isValidCell(b.cell) || !IDS.has(b.activity)) return bad('invalid share');
        const bands = Array.isArray(b.bands) ? [...new Set(b.bands)].filter(isValidBand).slice(0, 4) : [];
        if (!bands.length) return bad('invalid share');
        await community.log({ cell: b.cell, bands, activity: b.activity, fam: await sha256(b.fam) });
        return json({ ok: true });
      }

      if (url.pathname === '/api/trends' && request.method === 'GET') {
        const cell = url.searchParams.get('cell');
        if (!isValidCell(cell)) return bad('invalid cell');
        const bands = (url.searchParams.get('bands') || '').split(',').filter(isValidBand);
        const t = await community.trends({ cells: neighbourCells(cell), bands, minFamilies: Number(env.MIN_FAMILIES || 3) });
        return json(t);
      }

      if (url.pathname === '/api/ai' && request.method === 'POST') {
        if (!env.ANTHROPIC_API_KEY) return bad('AI is not enabled on this server.', 503);
        const b = await readJSON(request);
        if (!famOk(b.fam)) return bad('invalid request');
        const note = typeof b.note === 'string' ? b.note.trim().slice(0, 300) : '';

        const ip = request.headers.get('cf-connecting-ip') || 'local';
        const limit = Number(env.AI_DAILY_LIMIT || 5);
        const famKey = `f:${await sha256(b.fam)}`;
        const ipKey = `i:${await sha256(ip)}`;
        const usage = await community.consume([{ key: famKey, limit }, { key: ipKey, limit: limit * 6 }]);
        if (!usage.ok) return json({ error: `You've used today's ${limit} free AI plans. The planner still works without AI, and AI is back tomorrow.`, remaining: 0 }, 429);

        const ages = (Array.isArray(b.ages) ? b.ages : []).filter((a) => Number.isInteger(a) && a >= 0 && a <= 17).slice(0, 6);
        const bands = (Array.isArray(b.bands) ? b.bands : []).filter(isValidBand);
        const trends = isValidCell(b.cell)
          ? (await community.trends({ cells: neighbourCells(b.cell), bands, minFamilies: Number(env.MIN_FAMILIES || 3), limit: 6 })).activities
          : [];
        const places = (Array.isArray(b.places) ? b.places : [])
          .filter((p) => p && typeof p.name === 'string' && PLACE_TYPES.has(p.type))
          .slice(0, 10)
          .map((p) => ({ name: p.name.slice(0, 80), type: p.type, km: Math.round(Number(p.km) * 10) / 10 || 0 }));

        const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
        const toMin = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
        const days = (Array.isArray(b.days) ? b.days : []).slice(0, 2).map((d) => ({
          key: d?.key === 'sun' ? 'sun' : 'sat',
          label: typeof d?.label === 'string' ? d.label.slice(0, 30) : '',
          weather: typeof d?.weather === 'string' ? d.weather.slice(0, 80) : '',
          booked: (Array.isArray(d?.booked) ? d.booked : []).filter((x) => typeof x === 'string').slice(0, 8).map((x) => x.slice(0, 40)),
          windows: (Array.isArray(d?.windows) ? d.windows : [])
            .filter((w) => w && typeof w.id === 'string' && /^(sat|sun)@\d\d:\d\d$/.test(w.id) && TIME.test(w.start) && TIME.test(w.end))
            .map((w) => ({ id: w.id, start: w.start, end: w.end, mins: toMin(w.end) - toMin(w.start) }))
            .filter((w) => w.mins >= 30)
            .slice(0, 6),
        }));
        if (!days.some((d) => d.windows.length)) {
          await community.refund([famKey, ipKey]);
          return bad('There is no free time to plan this weekend.');
        }

        const ctx = {
          note,
          ages,
          vibe: oneOf(b.vibe, ['adventure', 'mix', 'cosy'], 'mix'),
          season: typeof b.season === 'string' ? b.season.slice(0, 12) : '',
          days,
          recentIds: (Array.isArray(b.recentIds) ? b.recentIds : []).filter((id) => IDS.has(id)).slice(0, 12),
          favIds: (Array.isArray(b.favIds) ? b.favIds : []).filter((id) => IDS.has(id)).slice(0, 12),
          trends,
          places,
          maxCustom: note ? 2 : 1,
        };
        try {
          const result = await suggest(env, ctx);
          if (!result.picks.length) throw new AIError('The AI had no good ideas this time. Please try again.', 502);
          return json({ ...result, remaining: usage.remaining });
        } catch (err) {
          await community.refund([famKey, ipKey]);
          if (err instanceof AIError) return bad(err.message, err.status);
          throw err;
        }
      }

      // One step of the chat loop (the browser runs the tools and calls again).
      if (url.pathname === '/api/chat' && request.method === 'POST') {
        if (!env.ANTHROPIC_API_KEY) return bad('Chat needs AI, which is not enabled on this server.', 503);
        let b;
        try { b = await readJSON(request, 400000); } catch (e) { return bad(e instanceof RangeError ? 'This chat is too long. Please start a new chat.' : 'invalid request', 413); }
        if (!famOk(b.fam) || !validMessages(b.messages)) return bad('invalid request');
        const ip = await sha256(request.headers.get('cf-connecting-ip') || 'local');
        const fam = await sha256(b.fam);
        const limit = Number(env.CHAT_DAILY_LIMIT || 20);
        const keys = isNewUserTurn(b.messages)
          ? [{ key: `c:${fam}`, limit }, { key: `ci:${ip}`, limit: limit * 6 }]
          : [{ key: `cs:${ip}`, limit: limit * 30 }]; // tool steps: generous, but bounded
        const usage = await community.consume(keys);
        if (!usage.ok) return json({ error: `You've sent today's ${limit} chat messages. Everything else in the app still works, and chat is back tomorrow.` }, 429);
        try {
          const step = await chatStep(env, b.messages);
          return json({ ...step, remaining: isNewUserTurn(b.messages) ? usage.remaining : undefined });
        } catch (err) {
          if (isNewUserTurn(b.messages)) await community.refund(keys.map((k) => k.key));
          if (err instanceof AIError) return bad(err.message, err.status);
          throw err;
        }
      }

      if (url.pathname.startsWith('/api/')) return bad('not found', 404);
      return env.ASSETS ? env.ASSETS.fetch(request) : new Response('Not found', { status: 404 });
    } catch (err) {
      console.error(err);
      return bad('Something went wrong. Please try again.', 500);
    }
  },
};
