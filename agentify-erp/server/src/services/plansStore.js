// Plans in the platform database. Prices are versioned: editing a price adds a new row with the date it takes effect,
// so earlier prices stay on record and invoices keep the amount actually charged. Workspaces already subscribed keep the
// price they signed up at (tenants.price_amount) until a new payment renews them at the then-current price.
//
// Effects of editing a plan on existing workspaces:
//   name / description / visibility       immediate, cosmetic
//   limits (users, projects, modules)      immediate for every workspace on the plan (unless it has its own overrides)
//   prices                                 new purchases and renewals only
//   on sale (active = 0)                   no new purchases; current subscribers can still renew
import { PLANS, DEFAULT_PLANS, PLAN_SETTINGS, MODULES } from './plans.js';
import { bad, HttpError } from '../util.js';

export const PLANS_SCHEMA = `
CREATE TABLE IF NOT EXISTS plans(
  id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT, seats INTEGER, projects INTEGER, grace_days INTEGER NOT NULL DEFAULT 7,
  modules TEXT, visible INTEGER NOT NULL DEFAULT 1, active INTEGER NOT NULL DEFAULT 1, sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')), updated_by TEXT);
CREATE TABLE IF NOT EXISTS plan_prices(
  id INTEGER PRIMARY KEY, plan_id TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE, currency TEXT NOT NULL, interval TEXT NOT NULL CHECK(interval IN ('month','year')),
  amount INTEGER NOT NULL CHECK(amount >= 0), effective_from TEXT NOT NULL DEFAULT (datetime('now')), created_by TEXT);
CREATE INDEX IF NOT EXISTS idx_plan_prices ON plan_prices(plan_id, currency, interval, effective_from);
`;
const CURRENCIES = ['PKR', 'USD'];
const ID_RE = /^[a-z][a-z0-9_]{1,30}$/;

let db = null;
/** Called once by platformDb(): create the tables, seed the default plans into an empty database, load PLANS. */
export function initPlans(pdb) {
  db = pdb;
  db.exec(PLANS_SCHEMA);
  if (!db.prepare('SELECT 1 FROM plans LIMIT 1').get()) {
    let i = 0;
    for (const [id, p] of Object.entries(DEFAULT_PLANS)) {
      db.prepare('INSERT INTO plans(id,name,seats,projects,sort_order,updated_by) VALUES(?,?,?,?,?,?)').run(id, p.name, p.seats, p.projects, i++, 'system');
      for (const [cur, byInt] of Object.entries(p.price)) for (const [int, amount] of Object.entries(byInt)) db.prepare("INSERT INTO plan_prices(plan_id,currency,interval,amount,effective_from,created_by) VALUES(?,?,?,?,'2000-01-01 00:00:00','system')").run(id, cur, int, amount);
    }
  }
  reloadPlans();
}

const setting = (k) => db.prepare('SELECT value FROM platform_settings WHERE key=?').get(k)?.value;
/** Rebuild the in-memory PLANS object in place (same object, so every importer sees the change). */
export function reloadPlans() {
  const rows = db.prepare('SELECT * FROM plans ORDER BY sort_order, id').all();
  const prices = db.prepare(`SELECT p.plan_id, p.currency, p.interval, p.amount FROM plan_prices p
    WHERE p.id = (SELECT q.id FROM plan_prices q WHERE q.plan_id=p.plan_id AND q.currency=p.currency AND q.interval=p.interval AND q.effective_from<=datetime('now') ORDER BY q.effective_from DESC, q.id DESC LIMIT 1)`).all();
  for (const k of Object.keys(PLANS)) delete PLANS[k];
  for (const r of rows) {
    const price = {};
    for (const p of prices.filter((x) => x.plan_id === r.id)) (price[p.currency] ||= {})[p.interval] = p.amount;
    PLANS[r.id] = { name: r.name, description: r.description, seats: r.seats, projects: r.projects, grace_days: r.grace_days, modules: r.modules ? JSON.parse(r.modules) : null, visible: !!r.visible, active: !!r.active, price };
  }
  PLAN_SETTINGS.trial_plan = setting('trial_plan') || (PLANS.growth ? 'growth' : Object.keys(PLANS)[0] || 'growth');
  PLAN_SETTINGS.default_trial_days = Number(setting('default_trial_days') ?? 14);
}

export function listPlans() {
  const subs = Object.fromEntries(db.prepare("SELECT plan, COUNT(*) n FROM tenants WHERE is_legacy=0 AND status='active' AND subscription_status<>'trialing' GROUP BY plan").all().map((r) => [r.plan, r.n]));
  return db.prepare('SELECT * FROM plans ORDER BY sort_order, id').all().map((r) => ({
    id: r.id, name: r.name, description: r.description, seats: r.seats, projects: r.projects, grace_days: r.grace_days, modules: r.modules ? JSON.parse(r.modules) : null,
    visible: !!r.visible, active: !!r.active, sort_order: r.sort_order, updated_at: r.updated_at, updated_by: r.updated_by, subscribers: subs[r.id] || 0,
    price: PLANS[r.id]?.price || {},
    price_history: db.prepare('SELECT currency, interval, amount, effective_from, created_by FROM plan_prices WHERE plan_id=? ORDER BY effective_from DESC, id DESC LIMIT 40').all(r.id),
  }));
}

const limitVal = (v, label) => {
  if (v === null || v === '' || v === undefined) return null;
  const n = Math.trunc(Number(v));
  if (!(n >= 1 && n <= 100000)) throw bad(`${label} must be a whole number from 1, or empty for unlimited`);
  return n;
};
export function cleanModules(m) {
  if (m === null || m === undefined) return null;
  if (!Array.isArray(m)) throw bad('Modules must be a list');
  const bad1 = m.filter((x) => !MODULES[x]);
  if (bad1.length) throw bad(`Unknown module(s): ${bad1.join(', ')}`);
  return [...new Set(m)];
}

/** Create or update a plan. Only prices that differ from the current ones get a new price row. */
export function savePlan(id, b, actor) {
  const pid = String(id || '').trim().toLowerCase();
  if (!ID_RE.test(pid) || ['trial', 'legacy', 'manual'].includes(pid)) throw bad('Plan ID must be 2-31 lowercase letters, digits or underscores, starting with a letter (not trial, legacy or manual)');
  const exists = db.prepare('SELECT * FROM plans WHERE id=?').get(pid);
  const name = String(b.name ?? exists?.name ?? '').trim();
  if (!name || name.length > 60) throw bad('Plan name is required (up to 60 characters)');
  const grace = b.grace_days === undefined ? (exists?.grace_days ?? 7) : Math.trunc(Number(b.grace_days));
  if (!(grace >= 0 && grace <= 90)) throw bad('Grace days must be between 0 and 90');
  const fields = {
    name, description: b.description === undefined ? exists?.description ?? null : (String(b.description || '').trim().slice(0, 300) || null),
    seats: b.seats === undefined ? exists?.seats ?? null : limitVal(b.seats, 'User limit'),
    projects: b.projects === undefined ? exists?.projects ?? null : limitVal(b.projects, 'Project limit'),
    grace_days: grace,
    modules: b.modules === undefined ? exists?.modules ?? null : (cleanModules(b.modules) ? JSON.stringify(cleanModules(b.modules)) : null),
    visible: b.visible === undefined ? exists?.visible ?? 1 : (b.visible ? 1 : 0),
    active: b.active === undefined ? exists?.active ?? 1 : (b.active ? 1 : 0),
    sort_order: b.sort_order === undefined ? exists?.sort_order ?? (db.prepare('SELECT COALESCE(MAX(sort_order),0)+1 n FROM plans').get().n) : Math.trunc(Number(b.sort_order)) || 0,
  };
  const newPrices = [];
  for (const cur of CURRENCIES) for (const int of ['month', 'year']) {
    const v = b.price?.[cur]?.[int];
    if (v === undefined || v === null || v === '') continue;
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0 || n > 1e9 || Math.trunc(n) !== n) throw bad(`${cur} ${int}ly price must be a whole amount`);
    if (PLANS[pid]?.price?.[cur]?.[int] !== n) newPrices.push([cur, int, n]);
  }
  if (!exists && !newPrices.some(([cur]) => cur === 'PKR')) throw bad('A new plan needs at least its PKR monthly and yearly prices');
  const changes = { created: !exists, fields: Object.keys(fields).filter((k) => !exists || String(exists[k] ?? '') !== String(fields[k] ?? '')), prices: newPrices.map(([c, i, a]) => ({ currency: c, interval: i, from: PLANS[pid]?.price?.[c]?.[i] ?? null, to: a })) };
  db.exec('BEGIN IMMEDIATE');
  try {
    if (exists) db.prepare(`UPDATE plans SET ${Object.keys(fields).map((k) => `${k}=?`).join(',')}, updated_at=datetime('now'), updated_by=? WHERE id=?`).run(...Object.values(fields), actor, pid);
    else db.prepare(`INSERT INTO plans(id,${Object.keys(fields).join(',')},updated_by) VALUES(?,${Object.keys(fields).map(() => '?').join(',')},?)`).run(pid, ...Object.values(fields), actor);
    for (const [cur, int, amount] of newPrices) db.prepare('INSERT INTO plan_prices(plan_id,currency,interval,amount,created_by) VALUES(?,?,?,?,?)').run(pid, cur, int, amount, actor);
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  reloadPlans();
  return { plan: listPlans().find((p) => p.id === pid), changes };
}

/** Trial length for new sign-ups and which plan's limits a trial gets. */
export function savePlanSettings({ default_trial_days, trial_plan }, actor) {
  const set = (k, v) => db.prepare("INSERT INTO platform_settings(key,value,updated_by,updated_at) VALUES(?,?,?,datetime('now')) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_by=excluded.updated_by, updated_at=excluded.updated_at").run(k, String(v), actor);
  if (default_trial_days !== undefined) {
    const n = Math.trunc(Number(default_trial_days));
    if (!(n >= 0 && n <= 365)) throw bad('Trial days must be between 0 and 365');
    set('default_trial_days', n);
  }
  if (trial_plan !== undefined) {
    if (!PLANS[trial_plan]) throw new HttpError(400, 'Unknown plan');
    set('trial_plan', trial_plan);
  }
  reloadPlans();
  return { ...PLAN_SETTINGS };
}
