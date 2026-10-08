// Durable Object with its own SQLite database. It stores anonymous activity
// counts and AI usage counters. One instance ("global") is enough at MVP scale.
// To shard later, route by region, e.g. idFromName(cell prefix).
import { DurableObject } from 'cloudflare:workers';

const DAY_MS = 86400000;
export const dayString = (t = Date.now()) => new Date(t).toISOString().slice(0, 10);

export class Community extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS events (
      day TEXT NOT NULL, cell TEXT NOT NULL, band TEXT NOT NULL, activity TEXT NOT NULL, fam TEXT NOT NULL,
      PRIMARY KEY (day, fam, activity, band))`);
    this.sql.exec('CREATE INDEX IF NOT EXISTS events_cell_day ON events (cell, day)');
    this.sql.exec(`CREATE TABLE IF NOT EXISTS ai_usage (
      day TEXT NOT NULL, key TEXT NOT NULL, n INTEGER NOT NULL, PRIMARY KEY (day, key))`);
    // Where each school's public calendar lives (a feed link, or official dates found by search).
    // Public school information only: no family, child or device is stored with it.
    // Estimated AI spend per month, in micro-dollars, for the monthly budget cap.
    this.sql.exec('CREATE TABLE IF NOT EXISTS ai_spend (month TEXT PRIMARY KEY, micro INTEGER NOT NULL)');
    this.sql.exec(`CREATE TABLE IF NOT EXISTS school_cache (
      key TEXT PRIMARY KEY, data TEXT NOT NULL, updated INTEGER NOT NULL)`);
    // LittleRoam Plus waitlist: an email a parent typed in to hear when Plus launches.
    // Never shown publicly; only the owner can read it (GET /api/waitlist with ADMIN_TOKEN).
    this.sql.exec(`CREATE TABLE IF NOT EXISTS waitlist (
      email TEXT PRIMARY KEY, kids INTEGER NOT NULL, created INTEGER NOT NULL)`);
  }

  waitlistAdd(email, kids) {
    const before = this.waitlistCount();
    this.sql.exec('INSERT INTO waitlist (email, kids, created) VALUES (?, ?, ?) ON CONFLICT (email) DO NOTHING', email, kids, Date.now());
    return { added: this.waitlistCount() > before };
  }

  waitlistCount() {
    return this.sql.exec('SELECT COUNT(*) AS n FROM waitlist').toArray()[0].n;
  }

  waitlistAll() {
    return this.sql.exec('SELECT email, kids, created FROM waitlist ORDER BY created').toArray();
  }

  spendGet(month) {
    const row = this.sql.exec('SELECT micro FROM ai_spend WHERE month = ?', month).toArray()[0];
    return (row?.micro || 0) / 1e6;
  }

  spendAdd(month, usd) {
    const micro = Math.max(0, Math.round(usd * 1e6));
    this.sql.exec('INSERT INTO ai_spend (month, micro) VALUES (?, ?) ON CONFLICT (month) DO UPDATE SET micro = micro + excluded.micro', month, micro);
    return this.spendGet(month);
  }

  schoolGet(key, maxAgeMs) {
    const row = this.sql.exec('SELECT data, updated FROM school_cache WHERE key = ?', key).toArray()[0];
    return row && Date.now() - row.updated < maxAgeMs ? JSON.parse(row.data) : null;
  }

  schoolPut(key, data) {
    this.sql.exec('INSERT INTO school_cache (key, data, updated) VALUES (?, ?, ?) ON CONFLICT (key) DO UPDATE SET data = excluded.data, updated = excluded.updated', key, JSON.stringify(data), Date.now());
    return { ok: true };
  }

  // One row per family, per activity, per age band, per day. Re-sharing the same thing is a no-op.
  log({ cell, bands, activity, fam }) {
    const day = dayString();
    for (const band of bands) {
      this.sql.exec('INSERT OR IGNORE INTO events (day, cell, band, activity, fam) VALUES (?, ?, ?, ?, ?)', day, cell, band, activity, fam);
    }
    // Keep 90 days of history.
    if (Math.random() < 0.02) {
      const cutoff = dayString(Date.now() - 90 * DAY_MS);
      this.sql.exec('DELETE FROM events WHERE day < ?', cutoff);
      this.sql.exec('DELETE FROM ai_usage WHERE day < ?', cutoff);
    }
    return { ok: true };
  }

  // Activities that at least `minFamilies` distinct families in these cells and bands shared in the last `days` days.
  trends({ cells, bands, days = 30, minFamilies = 3, limit = 8 }) {
    if (!cells.length) return { activities: [], families: 0 };
    const since = dayString(Date.now() - days * DAY_MS);
    const cellQ = cells.map(() => '?').join(',');
    const bandFilter = bands.length ? `AND band IN (${bands.map(() => '?').join(',')})` : '';
    const params = [...cells, since, ...bands];
    const activities = this.sql.exec(
      `SELECT activity, COUNT(DISTINCT fam) AS families FROM events
       WHERE cell IN (${cellQ}) AND day >= ? ${bandFilter}
       GROUP BY activity HAVING families >= ? ORDER BY families DESC, activity LIMIT ?`,
      ...params, minFamilies, limit,
    ).toArray();
    const [{ total }] = this.sql.exec(
      `SELECT COUNT(DISTINCT fam) AS total FROM events WHERE cell IN (${cellQ}) AND day >= ? ${bandFilter}`,
      ...params,
    ).toArray();
    // The total is hidden too, until it reaches the threshold.
    return { activities, families: total >= minFamilies ? total : 0 };
  }

  // Counts one use against every key (family id, IP). Refuses if any key is already over its limit.
  consume(entries) {
    const day = dayString();
    for (const { key, limit } of entries) {
      const row = this.sql.exec('SELECT n FROM ai_usage WHERE day = ? AND key = ?', day, key).toArray()[0];
      if (row && row.n >= limit) return { ok: false, remaining: 0 };
    }
    let remaining = Infinity;
    for (const { key, limit } of entries) {
      this.sql.exec('INSERT INTO ai_usage (day, key, n) VALUES (?, ?, 1) ON CONFLICT (day, key) DO UPDATE SET n = n + 1', day, key);
      const { n } = this.sql.exec('SELECT n FROM ai_usage WHERE day = ? AND key = ?', day, key).toArray()[0];
      remaining = Math.min(remaining, limit - n);
    }
    return { ok: true, remaining };
  }

  // Gives a use back when the AI call failed on our side.
  refund(keys) {
    const day = dayString();
    for (const key of keys) this.sql.exec('UPDATE ai_usage SET n = MAX(n - 1, 0) WHERE day = ? AND key = ?', day, key);
    return { ok: true };
  }
}
