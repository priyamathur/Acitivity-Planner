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

export const askAI = (body) => call('ai', { method: 'POST', body: JSON.stringify(body) });
export const shareActivity = (body) => call('share', { method: 'POST', body: JSON.stringify(body) });
export const getTrends = (cell, bands) => call(`trends?cell=${encodeURIComponent(cell)}&bands=${encodeURIComponent(bands.join(','))}`);
