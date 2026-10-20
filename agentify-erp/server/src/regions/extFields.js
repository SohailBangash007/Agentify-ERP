// Region-specific fields (a pack lists them; values live in the workspace database). Typed and validated here so a
// region can add a field without a schema change. Money fields are stored as minor units like every other amount.
import { run, get, all } from '../db.js';
import { audit } from '../audit.js';
import { bad } from '../util.js';
import { currentRegion } from './runtime.js';

export function fieldDefs(entity) {
  const cfg = currentRegion().config;
  return (cfg.ext_fields || []).filter((f) => f.entity === entity)
    .map((f) => ({ ...f, options: f.options === 'sub_regions' ? (cfg.sub_regions || []) : f.options }));
}

function clean(def, v) {
  if (v === undefined || v === null || v === '') return null;
  if (def.type === 'number' || def.type === 'money') { const n = Number(v); if (!Number.isInteger(n) || n < 0) throw bad(`${def.label} must be a whole non-negative number`); return String(n); }
  if (def.type === 'select') { if (!def.options.includes(v)) throw bad(`${def.label}: choose one of the listed values`); return String(v); }
  const t = String(v).trim();
  if (t.length > 200) throw bad(`${def.label} is too long`);
  return t;
}

export function getExt(entity, id) {
  const defs = fieldDefs(entity);
  const rows = Object.fromEntries(all('SELECT key, value FROM region_ext_values WHERE entity=? AND entity_id=?', entity, id).map((r) => [r.key, r.value]));
  return { fields: defs, values: Object.fromEntries(defs.map((d) => [d.key, rows[d.key] ?? null])) };
}

export function saveExt(req, entity, id, input) {
  const defs = fieldDefs(entity);
  const byKey = Object.fromEntries(defs.map((d) => [d.key, d]));
  for (const k of Object.keys(input || {})) if (!byKey[k]) throw bad(`Unknown field: ${k}`);
  for (const [k, v] of Object.entries(input || {})) {
    const val = clean(byKey[k], v);
    if (val === null) run('DELETE FROM region_ext_values WHERE entity=? AND entity_id=? AND key=?', entity, id, k);
    else run(`INSERT INTO region_ext_values(entity, entity_id, key, value, updated_by, updated_at) VALUES(?,?,?,?,?,datetime('now'))
      ON CONFLICT(entity, entity_id, key) DO UPDATE SET value=excluded.value, updated_by=excluded.updated_by, updated_at=excluded.updated_at`, entity, id, k, val, req.user?.id ?? null);
  }
  audit(req, 'Updated region fields', entity, id, { keys: Object.keys(input || {}) });
  return getExt(entity, id);
}
export const entityExists = (entity, id) => !!get(entity === 'contact' ? 'SELECT 1 FROM contacts WHERE id=?' : 'SELECT 1 FROM properties WHERE id=?', id);
