// Document templates and compliance checklists for the workspace's region. Starter content comes from the region pack
// (marked "needs legal review"); a workspace can add its own templates, and every edit of a template is a new version.
import { Router } from 'express';
import { all, get, run } from '../db.js';
import { audit } from '../audit.js';
import { asyncH, bad, notFound, now, jparse, today } from '../util.js';
import { can } from '../rbac.js';
import { currentTenant } from '../context.js';
import { flagOn, currentRegion } from './runtime.js';
import { render, placeholders, unknownVariables, VARIABLES, KINDS, checklistStatus } from '../../../shared/region/templates.js';

const r = Router();
const needFlag = (flag, msg) => (req, _res, next) => (flagOn(currentTenant(), flag) ? next() : next(notFound(msg)));

/** Copies the region pack's starter templates and checklists into the workspace the first time they are needed. */
function seed() {
  const cfg = currentRegion().config;
  for (const t of cfg.templates || []) {
    const tkey = `${cfg.region}:${t.kind}:${t.name}`;
    if (!get('SELECT 1 FROM doc_templates WHERE tkey=?', tkey)) run('INSERT INTO doc_templates(tkey, region, kind, name, language, body, needs_legal_review, source) VALUES(?,?,?,?,?,?,?,?)', tkey, cfg.region, t.kind, t.name, t.language || 'en', t.body, t.needs_legal_review === false ? 0 : 1, 'pack');
  }
  for (const c of cfg.checklists || []) {
    if (!get('SELECT 1 FROM checklist_templates WHERE ckey=?', c.key)) run('INSERT INTO checklist_templates(ckey, region, name, applies_to, items, needs_legal_review) VALUES(?,?,?,?,?,?)', c.key, cfg.region, c.name, c.applies_to || 'sale', JSON.stringify(c.items), c.needs_legal_review === false ? 0 : 1);
  }
}
r.use((_req, _res, next) => { seed(); next(); });

// ---- Templates
const latest = "id IN (SELECT id FROM doc_templates d WHERE d.version=(SELECT MAX(version) FROM doc_templates WHERE tkey=d.tkey))";
r.get('/variables', can('crm', 'view'), (_req, res) => res.json({ kinds: KINDS, variables: VARIABLES }));
r.get('/templates', needFlag('templates', 'Document templates are not switched on for this workspace'), can('crm', 'view'), (_req, res) => res.json(all(`SELECT id, tkey, region, kind, name, language, version, needs_legal_review, source, created_at FROM doc_templates WHERE active=1 AND ${latest} ORDER BY kind, name`)));
r.get('/templates/:id', needFlag('templates', 'Document templates are not switched on for this workspace'), can('crm', 'view'), asyncH((req, res) => {
  const t = get('SELECT * FROM doc_templates WHERE id=?', Number(req.params.id));
  if (!t) throw notFound('Template not found');
  res.json({ ...t, placeholders: placeholders(t.body) });
}));
const clean = (b) => {
  const kind = String(b.kind || ''), name = String(b.name || '').trim(), body = String(b.body || '');
  if (!KINDS.includes(kind)) throw bad('Choose a document kind');
  if (!name) throw bad('Template name is required');
  if (!body.trim()) throw bad('Template text is required');
  const unknown = unknownVariables(kind, body);
  if (unknown.length) throw bad(`Unknown placeholder${unknown.length > 1 ? 's' : ''}: ${unknown.join(', ')}`);
  return { kind, name, body, language: b.language || 'en' };
};
r.post('/templates', needFlag('templates', 'Document templates are not switched on for this workspace'), can('settings', 'edit'), asyncH((req, res) => {
  const t = clean(req.body || {});
  const region = currentRegion().config.region;
  const tkey = `${region}:custom:${t.kind}:${t.name}`;
  if (get('SELECT 1 FROM doc_templates WHERE tkey=?', tkey)) throw bad('A template with that name already exists');
  const id = Number(run('INSERT INTO doc_templates(tkey, region, kind, name, language, body, needs_legal_review, source, created_by) VALUES(?,?,?,?,?,?,1,?,?)', tkey, region, t.kind, t.name, t.language, t.body, 'custom', req.user.id).lastInsertRowid);
  audit(req, 'Created template', 'template', id, t.name);
  res.status(201).json(get('SELECT * FROM doc_templates WHERE id=?', id));
}));
r.put('/templates/:id', needFlag('templates', 'Document templates are not switched on for this workspace'), can('settings', 'edit'), asyncH((req, res) => {
  const old = get('SELECT * FROM doc_templates WHERE id=?', Number(req.params.id));
  if (!old) throw notFound('Template not found');
  const t = clean({ kind: old.kind, name: old.name, ...req.body });
  // an edit is a new version; the old text stays so a document made from it can still be explained
  const id = Number(run('INSERT INTO doc_templates(tkey, region, kind, name, language, body, version, needs_legal_review, source, created_by) VALUES(?,?,?,?,?,?,?,1,?,?)', old.tkey, old.region, old.kind, old.name, t.language, t.body, old.version + 1, 'custom', req.user.id).lastInsertRowid);
  audit(req, 'Edited template', 'template', id, `${old.name} v${old.version + 1}`);
  res.json(get('SELECT * FROM doc_templates WHERE id=?', id));
}));
r.post('/templates/:id/render', needFlag('templates', 'Document templates are not switched on for this workspace'), can('crm', 'view'), asyncH((req, res) => {
  const t = get('SELECT * FROM doc_templates WHERE id=?', Number(req.params.id));
  if (!t) throw notFound('Template not found');
  const reg = currentRegion();
  const out = render(t.body, { today: today(), ...(req.body?.context || {}) }, { fmt: { money: (v) => reg.money.format(Number(v)), date: (v) => reg.fmt.date(String(v)) } });
  res.json({ ...out, template: { id: t.id, name: t.name, version: t.version }, notice: t.needs_legal_review ? 'Sample wording: have it reviewed by a licensed professional before use.' : null });
}));

// ---- Checklists
r.get('/checklists', needFlag('compliance', 'Checklists are not switched on for this workspace'), can('crm', 'view'), (req, res) => {
  const entity = req.query.applies_to;
  res.json(all('SELECT * FROM checklist_templates WHERE active=1 ORDER BY name').filter((c) => !entity || c.applies_to === entity).map((c) => ({ ...c, items: jparse(c.items, []) })));
});
r.get('/checklists/run', needFlag('compliance', 'Checklists are not switched on for this workspace'), can('crm', 'view'), asyncH((req, res) => {
  const entity = String(req.query.entity || ''), id = Number(req.query.id);
  if (!['sale', 'contact', 'property'].includes(entity) || !id) throw bad('entity and id are required');
  const out = all('SELECT * FROM checklist_templates WHERE active=1 AND applies_to=?', entity).map((c) => {
    run('INSERT OR IGNORE INTO checklist_runs(ckey, entity, entity_id, updated_at) VALUES(?,?,?,?)', c.ckey, entity, id, now());
    const rr = get('SELECT * FROM checklist_runs WHERE ckey=? AND entity=? AND entity_id=?', c.ckey, entity, id);
    const items = jparse(c.items, []), state = jparse(rr.state, {});
    return { run_id: rr.id, ckey: c.ckey, name: c.name, needs_legal_review: c.needs_legal_review, completed_at: rr.completed_at, items: items.map((i) => ({ ...i, ...(state[i.key] || { done: false }) })), status: checklistStatus(items, state) };
  });
  res.json(out);
}));
r.post('/checklists/run/:runId/item', needFlag('compliance', 'Checklists are not switched on for this workspace'), can('crm', 'edit'), asyncH((req, res) => {
  const rr = get('SELECT * FROM checklist_runs WHERE id=?', Number(req.params.runId));
  if (!rr) throw notFound('Checklist not found');
  if (rr.completed_at) throw bad('This checklist is already completed');
  const c = get('SELECT * FROM checklist_templates WHERE ckey=?', rr.ckey);
  const items = jparse(c.items, []);
  const key = String(req.body?.key || '');
  if (!items.some((i) => i.key === key)) throw bad('Unknown checklist item');
  const state = jparse(rr.state, {});
  state[key] = { done: !!req.body?.done, note: String(req.body?.note || '').slice(0, 500) || undefined, by: req.user.name, at: now() };
  run('UPDATE checklist_runs SET state=?, updated_at=? WHERE id=?', JSON.stringify(state), now(), rr.id);
  audit(req, state[key].done ? 'Checklist item done' : 'Checklist item reopened', rr.entity, rr.entity_id, `${c.name}: ${key}`);
  res.json({ status: checklistStatus(items, state), item: state[key] });
}));
r.post('/checklists/run/:runId/complete', needFlag('compliance', 'Checklists are not switched on for this workspace'), can('crm', 'edit'), asyncH((req, res) => {
  const rr = get('SELECT * FROM checklist_runs WHERE id=?', Number(req.params.runId));
  if (!rr) throw notFound('Checklist not found');
  const c = get('SELECT * FROM checklist_templates WHERE ckey=?', rr.ckey);
  const st = checklistStatus(jparse(c.items, []), jparse(rr.state, {}));
  if (!st.complete) throw bad(`${st.required - st.required_done} required item(s) are still open`);
  run('UPDATE checklist_runs SET completed_at=?, completed_by=?, updated_at=? WHERE id=?', now(), req.user.id, now(), rr.id);
  audit(req, 'Checklist completed', rr.entity, rr.entity_id, c.name);
  res.json({ completed: true });
}));
export default r;
