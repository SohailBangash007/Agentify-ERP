// Console operations for regions. Every change is written to region_rule_audit; packs are versioned, never overwritten,
// and a rule edit is always a new row (version + 1) so earlier calculations stay explainable.
import { FILE_PACKS } from './runtime.js';
import { loadOverrides } from './index.js';

const audit = (pdb, region, ruleId, action, actor, before, after) => pdb.prepare('INSERT INTO region_rule_audit(region, rule_id, action, actor, before, after) VALUES(?,?,?,?,?,?)')
  .run(region, ruleId ?? null, action, actor || null, before == null ? null : JSON.stringify(before), after == null ? null : JSON.stringify(after));

export function listRegions(pdb) {
  return Object.keys(FILE_PACKS).map((code) => {
    const versions = pdb.prepare('SELECT version, status, note, created_by, created_at FROM region_packs WHERE code=? ORDER BY version DESC').all(code);
    const flags = Object.fromEntries(pdb.prepare('SELECT flag, enabled FROM region_flags WHERE region=?').all(code).map((f) => [f.flag, !!f.enabled]));
    const p = FILE_PACKS[code];
    return {
      code, name: p.name, currency: p.currency, status: versions.some((v) => v.status === 'active') ? 'active' : 'draft', versions,
      flags: { ...(p.flags || {}), ...flags },
      workspaces: pdb.prepare('SELECT COUNT(*) n FROM tenants WHERE region=?').get(code).n,
      rules: pdb.prepare('SELECT COUNT(*) n FROM region_rules WHERE region=?').get(code).n,
      unreviewed_rules: pdb.prepare('SELECT COUNT(*) n FROM region_rules WHERE region=? AND needs_legal_review=1').get(code).n,
    };
  });
}

/** Make a region available at signup (or take it back to draft). A region that has workspaces cannot go back to draft. */
export function setRegionStatus(pdb, code, status, actor) {
  if (!FILE_PACKS[code]) throw new Error('Unknown region');
  if (!['active', 'draft'].includes(status)) throw new Error('Status must be active or draft');
  if (code === 'PK' && status !== 'active') throw new Error('The Pakistan pack stays active');
  if (status === 'draft' && pdb.prepare('SELECT COUNT(*) n FROM tenants WHERE region=?').get(code).n) throw new Error('This region has workspaces, so it cannot go back to draft');
  const top = pdb.prepare('SELECT MAX(version) v FROM region_packs WHERE code=?').get(code).v;
  pdb.prepare('UPDATE region_packs SET status=? WHERE code=? AND version=?').run(status, code, top);
  audit(pdb, code, null, `status:${status}`, actor, null, { version: top });
  loadOverrides(pdb);
}

export function setRegionFlag(pdb, code, flag, enabled, actor) {
  if (!FILE_PACKS[code]) throw new Error('Unknown region');
  if (!/^[a-z_]{2,40}$/.test(flag)) throw new Error('Invalid flag name');
  const before = pdb.prepare('SELECT enabled FROM region_flags WHERE region=? AND flag=?').get(code, flag);
  pdb.prepare("INSERT INTO region_flags(region, flag, enabled, updated_by, updated_at) VALUES(?,?,?,?,datetime('now')) ON CONFLICT(region, flag) DO UPDATE SET enabled=excluded.enabled, updated_by=excluded.updated_by, updated_at=excluded.updated_at")
    .run(code, flag, enabled ? 1 : 0, actor || null);
  audit(pdb, code, null, `flag:${flag}`, actor, before ? { enabled: !!before.enabled } : null, { enabled: !!enabled });
  loadOverrides(pdb);
}

/** A new rule row (version + 1). Always flagged for legal review until a person marks it reviewed. */
export function saveRule(pdb, r, actor) {
  for (const k of ['region', 'kind', 'key', 'effective_from', 'value']) if (r[k] === undefined || r[k] === '') throw new Error(`${k} is required`);
  if (!FILE_PACKS[r.region]) throw new Error('Unknown region');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(r.effective_from)) throw new Error('effective_from must be YYYY-MM-DD');
  const value = typeof r.value === 'string' ? r.value : JSON.stringify(r.value);
  try { JSON.parse(value); } catch { throw new Error('value must be valid JSON'); }
  const prev = pdb.prepare("SELECT MAX(version) v FROM region_rules WHERE region=? AND COALESCE(sub_region,'')=? AND kind=? AND key=?").get(r.region, r.sub_region || '', r.kind, r.key).v || 0;
  const info = pdb.prepare('INSERT INTO region_rules(region, sub_region, kind, key, version, effective_from, effective_to, value, source_url, needs_legal_review, created_by) VALUES(?,?,?,?,?,?,?,?,?,1,?)')
    .run(r.region, r.sub_region || null, r.kind, r.key, prev + 1, r.effective_from, r.effective_to || null, value, r.source_url || null, actor || null);
  const id = Number(info.lastInsertRowid);
  audit(pdb, r.region, id, 'rule:create', actor, null, { ...r, version: prev + 1 });
  return id;
}
export function reviewRule(pdb, id, actor) {
  const row = pdb.prepare('SELECT * FROM region_rules WHERE id=?').get(id);
  if (!row) throw new Error('Rule not found');
  pdb.prepare("UPDATE region_rules SET needs_legal_review=0, reviewed_by=?, reviewed_at=datetime('now') WHERE id=?").run(actor || null, id);
  audit(pdb, row.region, id, 'rule:reviewed', actor, { needs_legal_review: 1 }, { needs_legal_review: 0 });
}
export const listRules = (pdb, region) => pdb.prepare('SELECT * FROM region_rules WHERE region=? ORDER BY kind, key, version DESC').all(region);
export const ruleAudit = (pdb, region) => pdb.prepare('SELECT * FROM region_rule_audit WHERE region=? ORDER BY id DESC LIMIT 200').all(region);

/** Exchange rates are stored as parts per million of base->quote so they stay integers. */
export function saveFx(pdb, { base, quote, rate, as_of, source }, actor) {
  if (!/^[A-Z]{3}$/.test(base || '') || !/^[A-Z]{3}$/.test(quote || '') || base === quote) throw new Error('Use two different 3-letter currency codes');
  const ppm = Math.round(Number(rate) * 1e6);
  if (!(ppm > 0)) throw new Error('Rate must be greater than zero');
  pdb.prepare('INSERT OR REPLACE INTO fx_rates(base, quote, rate_ppm, as_of, source) VALUES(?,?,?,?,?)').run(base, quote, ppm, as_of || new Date().toISOString().slice(0, 10), source || 'manual');
  audit(pdb, null, null, 'fx:set', actor, null, { base, quote, rate: ppm / 1e6, as_of });
}
export const listFx = (pdb) => pdb.prepare('SELECT base, quote, rate_ppm, as_of, source FROM fx_rates ORDER BY as_of DESC, base, quote LIMIT 200').all().map((r) => ({ ...r, rate: r.rate_ppm / 1e6 }));
