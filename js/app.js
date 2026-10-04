import { ACTIVITIES, CATEGORIES, SEASONS, BUCKET_LISTS, LIFE_SKILLS, TRADITIONS } from './data.js';
import { recommend, planWeekend, TIME_OPTIONS, PLACE_OPTIONS, ENERGY_OPTIONS, currentSeason, ageFromBirthYear, weatherBucket, weatherLabel, fitsAges } from './planner.js';
import { PLACE_TYPES, findPlaces, geocode, getWeather, getPosition, directionsUrl, osmUrl } from './near.js';
import * as store from './store.js';
import * as api from './api.js';
import { cellFor, bandsForAges, bandLabel } from './community.js';

// Optional: set to a Tally/Google Form/Stripe link to collect Plus early-access sign-ups.
const WAITLIST_URL = '';

const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const byId = Object.fromEntries(ACTIVITIES.map((a) => [a.id, a]));
const S = () => store.get();
// AI-created ideas are saved on the device so they can be planned and remembered like any other.
Object.assign(byId, S().custom);
const famId = () => S().fam || (store.set((s) => (s.fam = store.uid())), S().fam);
const kidAges = () => S().family.kids.map((k) => ageFromBirthYear(k.birthYear)).filter((a) => !Number.isNaN(a));
const fmtMins = (m) => (m < 60 ? `${m} min` : m % 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m / 60} h`);
const settingLabel = { home: 'At home', outside: 'Outside', out: 'Trip' };

let weather = null; // { temp, code, unit }

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('show'), 2400);
}

// ---------------- Routing ----------------
const VIEWS = ['today', 'near', 'ideas', 'plan', 'memories'];

function route() {
  const hash = location.hash.slice(1) || 'today';
  if (hash.startsWith('a/')) {
    const a = byId[hash.slice(2)];
    if (!$('main').dataset.view) show('today');
    if (a) openActivity(a, { fromLink: true });
    return;
  }
  show(VIEWS.includes(hash) ? hash : 'today');
}

function show(view) {
  closeSheet();
  $('main').dataset.view = view;
  $$('.tab').forEach((t) => t.setAttribute('aria-current', t.dataset.view === view ? 'page' : 'false'));
  const render = { today: renderToday, near: renderNear, ideas: renderIdeas, plan: renderPlan, memories: renderMemories }[view];
  render($('#view'));
  $('#view').focus({ preventScroll: true });
  window.scrollTo(0, 0);
}

// ---------------- Bottom sheet ----------------
function openSheet(html, onMount) {
  const sheet = $('#sheet');
  $('#sheet-body').innerHTML = html;
  sheet.hidden = false;
  requestAnimationFrame(() => sheet.classList.add('open'));
  onMount?.($('#sheet-body'));
}
function closeSheet() {
  const sheet = $('#sheet');
  if (sheet.hidden) return;
  sheet.classList.remove('open');
  sheet.hidden = true;
  if (location.hash.startsWith('#a/')) history.replaceState(null, '', '#' + ($('main').dataset.view || 'today'));
}

// ---------------- Activity card & detail ----------------
function card(a, { compact = false, why = '', place = '' } = {}) {
  const fav = S().favs.includes(a.id);
  return `<article class="card act" data-id="${a.id}">
    <button class="act-main" data-open="${a.id}" aria-label="Open ${esc(a.title)}">
      <span class="act-emoji" aria-hidden="true">${esc(a.emoji)}</span>
      <span class="act-text">
        <strong>${esc(a.title)}${a.ai ? ' <span class="chip sm ai">✨ AI idea</span>' : ''}</strong>
        <span class="meta">${CATEGORIES[a.cat].emoji} ${CATEGORIES[a.cat].label} · ${fmtMins(a.mins)} · ${settingLabel[a.setting]} · ages ${a.ages[0]}–${a.ages[1]}</span>
        ${why || place ? `<span class="why">${[why && esc(why), place && `📍 ${esc(place)}`].filter(Boolean).join(' · ')}</span>` : ''}
        ${compact ? '' : `<span class="skills">${a.skills.map((s) => `<span class="chip sm">${esc(s)}</span>`).join('')}</span>`}
      </span>
    </button>
    <button class="icon-btn fav ${fav ? 'on' : ''}" data-fav="${a.id}" aria-pressed="${fav}" aria-label="Save ${esc(a.title)}">${fav ? '♥' : '♡'}</button>
  </article>`;
}

function openActivity(a, { fromLink = false } = {}) {
  if (!fromLink) history.replaceState(null, '', '#a/' + a.id);
  openSheet(`
    <div class="detail">
      <div class="detail-head"><span class="big-emoji">${a.emoji}</span>
        <div><h2>${esc(a.title)}</h2>
        <p class="meta">${CATEGORIES[a.cat].emoji} ${CATEGORIES[a.cat].label} · ${fmtMins(a.mins)} · ${settingLabel[a.setting]} · ages ${a.ages[0]}–${a.ages[1]} · ${['No mess', 'A little mess', 'Messy!'][a.mess]}</p></div>
      </div>
      <h3>You'll need</h3><ul class="list">${a.materials.map((m) => `<li>${esc(m)}</li>`).join('')}</ul>
      <h3>How to</h3><ol class="list steps">${a.steps.map((m) => `<li>${esc(m)}</li>`).join('')}</ol>
      <h3>What they're learning</h3><p>${a.skills.map((s) => `<span class="chip">${esc(s)}</span>`).join(' ')}</p>
      ${a.tip ? `<p class="tip">💡 ${esc(a.tip)}</p>` : ''}
      ${a.ai ? '<p class="fine">✨ This idea was written by AI for your family. Read it through first and use your own judgement on safety.</p>' : ''}
      <div class="row wrap gap">
        <button class="btn primary" data-act="done">✅ We did it — save a memory</button>
        <button class="btn" data-act="plan">📅 Add to plan</button>
        <button class="btn ghost" data-act="share">↗ Share</button>
      </div>
    </div>`,
  (el) => {
    $('[data-act=done]', el).onclick = () => memoryForm({ activityId: a.id, title: a.title });
    $('[data-act=plan]', el).onclick = () => pickDay(a);
    $('[data-act=share]', el).onclick = () => share(a);
  });
}

async function share(a) {
  const url = `${location.origin}${location.pathname}#a/${a.id}`;
  const text = `${a.emoji} ${a.title} — a screen-free idea for ${fmtMins(a.mins)}.`;
  try {
    if (navigator.share) await navigator.share({ title: a.title, text, url });
    else {
      await navigator.clipboard.writeText(`${text} ${url}`);
      toast('Link copied');
    }
  } catch { /* user cancelled */ }
}

function weekDays(start = new Date()) {
  // 8 days so a full upcoming weekend is always visible, even on a Sunday.
  return Array.from({ length: 8 }, (_, i) => {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    return d;
  });
}

function pickDay(a) {
  openSheet(`<h2>Add “${esc(a.title)}” to…</h2>
    <div class="grid days">${weekDays().map((d) => `<button class="btn" data-day="${store.isoDate(d)}">${d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' })}</button>`).join('')}</div>`,
  (el) => $$('[data-day]', el).forEach((b) => (b.onclick = () => {
    store.set((s) => {
      (s.week[b.dataset.day] ??= []).push(a.id);
    });
    closeSheet();
    toast('Added to your plan');
  })));
}

// Shared delegation for cards anywhere in the view.
document.addEventListener('click', (e) => {
  const open = e.target.closest('[data-open]');
  if (open) return openActivity(byId[open.dataset.open]);
  const fav = e.target.closest('[data-fav]');
  if (fav) {
    const id = fav.dataset.fav;
    store.set((s) => (s.favs = s.favs.includes(id) ? s.favs.filter((x) => x !== id) : [...s.favs, id]));
    const on = S().favs.includes(id);
    $$(`[data-fav="${id}"]`).forEach((b) => { b.classList.toggle('on', on); b.textContent = on ? '♥' : '♡'; b.setAttribute('aria-pressed', on); });
    toast(on ? 'Saved to favourites' : 'Removed from favourites');
  }
  if (e.target.closest('[data-close]')) closeSheet();
});

// ---------------- Today: the planner bot ----------------
function renderToday(root) {
  const s = S();
  const hello = s.family.name ? `Hi, ${esc(s.family.name)} family` : 'Hi there';
  const season = SEASONS[currentSeason()];
  const w = weather ? `<span class="chip">${esc(weatherLabel(weather.code))} · ${Math.round(weather.temp)}${esc(weather.unit)}</span>` : '';
  const today = store.isoDate();
  const planned = (s.week[today] || []).map((id) => byId[id]).filter(Boolean);
  root.innerHTML = `
    <section class="hero">
      <p class="eyebrow">${season.emoji} ${season.label} ${w}</p>
      <h1>${hello} 👋</h1>
      <p class="lede">Tell me a little about right now and I'll plan something screen-free you'll actually remember.</p>
    </section>
    ${planned.length ? `<section><h2 class="h">On today's plan</h2>${planned.map((a) => card(a, { compact: true })).join('')}</section>` : ''}
    ${api.aiEnabled() ? `<form id="ask" class="card pad ask">
      <label for="ask-q">✨ Ask for something specific</label>
      <div class="row gap"><input id="ask-q" class="input grow" maxlength="400" placeholder="e.g. a calm idea for a 4-year-old with a cold" />
      <button class="btn primary">Ask</button></div>
      <p class="fine">Your question, your kids' ages and today's context are sent to our AI (Claude) to plan. No names or photos.</p>
    </form>` : ''}
    <section class="chat" id="chat" aria-live="polite"></section>
    <section id="popular"></section>
    <section class="quick">
      <h2 class="h">Quick picks</h2>
      <div class="grid two">
        <button class="tile" data-quick="rainy">🌧️<span>Rainy-day rescue</span></button>
        <button class="tile" data-quick="ten">⏱️<span>15 minutes before dinner</span></button>
        <button class="tile" data-quick="weekend">🗓️<span>Plan my weekend</span></button>
        <button class="tile" data-quick="near">📍<span>Things to do near me</span></button>
      </div>
    </section>`;
  $$('[data-quick]', root).forEach((b) => (b.onclick = () => quick(b.dataset.quick)));
  const ask = $('#ask', root);
  if (ask) ask.onsubmit = (e) => {
    e.preventDefault();
    const q = $('#ask-q', root).value.trim();
    if (!q) return;
    $('#chat').innerHTML = '';
    bubble(esc(q), 'me');
    aiSuggest({ maxMins: 600, place: 'any', energy: 'any' }, q);
    $('#ask-q', root).value = '';
  };
  startBot();
  renderPopular();
}

// ---------------- Popular near you (anonymous, aggregated) ----------------
async function renderPopular() {
  const el = $('#popular');
  if (!el || !api.communityEnabled()) return;
  const loc = S().location;
  const bands = bandsForAges(kidAges());
  if (!loc || !bands.length) {
    el.innerHTML = `<h2 class="h">👨‍👩‍👧 Popular with families near you</h2>
      <p class="meta">${!loc ? 'Set your area in <a href="#near">Near me</a>' : 'Add your kids\' ages in ⚙️ settings'} to see what families with kids the same age are doing nearby.</p>`;
    return;
  }
  el.innerHTML = '<h2 class="h">👨‍👩‍👧 Popular with families near you</h2><p class="meta">Loading…</p>';
  try {
    const t = await api.getTrends(cellFor(loc), bands);
    const acts = t.activities.map((x) => ({ a: byId[x.activity], n: x.families })).filter((x) => x.a);
    const where = loc.label === 'Your location' ? 'you' : esc(loc.label);
    el.innerHTML = `<h2 class="h">👨‍👩‍👧 Popular with families near you</h2>
      ${acts.length
        ? `<p class="meta">What ${t.families} families with kids ${bands.map(bandLabel).join(' & ')} near ${where} shared in the last 30 days.</p>
           ${acts.slice(0, 5).map(({ a, n }) => card(a, { compact: true, why: `${n} families did this` })).join('')}`
        : `<p class="meta">Not enough families near ${where} have shared yet. We only show an activity once at least ${api.minFamilies()} families have done it, so nobody can be identified. When you save a memory, you can add it anonymously to help.</p>`}`;
  } catch {
    el.innerHTML = '';
  }
}

// ---------------- AI suggestions ----------------
function aiBody(ctx, question = '') {
  const ages = kidAges();
  const loc = S().location;
  const now = new Date();
  return {
    fam: famId(),
    question,
    ages,
    bands: bandsForAges(ages),
    cell: loc ? cellFor(loc) : null,
    maxMins: ctx.maxMins,
    place: ctx.place,
    energy: ctx.energy,
    weather: weather ? `${weatherLabel(weather.code)} ${Math.round(weather.temp)}${weather.unit}` : '',
    season: SEASONS[currentSeason()].label,
    when: now.toLocaleDateString('en-GB', { weekday: 'long' }) + (now.getHours() < 12 ? ' morning' : now.getHours() < 17 ? ' afternoon' : ' evening'),
    recentIds: S().recent.filter((id) => !id.startsWith('ai-')),
    favIds: S().favs.filter((id) => !id.startsWith('ai-')),
    places: (nearState.places || []).filter((p) => p.named).slice(0, 10).map((p) => ({ name: p.name, type: p.type, km: Number(p.km.toFixed(1)) })),
  };
}

async function aiSuggest(ctx, question = '') {
  const thinking = bubble('<span class="typing">✨ Thinking about your family…</span>');
  try {
    const res = await api.askAI(aiBody(ctx, question));
    thinking.remove();
    const customs = res.picks.filter((p) => p.custom).map((p) => p.custom);
    if (customs.length) {
      store.set((s) => {
        s.custom ??= {};
        for (const c of customs) s.custom[c.id] = c;
        // Keep the 30 most recent AI ideas, plus any that are planned, saved or remembered.
        const keep = new Set([...s.favs, ...Object.values(s.week).flat(), ...s.memories.map((m) => m.activityId)]);
        const ids = Object.keys(s.custom);
        ids.slice(0, Math.max(0, ids.length - 30)).forEach((id) => { if (!keep.has(id)) delete s.custom[id]; });
      });
      Object.assign(byId, ...customs.map((c) => ({ [c.id]: c })));
    }
    const picks = res.picks.map((p) => ({ a: byId[p.activityId], why: p.why, place: p.placeName })).filter((p) => p.a);
    store.set((s) => (s.recent = [...picks.map((p) => p.a.id), ...s.recent].slice(0, 12)));
    const el = bubble(`${esc(res.message || 'Here are some ideas:')}
      <div class="picks">${picks.map((p) => card(p.a, { why: p.why, place: p.place })).join('')}</div>
      <p class="fine">✨ AI suggestions · ${res.remaining} left today</p>
      <div class="row wrap gap"><button class="btn sm" data-more>🔄 Show me others</button><button class="btn sm ghost" data-restart>Start over</button></div>`);
    $('[data-more]', el).onclick = () => { $('[data-more]', el).parentElement.remove(); question ? aiSuggest(ctx, question) : suggest(ctx, Date.now(), { ai: false }); };
    $('[data-restart]', el).onclick = () => { $('#chat').innerHTML = ''; startBot(); };
    el.scrollIntoView({ block: 'start', behavior: 'smooth' });
  } catch (err) {
    thinking.remove();
    bubble(`${esc(err.message)} ${question ? '' : 'Here are some ideas from our library instead.'}`);
    if (!question) suggest(ctx, Date.now(), { ai: false });
  }
}

function bubble(html, who = 'bot') {
  const chat = $('#chat');
  if (!chat) return null;
  const el = document.createElement('div');
  el.className = `bubble ${who}`;
  el.innerHTML = html;
  chat.append(el);
  if (who === 'me') el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  return el;
}

function choices(opts, onPick) {
  const el = bubble(`<div class="choices">${opts.map((o) => `<button class="chip-btn" data-v="${o.id}">${esc(o.label)}</button>`).join('')}</div>`, 'choices-row');
  $$('button', el).forEach((b) => (b.onclick = () => {
    el.remove();
    bubble(esc(b.textContent), 'me');
    onPick(b.dataset.v);
  }));
}

function startBot() {
  const ctx = {};
  const ages = kidAges();
  bubble(ages.length
    ? `Planning for ${ages.length === 1 ? `your ${ages[0]}-year-old` : `kids aged ${ages.join(' & ')}`}. How much time do you have?`
    : 'How much time do you have?');
  choices(TIME_OPTIONS, (t) => {
    ctx.maxMins = TIME_OPTIONS.find((o) => o.id === t).max;
    bubble('Where would you like to be?');
    choices(PLACE_OPTIONS, (p) => {
      ctx.place = p;
      bubble('And what\'s the energy level?');
      choices(ENERGY_OPTIONS, (e) => {
        ctx.energy = e;
        suggest(ctx);
      });
    });
  });
}

function baseCtx(extra = {}) {
  return {
    ages: kidAges(),
    weather: weather ? weatherBucket(weather.code) : null,
    recentIds: S().recent,
    favIds: S().favs,
    ...extra,
  };
}

function suggest(ctx, seed = Date.now(), { ai = api.aiEnabled() } = {}) {
  if (ai) return aiSuggest(ctx);
  const full = baseCtx(ctx);
  let picks = recommend(full, { seed });
  let note = '';
  if (!picks.length) {
    picks = recommend({ ...full, place: 'any', energy: 'any' }, { seed });
    note = 'Nothing matched exactly, so I loosened the filters a little. ';
  }
  if (full.weather === 'wet') note += 'It looks wet out, so I leaned towards rain-friendly ideas. ';
  const el = bubble(`${note}Here are ${picks.length} ideas:<div class="picks">${picks.map((a) => card(a)).join('')}</div>
    <div class="row wrap gap"><button class="btn sm" data-more>🔄 Show me others</button><button class="btn sm ghost" data-restart>Start over</button>
    ${ctx.place === 'out' ? '<a class="btn sm ghost" href="#near">📍 Find places near me</a>' : ''}</div>`);
  store.set((s) => (s.recent = [...picks.map((a) => a.id), ...s.recent].slice(0, 12)));
  $('[data-more]', el).onclick = () => { $('[data-more]', el).parentElement.remove(); suggest(ctx, seed + 7, { ai: false }); };
  $('[data-restart]', el).onclick = () => { $('#chat').innerHTML = ''; startBot(); };
  el.scrollIntoView({ block: 'start', behavior: 'smooth' });
}

function quick(kind) {
  if (kind === 'near') return (location.hash = 'near');
  if (kind === 'weekend') return weekendSheet();
  $('#chat').innerHTML = '';
  if (kind === 'rainy') { bubble('Rainy-day rescue, coming up ☔'); suggest({ place: 'home', maxMins: 90, energy: 'any', weather: 'wet' }, Date.now(), { ai: false }); }
  if (kind === 'ten') { bubble('Short and sweet — 30 minutes or less.'); suggest({ place: 'home', maxMins: 30, energy: 'any', mess: 1 }, Date.now(), { ai: false }); }
}

function weekendSheet(seed = Date.now()) {
  const { sat, sun } = planWeekend(baseCtx(), seed);
  const nextSat = new Date();
  nextSat.setDate(nextSat.getDate() + ((6 - nextSat.getDay() + 7) % 7));
  const nextSun = new Date(nextSat);
  nextSun.setDate(nextSat.getDate() + 1);
  openSheet(`<h2>Your weekend plan</h2>
    <h3>Saturday · ${nextSat.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</h3>${sat.map((a) => card(a, { compact: true })).join('')}
    <h3>Sunday · ${nextSun.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</h3>${sun.map((a) => card(a, { compact: true })).join('')}
    <div class="row wrap gap"><button class="btn primary" data-save>📅 Save to my plan</button><button class="btn" data-again>🔄 Shuffle</button></div>`,
  (el) => {
    $('[data-again]', el).onclick = () => weekendSheet(seed + 11);
    $('[data-save]', el).onclick = () => {
      store.set((s) => {
        (s.week[store.isoDate(nextSat)] ??= []).push(...sat.map((a) => a.id));
        (s.week[store.isoDate(nextSun)] ??= []).push(...sun.map((a) => a.id));
      });
      closeSheet();
      toast('Weekend saved to your plan');
    };
  });
}

// ---------------- Near me ----------------
let nearState = { type: 'playground', radius: 5, places: null, error: null, loading: false };

function renderNear(root) {
  const loc = S().location;
  root.innerHTML = `
    <section class="hero"><h1>Things to do near me</h1>
      <p class="lede">Free, mostly outdoor places from open map data — no ads, no sponsored rankings.</p></section>
    <section class="card pad">
      <div class="row gap wrap">
        <button class="btn primary" id="use-loc">📍 Use my location</button>
        <form id="loc-form" class="row gap grow loc-form"><input id="loc-q" class="input grow" placeholder="…or a city / postcode" aria-label="City or postcode" /><button class="btn">Go</button></form>
      </div>
      ${loc ? `<p class="meta mt">Searching around <strong>${esc(loc.label)}</strong></p>` : ''}
    </section>
    <div class="chips-scroll" role="tablist">${Object.entries(PLACE_TYPES).map(([k, t]) => `<button class="chip-btn ${k === nearState.type ? 'on' : ''}" data-type="${k}" role="tab" aria-selected="${k === nearState.type}">${t.emoji} ${t.label}</button>`).join('')}</div>
    <div class="row gap center-v"><label for="radius" class="meta">Within</label>
      <select id="radius" class="input sm">${[2, 5, 10, 25].map((r) => `<option value="${r}" ${r === nearState.radius ? 'selected' : ''}>${r} km</option>`).join('')}</select></div>
    <section id="places" aria-live="polite"></section>
    <p class="fine">Place data © OpenStreetMap contributors. Always check opening hours and conditions before you go.</p>`;
  $('#use-loc', root).onclick = async () => {
    try { setLocation(await getPosition()); } catch (e) { toast(e.message); }
  };
  $('#loc-form', root).onsubmit = async (e) => {
    e.preventDefault();
    const q = $('#loc-q', root).value.trim();
    if (!q) return;
    try { setLocation(await geocode(q)); } catch (err) { toast(err.message); }
  };
  $$('[data-type]', root).forEach((b) => (b.onclick = () => { nearState.type = b.dataset.type; nearState.places = null; renderNear(root); }));
  $('#radius', root).onchange = (e) => { nearState.radius = Number(e.target.value); nearState.places = null; renderNear(root); };
  renderPlaces();
}

function setLocation(loc) {
  store.set((s) => (s.location = loc));
  nearState.places = null;
  loadWeather();
  if ($('main').dataset.view === 'near') renderNear($('#view'));
}

async function renderPlaces() {
  const el = $('#places');
  const loc = S().location;
  if (!loc) { el.innerHTML = '<p class="empty">Share your location or type a city to see places nearby.</p>'; return; }
  const t = PLACE_TYPES[nearState.type];
  if (!nearState.places) {
    el.innerHTML = '<p class="empty">Looking for places… 🔎</p>';
    const key = `${nearState.type}|${nearState.radius}|${loc.lat},${loc.lon}`;
    nearState.key = key;
    try {
      const places = await findPlaces(nearState.type, loc, nearState.radius);
      if (nearState.key !== key) return;
      nearState.places = places;
      nearState.error = null;
    } catch (e) {
      if (nearState.key !== key) return;
      el.innerHTML = `<p class="empty">${esc(e.message)}</p><button class="btn" id="retry">Try again</button>`;
      $('#retry').onclick = renderPlaces;
      return;
    }
  }
  const places = nearState.places;
  if (!places.length) {
    el.innerHTML = `<p class="empty">No ${t.label.toLowerCase()} found within ${nearState.radius} km. Try a bigger radius.</p>`;
    return;
  }
  const pair = t.pair && byId[t.pair];
  el.innerHTML = `
    ${pair ? `<button class="card pair" data-open="${pair.id}">💡 Make it an adventure: <strong>${pair.emoji} ${esc(pair.title)}</strong></button>` : ''}
    <p class="meta">${places.length} found</p>
    ${places.slice(0, 40).map((p) => `
      <article class="card place">
        <div class="grow"><strong>${t.emoji} ${esc(p.name)}</strong>
          <p class="meta">${p.km < 1 ? Math.round(p.km * 1000) + ' m' : p.km.toFixed(1) + ' km'} away
          ${p.fee === 'no' ? ' · Free' : ''}${p.toilets === 'yes' ? ' · Toilets' : ''}${p.wheelchair === 'yes' ? ' · ♿' : ''}${p.hours ? ' · ' + esc(p.hours) : ''}</p></div>
        <div class="col gap-sm">
          <a class="btn sm" href="${directionsUrl(p)}" target="_blank" rel="noopener">Directions</a>
          ${p.website ? `<a class="btn sm ghost" href="${esc(p.website)}" target="_blank" rel="noopener">Website</a>` : `<a class="btn sm ghost" href="${osmUrl(p)}" target="_blank" rel="noopener">Map</a>`}
        </div>
      </article>`).join('')}`;
}

// ---------------- Ideas library ----------------
let ideaFilter = { cat: 'all', setting: 'all', q: '', forKids: true };

function renderIdeas(root) {
  const ages = kidAges();
  root.innerHTML = `
    <section class="hero"><h1>Idea library</h1><p class="lede">${ACTIVITIES.length} screen-free activities, each with steps, materials and what kids learn.</p></section>
    <input class="input" id="q" type="search" placeholder="Search: slime, baking, rainy…" value="${esc(ideaFilter.q)}" aria-label="Search ideas" />
    <div class="chips-scroll">${[['all', '✨ All'], ...Object.entries(CATEGORIES).map(([k, c]) => [k, `${c.emoji} ${c.label}`]), ['favs', '♥ Saved']].map(([k, l]) => `<button class="chip-btn ${ideaFilter.cat === k ? 'on' : ''}" data-cat="${k}">${l}</button>`).join('')}</div>
    <div class="row gap wrap center-v">
      <select class="input sm" id="setting" aria-label="Where">${[['all', 'Anywhere'], ['home', 'At home'], ['outside', 'Outside'], ['out', 'Trips']].map(([k, l]) => `<option value="${k}" ${ideaFilter.setting === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
      ${ages.length ? `<label class="meta"><input type="checkbox" id="forkids" ${ideaFilter.forKids ? 'checked' : ''}/> Right for my kids' ages</label>` : ''}
    </div>
    <section id="idea-list"></section>`;
  const draw = () => {
    const q = ideaFilter.q.toLowerCase();
    const list = ACTIVITIES.filter((a) =>
      (ideaFilter.cat === 'all' || (ideaFilter.cat === 'favs' ? S().favs.includes(a.id) : a.cat === ideaFilter.cat)) &&
      (ideaFilter.setting === 'all' || a.setting === ideaFilter.setting) &&
      (!ages.length || !ideaFilter.forKids || fitsAges(a, ages)) &&
      (!q || [a.title, a.tip, ...a.materials, ...a.skills, ...a.steps, CATEGORIES[a.cat].label].join(' ').toLowerCase().includes(q)));
    $('#idea-list').innerHTML = list.length ? list.map((a) => card(a)).join('') : '<p class="empty">No ideas match — try clearing a filter.</p>';
  };
  $('#q', root).oninput = (e) => { ideaFilter.q = e.target.value; draw(); };
  $$('[data-cat]', root).forEach((b) => (b.onclick = () => { ideaFilter.cat = b.dataset.cat; renderIdeas(root); }));
  $('#setting', root).onchange = (e) => { ideaFilter.setting = e.target.value; draw(); };
  const fk = $('#forkids', root);
  if (fk) fk.onchange = (e) => { ideaFilter.forKids = e.target.checked; draw(); };
  draw();
}

// ---------------- Plan: this week + long term ----------------
let planTab = 'week';

function renderPlan(root) {
  root.innerHTML = `
    <section class="hero"><h1>Plans</h1><p class="lede">Short-term plans for this week, and long-term goals that grow with your family.</p></section>
    <div class="seg" role="tablist">${[['week', 'This week'], ['bucket', 'Bucket list'], ['skills', 'Life skills'], ['traditions', 'Traditions']].map(([k, l]) => `<button role="tab" class="${planTab === k ? 'on' : ''}" aria-selected="${planTab === k}" data-ptab="${k}">${l}</button>`).join('')}</div>
    <section id="plan-body"></section>`;
  $$('[data-ptab]', root).forEach((b) => (b.onclick = () => { planTab = b.dataset.ptab; renderPlan(root); }));
  ({ week: planWeek, bucket: planBucket, skills: planSkills, traditions: planTraditions })[planTab]($('#plan-body'));
}

function planWeek(el) {
  const s = S();
  el.innerHTML = `<div class="row gap wrap"><button class="btn primary" id="wk">✨ Plan my weekend for me</button></div>
    ${weekDays().map((d) => {
      const key = store.isoDate(d);
      const items = (s.week[key] || []).map((id, i) => ({ a: byId[id], i })).filter((x) => x.a);
      return `<div class="day card pad"><div class="row space center-v"><strong>${d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' })}</strong>
          <a class="btn sm ghost" href="#ideas">+ Add</a></div>
        ${items.length ? items.map(({ a, i }) => `<div class="row space center-v plan-item"><button class="link" data-open="${a.id}">${a.emoji} ${esc(a.title)}</button>
          <span class="row gap-sm"><button class="icon-btn" title="Done — save memory" data-done="${a.id}">✅</button><button class="icon-btn" title="Remove" data-rm="${key}|${i}">✕</button></span></div>`).join('') : '<p class="meta">Free day — leave room for boredom, it\'s good for them.</p>'}
      </div>`;
    }).join('')}`;
  $('#wk', el).onclick = () => weekendSheet();
  $$('[data-done]', el).forEach((b) => (b.onclick = () => memoryForm({ activityId: b.dataset.done, title: byId[b.dataset.done].title })));
  $$('[data-rm]', el).forEach((b) => (b.onclick = () => {
    const [key, i] = b.dataset.rm.split('|');
    store.set((st) => { st.week[key].splice(Number(i), 1); if (!st.week[key].length) delete st.week[key]; });
    planWeek(el);
  }));
}

function planBucket(el) {
  const season = currentSeason();
  const draw = (sk) => {
    const items = BUCKET_LISTS[sk];
    const done = items.filter((_, i) => S().bucket[`${sk}:${i}`]).length;
    el.innerHTML = `<div class="chips-scroll">${Object.entries(SEASONS).map(([k, v]) => `<button class="chip-btn ${k === sk ? 'on' : ''}" data-season="${k}">${v.emoji} ${v.label}${k === season ? ' (now)' : ''}</button>`).join('')}</div>
      <div class="progress" aria-label="${done} of ${items.length} done"><span style="width:${(done / items.length) * 100}%"></span></div>
      <p class="meta">${done} of ${items.length} done — no rush, it's not a race.</p>
      <ul class="checklist">${items.map((t, i) => `<li><label><input type="checkbox" data-b="${sk}:${i}" ${S().bucket[`${sk}:${i}`] ? 'checked' : ''}/> <span>${esc(t)}</span></label></li>`).join('')}</ul>`;
    $$('[data-season]', el).forEach((b) => (b.onclick = () => draw(b.dataset.season)));
    $$('[data-b]', el).forEach((c) => (c.onchange = () => {
      store.set((s) => (c.checked ? (s.bucket[c.dataset.b] = true) : delete s.bucket[c.dataset.b]));
      if (c.checked) {
        const title = BUCKET_LISTS[sk][Number(c.dataset.b.split(':')[1])];
        toast('Lovely! Want to save it as a memory?');
        memoryForm({ title });
      } else draw(sk);
    }));
  };
  draw(season);
}

function planSkills(el) {
  const ages = kidAges();
  el.innerHTML = `<p class="meta">Age bands are rough guides — every child is different. Tick skills off as they master them.</p>
    ${LIFE_SKILLS.map((b, bi) => {
      const relevant = !ages.length || ages.some((a) => a >= b.ages[0] - 1 && a <= b.ages[1] + 1);
      const done = b.skills.filter((_, i) => S().skills[`${bi}:${i}`]).length;
      return `<details class="card pad" ${relevant ? 'open' : ''}><summary><strong>${b.band}</strong> <span class="meta">${done}/${b.skills.length}</span></summary>
        <ul class="checklist">${b.skills.map((t, i) => `<li><label><input type="checkbox" data-s="${bi}:${i}" ${S().skills[`${bi}:${i}`] ? 'checked' : ''}/> <span>${esc(t)}</span></label></li>`).join('')}</ul></details>`;
    }).join('')}
    <a class="btn ghost" href="#ideas" id="ls-ideas">🧺 Browse life-skills activities</a>`;
  $('#ls-ideas', el).onclick = () => { ideaFilter.cat = 'lifeskills'; };
  $$('[data-s]', el).forEach((c) => (c.onchange = () => {
    store.set((s) => (c.checked ? (s.skills[c.dataset.s] = true) : delete s.skills[c.dataset.s]));
    if (c.checked) toast('A new skill unlocked 🎉');
    planSkills(el);
  }));
}

function planTraditions(el) {
  const mine = S().traditions;
  el.innerHTML = `<p class="meta">Small rituals, repeated, become the memories kids keep. Adopt one or two.</p>
    ${TRADITIONS.map((t) => `<article class="card pad row space center-v"><div><strong>${t.emoji} ${esc(t.title)}</strong> <span class="chip sm">${t.cadence}</span><p class="meta">${esc(t.desc)}</p></div>
      <button class="btn sm ${mine.includes(t.title) ? 'primary' : ''}" data-t="${esc(t.title)}">${mine.includes(t.title) ? '✓ Ours' : 'Adopt'}</button></article>`).join('')}`;
  $$('[data-t]', el).forEach((b) => (b.onclick = () => {
    const t = b.dataset.t;
    store.set((s) => (s.traditions = s.traditions.includes(t) ? s.traditions.filter((x) => x !== t) : [...s.traditions, t]));
    planTraditions(el);
  }));
}

// ---------------- Memories ----------------
const MOODS = ['😍', '😄', '🙂', '😅', '😴'];

// Only library activities can be shared, and only once we know the area and the kids' ages.
const canShare = (id) => api.communityEnabled() && id && !id.startsWith('ai-') && Boolean(byId[id]) && Boolean(S().location) && bandsForAges(kidAges()).length > 0;

function memoryForm({ activityId = null, title = '' } = {}) {
  openSheet(`<h2>Save a memory</h2>
    <form id="mem" class="col gap">
      <label>What did you do?<input class="input" name="title" required value="${esc(title)}" /></label>
      <label>When?<input class="input" type="date" name="date" value="${store.isoDate()}" /></label>
      <fieldset class="moods"><legend>How was it?</legend>${MOODS.map((m, i) => `<label><input type="radio" name="mood" value="${m}" ${i === 1 ? 'checked' : ''}/><span>${m}</span></label>`).join('')}</fieldset>
      <label>A moment to remember<textarea class="input" name="note" rows="3" placeholder="The bit you'll want to remember in 10 years…"></textarea></label>
      <label>Something they said <textarea class="input" name="quote" rows="2" placeholder="“Mummy, the clouds are having a party!”"></textarea></label>
      <label class="file">📷 Add a photo (stays on your phone)<input type="file" name="photo" accept="image/*" /></label>
      ${canShare(activityId) ? `<label class="share"><input type="checkbox" name="share" ${S().shareNearby ? 'checked' : ''}/>
        <span>Add anonymously to “Popular near you”<small>Shares only the activity, your kids' age bands and a ~5 km area. No names, notes or photos.</small></span></label>` : ''}
      <button class="btn primary">Save memory</button>
    </form>`,
  (el) => {
    $('#mem', el).onsubmit = async (e) => {
      e.preventDefault();
      const f = new FormData(e.target);
      const file = f.get('photo');
      let photoId = null;
      if (file && file.size) {
        try {
          photoId = store.uid();
          await store.putPhoto(photoId, await store.compressImage(file));
        } catch (err) {
          photoId = null;
          toast('Could not save the photo, but your memory is saved.');
        }
      }
      store.set((s) => s.memories.unshift({
        id: store.uid(), date: f.get('date') || store.isoDate(), title: String(f.get('title')).trim(), activityId,
        mood: f.get('mood'), note: String(f.get('note') || '').trim(), quote: String(f.get('quote') || '').trim(), photoId,
      }));
      if (canShare(activityId)) {
        const share = f.get('share') === 'on';
        store.set((s) => (s.shareNearby = share));
        if (share) api.shareActivity({ fam: famId(), cell: cellFor(S().location), bands: bandsForAges(kidAges()), activity: activityId }).catch(() => {});
      }
      closeSheet();
      toast('Memory saved 💛');
      if ($('main').dataset.view === 'memories') renderMemories($('#view'));
    };
  });
}

function renderMemories(root) {
  const mems = [...S().memories].sort((a, b) => b.date.localeCompare(a.date));
  const year = new Date().getFullYear();
  const thisYear = mems.filter((m) => m.date.startsWith(String(year)));
  const month = store.isoDate().slice(0, 7);
  const thisMonth = mems.filter((m) => m.date.startsWith(month)).length;
  const outdoors = thisYear.filter((m) => m.activityId && byId[m.activityId]?.setting !== 'home').length;
  root.innerHTML = `
    <section class="hero"><h1>Our memories</h1><p class="lede">Private to your family. No likes, no followers, no comparing.</p></section>
    <div class="grid three stats">
      <div class="stat"><strong>${thisMonth}</strong><span>this month</span></div>
      <div class="stat"><strong>${thisYear.length}</strong><span>in ${year}</span></div>
      <div class="stat"><strong>${outdoors}</strong><span>outdoor adventures</span></div>
    </div>
    <div class="row gap wrap"><button class="btn primary" id="new-mem">+ New memory</button>${thisYear.length ? '<button class="btn" id="recap">🎞️ Our year so far</button>' : ''}</div>
    <section id="timeline">${mems.length ? '' : '<p class="empty">Your first memory is one activity away. Tap ✅ on any idea when you\'ve done it.</p>'}</section>`;
  $('#new-mem', root).onclick = () => memoryForm();
  const recapBtn = $('#recap', root);
  if (recapBtn) recapBtn.onclick = () => recap(thisYear, year);
  const tl = $('#timeline', root);
  let lastMonth = '';
  for (const m of mems) {
    const mk = m.date.slice(0, 7);
    if (mk !== lastMonth) {
      lastMonth = mk;
      tl.insertAdjacentHTML('beforeend', `<h2 class="h">${new Date(m.date + 'T12:00').toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</h2>`);
    }
    tl.insertAdjacentHTML('beforeend', `<article class="card memory" data-mid="${m.id}">
      ${m.photoId ? `<img alt="" class="mem-photo" data-photo="${m.photoId}" />` : ''}
      <div class="pad"><div class="row space"><strong>${esc(m.mood || '')} ${esc(m.title)}</strong><span class="meta">${new Date(m.date + 'T12:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</span></div>
      ${m.note ? `<p>${esc(m.note)}</p>` : ''}${m.quote ? `<blockquote>“${esc(m.quote)}”</blockquote>` : ''}
      <button class="link danger sm" data-del="${m.id}">Delete</button></div></article>`);
  }
  $$('[data-photo]', tl).forEach(async (img) => {
    try {
      const blob = await store.getPhoto(img.dataset.photo);
      if (blob) img.src = URL.createObjectURL(blob);
      else img.remove();
    } catch { img.remove(); }
  });
  $$('[data-del]', tl).forEach((b) => (b.onclick = async () => {
    if (!confirm('Delete this memory? This cannot be undone.')) return;
    const m = S().memories.find((x) => x.id === b.dataset.del);
    if (m?.photoId) await store.deletePhoto(m.photoId).catch(() => {});
    store.set((s) => (s.memories = s.memories.filter((x) => x.id !== b.dataset.del)));
    renderMemories(root);
  }));
}

function recap(mems, year) {
  const cats = {};
  mems.forEach((m) => { const c = byId[m.activityId]?.cat; if (c) cats[c] = (cats[c] || 0) + 1; });
  const top = Object.entries(cats).sort((a, b) => b[1] - a[1])[0];
  const fav = mems.filter((m) => m.mood === '😍');
  const quotes = mems.filter((m) => m.quote).slice(0, 3);
  openSheet(`<div class="recap"><p class="eyebrow">Our ${year}</p><h2>${mems.length} memories made together</h2>
    ${top ? `<p>Your family's favourite kind of fun: <strong>${CATEGORIES[top[0]].emoji} ${CATEGORIES[top[0]].label}</strong></p>` : ''}
    ${fav.length ? `<p>😍 ${fav.length} absolute favourite${fav.length > 1 ? 's' : ''}, including <strong>${esc(fav[0].title)}</strong>.</p>` : ''}
    ${quotes.map((q) => `<blockquote>“${esc(q.quote)}”</blockquote>`).join('')}
    <p class="meta">Keep going — the ordinary days count most.</p></div>`);
}

// ---------------- Settings, onboarding, Plus ----------------
function settings() {
  const s = S();
  openSheet(`<h2>Family settings</h2>
    <form id="fam" class="col gap">
      <label>Family name (optional)<input class="input" name="name" value="${esc(s.family.name)}" placeholder="e.g. Mathur" /></label>
      <fieldset><legend>Kids — birth years only, nothing else needed</legend><div id="kids" class="col gap-sm"></div>
        <button type="button" class="btn sm" id="add-kid">+ Add a child</button></fieldset>
      <button class="btn primary">Save</button>
    </form>
    <hr/>
    <h3>Your data</h3><p class="meta">Everything is stored only on this device. Back it up so you never lose your memories (photos are not included in the backup file).</p>
    <div class="row gap wrap"><button class="btn" id="export">⬇ Export backup</button><label class="btn">⬆ Import<input type="file" id="import" accept="application/json" hidden /></label><button class="btn ghost danger" id="wipe">Erase everything</button></div>
    <hr/><button class="btn ghost" id="plus-btn">✨ About LittleRoam Plus</button>`,
  (el) => {
    const kidsEl = $('#kids', el);
    const yr = new Date().getFullYear();
    const row = (k = { name: '', birthYear: yr - 4 }) => {
      kidsEl.insertAdjacentHTML('beforeend', `<div class="row gap kid"><input class="input grow" name="kname" placeholder="Nickname (optional)" value="${esc(k.name)}" aria-label="Nickname" />
        <select class="input sm" name="kyear" aria-label="Birth year">${Array.from({ length: 16 }, (_, i) => yr - i).map((y) => `<option ${Number(k.birthYear) === y ? 'selected' : ''}>${y}</option>`).join('')}</select>
        <button type="button" class="icon-btn" aria-label="Remove child">✕</button></div>`);
      const last = kidsEl.lastElementChild;
      $('button', last).onclick = () => last.remove();
    };
    (s.family.kids.length ? s.family.kids : [undefined]).forEach((k) => row(k));
    $('#add-kid', el).onclick = () => row();
    $('#fam', el).onsubmit = (e) => {
      e.preventDefault();
      const kids = $$('.kid', el).map((r) => ({ name: $('[name=kname]', r).value.trim(), birthYear: Number($('[name=kyear]', r).value) }));
      store.set((st) => { st.family = { name: $('[name=name]', el).value.trim(), kids }; st.onboarded = true; });
      closeSheet();
      toast('Saved');
      route();
    };
    $('#export', el).onclick = () => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([store.exportJSON()], { type: 'application/json' }));
      a.download = `littleroam-backup-${store.isoDate()}.json`;
      a.click();
    };
    $('#import', el).onchange = async (e) => {
      try { store.importJSON(await e.target.files[0].text()); toast('Backup restored'); closeSheet(); route(); } catch (err) { toast(err.message); }
    };
    $('#wipe', el).onclick = () => {
      if (!confirm('Erase all plans, memories and settings on this device?')) return;
      store.reset();
      indexedDB.deleteDatabase('littleroam-photos');
      location.hash = '';
      location.reload();
    };
    $('#plus-btn', el).onclick = plus;
  });
}

function plus() {
  openSheet(`<div class="plus"><p class="eyebrow">Coming soon</p><h2>LittleRoam Plus</h2>
    <p class="lede">The free app stays free — planner, near-me search, idea library and memories. Plus is for families who want more.</p>
    <div class="grid two">
      <div class="card pad price"><h3>Free</h3><p class="amt">$0</p><ul class="list"><li>Planner bot & quick picks</li><li>Near-me places</li><li>Full idea library</li><li>Memories on this device</li></ul></div>
      <div class="card pad price hl"><h3>Plus</h3><p class="amt">$4.99<span>/mo</span></p><p class="meta">or $34.99/year · 14-day free trial</p><ul class="list"><li>Cloud backup & photo sync</li><li>Share with partner & grandparents</li><li>Printable memory book & yearly recap</li><li>Seasonal adventure packs & local events</li><li>Personalised AI planner</li></ul></div>
    </div>
    <p class="meta">Prices are planned, not yet charged. No payment is taken in this version.</p>
    <button class="btn primary" id="interest">${S().plusInterest ? '✓ You\'re on the list' : 'I\'m interested'}</button></div>`,
  (el) => {
    $('#interest', el).onclick = () => {
      store.set((s) => (s.plusInterest = true));
      if (WAITLIST_URL) window.open(WAITLIST_URL, '_blank', 'noopener');
      else toast('Thanks! We\'ll let you know in the app when Plus launches.');
      $('#interest', el).textContent = '✓ You\'re on the list';
    };
  });
}

function onboarding() {
  openSheet(`<div class="onboard"><span class="big-emoji">🌱</span><h2>Welcome to LittleRoam</h2>
    <p class="lede">Screen-free ideas, little local adventures, and a private place for the memories — planned in under a minute.</p>
    <ul class="list"><li>🧭 A planner that asks 3 quick questions</li><li>📍 Free parks, trails & libraries near you</li><li>💛 Private memories — no likes, no comparing</li></ul>
    <div class="row gap wrap"><button class="btn primary" id="ob-start">Add my kids' ages</button><button class="btn ghost" id="ob-skip">Skip for now</button></div></div>`,
  (el) => {
    $('#ob-start', el).onclick = settings;
    $('#ob-skip', el).onclick = () => { store.set((s) => (s.onboarded = true)); closeSheet(); };
  });
}

async function loadWeather() {
  const loc = S().location;
  if (!loc) return;
  try {
    weather = await getWeather(loc);
    if ($('main').dataset.view === 'today') {
      const eb = $('.hero .eyebrow');
      if (eb && !eb.querySelector('.chip')) eb.insertAdjacentHTML('beforeend', ` <span class="chip">${esc(weatherLabel(weather.code))} · ${Math.round(weather.temp)}${esc(weather.unit)}</span>`);
    }
  } catch { weather = null; }
}

// ---------------- Boot ----------------
$('#settings-btn').onclick = settings;
$('#sheet').addEventListener('click', (e) => { if (e.target.id === 'sheet') closeSheet(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSheet(); });
window.addEventListener('hashchange', route);
route();
loadWeather();
// Turn on AI and Popular-near-you once we know the server supports them.
api.checkHealth().then(() => {
  if (!(api.aiEnabled() || api.communityEnabled()) || $('main').dataset.view !== 'today') return;
  if ($('#chat .bubble.me')) renderPopular(); // don't wipe a conversation in progress
  else renderToday($('#view'));
});
if (!S().onboarded && !location.hash.startsWith('#a/')) onboarding();

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}

// Expose for tests/debugging.
window.__littleroam = { store };
