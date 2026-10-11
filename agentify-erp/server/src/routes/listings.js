import { Router } from 'express';
import { all, get } from '../db.js';
import { can, hasPerm, requireStaff } from '../rbac.js';
import { asyncH, bad, notFound } from '../util.js';
import { approveProject, approveProperty, rejectProject, rejectProperty, requestProject } from '../services/listings.js';

/**
 * Website listing approvals. Sales agents add properties and ask for projects to be shown; the Listing Manager approves
 * (which publishes and features them) or sends them back with a reason.
 */
const r = Router();
r.use(requireStaff);

const COVER = "(SELECT path FROM media WHERE entity_type='property' AND entity_id=p.id AND kind IN ('cover','gallery') ORDER BY kind='cover' DESC, sort_order LIMIT 1)";

r.get('/queue', can('listings', 'view'), asyncH((req, res) => {
  const props = all(`SELECT p.id,p.code,p.title,p.property_type,p.purpose,p.city,p.area_name,p.location,p.net_price,p.area_size,p.unit,p.description,p.project_id,p.updated_at,p.created_at,
      COALESCE(a.name, c.name) agent_name, COALESCE(a.phone, c.phone) agent_phone, pr.name project_name, ${COVER} cover,
      (SELECT COUNT(*) FROM media WHERE entity_type='property' AND entity_id=p.id AND kind IN ('cover','gallery')) photos
    FROM properties p LEFT JOIN users a ON a.id=p.agent_id LEFT JOIN users c ON c.id=p.created_by LEFT JOIN projects pr ON pr.id=p.project_id
    WHERE p.review_state='review' ORDER BY p.updated_at, p.id`).map((p) => ({
    ...p, cover: p.cover ? `/uploads/${p.cover}` : null,
    checks: [{ ok: p.net_price > 0, label: 'Price set' }, { ok: p.photos > 0, label: `${p.photos} photo(s)` }, { ok: !!(p.description && p.description.trim().length > 20), label: 'Description' }, { ok: !!(p.city || p.location), label: 'Location' }],
  }));
  const projects = all(`SELECT p.id,p.code,p.name,p.location,p.description,p.kind,p.dev_status,p.total_units,p.site_requested_at,u.name requested_by, u.phone requested_by_phone,
      (SELECT path FROM media WHERE entity_type='project' AND entity_id=p.id ORDER BY sort_order LIMIT 1) cover
    FROM projects p LEFT JOIN users u ON u.id=p.site_requested_by WHERE p.site_state='requested' ORDER BY p.site_requested_at, p.id`).map((p) => ({ ...p, cover: p.cover ? `/uploads/${p.cover}` : null }));
  const decided = all(`SELECT p.id, p.title name, 'property' kind, p.review_state state, p.review_note note, p.reviewed_at at, u.name by_name FROM properties p LEFT JOIN users u ON u.id=p.review_by
      WHERE p.reviewed_at IS NOT NULL ORDER BY p.reviewed_at DESC LIMIT 15`);
  res.json({ properties: props, projects, decided, pending: props.length + projects.length });
}));

r.post('/properties/:id(\\d+)/approve', can('listings', 'approve'), asyncH((req, res) => { approveProperty(Number(req.params.id), req); res.json({ ok: true }); }));
r.post('/properties/:id(\\d+)/reject', can('listings', 'approve'), asyncH((req, res) => { rejectProperty(Number(req.params.id), req.body?.note, req); res.json({ ok: true }); }));
r.post('/properties/approve-all', can('listings', 'approve'), asyncH((req, res) => {
  const ids = (Array.isArray(req.body?.ids) ? req.body.ids : []).map(Number).filter(Boolean);
  if (!ids.length) throw bad('Choose at least one listing');
  const done = [], failed = [];
  for (const id of ids) { try { approveProperty(id, req); done.push(id); } catch (e) { failed.push({ id, error: e.message }); } }
  res.json({ approved: done.length, failed });
}));

r.post('/projects/:id(\\d+)/approve', can('listings', 'approve'), asyncH((req, res) => { approveProject(Number(req.params.id), req); res.json({ ok: true }); }));
r.post('/projects/:id(\\d+)/reject', can('listings', 'approve'), asyncH((req, res) => { rejectProject(Number(req.params.id), req.body?.note, req); res.json({ ok: true }); }));
/** Any staff member who can add properties (a sales agent) or see projects can ask for one to be shown on the website. */
r.post('/projects/:id(\\d+)/request', asyncH((req, res) => {
  if (!hasPerm(req.user, 'properties', 'create') && !hasPerm(req.user, 'projects', 'view')) throw bad('You cannot request website listings');
  if (!get('SELECT 1 FROM projects WHERE id=?', req.params.id)) throw notFound('Project not found');
  requestProject(Number(req.params.id), req);
  res.json({ ok: true });
}));

export default r;
