// LittleRoam API. Static files are served from ./_site by Cloudflare's assets
// layer; anything that isn't a file (i.e. /api/*) reaches this handler.
import { ACTIVITIES } from '../../js/data.js';
import { isValidCell, isValidBand, neighbourCells } from '../../js/community.js';
import { suggest, AIError } from './ai.js';

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

async function readJSON(request) {
  if (Number(request.headers.get('content-length') || 0) > 16000) throw new Error('too large');
  return request.json();
}

const famOk = (f) => typeof f === 'string' && /^[a-z0-9-]{8,64}$/i.test(f);
const intIn = (v, lo, hi, d) => (Number.isInteger(v) && v >= lo && v <= hi ? v : d);
const oneOf = (v, opts, d) => (opts.includes(v) ? v : d);

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const community = env.COMMUNITY.get(env.COMMUNITY.idFromName('global'));

    try {
      if (url.pathname === '/api/health') {
        return json({ ok: true, ai: Boolean(env.ANTHROPIC_API_KEY), community: true, aiDailyLimit: Number(env.AI_DAILY_LIMIT || 5), minFamilies: Number(env.MIN_FAMILIES || 3) });
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
        const question = typeof b.question === 'string' ? b.question.trim().slice(0, 400) : '';

        const ip = request.headers.get('cf-connecting-ip') || 'local';
        const limit = Number(env.AI_DAILY_LIMIT || 5);
        const famKey = `f:${await sha256(b.fam)}`;
        const ipKey = `i:${await sha256(ip)}`;
        const usage = await community.consume([{ key: famKey, limit }, { key: ipKey, limit: limit * 6 }]);
        if (!usage.ok) return json({ error: `You've used today's ${limit} free AI suggestions. The planner still works without AI, and AI is back tomorrow.`, remaining: 0 }, 429);

        const ages = (Array.isArray(b.ages) ? b.ages : []).filter((a) => Number.isInteger(a) && a >= 0 && a <= 17).slice(0, 6);
        const bands = (Array.isArray(b.bands) ? b.bands : []).filter(isValidBand);
        const trends = isValidCell(b.cell)
          ? (await community.trends({ cells: neighbourCells(b.cell), bands, minFamilies: Number(env.MIN_FAMILIES || 3), limit: 6 })).activities
          : [];
        const places = (Array.isArray(b.places) ? b.places : [])
          .filter((p) => p && typeof p.name === 'string' && PLACE_TYPES.has(p.type))
          .slice(0, 10)
          .map((p) => ({ name: p.name.slice(0, 80), type: p.type, km: Math.round(Number(p.km) * 10) / 10 || 0 }));

        const ctx = {
          question,
          ages,
          maxMins: intIn(b.maxMins, 10, 600, 60),
          place: oneOf(b.place, ['home', 'outside', 'out', 'any'], 'any'),
          energy: oneOf(b.energy, ['calm', 'active', 'any'], 'any'),
          weather: typeof b.weather === 'string' ? b.weather.slice(0, 40) : '',
          season: typeof b.season === 'string' ? b.season.slice(0, 12) : '',
          when: typeof b.when === 'string' ? b.when.slice(0, 40) : '',
          recentIds: (Array.isArray(b.recentIds) ? b.recentIds : []).filter((id) => IDS.has(id)).slice(0, 12),
          favIds: (Array.isArray(b.favIds) ? b.favIds : []).filter((id) => IDS.has(id)).slice(0, 12),
          trends,
          places,
          maxCustom: question ? 3 : 1,
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

      if (url.pathname.startsWith('/api/')) return bad('not found', 404);
      return env.ASSETS ? env.ASSETS.fetch(request) : new Response('Not found', { status: 404 });
    } catch (err) {
      console.error(err);
      return bad('Something went wrong. Please try again.', 500);
    }
  },
};
