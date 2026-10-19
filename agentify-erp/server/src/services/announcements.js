// Platform announcements and release notes. Written by platform staff (content.manage), shown inside workspaces to the
// audience they target (product, plan, specific workspaces, workspace role) and optionally on the public website.
// Publishing a note is not a software deployment: the real running version comes from services/version.js.
import { platformDb } from '../platform.js';
import { PLANS, PRODUCTS, tenantProducts } from './plans.js';
import { bad, HttpError } from '../util.js';

const pdb = () => platformDb();
export const ANNOUNCEMENT_SCHEMA = `
CREATE TABLE IF NOT EXISTS announcements(
  id INTEGER PRIMARY KEY, title TEXT NOT NULL, body TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'info' CHECK(kind IN ('info','release','feature','maintenance','billing')),
  audience TEXT NOT NULL DEFAULT '{}', status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','published','retired')), publish_at TEXT, retire_at TEXT,
  show_on_website INTEGER NOT NULL DEFAULT 0, version_tag TEXT, created_by TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT, published_at TEXT, retired_at TEXT);
CREATE INDEX IF NOT EXISTS idx_announcements ON announcements(status, publish_at);
CREATE TABLE IF NOT EXISTS announcement_reads(announcement_id INTEGER NOT NULL REFERENCES announcements(id) ON DELETE CASCADE, tenant_id INTEGER NOT NULL, user_id INTEGER NOT NULL,
  seen_at TEXT NOT NULL DEFAULT (datetime('now')), read_at TEXT, PRIMARY KEY(announcement_id, tenant_id, user_id));
`;
let ready = false;
const ensure = () => { if (!ready) { pdb().exec(ANNOUNCEMENT_SCHEMA); ready = true; } };
const KINDS = ['info', 'release', 'feature', 'maintenance', 'billing'];
const nowIso = () => new Date().toISOString();
const parse = (s) => { try { return JSON.parse(s || '{}'); } catch { return {}; } };

/** draft | scheduled | live | retired, from the stored status and the dates. */
export function stateOf(a, at = nowIso()) {
  if (a.status === 'draft') return 'draft';
  if (a.status === 'retired' || (a.retire_at && a.retire_at <= at)) return 'retired';
  if (a.publish_at && a.publish_at > at) return 'scheduled';
  return 'live';
}
const view = (a) => ({ ...a, audience: parse(a.audience), show_on_website: !!a.show_on_website, state: stateOf(a) });

function cleanAudience(a = {}) {
  const list = (v, ok, label) => { if (v == null || (Array.isArray(v) && !v.length)) return []; if (!Array.isArray(v) || v.some((x) => !ok(x))) throw bad(`Unknown ${label}`); return [...new Set(v)]; };
  return {
    products: list(a.products, (x) => !!PRODUCTS[x], 'product'), plans: list(a.plans, (x) => !!PLANS[x] || x === 'trial', 'plan'),
    tenants: list(a.tenants, (x) => Number.isInteger(Number(x)) && Number(x) > 0, 'workspace').map(Number), roles: list(a.roles, (x) => typeof x === 'string' && x.length <= 60, 'role'),
  };
}
const isoOrNull = (v, label) => {
  if (v === undefined || v === null || v === '') return null;
  const t = Date.parse(v);
  if (!Number.isFinite(t)) throw bad(`${label} is not a valid date and time`);
  return new Date(t).toISOString();
};

export function listAnnouncements() {
  ensure();
  return pdb().prepare(`SELECT a.*, (SELECT COUNT(*) FROM announcement_reads r WHERE r.announcement_id=a.id) seen, (SELECT COUNT(*) FROM announcement_reads r WHERE r.announcement_id=a.id AND r.read_at IS NOT NULL) read_count
    FROM announcements a ORDER BY COALESCE(a.publish_at, a.created_at) DESC, a.id DESC`).all().map(view);
}

export function saveAnnouncement(id, b, by) {
  ensure();
  const cur = id ? pdb().prepare('SELECT * FROM announcements WHERE id=?').get(Number(id)) : null;
  if (id && !cur) throw new HttpError(404, 'Announcement not found');
  const title = String(b.title ?? cur?.title ?? '').trim();
  const body = String(b.body ?? cur?.body ?? '').trim();
  if (!title || title.length > 140) throw bad('Title is required (up to 140 characters)');
  if (!body || body.length > 5000) throw bad('Text is required (up to 5000 characters)');
  const kind = b.kind ?? cur?.kind ?? 'info';
  if (!KINDS.includes(kind)) throw bad(`Kind must be one of: ${KINDS.join(', ')}`);
  const row = {
    title, body, kind, audience: JSON.stringify(b.audience !== undefined ? cleanAudience(b.audience) : parse(cur?.audience)),
    publish_at: b.publish_at !== undefined ? isoOrNull(b.publish_at, 'Publish time') : cur?.publish_at ?? null,
    retire_at: b.retire_at !== undefined ? isoOrNull(b.retire_at, 'End time') : cur?.retire_at ?? null,
    show_on_website: b.show_on_website !== undefined ? (b.show_on_website ? 1 : 0) : cur?.show_on_website ?? 0,
    version_tag: b.version_tag !== undefined ? (String(b.version_tag || '').trim().slice(0, 40) || null) : cur?.version_tag ?? null,
  };
  if (row.publish_at && row.retire_at && row.retire_at <= row.publish_at) throw bad('The end time must be after the publish time');
  if (cur) pdb().prepare(`UPDATE announcements SET ${Object.keys(row).map((k) => `${k}=?`).join(',')}, updated_at=datetime('now') WHERE id=?`).run(...Object.values(row), cur.id);
  else id = Number(pdb().prepare(`INSERT INTO announcements(${Object.keys(row).join(',')},created_by) VALUES(${Object.keys(row).map(() => '?').join(',')},?)`).run(...Object.values(row), by).lastInsertRowid);
  return view(pdb().prepare('SELECT * FROM announcements WHERE id=?').get(Number(id)));
}

/** Publish now (or at publish_at if that is later) / retire now. */
export function setAnnouncementStatus(id, action) {
  ensure();
  const a = pdb().prepare('SELECT * FROM announcements WHERE id=?').get(Number(id));
  if (!a) throw new HttpError(404, 'Announcement not found');
  if (action === 'publish') pdb().prepare("UPDATE announcements SET status='published', published_at=COALESCE(published_at, ?), publish_at=COALESCE(publish_at, ?), retired_at=NULL, updated_at=datetime('now') WHERE id=?").run(nowIso(), nowIso(), a.id);
  else if (action === 'retire') pdb().prepare("UPDATE announcements SET status='retired', retired_at=?, updated_at=datetime('now') WHERE id=?").run(nowIso(), a.id);
  else if (action === 'draft') pdb().prepare("UPDATE announcements SET status='draft', updated_at=datetime('now') WHERE id=?").run(a.id);
  else throw bad('Action must be publish, retire or draft');
  return view(pdb().prepare('SELECT * FROM announcements WHERE id=?').get(a.id));
}

/** Does this announcement target this workspace user? Empty lists mean "everyone". */
export function matches(a, tenant, roleName) {
  const au = typeof a.audience === 'string' ? parse(a.audience) : a.audience || {};
  if (au.tenants?.length && !au.tenants.includes(tenant.id)) return false;
  if (au.products?.length && !tenantProducts(tenant).some((p) => au.products.includes(p))) return false;
  if (au.plans?.length) {
    const key = ['trialing', 'pending'].includes(tenant.subscription_status) || tenant.is_legacy ? 'trial' : tenant.plan;
    if (!au.plans.includes(key)) return false;
  }
  if (au.roles?.length && !au.roles.includes(roleName)) return false;
  return true;
}

/** What one signed-in workspace user should see now, with read state. Marks them as seen (delivery). */
export function forUser(tenant, user) {
  ensure();
  const at = nowIso();
  const live = pdb().prepare("SELECT * FROM announcements WHERE status='published'").all().filter((a) => stateOf(a, at) === 'live' && matches(a, tenant, user.role_name || user.role));
  const ins = pdb().prepare('INSERT OR IGNORE INTO announcement_reads(announcement_id,tenant_id,user_id) VALUES(?,?,?)');
  const readQ = pdb().prepare('SELECT read_at FROM announcement_reads WHERE announcement_id=? AND tenant_id=? AND user_id=?');
  return live.map((a) => { ins.run(a.id, tenant.id, user.id); return { id: a.id, title: a.title, body: a.body, kind: a.kind, version_tag: a.version_tag, published_at: a.publish_at || a.published_at, read: !!readQ.get(a.id, tenant.id, user.id)?.read_at }; })
    .sort((x, y) => String(y.published_at).localeCompare(String(x.published_at)));
}
export function markRead(tenant, user, id) {
  ensure();
  const a = pdb().prepare("SELECT * FROM announcements WHERE id=? AND status='published'").get(Number(id));
  if (!a || stateOf(a) !== 'live' || !matches(a, tenant, user.role_name || user.role)) throw new HttpError(404, 'Announcement not found');
  pdb().prepare("INSERT INTO announcement_reads(announcement_id,tenant_id,user_id,read_at) VALUES(?,?,?,datetime('now')) ON CONFLICT(announcement_id,tenant_id,user_id) DO UPDATE SET read_at=COALESCE(read_at, excluded.read_at)").run(a.id, tenant.id, user.id);
  return { ok: true };
}
/** Public website: live notes marked for the website (no audience restriction allowed there). */
export function publicAnnouncements() {
  ensure();
  return pdb().prepare("SELECT id, title, body, kind, version_tag, publish_at, published_at, audience FROM announcements WHERE status='published' AND show_on_website=1").all()
    .filter((a) => stateOf({ ...a, status: 'published' }) === 'live').filter((a) => { const au = parse(a.audience); return !au.tenants?.length && !au.roles?.length; })
    .map(({ audience, ...a }) => a).sort((x, y) => String(y.publish_at).localeCompare(String(x.publish_at))).slice(0, 20);
}
