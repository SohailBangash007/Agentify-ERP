// Construction Management API (/api/construction). Permission module: construction. Only workspaces whose plan includes
// the Construction product reach these routes (billingGuard in services/plans.js); every query runs in the workspace's
// own database, and every id taken from a request is checked to belong to the project it is used with.
import { Router } from 'express';
import { all, get, run, tx, nextNo } from '../db.js';
import { can, requireStaff } from '../rbac.js';
import { audit } from '../audit.js';
import { sendTable } from './helpers.js';
import { asyncH, bad, notFound, now, today, int, num } from '../util.js';
import {
  mustProject, siteOf, boqOf, phaseOf, vendorOf, dateOr, str, projectFigures, costByCategory, cleanBoq, importBoq, saveEstimateLines, estimateDetail, convertEstimate,
  stockList, moveStock, poDetail, savePoLines, receivePo, billPo, subcontractDetail, createCertificate, approveCertificate, postLabour, addProgress,
} from '../services/construction.js';

const r = Router();
r.use(requireStaff);
const pid = (req) => mustProject(req.params.id).id;
const fmt = (req) => String(req.query.format || '');

// ---------------------------------------------------------------- overview and project control
r.get('/overview', can('construction', 'view'), (_req, res) => {
  const projects = all("SELECT p.id, p.code, p.name, p.location, p.kind, p.dev_status, p.start_date, p.expected_completion, u.name manager_name FROM projects p LEFT JOIN users u ON u.id=p.manager_id WHERE p.kind='construction' OR EXISTS(SELECT 1 FROM con_boq_items b WHERE b.project_id=p.id) OR EXISTS(SELECT 1 FROM con_sites s WHERE s.project_id=p.id) ORDER BY p.name")
    .map((p) => ({ ...p, ...projectFigures(p.id), sites: get('SELECT COUNT(*) n FROM con_sites WHERE project_id=?', p.id).n }));
  const pending = {
    change_orders: get("SELECT COUNT(*) n FROM con_change_orders WHERE status='submitted'").n,
    purchase_orders: get("SELECT COUNT(*) n FROM con_purchase_orders WHERE status='draft'").n,
    certificates: get("SELECT COUNT(*) n FROM con_certificates WHERE status='draft'").n,
    low_stock: stockList().filter((s) => s.low).length,
    labour_not_posted: get('SELECT COALESCE(SUM(amount),0) n FROM con_labour_logs WHERE voucher_id IS NULL').n,
  };
  res.json({ projects, pending });
});
r.get('/projects/:id/summary', can('construction', 'view'), asyncH((req, res) => {
  const p = mustProject(req.params.id);
  res.json({
    project: p, figures: projectFigures(p.id), by_category: costByCategory(p.id),
    sites: all('SELECT s.*, u.name supervisor_name FROM con_sites s LEFT JOIN users u ON u.id=s.supervisor_id WHERE s.project_id=? ORDER BY s.name', p.id),
    phases: all('SELECT * FROM con_phases WHERE project_id=? ORDER BY sort_order, id', p.id),
    milestones: all('SELECT m.*, i.amount installment_amount, i.due_date installment_due, i.status installment_status FROM con_milestones m LEFT JOIN installments i ON i.id=m.installment_id WHERE m.project_id=? ORDER BY m.due_date IS NULL, m.due_date, m.id', p.id),
    contracts: all("SELECT s.id, s.sale_no, s.title, s.net_price, s.paid_amount, c.full_name client FROM sales s JOIN contacts c ON c.id=s.contact_id WHERE s.project_id=? AND s.kind='construction' AND s.status='confirmed'", p.id),
    recent_vouchers: all('SELECT v.id, v.voucher_no, v.date, v.description, v.amount, v.status, ve.name vendor FROM expense_vouchers v LEFT JOIN vendors ve ON ve.id=v.vendor_id WHERE v.project_id=? ORDER BY v.id DESC LIMIT 15', p.id),
  });
}));
r.get('/projects/:id/cost-report', can('construction', 'export'), asyncH(async (req, res) => {
  const p = mustProject(req.params.id);
  const f = projectFigures(p.id);
  const rows = [['BOQ value', f.boq_value], ['Approved change orders', f.change_orders_approved], ['Budget', f.budget], ['Committed (POs + subcontracts)', f.committed], ['Actual cost (approved vouchers)', f.actual_cost],
    ['Cost awaiting approval', f.cost_awaiting_approval], ['Labour not yet posted', f.labour_not_posted], ['Remaining budget', f.remaining_budget], ['Earned value', f.earned_value], ['Retention held', f.retention_held],
    ['Client contract value', f.client_contract_value], ['Client billed (due to date)', f.client_billed], ['Client received', f.client_received]].map(([metric, value]) => ({ metric, value }));
  await sendTable(res, fmt(req) || 'pdf', `cost-report-${p.code}`, [{ key: 'metric', label: 'Item' }, { key: 'value', label: 'Amount' }], rows, { title: `Cost report: ${p.name}`, subtitle: `As of ${today()} · ${f.percent_complete ?? 0}% complete` });
}));

// ---------------------------------------------------------------- sites, phases, milestones
r.get('/projects/:id/sites', can('construction', 'view'), asyncH((req, res) => res.json(all('SELECT * FROM con_sites WHERE project_id=? ORDER BY name', pid(req)))));
r.post('/sites', can('construction', 'create'), asyncH((req, res) => {
  const p = mustProject(req.body.project_id);
  const name = str(req.body.name, 120);
  if (!name) throw bad('Site name is required');
  if (req.body.supervisor_id && !get('SELECT 1 FROM users WHERE id=?', int(req.body.supervisor_id))) throw bad('Supervisor not found');
  const id = Number(run('INSERT INTO con_sites(project_id,name,address,supervisor_id,start_date,notes,created_by,created_at) VALUES(?,?,?,?,?,?,?,?)', p.id, name, str(req.body.address), int(req.body.supervisor_id) || null, dateOr(req.body.start_date), str(req.body.notes), req.user.id, now()).lastInsertRowid);
  audit(req, 'Created site', 'project', p.id, name);
  res.status(201).json(get('SELECT * FROM con_sites WHERE id=?', id));
}));
r.put('/sites/:sid', can('construction', 'edit'), asyncH((req, res) => {
  const s = get('SELECT * FROM con_sites WHERE id=?', int(req.params.sid));
  if (!s) throw notFound('Site not found');
  const status = req.body.status ?? s.status;
  if (!['active', 'on_hold', 'closed'].includes(status)) throw bad('Unknown status');
  run('UPDATE con_sites SET name=?, address=?, supervisor_id=?, status=?, start_date=?, notes=? WHERE id=?', str(req.body.name, 120) || s.name, req.body.address !== undefined ? str(req.body.address) : s.address,
    req.body.supervisor_id !== undefined ? int(req.body.supervisor_id) || null : s.supervisor_id, status, req.body.start_date !== undefined ? dateOr(req.body.start_date) : s.start_date, req.body.notes !== undefined ? str(req.body.notes) : s.notes, s.id);
  res.json(get('SELECT * FROM con_sites WHERE id=?', s.id));
}));
r.post('/phases', can('construction', 'create'), asyncH((req, res) => {
  const p = mustProject(req.body.project_id);
  const name = str(req.body.name, 120);
  if (!name) throw bad('Phase name is required');
  const id = Number(run('INSERT INTO con_phases(project_id,name,planned_start,planned_end,sort_order,created_at) VALUES(?,?,?,?,?,?)', p.id, name, dateOr(req.body.planned_start), dateOr(req.body.planned_end), int(req.body.sort_order), now()).lastInsertRowid);
  res.status(201).json(get('SELECT * FROM con_phases WHERE id=?', id));
}));
r.put('/phases/:phid', can('construction', 'edit'), asyncH((req, res) => {
  const ph = get('SELECT * FROM con_phases WHERE id=?', int(req.params.phid));
  if (!ph) throw notFound('Phase not found');
  const status = req.body.status ?? ph.status;
  if (!['planned', 'in_progress', 'completed'].includes(status)) throw bad('Unknown status');
  run('UPDATE con_phases SET name=?, planned_start=?, planned_end=?, status=?, sort_order=? WHERE id=?', str(req.body.name, 120) || ph.name, req.body.planned_start !== undefined ? dateOr(req.body.planned_start) : ph.planned_start,
    req.body.planned_end !== undefined ? dateOr(req.body.planned_end) : ph.planned_end, status, req.body.sort_order !== undefined ? int(req.body.sort_order) : ph.sort_order, ph.id);
  res.json(get('SELECT * FROM con_phases WHERE id=?', ph.id));
}));
r.post('/milestones', can('construction', 'create'), asyncH((req, res) => {
  const p = mustProject(req.body.project_id);
  const name = str(req.body.name, 160);
  if (!name) throw bad('Milestone name is required');
  // a milestone can drive a client payment: link it to an installment of a construction contract on this project
  const inst = req.body.installment_id ? get("SELECT i.id FROM installments i JOIN sales s ON s.id=i.sale_id WHERE i.id=? AND s.project_id=? AND s.kind='construction'", int(req.body.installment_id), p.id) : null;
  if (req.body.installment_id && !inst) throw bad('That installment is not on a construction contract of this project');
  const id = Number(run('INSERT INTO con_milestones(project_id,phase_id,name,due_date,installment_id,client_visible,notes,created_at) VALUES(?,?,?,?,?,?,?,?)', p.id, phaseOf(req.body.phase_id, p.id), name, dateOr(req.body.due_date), inst?.id ?? null, req.body.client_visible === false ? 0 : 1, str(req.body.notes), now()).lastInsertRowid);
  res.status(201).json(get('SELECT * FROM con_milestones WHERE id=?', id));
}));
/** Mark a milestone achieved. If it is linked to a contract installment due later, that installment becomes due today. */
r.post('/milestones/:mid/achieve', can('construction', 'approve'), asyncH((req, res) => {
  const m = get('SELECT * FROM con_milestones WHERE id=?', int(req.params.mid));
  if (!m) throw notFound('Milestone not found');
  if (m.achieved_at) throw bad('Already achieved');
  tx(() => {
    run('UPDATE con_milestones SET achieved_at=? WHERE id=?', now(), m.id);
    if (m.installment_id) run("UPDATE installments SET due_date=? WHERE id=? AND due_date>? AND status<>'paid'", today(), m.installment_id, today());
  });
  audit(req, 'Milestone achieved', 'project', m.project_id, m.name);
  res.json(get('SELECT * FROM con_milestones WHERE id=?', m.id));
}));
r.delete('/milestones/:mid', can('construction', 'delete'), asyncH((req, res) => {
  const m = get('SELECT * FROM con_milestones WHERE id=?', int(req.params.mid));
  if (!m) throw notFound('Milestone not found');
  if (m.achieved_at) throw bad('An achieved milestone cannot be deleted');
  run('DELETE FROM con_milestones WHERE id=?', m.id);
  res.json({ ok: true });
}));

// ---------------------------------------------------------------- BOQ
r.get('/projects/:id/boq', can('construction', 'view'), asyncH(async (req, res) => {
  const id = pid(req);
  const rows = all('SELECT b.*, ROUND(b.qty*b.rate) amount, ROUND(MIN(b.completed_qty,b.qty)*b.rate) earned, ph.name phase FROM con_boq_items b LEFT JOIN con_phases ph ON ph.id=b.phase_id WHERE b.project_id=? ORDER BY b.sort_order, b.id', id)
    .map((b) => ({ ...b, percent: b.qty ? Math.round((Math.min(b.completed_qty, b.qty) / b.qty) * 1000) / 10 : 0 }));
  if (fmt(req)) {
    const p = mustProject(id);
    return sendTable(res, fmt(req), `boq-${p.code}`, [{ key: 'code', label: 'Code' }, { key: 'category', label: 'Category' }, { key: 'description', label: 'Description' }, { key: 'unit', label: 'Unit' },
      { key: 'qty', label: 'Qty' }, { key: 'rate', label: 'Rate' }, { key: 'amount', label: 'Amount' }, { key: 'completed_qty', label: 'Done' }, { key: 'percent', label: '% done' }], rows,
    { title: `Bill of quantities: ${p.name}`, totals: { amount: rows.reduce((s, x) => s + x.amount, 0) } });
  }
  res.json(rows);
}));
r.post('/boq', can('construction', 'create'), asyncH((req, res) => {
  const p = mustProject(req.body.project_id);
  const d = cleanBoq(req.body, p.id);
  const order = get('SELECT COALESCE(MAX(sort_order),0)+1 n FROM con_boq_items WHERE project_id=?', p.id).n;
  const id = Number(run('INSERT INTO con_boq_items(project_id,code,category,description,unit,qty,rate,phase_id,sort_order,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)', p.id, d.code ?? null, d.category, d.description, d.unit, d.qty, d.rate, d.phase_id ?? null, d.sort_order ?? order, now()).lastInsertRowid);
  audit(req, 'Added BOQ item', 'project', p.id, d.description);
  res.status(201).json(get('SELECT * FROM con_boq_items WHERE id=?', id));
}));
r.post('/projects/:id/boq/import', can('construction', 'create'), asyncH((req, res) => res.status(201).json({ imported: importBoq(pid(req), req.body?.rows, req) })));
r.put('/boq/:bid', can('construction', 'edit'), asyncH((req, res) => {
  const b = get('SELECT * FROM con_boq_items WHERE id=?', int(req.params.bid));
  if (!b) throw notFound('BOQ item not found');
  const d = cleanBoq(req.body, b.project_id, b);
  const keys = Object.keys(d);
  if (keys.length) run(`UPDATE con_boq_items SET ${keys.map((k) => `${k}=?`).join(',')}, updated_at=? WHERE id=?`, ...keys.map((k) => d[k]), now(), b.id);
  audit(req, 'Edited BOQ item', 'project', b.project_id, b.description);
  res.json(get('SELECT * FROM con_boq_items WHERE id=?', b.id));
}));
r.delete('/boq/:bid', can('construction', 'delete'), asyncH((req, res) => {
  const b = get('SELECT * FROM con_boq_items WHERE id=?', int(req.params.bid));
  if (!b) throw notFound('BOQ item not found');
  if (b.completed_qty > 0) throw bad('Progress has been recorded on this item; it cannot be deleted');
  run('DELETE FROM con_boq_items WHERE id=?', b.id);
  audit(req, 'Deleted BOQ item', 'project', b.project_id, b.description);
  res.json({ ok: true });
}));
r.post('/projects/:id/progress', can('construction', 'edit'), asyncH((req, res) => {
  const id = pid(req);
  tx(() => addProgress(id, req.body?.items, { date: dateOr(req.body?.date, today()) }, req));
  audit(req, 'Recorded progress', 'project', id, `${(req.body?.items || []).length} items`);
  res.json({ figures: projectFigures(id) });
}));

// ---------------------------------------------------------------- estimates
r.get('/estimates', can('construction', 'view'), (req, res) => res.json(all(`SELECT e.*, c.full_name client_name, p.name project_name,
  (SELECT ROUND(SUM(qty*rate)) FROM con_estimate_lines WHERE estimate_id=e.id) subtotal FROM con_estimates e LEFT JOIN contacts c ON c.id=e.contact_id LEFT JOIN projects p ON p.id=e.project_id ORDER BY e.id DESC`)
  .map((e) => ({ ...e, total: Math.round((e.subtotal || 0) * (1 + (e.markup_pct || 0) / 100)) }))));
r.get('/estimates/:eid', can('construction', 'view'), asyncH(async (req, res) => {
  const e = estimateDetail(req.params.eid);
  if (fmt(req)) {
    const rows = e.lines.map((l) => ({ ...l, amount: Math.round(l.qty * l.rate) }));
    return sendTable(res, fmt(req), e.estimate_no, [{ key: 'category', label: 'Category' }, { key: 'description', label: 'Description' }, { key: 'unit', label: 'Unit' }, { key: 'qty', label: 'Qty' }, { key: 'rate', label: 'Rate' }, { key: 'amount', label: 'Amount' }], rows,
      { title: `Estimate ${e.estimate_no}: ${e.title}`, subtitle: [e.client_name, e.valid_until && `valid until ${e.valid_until}`].filter(Boolean).join(' · '), summary: [['Subtotal', e.subtotal], ['Markup', e.markup], ['Total', e.total]] });
  }
  res.json(e);
}));
r.post('/estimates', can('construction', 'create'), asyncH((req, res) => {
  const b = req.body || {};
  const title = str(b.title, 160);
  if (!title) throw bad('Estimate title is required');
  if (b.contact_id && !get('SELECT 1 FROM contacts WHERE id=?', int(b.contact_id))) throw bad('Client not found');
  if (b.project_id) mustProject(b.project_id);
  const id = tx(() => {
    const eid = Number(run('INSERT INTO con_estimates(estimate_no,title,contact_id,project_id,valid_until,markup_pct,notes,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?)', nextNo('EST', 'EST', 4), title, int(b.contact_id) || null, int(b.project_id) || null,
      dateOr(b.valid_until), Math.min(500, Math.max(0, num(b.markup_pct))), str(b.notes, 2000), req.user.id, now()).lastInsertRowid);
    saveEstimateLines(eid, b.lines);
    return eid;
  });
  audit(req, 'Created estimate', 'estimate', id, title);
  res.status(201).json(estimateDetail(id));
}));
r.put('/estimates/:eid', can('construction', 'edit'), asyncH((req, res) => {
  const e = estimateDetail(req.params.eid);
  if (!['draft', 'sent'].includes(e.status)) throw bad(`An ${e.status} estimate cannot be edited`);
  const b = req.body || {};
  tx(() => {
    run('UPDATE con_estimates SET title=?, contact_id=?, project_id=?, valid_until=?, markup_pct=?, notes=? WHERE id=?', str(b.title, 160) || e.title, b.contact_id !== undefined ? int(b.contact_id) || null : e.contact_id,
      b.project_id !== undefined ? (b.project_id ? mustProject(b.project_id).id : null) : e.project_id, b.valid_until !== undefined ? dateOr(b.valid_until) : e.valid_until,
      b.markup_pct !== undefined ? Math.min(500, Math.max(0, num(b.markup_pct))) : e.markup_pct, b.notes !== undefined ? str(b.notes, 2000) : e.notes, e.id);
    if (b.lines) saveEstimateLines(e.id, b.lines);
  });
  res.json(estimateDetail(e.id));
}));
r.post('/estimates/:eid/status', can('construction', 'approve'), asyncH((req, res) => {
  const e = estimateDetail(req.params.eid);
  const next = req.body?.status;
  const allowed = { draft: ['sent', 'accepted', 'rejected'], sent: ['accepted', 'rejected', 'draft'], rejected: ['draft'], accepted: [] }[e.status];
  if (!allowed.includes(next)) throw bad(`A ${e.status} estimate cannot become ${next}`);
  run('UPDATE con_estimates SET status=?, decided_at=? WHERE id=?', next, ['accepted', 'rejected'].includes(next) ? now() : null, e.id);
  audit(req, `Estimate ${next}`, 'estimate', e.id, e.estimate_no);
  res.json(estimateDetail(e.id));
}));
r.post('/estimates/:eid/convert', can('construction', 'create'), asyncH((req, res) => res.json({ project_id: convertEstimate(req.params.eid, req.body?.project_id, req) })));

// ---------------------------------------------------------------- change orders
r.get('/projects/:id/change-orders', can('construction', 'view'), asyncH((req, res) => res.json(all('SELECT co.*, u.name decided_by_name FROM con_change_orders co LEFT JOIN users u ON u.id=co.decided_by WHERE co.project_id=? ORDER BY co.id DESC', pid(req)))));
r.post('/change-orders', can('construction', 'create'), asyncH((req, res) => {
  const p = mustProject(req.body.project_id);
  const title = str(req.body.title, 160);
  if (!title) throw bad('Title is required');
  const amount = int(req.body.amount, NaN);
  if (!Number.isFinite(amount)) throw bad('Amount must be a whole number (negative for a reduction)');
  const origin = req.body.origin || 'client';
  if (!['client', 'internal', 'site'].includes(origin)) throw bad('Unknown origin');
  const id = Number(run('INSERT INTO con_change_orders(co_no,project_id,title,description,amount,days_impact,origin,client_visible,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)', nextNo('CO', 'CO', 4), p.id, title, str(req.body.description, 2000), amount,
    int(req.body.days_impact), origin, req.body.client_visible === false ? 0 : 1, req.user.id, now()).lastInsertRowid);
  audit(req, 'Created change order', 'project', p.id, title);
  res.status(201).json(get('SELECT * FROM con_change_orders WHERE id=?', id));
}));
r.put('/change-orders/:cid', can('construction', 'edit'), asyncH((req, res) => {
  const co = get('SELECT * FROM con_change_orders WHERE id=?', int(req.params.cid));
  if (!co) throw notFound('Change order not found');
  if (co.status !== 'draft') throw bad('Only a draft change order can be edited');
  const amount = req.body.amount !== undefined ? int(req.body.amount, NaN) : co.amount;
  if (!Number.isFinite(amount)) throw bad('Amount must be a whole number');
  run('UPDATE con_change_orders SET title=?, description=?, amount=?, days_impact=?, client_visible=? WHERE id=?', str(req.body.title, 160) || co.title, req.body.description !== undefined ? str(req.body.description, 2000) : co.description, amount,
    req.body.days_impact !== undefined ? int(req.body.days_impact) : co.days_impact, req.body.client_visible !== undefined ? (req.body.client_visible ? 1 : 0) : co.client_visible, co.id);
  res.json(get('SELECT * FROM con_change_orders WHERE id=?', co.id));
}));
r.post('/change-orders/:cid/:action(submit|approve|reject)', asyncH((req, res, next) => can('construction', req.params.action === 'submit' ? 'edit' : 'approve')(req, res, next)), asyncH((req, res) => {
  const co = get('SELECT * FROM con_change_orders WHERE id=?', int(req.params.cid));
  if (!co) throw notFound('Change order not found');
  const a = req.params.action;
  if (a === 'submit' && co.status !== 'draft') throw bad('Only a draft can be submitted');
  if (a !== 'submit' && !['draft', 'submitted'].includes(co.status)) throw bad(`This change order is already ${co.status}`);
  if (a === 'reject' && !str(req.body?.note)) throw bad('Say why it is rejected');
  if (a === 'submit') run("UPDATE con_change_orders SET status='submitted' WHERE id=?", co.id);
  else run('UPDATE con_change_orders SET status=?, decided_by=?, decided_at=?, decision_note=? WHERE id=?', a === 'approve' ? 'approved' : 'rejected', req.user.id, now(), str(req.body?.note, 500), co.id);
  audit(req, `Change order ${a}`, 'project', co.project_id, `${co.co_no} ${co.title} ${co.amount}`);
  res.json(get('SELECT * FROM con_change_orders WHERE id=?', co.id));
}));

// ---------------------------------------------------------------- materials and stock
r.get('/materials', can('construction', 'view'), (_req, res) => res.json(all('SELECT * FROM con_materials ORDER BY active DESC, name')));
r.post('/materials', can('construction', 'create'), asyncH((req, res) => {
  const name = str(req.body.name, 120);
  if (!name) throw bad('Material name is required');
  const code = str(req.body.code, 30);
  if (code && get('SELECT 1 FROM con_materials WHERE code=?', code)) throw bad('That material code already exists');
  const id = Number(run('INSERT INTO con_materials(code,name,unit,category,reorder_level,created_at) VALUES(?,?,?,?,?,?)', code, name, str(req.body.unit, 20) || 'nos', str(req.body.category, 80), req.body.reorder_level === '' || req.body.reorder_level == null ? null : num(req.body.reorder_level), now()).lastInsertRowid);
  res.status(201).json(get('SELECT * FROM con_materials WHERE id=?', id));
}));
r.put('/materials/:mid', can('construction', 'edit'), asyncH((req, res) => {
  const m = get('SELECT * FROM con_materials WHERE id=?', int(req.params.mid));
  if (!m) throw notFound('Material not found');
  run('UPDATE con_materials SET name=?, unit=?, category=?, reorder_level=?, active=? WHERE id=?', str(req.body.name, 120) || m.name, str(req.body.unit, 20) || m.unit, req.body.category !== undefined ? str(req.body.category, 80) : m.category,
    req.body.reorder_level !== undefined ? (req.body.reorder_level === '' || req.body.reorder_level === null ? null : num(req.body.reorder_level)) : m.reorder_level, req.body.active !== undefined ? (req.body.active ? 1 : 0) : m.active, m.id);
  res.json(get('SELECT * FROM con_materials WHERE id=?', m.id));
}));
r.get('/stock', can('construction', 'view'), asyncH(async (req, res) => {
  const rows = stockList({ projectId: int(req.query.project_id) || null, siteId: int(req.query.site_id) || null });
  if (fmt(req)) return sendTable(res, fmt(req), 'site-stock', [{ key: 'site_name', label: 'Site' }, { key: 'material', label: 'Material' }, { key: 'unit', label: 'Unit' }, { key: 'balance', label: 'In stock' }, { key: 'issued_qty', label: 'Issued' }, { key: 'avg_cost', label: 'Avg cost' }], rows, { title: 'Site stock' });
  res.json(rows);
}));
r.get('/stock/moves', can('construction', 'view'), (req, res) => {
  const where = []; const args = [];
  if (req.query.site_id) { where.push('m.site_id=?'); args.push(int(req.query.site_id)); }
  if (req.query.project_id) { where.push('m.project_id=?'); args.push(int(req.query.project_id)); }
  if (req.query.material_id) { where.push('m.material_id=?'); args.push(int(req.query.material_id)); }
  res.json(all(`SELECT m.*, mt.name material, mt.unit, s.name site_name, u.name by_name FROM con_stock_moves m JOIN con_materials mt ON mt.id=m.material_id JOIN con_sites s ON s.id=m.site_id LEFT JOIN users u ON u.id=m.created_by
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY m.date DESC, m.id DESC LIMIT 500`, ...args));
});
r.post('/stock/moves', can('construction', 'edit'), asyncH((req, res) => res.status(201).json({ id: moveStock(req.body || {}, req) })));

// ---------------------------------------------------------------- purchase orders
r.get('/purchase-orders', can('construction', 'view'), (req, res) => res.json(all(`SELECT po.*, v.name vendor_name, p.name project_name, s.name site_name FROM con_purchase_orders po JOIN vendors v ON v.id=po.vendor_id JOIN projects p ON p.id=po.project_id
  LEFT JOIN con_sites s ON s.id=po.site_id ${req.query.project_id ? 'WHERE po.project_id=?' : ''} ORDER BY po.id DESC LIMIT 500`, ...(req.query.project_id ? [int(req.query.project_id)] : []))));
r.get('/purchase-orders/:poid', can('construction', 'view'), asyncH(async (req, res) => {
  const po = poDetail(req.params.poid);
  if (fmt(req)) return sendTable(res, fmt(req), po.po_no, [{ key: 'description', label: 'Item' }, { key: 'unit', label: 'Unit' }, { key: 'qty', label: 'Qty' }, { key: 'rate', label: 'Rate' }, { key: 'amount', label: 'Amount' }],
    po.lines.map((l) => ({ ...l, amount: Math.round(l.qty * l.rate) })), { title: `Purchase order ${po.po_no}`, subtitle: `${po.vendor_name} · ${po.project_name}${po.site_name ? ` · deliver to ${po.site_name}` : ''} · ${po.order_date}`, summary: [['Total', po.total]] });
  res.json(po);
}));
r.post('/purchase-orders', can('construction', 'create'), asyncH((req, res) => {
  const b = req.body || {};
  const p = mustProject(b.project_id);
  const id = tx(() => {
    const poid = Number(run('INSERT INTO con_purchase_orders(po_no,project_id,site_id,vendor_id,order_date,expected_date,notes,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?)', nextNo('PO', 'PO', 5), p.id, siteOf(b.site_id, p.id), vendorOf(b.vendor_id),
      dateOr(b.order_date, today()), dateOr(b.expected_date), str(b.notes, 1000), req.user.id, now()).lastInsertRowid);
    savePoLines(poid, p.id, b.lines);
    return poid;
  });
  audit(req, 'Created purchase order', 'purchase_order', id, p.name);
  res.status(201).json(poDetail(id));
}));
r.put('/purchase-orders/:poid', can('construction', 'edit'), asyncH((req, res) => {
  const po = poDetail(req.params.poid);
  if (po.status !== 'draft') throw bad('Only a draft purchase order can be edited');
  const b = req.body || {};
  tx(() => {
    run('UPDATE con_purchase_orders SET site_id=?, vendor_id=?, order_date=?, expected_date=?, notes=? WHERE id=?', b.site_id !== undefined ? siteOf(b.site_id, po.project_id) : po.site_id, b.vendor_id !== undefined ? vendorOf(b.vendor_id) : po.vendor_id,
      b.order_date !== undefined ? dateOr(b.order_date, today()) : po.order_date, b.expected_date !== undefined ? dateOr(b.expected_date) : po.expected_date, b.notes !== undefined ? str(b.notes, 1000) : po.notes, po.id);
    if (b.lines) savePoLines(po.id, po.project_id, b.lines);
  });
  res.json(poDetail(po.id));
}));
r.post('/purchase-orders/:poid/approve', can('construction', 'approve'), asyncH((req, res) => {
  const po = poDetail(req.params.poid);
  if (po.status !== 'draft') throw bad('Only a draft can be approved');
  run("UPDATE con_purchase_orders SET status='approved', approved_by=?, approved_at=? WHERE id=?", req.user.id, now(), po.id);
  audit(req, 'Approved purchase order', 'purchase_order', po.id, `${po.po_no} ${po.total}`);
  res.json(poDetail(po.id));
}));
r.post('/purchase-orders/:poid/receive', can('construction', 'edit'), asyncH((req, res) => res.json(receivePo(req.params.poid, req.body || {}, req))));
r.post('/purchase-orders/:poid/bill', can('construction', 'approve'), asyncH((req, res) => { const vid = billPo(req.params.poid, req.body || {}, req); res.status(201).json({ voucher_id: vid, po: poDetail(req.params.poid) }); }));
r.post('/purchase-orders/:poid/:action(cancel|close)', can('construction', 'approve'), asyncH((req, res) => {
  const po = poDetail(req.params.poid);
  if (req.params.action === 'cancel' && (po.lines.some((l) => l.received_qty > 0) || ['closed', 'cancelled'].includes(po.status))) throw bad('A purchase order with goods received cannot be cancelled; close it instead');
  if (req.params.action === 'close' && ['draft', 'cancelled', 'closed'].includes(po.status)) throw bad('Only an approved or received purchase order can be closed');
  run('UPDATE con_purchase_orders SET status=? WHERE id=?', req.params.action === 'cancel' ? 'cancelled' : 'closed', po.id);
  audit(req, `Purchase order ${req.params.action}`, 'purchase_order', po.id, po.po_no);
  res.json(poDetail(po.id));
}));

// ---------------------------------------------------------------- subcontracts and certificates
r.get('/subcontracts', can('construction', 'view'), (req, res) => res.json(all(`SELECT sc.*, v.name vendor_name, p.name project_name,
  (SELECT COALESCE(SUM(this_period),0) FROM con_certificates c WHERE c.subcontract_id=sc.id AND c.status='approved' AND c.kind='progress') certified
  FROM con_subcontracts sc JOIN vendors v ON v.id=sc.vendor_id JOIN projects p ON p.id=sc.project_id ${req.query.project_id ? 'WHERE sc.project_id=?' : ''} ORDER BY sc.id DESC`, ...(req.query.project_id ? [int(req.query.project_id)] : []))));
r.get('/subcontracts/:scid', can('construction', 'view'), asyncH((req, res) => res.json(subcontractDetail(req.params.scid))));
r.post('/subcontracts', can('construction', 'create'), asyncH((req, res) => {
  const b = req.body || {};
  const p = mustProject(b.project_id);
  const title = str(b.title, 160);
  if (!title) throw bad('Title is required');
  const value = int(b.value);
  if (!(value > 0)) throw bad('Subcontract value must be above zero');
  const ret = num(b.retention_pct, 0);
  if (!(ret >= 0 && ret <= 20)) throw bad('Retention must be between 0 and 20%');
  const id = Number(run('INSERT INTO con_subcontracts(sc_no,project_id,vendor_id,title,scope,value,retention_pct,start_date,end_date,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)', nextNo('SC', 'SC', 4), p.id, vendorOf(b.vendor_id), title, str(b.scope, 3000),
    value, ret, dateOr(b.start_date), dateOr(b.end_date), req.user.id, now()).lastInsertRowid);
  audit(req, 'Created subcontract', 'subcontract', id, title);
  res.status(201).json(subcontractDetail(id));
}));
r.post('/subcontracts/:scid/status', can('construction', 'approve'), asyncH((req, res) => {
  const sc = subcontractDetail(req.params.scid);
  const next = req.body?.status;
  const allowed = { draft: ['active', 'terminated'], active: ['completed', 'terminated'], completed: [], terminated: [] }[sc.status];
  if (!allowed.includes(next)) throw bad(`A ${sc.status} subcontract cannot become ${next}`);
  run('UPDATE con_subcontracts SET status=? WHERE id=?', next, sc.id);
  audit(req, `Subcontract ${next}`, 'subcontract', sc.id, sc.sc_no);
  res.json(subcontractDetail(sc.id));
}));
r.post('/subcontracts/:scid/certificates', can('construction', 'create'), asyncH((req, res) => { createCertificate(req.params.scid, req.body || {}, req); res.status(201).json(subcontractDetail(req.params.scid)); }));
r.post('/certificates/:cid/approve', can('construction', 'approve'), asyncH((req, res) => { const vid = approveCertificate(req.params.cid, req); res.json({ voucher_id: vid }); }));
r.post('/certificates/:cid/cancel', can('construction', 'edit'), asyncH((req, res) => {
  const c = get('SELECT * FROM con_certificates WHERE id=?', int(req.params.cid));
  if (!c) throw notFound('Certificate not found');
  if (c.status !== 'draft') throw bad('Only a draft certificate can be cancelled');
  run("UPDATE con_certificates SET status='cancelled' WHERE id=?", c.id);
  res.json({ ok: true });
}));

// ---------------------------------------------------------------- labour
r.get('/projects/:id/labour', can('construction', 'view'), asyncH(async (req, res) => {
  const id = pid(req);
  const rows = all(`SELECT l.*, s.name site_name, v.name vendor_name, ev.voucher_no FROM con_labour_logs l LEFT JOIN con_sites s ON s.id=l.site_id LEFT JOIN vendors v ON v.id=l.vendor_id LEFT JOIN expense_vouchers ev ON ev.id=l.voucher_id
    WHERE l.project_id=? AND l.date>=? AND l.date<=? ORDER BY l.date DESC, l.id DESC`, id, dateOr(req.query.from, '0000-01-01'), dateOr(req.query.to, '9999-12-31'));
  if (fmt(req)) return sendTable(res, fmt(req), 'labour', [{ key: 'date', label: 'Date' }, { key: 'site_name', label: 'Site' }, { key: 'trade', label: 'Trade' }, { key: 'workers', label: 'Workers' }, { key: 'days', label: 'Days' }, { key: 'rate', label: 'Rate' }, { key: 'amount', label: 'Amount' }, { key: 'voucher_no', label: 'Voucher' }], rows, { title: 'Labour record' });
  res.json(rows);
}));
const cleanLabour = (b, projectId) => {
  const trade = str(b.trade, 80);
  if (!trade) throw bad('Trade is required (e.g. Mason, Steel fixer, Helper)');
  const workers = int(b.workers);
  if (!(workers > 0)) throw bad('Number of workers must be above zero');
  const days = num(b.days, 1);
  if (!(days > 0 && days <= 31)) throw bad('Days must be between 0 and 31');
  const rate = int(b.rate);
  if (!(rate >= 0)) throw bad('Rate must be zero or more');
  return { site_id: siteOf(b.site_id, projectId), date: dateOr(b.date, today()), trade, vendor_id: b.vendor_id ? vendorOf(b.vendor_id) : null, workers, days, rate, amount: Math.round(workers * days * rate), boq_item_id: boqOf(b.boq_item_id, projectId), notes: str(b.notes, 500) };
};
r.post('/labour', can('construction', 'create'), asyncH((req, res) => {
  const p = mustProject(req.body.project_id);
  const d = cleanLabour(req.body, p.id);
  const id = Number(run('INSERT INTO con_labour_logs(project_id,site_id,date,trade,vendor_id,workers,days,rate,amount,boq_item_id,notes,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)', p.id, d.site_id, d.date, d.trade, d.vendor_id, d.workers, d.days, d.rate, d.amount, d.boq_item_id, d.notes, req.user.id, now()).lastInsertRowid);
  res.status(201).json(get('SELECT * FROM con_labour_logs WHERE id=?', id));
}));
r.put('/labour/:lid', can('construction', 'edit'), asyncH((req, res) => {
  const l = get('SELECT * FROM con_labour_logs WHERE id=?', int(req.params.lid));
  if (!l) throw notFound('Entry not found');
  if (l.voucher_id) throw bad('This entry is already posted to the accounts');
  const d = cleanLabour({ ...l, ...req.body }, l.project_id);
  run('UPDATE con_labour_logs SET site_id=?, date=?, trade=?, vendor_id=?, workers=?, days=?, rate=?, amount=?, boq_item_id=?, notes=? WHERE id=?', d.site_id, d.date, d.trade, d.vendor_id, d.workers, d.days, d.rate, d.amount, d.boq_item_id, d.notes, l.id);
  res.json(get('SELECT * FROM con_labour_logs WHERE id=?', l.id));
}));
r.delete('/labour/:lid', can('construction', 'delete'), asyncH((req, res) => {
  const l = get('SELECT * FROM con_labour_logs WHERE id=?', int(req.params.lid));
  if (!l) throw notFound('Entry not found');
  if (l.voucher_id) throw bad('A posted entry cannot be deleted');
  run('DELETE FROM con_labour_logs WHERE id=?', l.id);
  res.json({ ok: true });
}));
r.post('/projects/:id/labour/post', can('construction', 'approve'), asyncH((req, res) => res.status(201).json(postLabour(req.params.id, req.body || {}, req))));

// ---------------------------------------------------------------- daily site reports
r.get('/projects/:id/reports', can('construction', 'view'), asyncH((req, res) => {
  const id = pid(req);
  const reps = all('SELECT d.*, s.name site_name, u.name by_name FROM con_daily_reports d LEFT JOIN con_sites s ON s.id=d.site_id LEFT JOIN users u ON u.id=d.created_by WHERE d.project_id=? ORDER BY d.date DESC, d.id DESC LIMIT 200', id);
  const prog = all('SELECT p.report_id, p.qty, b.description, b.unit FROM con_progress p JOIN con_boq_items b ON b.id=p.boq_item_id WHERE b.project_id=? AND p.report_id IS NOT NULL', id);
  const photos = all("SELECT id, entity_id, name FROM documents WHERE entity_type='con_report' AND entity_id IN (SELECT id FROM con_daily_reports WHERE project_id=?)", id);
  res.json(reps.map((d) => ({ ...d, client_visible: !!d.client_visible, progress: prog.filter((p) => p.report_id === d.id), photos: photos.filter((p) => p.entity_id === d.id) })));
}));
r.post('/reports', can('construction', 'create'), asyncH((req, res) => {
  const b = req.body || {};
  const p = mustProject(b.project_id);
  const work = str(b.work_done, 4000);
  if (!work) throw bad('Describe the work done');
  const date = dateOr(b.date, today());
  if (date > today()) throw bad('A site report cannot be dated in the future');
  const id = tx(() => {
    const rid = Number(run('INSERT INTO con_daily_reports(project_id,site_id,date,weather,workers_on_site,work_done,issues,safety,client_visible,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)', p.id, siteOf(b.site_id, p.id), date, str(b.weather, 80),
      b.workers_on_site === '' || b.workers_on_site == null ? null : int(b.workers_on_site), work, str(b.issues, 2000), str(b.safety, 2000), b.client_visible ? 1 : 0, req.user.id, now()).lastInsertRowid);
    if (Array.isArray(b.progress) && b.progress.length) addProgress(p.id, b.progress, { reportId: rid, date }, req);
    return rid;
  });
  audit(req, 'Daily site report', 'project', p.id, date);
  res.status(201).json(get('SELECT * FROM con_daily_reports WHERE id=?', id));
}));
r.put('/reports/:rid', can('construction', 'edit'), asyncH((req, res) => {
  const d = get('SELECT * FROM con_daily_reports WHERE id=?', int(req.params.rid));
  if (!d) throw notFound('Report not found');
  const b = req.body || {};
  run('UPDATE con_daily_reports SET weather=?, workers_on_site=?, work_done=?, issues=?, safety=?, client_visible=? WHERE id=?', b.weather !== undefined ? str(b.weather, 80) : d.weather, b.workers_on_site !== undefined ? int(b.workers_on_site) : d.workers_on_site,
    str(b.work_done, 4000) || d.work_done, b.issues !== undefined ? str(b.issues, 2000) : d.issues, b.safety !== undefined ? str(b.safety, 2000) : d.safety, b.client_visible !== undefined ? (b.client_visible ? 1 : 0) : d.client_visible, d.id);
  res.json(get('SELECT * FROM con_daily_reports WHERE id=?', d.id));
}));

export default r;
