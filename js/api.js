// Client for the optional LittleRoam server (/api). When the app is hosted
// without it (e.g. GitHub Pages), every feature here quietly turns off and the
// on-device planner keeps working.
const BASE = new URL('api/', location.href.split('#')[0]);

let health = null;

export async function checkHealth() {
  try {
    const res = await fetch(new URL('health', BASE), { cache: 'no-store' });
    const type = res.headers.get('content-type') || '';
    health = res.ok && type.includes('json') ? await res.json() : { ok: false };
  } catch {
    health = { ok: false };
  }
  return health;
}

export const aiEnabled = () => Boolean(health?.ok && health.ai);
export const communityEnabled = () => Boolean(health?.ok && health.community);
export const minFamilies = () => health?.minFamilies ?? 3;
export const chatEnabled = () => Boolean(health?.ok && health.chat);

async function call(path, opts = {}) {
  const res = await fetch(new URL(path, BASE), {
    ...opts,
    headers: { 'content-type': 'application/json', ...(opts.headers || {}) },
  });
  let data = {};
  try { data = await res.json(); } catch { /* non-JSON error */ }
  if (!res.ok) {
    const err = new Error(data.error || `Request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}

export const waitlistEnabled = () => Boolean(health?.ok && health.waitlist);
export const joinWaitlist = (body) => call('waitlist', { method: 'POST', body: JSON.stringify(body) });
export const askAI = (body) => call('ai', { method: 'POST', body: JSON.stringify(body) });
export const shareActivity = (body) => call('share', { method: 'POST', body: JSON.stringify(body) });
export const getTrends = (cell, bands) => call(`trends?cell=${encodeURIComponent(cell)}&bands=${encodeURIComponent(bands.join(','))}`);
export const chatStep = (body) => call('chat', { method: 'POST', body: JSON.stringify(body) });
export const schoolFeedsEnabled = () => Boolean(health?.ok && health.schoolFeeds);
export const schoolPhotoEnabled = () => Boolean(health?.ok && health.schoolPhoto);
export const readSchoolPhoto = (body) => call('school-photo', { method: 'POST', body: JSON.stringify(body) });

// A school calendar feed. Through our server when there is one (school sites
// usually block browsers from reading their feeds directly), otherwise direct.
export async function fetchSchoolFeed(url) {
  const target = schoolFeedsEnabled() ? new URL(`school-feed?url=${encodeURIComponent(url)}`, BASE) : url;
  let res;
  try { res = await fetch(target, { cache: 'no-store' }); } catch {
    throw new Error(schoolFeedsEnabled() ? "Couldn't reach the calendar. Check your connection." : "This school's calendar can't be read from the browser. Download the .ics file from the school's calendar page and choose “Import a calendar file”.");
  }
  const text = await res.text();
  if (!res.ok) {
    let msg = `Couldn't load that calendar (${res.status}).`;
    try { msg = JSON.parse(text).error || msg; } catch { /* plain text */ }
    throw new Error(msg);
  }
  return text;
}

export const schoolFinderEnabled = () => Boolean(health?.ok && health.schoolFinder);
export const findSchoolCalendar = (body) => call('school-calendar', { method: 'POST', body: JSON.stringify(body) });

// Schools by name near home: through our server when there is one, else straight from OpenStreetMap.
export async function searchSchools(q, where) {
  if (schoolFinderEnabled()) return (await call(`schools?q=${encodeURIComponent(q)}&lat=${where.lat}&lon=${where.lon}`)).schools;
  const { findSchools } = await import('./near.js');
  return findSchools(q, where);
}
