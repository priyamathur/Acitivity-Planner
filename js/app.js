import { ACTIVITIES, CATEGORIES, SEASONS } from './data.js';
import { currentSeason, ageFromBirthYear, weatherBucket, weatherLabel, fitsAges, VIBES, weekendDays, bookedFor, freeWindows, fillWeekend, swapPick, classKind, toMin } from './planner.js';
import { PLACE_TYPES, findPlaces, geocode, getForecast, getPosition, directionsUrl, osmUrl } from './near.js';
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
const fmtDate = (iso, opts = { weekday: 'short', day: 'numeric', month: 'short' }) => new Date(iso + 'T12:00').toLocaleDateString(undefined, opts);

let forecast = {}; // 'YYYY-MM-DD' -> { code, max, rain, unit }

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('show'), 2400);
}

// ---------------- Routing ----------------
const VIEWS = ['weekend', 'near', 'ideas', 'memories'];

function route() {
  const hash = location.hash.slice(1) || 'weekend';
  if (hash.startsWith('a/')) {
    const a = byId[hash.slice(2)];
    if (!$('main').dataset.view) show('weekend');
    if (a) openActivity(a, { fromLink: true });
    return;
  }
  show(VIEWS.includes(hash) ? hash : 'weekend');
}

function show(view) {
  closeSheet();
  $('main').dataset.view = view;
  $$('.tab').forEach((t) => t.setAttribute('aria-current', t.dataset.view === view ? 'page' : 'false'));
  const render = { weekend: renderWeekend, near: renderNear, ideas: renderIdeas, memories: renderMemories }[view];
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
  if (location.hash.startsWith('#a/')) history.replaceState(null, '', '#' + ($('main').dataset.view || 'weekend'));
}
const rerender = () => { const v = $('main').dataset.view; if (v) ({ weekend: renderWeekend, near: renderNear, ideas: renderIdeas, memories: renderMemories })[v]($('#view')); };

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
      <div class="detail-head"><span class="big-emoji">${esc(a.emoji)}</span>
        <div><h2>${esc(a.title)}</h2>
        <p class="meta">${CATEGORIES[a.cat].emoji} ${CATEGORIES[a.cat].label} · ${fmtMins(a.mins)} · ${settingLabel[a.setting]} · ages ${a.ages[0]}–${a.ages[1]} · ${['No mess', 'A little mess', 'Messy!'][a.mess]}</p></div>
      </div>
      <h3>You'll need</h3><ul class="list">${a.materials.map((m) => `<li>${esc(m)}</li>`).join('')}</ul>
      <h3>How to</h3><ol class="list steps">${a.steps.map((m) => `<li>${esc(m)}</li>`).join('')}</ol>
      <h3>What they're learning</h3><p>${a.skills.map((s) => `<span class="chip">${esc(s)}</span>`).join(' ')}</p>
      ${a.tip ? `<p class="tip">💡 ${esc(a.tip)}</p>` : ''}
      ${a.ai ? '<p class="fine">✨ This idea was written by AI for your family. Read it through first and use your own judgement on safety.</p>' : ''}
      <div class="row wrap gap">
        <button class="btn primary" data-act="plan">🗓️ Add to our weekend</button>
        <button class="btn" data-act="done">✅ We did it</button>
        <button class="btn ghost" data-act="share">↗ Share</button>
      </div>
    </div>`,
  (el) => {
    $('[data-act=done]', el).onclick = () => memoryForm({ activityId: a.id, title: a.title });
    $('[data-act=plan]', el).onclick = () => addToWeekend(a);
    $('[data-act=share]', el).onclick = () => share(a);
  });
}

async function shareText(title, text, url) {
  try {
    if (navigator.share) await navigator.share({ title, text, url });
    else {
      await navigator.clipboard.writeText(url ? `${text} ${url}` : text);
      toast('Copied — paste it anywhere');
    }
  } catch { /* user cancelled */ }
}
const share = (a) => shareText(a.title, `${a.emoji} ${a.title}: a screen-free idea for ${fmtMins(a.mins)}.`, `${location.origin}${location.pathname}#a/${a.id}`);

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

// ======================= The weekend =======================
let weekendOffset = 0; // 0 = this weekend, 1 = next

function weekendModel(offset = weekendOffset) {
  const days = weekendDays(new Date(), offset).map((d) => {
    const booked = bookedFor(S().classes, d);
    const f = forecast[d.date];
    const weather = f ? (['wet', 'snow'].includes(weatherBucket(f.code)) || f.rain >= 60 ? 'wet' : 'dry') : null;
    return { ...d, booked, windows: d.past ? [] : freeWindows(booked, d.key), forecast: f, weather };
  });
  const key = days[0].date;
  return { key, days, plan: S().weekends[key] || null };
}

const kidName = (i) => (i === '' || i == null ? '' : S().family.kids[Number(i)]?.name || (S().family.kids.length > 1 ? `Child ${Number(i) + 1}` : ''));
const weatherChip = (f) => (f ? `<span class="chip sm">${esc(weatherLabel(f.code))} · ${Math.round(f.max)}${esc(f.unit)}${f.rain >= 30 ? ` · ${f.rain}% rain` : ''}</span>` : '');

function renderWeekend(root) {
  const { key, days, plan } = weekendModel();
  const s = S();
  const hello = s.family.name ? `the ${esc(s.family.name)}s` : 'your family';
  const live = days.filter((d) => !d.past);
  const freeCount = live.reduce((n, d) => n + d.windows.length, 0);
  root.innerHTML = `
    <section class="hero">
      <p class="eyebrow">${SEASONS[currentSeason()].emoji} ${fmtDate(days[0].date, { day: 'numeric', month: 'short' })} – ${fmtDate(days[1].date, { day: 'numeric', month: 'short' })}</p>
      <h1>A weekend for ${hello}</h1>
      <p class="lede">Add the classes you already have, and I'll fill the free time with screen-free adventures.</p>
    </section>
    <div class="seg two" role="tablist">
      <button role="tab" data-wk="0" class="${weekendOffset === 0 ? 'on' : ''}" aria-selected="${weekendOffset === 0}">This weekend</button>
      <button role="tab" data-wk="1" class="${weekendOffset === 1 ? 'on' : ''}" aria-selected="${weekendOffset === 1}">Next weekend</button>
    </div>

    <section class="card pad">
      <div class="row space center-v"><h2 class="h0">🗓️ Classes &amp; plans</h2><button class="btn sm" id="add-class">+ Add</button></div>
      ${days.map((d) => `<div class="booked-day"><strong class="meta">${d.name}${d.past ? ' (over)' : ''}</strong>
        ${d.booked.length ? d.booked.map((c) => `<div class="row space center-v booked">
          <span>${esc(classKind(c.title).emoji)} <strong>${esc(c.start)}–${esc(c.end)}</strong> ${esc(c.title)}${kidName(c.kid) ? ` <span class="chip sm">${esc(kidName(c.kid))}</span>` : ''}${c.repeat === 'once' ? ' <span class="chip sm">this week only</span>' : ''}${c.where ? `<span class="meta"> · ${esc(c.where)}</span>` : ''}</span>
          <button class="icon-btn" data-edit-class="${c.id}" aria-label="Edit ${esc(c.title)}">✎</button></div>`).join('') : '<p class="meta">Nothing booked</p>'}</div>`).join('')}
    </section>

    ${!plan ? `<section class="card pad plan-form">
      <h2 class="h0">✨ Plan our weekend</h2>
      ${freeCount ? `<p class="meta">${freeCount} free slot${freeCount > 1 ? 's' : ''} to fill${live.length < 2 ? ' (Saturday is over)' : ''}.</p>` : '<p class="meta">No free time left this weekend. Enjoy the classes!</p>'}
      <div class="vibes" role="radiogroup" aria-label="What kind of weekend?">${Object.entries(VIBES).map(([k, v], i) => `<label class="vibe"><input type="radio" name="vibe" value="${k}" ${(s.lastVibe || 'mix') === k ? 'checked' : ''}/><span><b>${v.emoji} ${v.label}</b><small>${v.desc}</small></span></label>`).join('')}</div>
      ${api.aiEnabled() ? `<label class="mt">Anything else I should know? <span class="meta">(optional)</span><input id="wk-note" class="input" maxlength="300" placeholder="e.g. Grandma visits Sunday lunch, Mia has a cold" /></label>
        <p class="fine">For AI planning we send your note, kids' ages, class types and times (not names), the weather and nearby place names.</p>` : ''}
      <button class="btn primary mt" id="plan-btn" ${freeCount ? '' : 'disabled'}>${api.aiEnabled() ? '✨ Plan it with AI' : '✨ Plan it for me'}</button>
    </section>` : ''}

    ${plan?.message ? `<p class="ai-msg">✨ ${esc(plan.message)}</p>` : ''}
    <section id="timeline-wk">${plan ? days.map((d) => dayTimeline(d, plan)).join('') : ''}</section>
    ${plan ? `<div class="row wrap gap">
      <button class="btn primary" id="send-plan">↗ Send to my partner</button>
      <button class="btn" id="replan">🔄 Re-plan</button>
      <button class="btn ghost" id="clear-plan">Clear</button></div>` : ''}
    <section id="popular"></section>`;

  $$('[data-wk]', root).forEach((b) => (b.onclick = () => { weekendOffset = Number(b.dataset.wk); renderWeekend(root); }));
  $('#add-class', root).onclick = () => classForm();
  $$('[data-edit-class]', root).forEach((b) => (b.onclick = () => classForm(S().classes.find((c) => c.id === b.dataset.editClass), days.find((d) => d.booked.some((c) => c.id === b.dataset.editClass)))));
  const planBtn = $('#plan-btn', root);
  if (planBtn) planBtn.onclick = () => {
    const vibe = $('input[name=vibe]:checked', root)?.value || 'mix';
    store.set((st) => (st.lastVibe = vibe));
    makePlan({ vibe, note: $('#wk-note', root)?.value.trim() || '' });
  };
  if (plan) {
    $('#replan', root).onclick = () => { store.set((st) => delete st.weekends[key]); renderWeekend(root); };
    $('#clear-plan', root).onclick = () => { if (confirm('Clear this weekend\'s plan? Your classes stay.')) { store.set((st) => delete st.weekends[key]); renderWeekend(root); } };
    $('#send-plan', root).onclick = () => sharePlan(days, plan);
    $$('[data-swap]', root).forEach((b) => (b.onclick = () => swap(b.dataset.swap)));
    $$('[data-rm-pick]', root).forEach((b) => (b.onclick = () => { store.set((st) => delete st.weekends[key].picks[b.dataset.rmPick]); renderWeekend(root); }));
    $$('[data-fill]', root).forEach((b) => (b.onclick = () => swap(b.dataset.fill)));
    $$('[data-done-pick]', root).forEach((b) => (b.onclick = () => {
      const [winId, date] = b.dataset.donePick.split('|');
      const a = byId[plan.picks[winId].id];
      memoryForm({ activityId: a.id, title: a.title, date, onSaved: () => store.set((st) => (st.weekends[key].done[winId] = true)) });
    }));
  }
  renderPopular();
}

function dayTimeline(d, plan) {
  if (d.past) return `<div class="day card pad past"><strong>${d.name}</strong> <span class="meta">${fmtDate(d.date)} · over</span></div>`;
  const items = [
    ...d.booked.map((c) => ({ t: c.s, html: `<div class="slot booked-slot"><span class="time">${esc(c.start)}–${esc(c.end)}</span>
      <span class="slot-body">${esc(classKind(c.title).emoji)} <strong>${esc(c.title)}</strong>${kidName(c.kid) ? ` <span class="chip sm">${esc(kidName(c.kid))}</span>` : ''}${c.where ? `<span class="meta"> · ${esc(c.where)}</span>` : ''}</span></div>` })),
    { t: toMin('12:30'), html: '<div class="slot lunch"><span class="time">12:30</span><span class="slot-body meta">🥪 Lunch &amp; rest</span></div>' },
    ...d.windows.map((w) => {
      const p = plan.picks[w.id];
      const a = p && byId[p.id];
      const done = plan.done?.[w.id];
      return { t: toMin(w.start), html: a ? `<div class="slot plan-slot ${done ? 'done' : ''}"><span class="time">${esc(w.start)}</span>
        <div class="slot-body">${card(a, { compact: true, why: p.why, place: p.place })}
        <div class="row gap-sm slot-actions">
          <button class="btn sm" data-done-pick="${w.id}|${d.date}">${done ? '💛 Remembered' : '✅ We did it'}</button>
          <button class="btn sm ghost" data-swap="${w.id}">🔄 Swap</button>
          <button class="icon-btn" data-rm-pick="${w.id}" aria-label="Remove from plan" title="Remove">✕</button></div></div></div>`
        : `<div class="slot free"><span class="time">${esc(w.start)}</span><span class="slot-body meta">Free until ${esc(w.end)}. Leave room for boredom, or <button class="link sm" data-fill="${w.id}">add something</button></span></div>` };
    }),
  ].sort((x, y) => x.t - y.t);
  return `<div class="day card pad"><div class="row space center-v"><strong>${d.name} <span class="meta">${fmtDate(d.date, { day: 'numeric', month: 'short' })}</span></strong>${weatherChip(d.forecast)}</div>
    ${items.map((i) => i.html).join('')}</div>`;
}

async function makePlan({ vibe, note }) {
  const { key, days } = weekendModel();
  const live = days.filter((d) => !d.past);
  const ctx = { ages: kidAges(), vibe, recentIds: S().recent, favIds: S().favs };
  let plan = { vibe, picks: {}, done: {}, message: '' };
  const btn = $('#plan-btn');
  if (api.aiEnabled()) {
    if (btn) { btn.disabled = true; btn.innerHTML = '<span class="typing">✨ Planning your weekend…</span>'; }
    try {
      const res = await api.askAI(aiBody(live, vibe, note));
      saveCustoms(res.picks.filter((p) => p.custom).map((p) => p.custom));
      for (const p of res.picks) if (byId[p.activityId]) plan.picks[p.windowId] = { id: p.activityId, why: p.why, place: p.placeName };
      plan.message = `${res.message} (${res.remaining} AI plans left today)`;
      plan.ai = true;
    } catch (err) {
      toast(err.message);
      plan.message = 'AI was unavailable, so this plan comes from our activity library.';
    }
  }
  // Fill any window the AI left empty (or everything, without AI).
  const missing = live.map((d) => ({ ...d, windows: d.windows.filter((w) => !plan.picks[w.id]) }));
  const used = Object.values(plan.picks).map((p) => p.id);
  Object.assign(plan.picks, fillWeekend(missing, { ...ctx, recentIds: [...ctx.recentIds, ...used] }));
  store.set((s) => {
    s.weekends[key] = plan;
    s.recent = [...Object.values(plan.picks).map((p) => p.id), ...s.recent].slice(0, 12);
  });
  renderWeekend($('#view'));
  $('#timeline-wk')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
}

function swap(winId) {
  const { key, days, plan } = weekendModel();
  const d = days.find((x) => x.windows.some((w) => w.id === winId));
  const w = d.windows.find((x) => x.id === winId);
  const exclude = [...Object.values(plan.picks).map((p) => p.id), ...(plan.swapped?.[winId] || [])];
  const a = swapPick(d, w, { ages: kidAges(), vibe: plan.vibe, exclude, favIds: S().favs }, Date.now());
  if (!a) return toast('No other ideas fit this slot. Try a different one.');
  store.set((s) => {
    const pl = s.weekends[key];
    (pl.swapped ??= {})[winId] = [...(pl.swapped[winId] || []), pl.picks[winId]?.id].filter(Boolean).slice(-8);
    pl.picks[winId] = { id: a.id };
    delete pl.done[winId];
  });
  renderWeekend($('#view'));
}

// Put a specific idea into a free slot this weekend or next.
function addToWeekend(a) {
  const options = [0, 1].flatMap((off) => {
    const m = weekendModel(off);
    return m.days.flatMap((d) => d.windows.filter((w) => w.mins >= Math.min(a.mins, 45)).map((w) => ({ off, key: m.key, d, w, cur: m.plan?.picks[w.id] && byId[m.plan.picks[w.id].id] })));
  });
  openSheet(`<h2>Add “${esc(a.title)}” to…</h2>
    ${options.length ? `<div class="col gap-sm">${options.map((o, i) => `<button class="btn slot-pick" data-i="${i}">
      <span><b>${o.off ? 'Next' : 'This'} ${o.d.name}</b> ${esc(o.w.start)}–${esc(o.w.end)}</span>
      <span class="meta">${o.cur ? `replaces ${esc(o.cur.title)}` : 'free'}${a.mins > o.w.mins ? ' · may run over' : ''}</span></button>`).join('')}</div>` : '<p class="meta">No free slots this weekend or next. Remove something first.</p>'}`,
  (el) => $$('[data-i]', el).forEach((b) => (b.onclick = () => {
    const o = options[Number(b.dataset.i)];
    store.set((s) => {
      const pl = (s.weekends[o.key] ??= { vibe: s.lastVibe || 'mix', picks: {}, done: {}, message: '' });
      pl.picks[o.w.id] = { id: a.id };
      delete pl.done[o.w.id];
    });
    weekendOffset = o.off;
    closeSheet();
    toast(`Added to ${o.d.name}`);
    location.hash = 'weekend';
    if ($('main').dataset.view === 'weekend') renderWeekend($('#view'));
  })));
}

function sharePlan(days, plan) {
  const lines = ['Our weekend 🌱'];
  for (const d of days.filter((x) => !x.past)) {
    lines.push('', `${d.name} ${fmtDate(d.date, { day: 'numeric', month: 'short' })}`);
    const rows = [
      ...d.booked.map((c) => [c.s, `${c.start}–${c.end} ${classKind(c.title).emoji} ${c.title}${kidName(c.kid) ? ` (${kidName(c.kid)})` : ''}`]),
      ...d.windows.filter((w) => plan.picks[w.id]).map((w) => { const p = plan.picks[w.id]; const a = byId[p.id]; return [toMin(w.start), `${w.start} ${a.emoji} ${a.title}${p.place ? ` @ ${p.place}` : ''}`]; }),
    ].sort((x, y) => x[0] - y[0]);
    lines.push(...(rows.length ? rows.map((r) => r[1]) : ['Free day']));
  }
  shareText('Our weekend', lines.join('\n'));
}

// ---------------- Classes & one-off plans ----------------
function classForm(c = null, day = null) {
  const kids = S().family.kids;
  const { days } = weekendModel();
  const isNew = !c;
  c ??= { title: '', kid: kids.length === 1 ? '0' : '', day: 'sat', start: '09:00', end: '10:00', where: '', repeat: 'weekly' };
  openSheet(`<h2>${isNew ? 'Add a class or plan' : 'Edit'}</h2>
    <form id="cls" class="col gap">
      <label>What is it?<input class="input" name="title" required maxlength="60" value="${esc(c.title)}" placeholder="Swimming, football, ballet, birthday party…" /></label>
      ${kids.length ? `<label>Who's going?<select class="input" name="kid"><option value="">Everyone</option>${kids.map((k, i) => `<option value="${i}" ${String(c.kid) === String(i) ? 'selected' : ''}>${esc(k.name || `Child ${i + 1}`)} (${ageFromBirthYear(k.birthYear)})</option>`).join('')}</select></label>` : ''}
      <div class="row gap">
        <label class="grow day-pick">Day<select class="input" name="day"><option value="sat" ${c.day === 'sat' ? 'selected' : ''}>Saturday</option><option value="sun" ${c.day === 'sun' ? 'selected' : ''}>Sunday</option></select></label>
        <label>From<input class="input" type="time" name="start" required value="${esc(c.start)}" step="900" /></label>
        <label>To<input class="input" type="time" name="end" required value="${esc(c.end)}" step="900" /></label>
      </div>
      <label>Where? <span class="meta">(optional)</span><input class="input" name="where" maxlength="60" value="${esc(c.where)}" placeholder="Leisure centre" /></label>
      <fieldset class="row gap wrap"><legend>How often?</legend>
        <label class="radio"><input type="radio" name="repeat" value="weekly" ${c.repeat !== 'once' ? 'checked' : ''}/> Every week</label>
        <label class="radio"><input type="radio" name="repeat" value="once" ${c.repeat === 'once' ? 'checked' : ''}/> This weekend only</label>
      </fieldset>
      <button class="btn primary">${isNew ? 'Add' : 'Save'}</button>
      ${!isNew ? `<div class="row gap wrap">${c.repeat !== 'once' && day ? `<button type="button" class="btn ghost" id="skip">Skip on ${fmtDate(day.date)} only</button>` : ''}<button type="button" class="btn ghost danger" id="del">Delete</button></div>` : ''}
    </form>`,
  (el) => {
    $('#cls', el).onsubmit = (e) => {
      e.preventDefault();
      const f = new FormData(e.target);
      const v = { title: String(f.get('title')).trim(), kid: String(f.get('kid') ?? ''), day: f.get('day'), start: f.get('start'), end: f.get('end'), where: String(f.get('where')).trim(), repeat: f.get('repeat') };
      if (toMin(v.end) <= toMin(v.start)) return toast('The end time needs to be after the start time.');
      if (v.repeat === 'once') v.date = days.find((d) => d.key === v.day).date;
      store.set((s) => {
        if (isNew) s.classes.push({ id: store.uid(), ...v });
        else Object.assign(s.classes.find((x) => x.id === c.id), v);
      });
      closeSheet();
      toast(isNew ? `${classKind(v.title).emoji} ${v.title} added` : 'Saved');
      rerender();
    };
    const del = $('#del', el);
    if (del) del.onclick = () => { store.set((s) => (s.classes = s.classes.filter((x) => x.id !== c.id))); closeSheet(); rerender(); };
    const skip = $('#skip', el);
    if (skip) skip.onclick = () => { store.set((s) => { const x = s.classes.find((y) => y.id === c.id); (x.skip ??= {})[day.date] = true; }); closeSheet(); toast(`Skipped on ${fmtDate(day.date)}`); rerender(); };
  });
}

// ---------------- AI ----------------
function aiBody(days, vibe, note) {
  const ages = kidAges();
  const loc = S().location;
  return {
    fam: famId(),
    note,
    vibe,
    ages,
    bands: bandsForAges(ages),
    cell: loc ? cellFor(loc) : null,
    season: SEASONS[currentSeason()].label,
    // Class titles can contain names, so only the generic kind and times are sent.
    days: days.map((d) => ({
      key: d.key,
      label: `${d.name} ${fmtDate(d.date, { day: 'numeric', month: 'short' })}`,
      weather: d.forecast ? `${weatherLabel(d.forecast.code)}, ${Math.round(d.forecast.max)}${d.forecast.unit}, ${d.forecast.rain ?? 0}% chance of rain` : '',
      booked: d.booked.map((c) => `${classKind(c.title).kind} ${c.start}–${c.end}`),
      windows: d.windows.map((w) => ({ id: w.id, start: w.start, end: w.end, mins: w.mins })),
    })),
    recentIds: S().recent.filter((id) => !id.startsWith('ai-')),
    favIds: S().favs.filter((id) => !id.startsWith('ai-')),
    places: (nearState.places || []).filter((p) => p.named).slice(0, 10).map((p) => ({ name: p.name, type: p.type, km: Number(p.km.toFixed(1)) })),
  };
}

function saveCustoms(customs) {
  if (!customs.length) return;
  store.set((s) => {
    s.custom ??= {};
    for (const c of customs) s.custom[c.id] = c;
    // Keep the 30 most recent AI ideas, plus any that are planned, saved or remembered.
    const keep = new Set([...s.favs, ...Object.values(s.weekends).flatMap((w) => Object.values(w.picks).map((p) => p.id)), ...s.memories.map((m) => m.activityId)]);
    const ids = Object.keys(s.custom);
    ids.slice(0, Math.max(0, ids.length - 30)).forEach((id) => { if (!keep.has(id)) delete s.custom[id]; });
  });
  Object.assign(byId, ...customs.map((c) => ({ [c.id]: c })));
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
  loadForecast();
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

// ---------------- Memories ----------------
const MOODS = ['😍', '😄', '🙂', '😅', '😴'];

// Only library activities can be shared, and only once we know the area and the kids' ages.
const canShare = (id) => api.communityEnabled() && id && !id.startsWith('ai-') && Boolean(byId[id]) && Boolean(S().location) && bandsForAges(kidAges()).length > 0;

function memoryForm({ activityId = null, title = '', date = store.isoDate(), onSaved = null } = {}) {
  openSheet(`<h2>Save a memory</h2>
    <form id="mem" class="col gap">
      <label>What did you do?<input class="input" name="title" required value="${esc(title)}" /></label>
      <label>When?<input class="input" type="date" name="date" value="${esc(date)}" /></label>
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
      onSaved?.();
      closeSheet();
      toast('Memory saved 💛');
      rerender();
    };
  });
}

function renderMemories(root) {
  const mems = [...S().memories].sort((a, b) => b.date.localeCompare(a.date));
  const year = new Date().getFullYear();
  const thisYear = mems.filter((m) => m.date.startsWith(String(year)));
  const weekendsOut = new Set(thisYear.filter((m) => [0, 6].includes(new Date(m.date + 'T12:00').getDay())).map((m) => { const d = new Date(m.date + 'T12:00'); d.setDate(d.getDate() - ((d.getDay() + 1) % 7)); return store.isoDate(d); })).size;
  const outdoors = thisYear.filter((m) => m.activityId && byId[m.activityId]?.setting !== 'home').length;
  root.innerHTML = `
    <section class="hero"><h1>Our memories</h1><p class="lede">Private to your family. No likes, no followers, no comparing.</p></section>
    <div class="grid three stats">
      <div class="stat"><strong>${weekendsOut}</strong><span>weekends with an adventure</span></div>
      <div class="stat"><strong>${thisYear.length}</strong><span>in ${year}</span></div>
      <div class="stat"><strong>${outdoors}</strong><span>outdoor adventures</span></div>
    </div>
    <div class="row gap wrap"><button class="btn primary" id="new-mem">+ New memory</button>${thisYear.length ? '<button class="btn" id="recap">🎞️ Our year so far</button>' : ''}</div>
    <section id="timeline">${mems.length ? '' : '<p class="empty">Your first memory is one weekend away. Tap ✅ We did it on anything in your plan.</p>'}</section>`;
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
    <p class="lede">The free app stays free: weekend planner, near-me search, idea library and memories. Plus is for families who want more.</p>
    <div class="grid two">
      <div class="card pad price"><h3>Free</h3><p class="amt">$0</p><ul class="list"><li>Weekend planner around your kids' classes</li><li>Near-me places</li><li>Full idea library</li><li>Memories on this device</li><li>A few AI plans a day</li></ul></div>
      <div class="card pad price hl"><h3>Plus</h3><p class="amt">$4.99<span>/mo</span></p><p class="meta">or $34.99/year · 14-day free trial</p><ul class="list"><li>Unlimited AI weekend plans</li><li>Shared family plan with partner & grandparents</li><li>Sync classes with Google/Apple Calendar</li><li>Local weekend events</li><li>Cloud backup, photo sync & memory book</li></ul></div>
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
    <p class="lede">Your family's weekend, planned in a minute: around the kids' classes, with screen-free adventures in the free time.</p>
    <ul class="list"><li>🗓️ Add swimming, football, ballet… once</li><li>✨ Free time filled with ideas that fit the weather</li><li>💛 Private weekend memories: no likes, no comparing</li></ul>
    <div class="row gap wrap"><button class="btn primary" id="ob-start">Add my kids' ages</button><button class="btn ghost" id="ob-skip">Skip for now</button></div></div>`,
  (el) => {
    $('#ob-start', el).onclick = settings;
    $('#ob-skip', el).onclick = () => { store.set((s) => (s.onboarded = true)); closeSheet(); };
  });
}

async function loadForecast() {
  const loc = S().location;
  if (!loc) return;
  try {
    forecast = await getForecast(loc);
    if ($('main').dataset.view === 'weekend' && $('#sheet').hidden) renderWeekend($('#view'));
  } catch { forecast = {}; }
}

// ---------------- Boot ----------------
$('#settings-btn').onclick = settings;
$('#sheet').addEventListener('click', (e) => { if (e.target.id === 'sheet') closeSheet(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSheet(); });
window.addEventListener('hashchange', route);
route();
loadForecast();
// Turn on AI and Popular-near-you once we know the server supports them.
api.checkHealth().then(() => {
  if ((api.aiEnabled() || api.communityEnabled()) && $('main').dataset.view === 'weekend' && $('#sheet').hidden) renderWeekend($('#view'));
});
if (!S().onboarded && !location.hash.startsWith('#a/')) onboarding();

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}

// Expose for tests/debugging.
window.__littleroam = { store };
