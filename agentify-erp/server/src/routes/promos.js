import { Router } from 'express';
import { all, get, run } from '../db.js';
import { can, requireStaff } from '../rbac.js';
import { audit } from '../audit.js';
import { asyncH, bad, notFound, now, today } from '../util.js';
import { uploader } from './helpers.js';

/** Promotions shown to customers in their portal (staff side). The portal reads them through portalPromos(). */
const r = Router();
r.use(requireStaff);
const imgUp = uploader('media', 'image', 10);
const COLS = ['title', 'description', 'property_id', 'project_id', 'price_label', 'valid_until', 'sort_order', 'active'];

r.get('/', can('customers', 'view'), asyncH((_req, res) => {
  res.json(all(`SELECT p.*, pr.title property_title, pj.name project_name FROM portal_promos p LEFT JOIN properties pr ON pr.id=p.property_id LEFT JOIN projects pj ON pj.id=p.project_id ORDER BY p.active DESC, p.sort_order, p.id DESC`));
}));
function body(b) {
  const d = {};
  for (const k of COLS) if (b[k] !== undefined) d[k] = b[k] === '' ? null : b[k];
  if (d.title !== undefined && !String(d.title || '').trim()) throw bad('Give the promotion a title');
  if (d.active !== undefined) d.active = d.active === true || d.active === 1 || d.active === '1' || d.active === 'true' ? 1 : 0;
  if (d.sort_order !== undefined) d.sort_order = Number(d.sort_order) || 0;
  return d;
}
r.post('/', can('customers', 'create'), imgUp.single('image'), asyncH((req, res) => {
  const d = body({ active: 1, ...req.body });
  if (!d.title) throw bad('Give the promotion a title');
  const id = Number(run('INSERT INTO portal_promos(title,description,image,property_id,project_id,price_label,valid_until,sort_order,active,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)',
    d.title, d.description ?? null, req.file ? `media/${req.file.filename}` : null, d.property_id ?? null, d.project_id ?? null, d.price_label ?? null, d.valid_until ?? null, d.sort_order ?? 0, d.active ?? 1, now()).lastInsertRowid);
  audit(req, 'Promotion created', 'promo', id, d.title);
  res.status(201).json({ id });
}));
const savePromo = asyncH((req, res) => {
  const p = get('SELECT * FROM portal_promos WHERE id=?', req.params.id);
  if (!p) throw notFound();
  const d = body(req.body);
  if (req.file) d.image = `media/${req.file.filename}`;
  const keys = Object.keys(d);
  if (keys.length) run(`UPDATE portal_promos SET ${keys.map((k) => `${k}=?`).join(',')} WHERE id=?`, ...keys.map((k) => d[k]), p.id);
  res.json({ ok: true });
});
r.put('/:id(\\d+)', can('customers', 'edit'), imgUp.single('image'), savePromo);
r.post('/:id(\\d+)', can('customers', 'edit'), imgUp.single('image'), savePromo);
r.delete('/:id(\\d+)', can('customers', 'delete'), asyncH((req, res) => {
  if (!get('SELECT 1 FROM portal_promos WHERE id=?', req.params.id)) throw notFound();
  run('DELETE FROM portal_promos WHERE id=?', req.params.id);
  res.json({ ok: true });
}));

/** What a customer sees: active, unexpired promotions plus the properties currently on sale. */
export function portalPromos() {
  const promos = all(`SELECT p.id,p.title,p.description,p.image,p.price_label,p.valid_until,p.property_id,p.project_id, pj.name project_name, pr.title property_title
    FROM portal_promos p LEFT JOIN projects pj ON pj.id=p.project_id LEFT JOIN properties pr ON pr.id=p.property_id
    WHERE p.active=1 AND (p.valid_until IS NULL OR p.valid_until>=?) ORDER BY p.sort_order, p.id DESC`, today());
  const listings = all(`SELECT p.id,p.title,p.property_type,p.city,p.location,p.area_size,p.unit,p.net_price,p.installment_available,p.status='featured' featured,pj.name project_name,
      (SELECT path FROM media WHERE entity_type='property' AND entity_id=p.id AND kind IN ('cover','gallery') ORDER BY kind='cover' DESC, sort_order LIMIT 1) cover
    FROM properties p LEFT JOIN projects pj ON pj.id=p.project_id WHERE p.published=1 AND p.status IN ('available','featured') AND p.purpose='Sell'
    ORDER BY (p.status='featured') DESC, p.id DESC LIMIT 12`);
  return { promos, listings };
}
export default r;
