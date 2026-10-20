// Appointments (viewings, site visits, calls, meetings). Each is optionally linked to a contact and a property, and is
// added to the owner's Google Calendar when they have connected it.
import { Router } from 'express';
import { all, get, run } from '../db.js';
import { audit, activity } from '../audit.js';
import { asyncH, bad, notFound, forbidden, now } from '../util.js';
import { can } from '../rbac.js';
import { syncAppointment, calendarConnected } from '../integrations/googleCalendar.js';

const r = Router();
const KINDS = ['viewing', 'site_visit', 'meeting', 'call', 'signing', 'other'];
const STAMP = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?$/;
const norm = (s) => String(s).replace('T', ' ').padEnd(19, ':00').slice(0, 19);

function clean(b, existing = {}) {
  const starts = b.starts_at ?? existing.starts_at;
  let ends = b.ends_at ?? existing.ends_at;
  if (!starts || !STAMP.test(String(starts))) throw bad('Choose a start date and time.');
  const s = norm(starts);
  if (!ends) ends = new Date(Date.parse(s.replace(' ', 'T') + 'Z') + 3600e3).toISOString().slice(0, 19).replace('T', ' ');
  if (!STAMP.test(String(ends))) throw bad('The end time is not valid.');
  const e = norm(ends);
  if (e <= s) throw bad('The appointment must end after it starts.');
  const kind = b.kind ?? existing.kind ?? 'viewing';
  if (!KINDS.includes(kind)) throw bad('Choose a kind of appointment.');
  const title = String(b.title ?? existing.title ?? '').trim();
  if (!title) throw bad('Give the appointment a title.');
  return { title: title.slice(0, 160), kind, starts_at: s, ends_at: e, location: String(b.location ?? existing.location ?? '').slice(0, 200) || null, notes: String(b.notes ?? existing.notes ?? '').slice(0, 1000) || null };
}
const mineOr403 = (req, a) => { if (req.user.own_scope && a.user_id !== req.user.id) throw forbidden('This appointment belongs to someone else'); };

r.get('/', can('crm', 'view'), (req, res) => {
  const where = []; const params = [];
  if (req.user.own_scope) { where.push('a.user_id=?'); params.push(req.user.id); }
  else if (req.query.mine === '1') { where.push('a.user_id=?'); params.push(req.user.id); }
  if (req.query.from) { where.push('a.starts_at>=?'); params.push(`${req.query.from} 00:00:00`); }
  if (req.query.to) { where.push('a.starts_at<=?'); params.push(`${req.query.to} 23:59:59`); }
  if (req.query.contact_id) { where.push('a.contact_id=?'); params.push(Number(req.query.contact_id)); }
  const rows = all(`SELECT a.*, c.full_name AS contact_name, p.title AS property_title, u.name AS user_name FROM appointments a LEFT JOIN contacts c ON c.id=a.contact_id LEFT JOIN properties p ON p.id=a.property_id LEFT JOIN users u ON u.id=a.user_id
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY a.starts_at LIMIT 300`, ...params);
  res.json({ calendar_connected: calendarConnected(req.user.id), items: rows });
});
r.post('/', can('crm', 'edit'), asyncH(async (req, res) => {
  const b = req.body || {};
  const c = clean(b);
  if (b.contact_id && !get('SELECT 1 FROM contacts WHERE id=?', Number(b.contact_id))) throw notFound('Contact not found');
  if (b.contact_id && req.user.own_scope && get('SELECT agent_id FROM contacts WHERE id=?', Number(b.contact_id))?.agent_id !== req.user.id) throw forbidden('This contact is not assigned to you');
  const id = Number(run('INSERT INTO appointments(contact_id, property_id, user_id, title, kind, starts_at, ends_at, location, notes, created_by, created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
    b.contact_id ? Number(b.contact_id) : null, b.property_id ? Number(b.property_id) : null, req.user.id, c.title, c.kind, c.starts_at, c.ends_at, c.location, c.notes, req.user.id, now()).lastInsertRowid);
  audit(req, 'Created appointment', 'appointment', id, c.title);
  if (b.contact_id) activity(Number(b.contact_id), req.user, 'Appointment scheduled', { detail: `${c.title} · ${c.starts_at}`, entityType: 'appointment', entityId: id });
  await syncAppointment(id);
  res.status(201).json(get('SELECT * FROM appointments WHERE id=?', id));
}));
r.put('/:id', can('crm', 'edit'), asyncH(async (req, res) => {
  const a = get('SELECT * FROM appointments WHERE id=?', Number(req.params.id));
  if (!a) throw notFound('Appointment not found');
  mineOr403(req, a);
  const c = clean(req.body || {}, a);
  run('UPDATE appointments SET title=?, kind=?, starts_at=?, ends_at=?, location=?, notes=? WHERE id=?', c.title, c.kind, c.starts_at, c.ends_at, c.location, c.notes, a.id);
  await syncAppointment(a.id);
  res.json(get('SELECT * FROM appointments WHERE id=?', a.id));
}));
r.post('/:id/cancel', can('crm', 'edit'), asyncH(async (req, res) => {
  const a = get('SELECT * FROM appointments WHERE id=?', Number(req.params.id));
  if (!a) throw notFound('Appointment not found');
  mineOr403(req, a);
  run("UPDATE appointments SET status='canceled' WHERE id=?", a.id);
  audit(req, 'Canceled appointment', 'appointment', a.id, a.title);
  await syncAppointment(a.id);
  res.json(get('SELECT * FROM appointments WHERE id=?', a.id));
}));
export default r;
