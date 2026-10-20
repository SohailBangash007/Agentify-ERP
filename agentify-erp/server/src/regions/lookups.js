// Starter lists (property types, lead sources, amenities) follow the workspace's region. The original lists are Pakistan's
// (Plots, Files, Zameen.com, Mosque ...); a workspace in another region gets its country's lists instead. Runs once per
// workspace, after the workspace has its starter lists, and never touches a list the customer has already used.
import { all, get, run, getSetting, setSetting } from '../db.js';
import { currentRegion } from './runtime.js';

const LISTS = [
  ['property_type', (c) => (c.property_types || []).map((t) => t.label), "SELECT 1 FROM properties WHERE property_type=? LIMIT 1"],
  ['lead_source', (c) => c.lead_sources || [], 'SELECT 1 FROM contacts WHERE lead_source=? LIMIT 1'],
  ['amenity', (c) => c.amenities || [], null],
];

export function syncRegionLookups() {
  const c = currentRegion().config;
  if (c.region === 'PK') return false;
  const key = `region_lookups_v1:${c.region}`;
  if (getSetting(key)) return false;
  if (!get("SELECT 1 FROM lookups WHERE type='property_type' LIMIT 1")) return false; // starter lists not created yet
  for (const [type, desired, usedSql] of LISTS) {
    const want = desired(c);
    if (!want.length) continue;
    const have = all('SELECT id, value FROM lookups WHERE type=?', type);
    const haveVals = new Set(have.map((r) => r.value));
    want.forEach((v, i) => { if (!haveVals.has(v)) run('INSERT INTO lookups(type, value, sort_order) VALUES(?,?,?)', type, v, i); else run('UPDATE lookups SET sort_order=?, active=1 WHERE type=? AND value=?', i, type, v); });
    for (const r of have) if (!want.includes(r.value) && !(usedSql && get(usedSql, r.value)) && r.value !== 'Other') run('DELETE FROM lookups WHERE id=?', r.id);
  }
  setSetting(key, '1');
  return true;
}
