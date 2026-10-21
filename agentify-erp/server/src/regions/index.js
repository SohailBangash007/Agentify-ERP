// Region control plane: pack versions, per-region flag switches, effective-dated rules and FX rates live in platform.db.
// Packs shipped in the code are seeded once; later edits made in the console are new versions, never overwrites.
import { FILE_PACKS, setOverrides, clientConfig, packOf } from './runtime.js';
import { COUNTRY_COPY } from './marketingCopy.js';

export const REGION_COLUMNS = [['region', "TEXT NOT NULL DEFAULT 'PK'"], ['sub_region', 'TEXT'], ['money_scale', 'INTEGER NOT NULL DEFAULT 0'],
  ['locale', "TEXT NOT NULL DEFAULT 'en-PK'"], ['language', "TEXT NOT NULL DEFAULT 'en'"], ['units_system', 'TEXT'], ['flags', 'TEXT']];

const SCHEMA = `
CREATE TABLE IF NOT EXISTS region_packs(
  code TEXT NOT NULL, version INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','active','retired')),
  manifest TEXT NOT NULL, note TEXT, created_by TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), PRIMARY KEY(code, version));
CREATE TABLE IF NOT EXISTS region_flags(
  region TEXT NOT NULL, flag TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 0, updated_by TEXT, updated_at TEXT, PRIMARY KEY(region, flag));
CREATE TABLE IF NOT EXISTS region_rules(
  id INTEGER PRIMARY KEY, region TEXT NOT NULL, sub_region TEXT, kind TEXT NOT NULL, key TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1,
  effective_from TEXT NOT NULL, effective_to TEXT, value TEXT NOT NULL, source_url TEXT, needs_legal_review INTEGER NOT NULL DEFAULT 1,
  reviewed_by TEXT, reviewed_at TEXT, created_by TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE INDEX IF NOT EXISTS idx_region_rules ON region_rules(region, kind, key);
CREATE TABLE IF NOT EXISTS region_rule_audit(
  id INTEGER PRIMARY KEY, region TEXT, rule_id INTEGER, action TEXT NOT NULL, actor TEXT, before TEXT, after TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS fx_rates(
  base TEXT NOT NULL, quote TEXT NOT NULL, rate_ppm INTEGER NOT NULL, as_of TEXT NOT NULL, source TEXT NOT NULL DEFAULT 'manual', PRIMARY KEY(base, quote, as_of));
`;

/** Creates the region tables, seeds the shipped packs the first time, and loads the newest active version of each. */
export function initRegions(pdb) {
  pdb.exec(SCHEMA);
  const ins = pdb.prepare('INSERT OR IGNORE INTO region_packs(code, version, status, manifest, note, created_by) VALUES(?,?,?,?,?,?)');
  for (const p of Object.values(FILE_PACKS)) {
    const v = p.version || 1;
    if (pdb.prepare('SELECT 1 FROM region_packs WHERE code=? AND version=?').get(p.code, v)) continue;
    // a newer shipped version inherits the status the console gave the previous one, and replaces it
    const prev = pdb.prepare("SELECT version, status FROM region_packs WHERE code=? AND status IN ('active','draft') ORDER BY version DESC LIMIT 1").get(p.code);
    const status = prev ? prev.status : (p.status === 'active' ? 'active' : 'draft');
    ins.run(p.code, v, status, JSON.stringify(p), prev ? `shipped with the release (replaces v${prev.version})` : 'shipped with the release', 'system');
    if (prev) pdb.prepare("UPDATE region_packs SET status='retired' WHERE code=? AND version<?").run(p.code, v);
  }
  // A server that ran an earlier release still has these countries as drafts. Open them, unless someone in the console
  // deliberately took the country back to draft (that is recorded in the audit table, so it is never overridden here).
  for (const p of Object.values(FILE_PACKS)) {
    if (p.status !== 'active') continue;
    const top = pdb.prepare('SELECT MAX(version) v FROM region_packs WHERE code=?').get(p.code)?.v;
    if (!top || pdb.prepare('SELECT status FROM region_packs WHERE code=? AND version=?').get(p.code, top).status !== 'draft') continue;
    if (pdb.prepare("SELECT 1 FROM region_rule_audit WHERE region=? AND action='status:draft'").get(p.code)) continue;
    pdb.prepare("UPDATE region_packs SET status='active' WHERE code=? AND version=?").run(p.code, top);
    pdb.prepare("INSERT INTO region_rule_audit(region, action, actor, after) VALUES(?,?,?,?)").run(p.code, 'status:active', 'system', JSON.stringify({ version: top, reason: 'shipped as open' }));
  }
  loadOverrides(pdb);
}

/** Re-reads the console-controlled state into the runtime (called at start-up and after any console change). */
export function loadOverrides(pdb) {
  const map = new Map();
  const rows = pdb.prepare("SELECT code, version, status, manifest FROM region_packs WHERE status IN ('active','draft') ORDER BY code, version").all();
  for (const r of rows) {
    const cur = map.get(r.code);
    // an active version beats any draft; among equals the highest version wins
    if (cur && cur.status === 'active' && r.status !== 'active') continue;
    map.set(r.code, { manifest: { ...JSON.parse(r.manifest), status: r.status, version: r.version }, status: r.status, flags: {} });
  }
  for (const f of pdb.prepare('SELECT region, flag, enabled FROM region_flags').all()) { const o = map.get(f.region); if (o) o.flags[f.flag] = !!f.enabled; }
  setOverrides(map);
}

/** Regions a new workspace may pick today: only packs that are active. */
export const selectableRegions = (pdb) => pdb.prepare("SELECT code, manifest FROM region_packs WHERE status='active' ORDER BY code, version").all()
  .reduce((m, r) => m.set(r.code, JSON.parse(r.manifest)), new Map());

/** Every country for the marketing site: open ones can sign up, the others show a waiting-list call to action. */
export function listCountries(pdb) {
  const open = selectableRegions(pdb);
  const ORDER = ['US', 'UK', 'AE', 'PK', 'CA'];
  return Object.keys(FILE_PACKS).sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b)).map((code) => {
    const p = packOf(code);
    const copy = COUNTRY_COPY[code] || {};
    return { code, name: p.name, slug: copy.slug || code.toLowerCase(), flag: copy.flag || '', currency: p.currency, locale: p.locale, languages: p.languages, sub_region_label: p.sub_region_label, sub_regions: p.sub_regions,
      timezones: p.timezones || [p.timezone], open: open.has(code), copy, config: clientConfig({ region: code }) };
  });
}
