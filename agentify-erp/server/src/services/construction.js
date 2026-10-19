// Construction Management business logic (runs inside one workspace's database).
//
// Money flows reuse the shared accounting engine instead of keeping a second ledger:
//   * actual cost  = expense vouchers tagged to the project (approved / partly paid / paid). Purchase-order bills,
//                    subcontractor payment certificates and posted labour all create ordinary vouchers that go through
//                    the normal submit -> approve -> pay workflow, so nothing is booked twice.
//   * budget       = BOQ (qty x rate) + approved change orders
//   * committed    = approved purchase orders + active / completed subcontracts
//   * earned value = BOQ completed qty x rate; % complete = earned / BOQ value
// Client billing uses construction contracts (sales of kind 'construction'): their installment schedule is the payment
// schedule, receipts and statements already exist, and a milestone can be linked to an installment.
import { all, get, run, tx, nextNo, val } from '../db.js';
import { createVoucher, submitVoucher } from './expenses.js';
import { audit } from '../audit.js';
import { bad, notFound, now, today, int, num } from '../util.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const dateOr = (v, def = null) => { if (v === undefined || v === null || v === '') return def; if (!DATE_RE.test(String(v))) throw bad('Dates must be YYYY-MM-DD'); return String(v); };
export const str = (v, max = 500) => { const s = String(v ?? '').trim(); return s ? s.slice(0, max) : null; };
const pos = (v, label, { allowZero = false } = {}) => { const n = num(v, NaN); if (!Number.isFinite(n) || n < 0 || (!allowZero && n === 0)) throw bad(`${label} must be ${allowZero ? 'zero or more' : 'greater than zero'}`); return Math.round(n * 1000) / 1000; };
const money = (v, label, { allowZero = true } = {}) => { const n = int(v, NaN); if (!Number.isFinite(n) || n < 0 || (!allowZero && n === 0)) throw bad(`${label} must be a whole amount${allowZero ? '' : ' above zero'}`); return n; };

export function mustProject(id) {
  const p = get('SELECT * FROM projects WHERE id=?', int(id));
  if (!p) throw notFound('Project not found');
  return p;
}
const mustIn = (table, id, projectId, label) => {
  if (id === undefined || id === null || id === '') return null;
  const r = get(`SELECT * FROM ${table} WHERE id=?`, int(id));
  if (!r || (projectId != null && r.project_id !== projectId)) throw bad(`${label} not found in this project`);
  return r.id;
};
export const siteOf = (id, projectId) => mustIn('con_sites', id, projectId, 'Site');
export const boqOf = (id, projectId) => mustIn('con_boq_items', id, projectId, 'BOQ item');
export const phaseOf = (id, projectId) => mustIn('con_phases', id, projectId, 'Phase');
export function vendorOf(id) {
  if (!id) throw bad('Choose a supplier / contractor');
  if (!get('SELECT 1 FROM vendors WHERE id=?', int(id))) throw bad('Supplier / contractor not found');
  return int(id);
}
const accountId = (code) => {
  const id = val('SELECT id FROM accounts WHERE code=?', code) || val("SELECT id FROM accounts WHERE code='5100'") || val("SELECT id FROM accounts WHERE type='expense' ORDER BY code LIMIT 1");
  if (!id) throw bad('No expense account exists for construction costs. Add one in the chart of accounts.');
  return id;
};
/** A voucher for construction cost, submitted for the normal approval. */
function costVoucher(req, { project_id, vendor_id = null, amount, description, account = '5100', date = today() }) {
  const id = createVoucher({ project_id, vendor_id, expense_account_id: accountId(account), amount, description, date, is_credit: vendor_id ? 1 : 0 }, req);
  submitVoucher(id, req);
  return id;
}

// ---------------------------------------------------------------- figures
const SPENT = "('approved','partial','paid')";
export function projectFigures(projectId) {
  const boq = get('SELECT COALESCE(SUM(qty*rate),0) value, COALESCE(SUM(MIN(completed_qty,qty)*rate),0) earned, COUNT(*) items FROM con_boq_items WHERE project_id=?', projectId);
  const co = get("SELECT COALESCE(SUM(CASE WHEN status='approved' THEN amount END),0) approved, COALESCE(SUM(CASE WHEN status IN ('draft','submitted') THEN amount END),0) pending, COALESCE(SUM(CASE WHEN status='approved' THEN days_impact END),0) days FROM con_change_orders WHERE project_id=?", projectId);
  const po = val("SELECT COALESCE(SUM(total),0) FROM con_purchase_orders WHERE project_id=? AND status IN ('approved','partially_received','received','closed')", projectId);
  const sc = val("SELECT COALESCE(SUM(value),0) FROM con_subcontracts WHERE project_id=? AND status IN ('active','completed')", projectId);
  const actual = val(`SELECT COALESCE(SUM(amount),0) FROM expense_vouchers WHERE project_id=? AND status IN ${SPENT}`, projectId);
  const pendingCost = val("SELECT COALESCE(SUM(amount),0) FROM expense_vouchers WHERE project_id=? AND status IN ('created','submitted')", projectId);
  const paid = val(`SELECT COALESCE(SUM(paid_amount),0) FROM expense_vouchers WHERE project_id=? AND status IN ${SPENT}`, projectId);
  const labourUnposted = val('SELECT COALESCE(SUM(amount),0) FROM con_labour_logs WHERE project_id=? AND voucher_id IS NULL', projectId);
  const retention = val("SELECT COALESCE(SUM(CASE WHEN kind='progress' THEN retention_amount ELSE -net_payable END),0) FROM con_certificates WHERE project_id=? AND status='approved'", projectId);
  const contract = get("SELECT COALESCE(SUM(net_price),0) value, COUNT(*) n FROM sales WHERE project_id=? AND kind='construction' AND status='confirmed'", projectId);
  const budget = boq.value + co.approved;
  return {
    boq_value: Math.round(boq.value), boq_items: boq.items, change_orders_approved: co.approved, change_orders_pending: co.pending, schedule_days_added: co.days,
    budget: Math.round(budget), committed: po + sc, purchase_orders: po, subcontracts: sc, actual_cost: actual, cost_awaiting_approval: pendingCost, paid_out: paid,
    labour_not_posted: labourUnposted, retention_held: retention, remaining_budget: Math.round(budget - actual), cost_variance_pct: budget ? Math.round(((actual - budget) / budget) * 1000) / 10 : null,
    earned_value: Math.round(boq.earned), percent_complete: boq.value ? Math.round((boq.earned / boq.value) * 1000) / 10 : null,
    client_contract_value: contract.value, client_contracts: contract.n,
    client_billed: val("SELECT COALESCE(SUM(i.amount),0) FROM installments i JOIN sales s ON s.id=i.sale_id WHERE s.project_id=? AND s.kind='construction' AND s.status='confirmed' AND i.due_date<=?", projectId, today()),
    client_received: val("SELECT COALESCE(SUM(rs.amount),0) FROM receipt_sales rs JOIN receipts r ON r.id=rs.receipt_id JOIN sales s ON s.id=rs.sale_id WHERE s.project_id=? AND s.kind='construction' AND r.status='valid'", projectId),
  };
}

export function costByCategory(projectId) {
  const budget = all('SELECT category, SUM(qty*rate) budget, SUM(MIN(completed_qty,qty)*rate) earned FROM con_boq_items WHERE project_id=? GROUP BY category ORDER BY category', projectId);
  const actual = all(`SELECT a.name account, SUM(v.amount) actual FROM expense_vouchers v JOIN accounts a ON a.id=v.expense_account_id WHERE v.project_id=? AND v.status IN ${SPENT} GROUP BY a.id ORDER BY actual DESC`, projectId);
  return { budget: budget.map((b) => ({ ...b, budget: Math.round(b.budget), earned: Math.round(b.earned) })), actual };
}

// ---------------------------------------------------------------- BOQ
export const BOQ_COLS = ['code', 'category', 'description', 'unit', 'qty', 'rate', 'phase_id', 'sort_order'];
export function cleanBoq(b, projectId, existing = null) {
  const d = {};
  if (b.code !== undefined) d.code = str(b.code, 30);
  if (b.category !== undefined || !existing) d.category = str(b.category, 80) || 'General';
  if (b.description !== undefined || !existing) { d.description = str(b.description, 500); if (!d.description) throw bad('BOQ item description is required'); }
  if (b.unit !== undefined || !existing) d.unit = str(b.unit, 20) || 'nos';
  if (b.qty !== undefined || !existing) d.qty = pos(b.qty, 'Quantity', { allowZero: true });
  if (b.rate !== undefined || !existing) d.rate = money(b.rate, 'Rate');
  if (b.phase_id !== undefined) d.phase_id = phaseOf(b.phase_id, projectId);
  if (b.sort_order !== undefined) d.sort_order = int(b.sort_order);
  if (existing && d.qty !== undefined && d.qty < existing.completed_qty) throw bad(`Quantity cannot be below the ${existing.completed_qty} ${existing.unit} already completed`);
  return d;
}
export function importBoq(projectId, rows, req) {
  if (!Array.isArray(rows) || !rows.length) throw bad('No rows to import');
  if (rows.length > 2000) throw bad('Import at most 2000 rows at a time');
  const clean = rows.map((r, i) => { try { return cleanBoq(r, projectId); } catch (e) { throw bad(`Row ${i + 1}: ${e.message}`); } });
  tx(() => {
    let order = val('SELECT COALESCE(MAX(sort_order),0) FROM con_boq_items WHERE project_id=?', projectId);
    for (const d of clean) run('INSERT INTO con_boq_items(project_id,code,category,description,unit,qty,rate,sort_order,created_at) VALUES(?,?,?,?,?,?,?,?,?)', projectId, d.code ?? null, d.category, d.description, d.unit, d.qty, d.rate, (order += 1), now());
  });
  audit(req, 'Imported BOQ', 'project', projectId, `${clean.length} items`);
  return clean.length;
}

// ---------------------------------------------------------------- estimates
export function saveEstimateLines(estimateId, lines) {
  if (!Array.isArray(lines) || !lines.length) throw bad('An estimate needs at least one line');
  if (lines.length > 1000) throw bad('Too many lines');
  run('DELETE FROM con_estimate_lines WHERE estimate_id=?', estimateId);
  lines.forEach((l, i) => {
    const description = str(l.description, 500);
    if (!description) throw bad(`Line ${i + 1}: description is required`);
    run('INSERT INTO con_estimate_lines(estimate_id,category,description,unit,qty,rate,sort_order) VALUES(?,?,?,?,?,?,?)', estimateId, str(l.category, 80) || 'General', description, str(l.unit, 20) || 'nos',
      pos(l.qty, `Line ${i + 1} quantity`, { allowZero: true }), money(l.rate, `Line ${i + 1} rate`), i);
  });
}
export function estimateDetail(id) {
  const e = get('SELECT e.*, c.full_name client_name, p.name project_name FROM con_estimates e LEFT JOIN contacts c ON c.id=e.contact_id LEFT JOIN projects p ON p.id=e.project_id WHERE e.id=?', int(id));
  if (!e) throw notFound('Estimate not found');
  const lines = all('SELECT * FROM con_estimate_lines WHERE estimate_id=? ORDER BY sort_order, id', e.id);
  const subtotal = Math.round(lines.reduce((s, l) => s + l.qty * l.rate, 0));
  const markup = Math.round((subtotal * (e.markup_pct || 0)) / 100);
  return { ...e, lines, subtotal, markup, total: subtotal + markup };
}
/** An accepted estimate becomes the project's BOQ (markup spread into the rates so the BOQ total equals the estimate). */
export function convertEstimate(id, projectId, req) {
  const e = estimateDetail(id);
  if (e.status !== 'accepted') throw bad('Only an accepted estimate can be turned into a BOQ');
  if (e.converted_at) throw bad('This estimate was already turned into a BOQ');
  const p = mustProject(projectId || e.project_id);
  const factor = 1 + (e.markup_pct || 0) / 100;
  tx(() => {
    let order = val('SELECT COALESCE(MAX(sort_order),0) FROM con_boq_items WHERE project_id=?', p.id);
    for (const l of e.lines) run('INSERT INTO con_boq_items(project_id,category,description,unit,qty,rate,source_estimate_id,sort_order,created_at) VALUES(?,?,?,?,?,?,?,?,?)', p.id, l.category, l.description, l.unit, l.qty, Math.round(l.rate * factor), e.id, (order += 1), now());
    run('UPDATE con_estimates SET project_id=?, converted_at=? WHERE id=?', p.id, now(), e.id);
  });
  audit(req, 'Estimate converted to BOQ', 'project', p.id, `${e.estimate_no}: ${e.lines.length} items`);
  return p.id;
}

// ---------------------------------------------------------------- stock
export function stockBalance(siteId, materialId) {
  return val(`SELECT COALESCE(SUM(CASE WHEN kind IN ('receive','transfer_in','adjust_in','return') THEN qty ELSE -qty END),0) FROM con_stock_moves WHERE site_id=? AND material_id=?`, siteId, materialId);
}
export function stockList({ projectId, siteId } = {}) {
  const where = []; const args = [];
  if (projectId) { where.push('s.project_id=?'); args.push(projectId); }
  if (siteId) { where.push('m.site_id=?'); args.push(siteId); }
  return all(`SELECT m.site_id, s.name site_name, s.project_id, mt.id material_id, mt.name material, mt.unit, mt.reorder_level,
    SUM(CASE WHEN m.kind IN ('receive','transfer_in','adjust_in','return') THEN m.qty ELSE -m.qty END) balance,
    SUM(CASE WHEN m.kind='receive' THEN m.qty*m.unit_cost ELSE 0 END) received_value, SUM(CASE WHEN m.kind='receive' THEN m.qty ELSE 0 END) received_qty,
    SUM(CASE WHEN m.kind='issue' THEN m.qty ELSE 0 END) issued_qty
    FROM con_stock_moves m JOIN con_sites s ON s.id=m.site_id JOIN con_materials mt ON mt.id=m.material_id ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    GROUP BY m.site_id, mt.id ORDER BY s.name, mt.name`, ...args).map((r) => ({ ...r, balance: Math.round(r.balance * 1000) / 1000, avg_cost: r.received_qty ? Math.round(r.received_value / r.received_qty) : null, low: r.reorder_level != null && r.balance <= r.reorder_level }));
}
/** Issue to work, return, adjust or transfer stock. Outflows can never take a site below zero. */
export function moveStock(b, req) {
  const material = get('SELECT * FROM con_materials WHERE id=?', int(b.material_id));
  if (!material) throw bad('Material not found');
  const site = get('SELECT * FROM con_sites WHERE id=?', int(b.site_id));
  if (!site) throw bad('Site not found');
  const qty = pos(b.qty, 'Quantity');
  const date = dateOr(b.date, today());
  const kinds = { issue: 'out', return: 'in', adjust_in: 'in', adjust_out: 'out', transfer: 'out' };
  if (!kinds[b.kind]) throw bad('Kind must be issue, return, adjust_in, adjust_out or transfer');
  if (b.kind.startsWith('adjust') && !str(b.note)) throw bad('Say why the stock is being adjusted');
  const boq = b.boq_item_id ? boqOf(b.boq_item_id, site.project_id) : null;
  return tx(() => {
    if (kinds[b.kind] === 'out' && stockBalance(site.id, material.id) < qty) throw bad(`Only ${stockBalance(site.id, material.id)} ${material.unit} of ${material.name} at ${site.name}`);
    const ins = (kind, s, ref) => Number(run('INSERT INTO con_stock_moves(material_id,site_id,project_id,kind,qty,unit_cost,ref_type,ref_id,boq_item_id,note,date,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',
      material.id, s.id, s.project_id, kind, qty, int(b.unit_cost), ref?.type ?? null, ref?.id ?? null, boq, str(b.note), date, req.user.id, now()).lastInsertRowid);
    if (b.kind === 'transfer') {
      const to = get('SELECT * FROM con_sites WHERE id=?', int(b.to_site_id));
      if (!to || to.id === site.id) throw bad('Choose a different destination site');
      const outId = ins('transfer_out', site);
      ins('transfer_in', to, { type: 'transfer', id: outId });
      audit(req, 'Transferred material', 'material', material.id, `${qty} ${material.unit} ${site.name} -> ${to.name}`);
      return outId;
    }
    const id = ins(b.kind, site);
    audit(req, `Stock ${b.kind.replace('_', ' ')}`, 'material', material.id, `${qty} ${material.unit} at ${site.name}`);
    return id;
  });
}

// ---------------------------------------------------------------- purchase orders
export function poDetail(id) {
  const po = get(`SELECT po.*, v.name vendor_name, p.name project_name, s.name site_name FROM con_purchase_orders po JOIN vendors v ON v.id=po.vendor_id JOIN projects p ON p.id=po.project_id
    LEFT JOIN con_sites s ON s.id=po.site_id WHERE po.id=?`, int(id));
  if (!po) throw notFound('Purchase order not found');
  const lines = all('SELECT l.*, m.name material_name FROM con_po_lines l LEFT JOIN con_materials m ON m.id=l.material_id WHERE l.po_id=? ORDER BY l.id', po.id);
  const received_value = Math.round(lines.reduce((s, l) => s + l.received_qty * l.rate, 0));
  return { ...po, lines, received_value, unbilled: received_value - po.billed, bills: all('SELECT b.*, v.voucher_no, v.status voucher_status FROM con_po_bills b JOIN expense_vouchers v ON v.id=b.voucher_id WHERE b.po_id=?', po.id) };
}
export function savePoLines(poId, projectId, lines) {
  if (!Array.isArray(lines) || !lines.length) throw bad('A purchase order needs at least one line');
  run('DELETE FROM con_po_lines WHERE po_id=?', poId);
  let total = 0;
  lines.forEach((l, i) => {
    const material = l.material_id ? get('SELECT * FROM con_materials WHERE id=?', int(l.material_id)) : null;
    if (l.material_id && !material) throw bad(`Line ${i + 1}: material not found`);
    const description = str(l.description, 300) || material?.name;
    if (!description) throw bad(`Line ${i + 1}: describe the item or pick a material`);
    const qty = pos(l.qty, `Line ${i + 1} quantity`), rate = money(l.rate, `Line ${i + 1} rate`);
    total += qty * rate;
    run('INSERT INTO con_po_lines(po_id,material_id,description,unit,qty,rate,boq_item_id) VALUES(?,?,?,?,?,?,?)', poId, material?.id ?? null, description, str(l.unit, 20) || material?.unit || 'nos', qty, rate, l.boq_item_id ? boqOf(l.boq_item_id, projectId) : null);
  });
  run('UPDATE con_purchase_orders SET total=? WHERE id=?', Math.round(total), poId);
}
/** Goods received at site: received quantities go up and the material enters the site's stock. */
export function receivePo(id, b, req) {
  const po = poDetail(id);
  if (!['approved', 'partially_received'].includes(po.status)) throw bad('Only an approved purchase order can be received');
  if (!po.site_id) throw bad('Set the delivery site on the purchase order first');
  const lines = Array.isArray(b.lines) ? b.lines : [];
  if (!lines.length) throw bad('Enter the quantities received');
  const date = dateOr(b.date, today());
  tx(() => {
    for (const r of lines) {
      const l = po.lines.find((x) => x.id === int(r.line_id));
      if (!l) throw bad('Line not found on this purchase order');
      const q = pos(r.qty, 'Received quantity', { allowZero: true });
      if (!q) continue;
      if (l.received_qty + q > l.qty * 1.1 + 1e-9) throw bad(`${l.description}: receiving ${q} would exceed the ordered ${l.qty} by more than 10%`);
      run('UPDATE con_po_lines SET received_qty=received_qty+? WHERE id=?', q, l.id);
      if (l.material_id) run('INSERT INTO con_stock_moves(material_id,site_id,project_id,kind,qty,unit_cost,ref_type,ref_id,boq_item_id,note,date,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',
        l.material_id, po.site_id, po.project_id, 'receive', q, l.rate, 'po', po.id, l.boq_item_id, `${po.po_no}${b.note ? ` · ${str(b.note, 200)}` : ''}`, date, req.user.id, now());
    }
    const all2 = all('SELECT qty, received_qty FROM con_po_lines WHERE po_id=?', po.id);
    const full = all2.every((l) => l.received_qty >= l.qty - 1e-9);
    run('UPDATE con_purchase_orders SET status=? WHERE id=?', full ? 'received' : 'partially_received', po.id);
  });
  audit(req, 'Goods received', 'purchase_order', po.id, po.po_no);
  return poDetail(po.id);
}
/** Supplier's bill for what has been received: an expense voucher for the unbilled value, sent for approval. */
export function billPo(id, b, req) {
  const po = poDetail(id);
  if (['draft', 'cancelled'].includes(po.status)) throw bad('Only an approved purchase order can be billed');
  const amount = b.amount === undefined || b.amount === '' ? po.unbilled : money(b.amount, 'Bill amount', { allowZero: false });
  if (amount <= 0) throw bad('Nothing received is waiting to be billed');
  if (amount > po.unbilled) throw bad(`Only ${po.unbilled} of received goods is not billed yet`);
  return tx(() => {
    const vid = costVoucher(req, { project_id: po.project_id, vendor_id: po.vendor_id, amount, description: `${po.po_no} supplier bill${b.reference ? ` ${str(b.reference, 60)}` : ''}`, account: b.account || '5100', date: dateOr(b.date, today()) });
    run('INSERT INTO con_po_bills(po_id,voucher_id,amount,created_at) VALUES(?,?,?,?)', po.id, vid, amount, now());
    run('UPDATE con_purchase_orders SET billed=billed+? WHERE id=?', amount, po.id);
    audit(req, 'Purchase order billed', 'purchase_order', po.id, `${po.po_no} -> voucher ${vid}`);
    return vid;
  });
}

// ---------------------------------------------------------------- subcontracts and payment certificates
export function subcontractDetail(id) {
  const sc = get('SELECT sc.*, v.name vendor_name, p.name project_name FROM con_subcontracts sc JOIN vendors v ON v.id=sc.vendor_id JOIN projects p ON p.id=sc.project_id WHERE sc.id=?', int(id));
  if (!sc) throw notFound('Subcontract not found');
  const certs = all('SELECT c.*, v.voucher_no, v.status voucher_status FROM con_certificates c LEFT JOIN expense_vouchers v ON v.id=c.voucher_id WHERE c.subcontract_id=? ORDER BY c.id', sc.id);
  const approved = certs.filter((c) => c.status === 'approved');
  const certified = approved.filter((c) => c.kind === 'progress').reduce((s, c) => s + c.this_period, 0);
  const retained = approved.filter((c) => c.kind === 'progress').reduce((s, c) => s + c.retention_amount, 0) - approved.filter((c) => c.kind === 'retention_release').reduce((s, c) => s + c.net_payable, 0);
  return { ...sc, certificates: certs, certified_to_date: certified, retention_held: retained, paid_to_date: approved.reduce((s, c) => s + c.net_payable, 0), remaining: sc.value - certified };
}
/**
 * Interim payment certificate: work done to date (cumulative value, or % of the subcontract), minus what was already
 * certified, minus retention on this period, minus other deductions = net payable. A retention release pays out held
 * retention. Approving creates the expense voucher for the net amount (vendor payable).
 */
export function createCertificate(scId, b, req) {
  const sc = subcontractDetail(scId);
  if (sc.status !== 'active' && !(sc.status === 'completed' && b.kind === 'retention_release')) throw bad('Certificates can be raised only on an active subcontract');
  if (sc.certificates.some((c) => c.status === 'draft')) throw bad('Approve or cancel the draft certificate first');
  const kind = b.kind === 'retention_release' ? 'retention_release' : 'progress';
  const periodTo = dateOr(b.period_to, today());
  let workToDate, thisPeriod, retention, net;
  const deductions = money(b.deductions ?? 0, 'Deductions');
  if (kind === 'retention_release') {
    const amount = b.amount === undefined || b.amount === '' ? sc.retention_held : money(b.amount, 'Release amount', { allowZero: false });
    if (amount <= 0 || amount > sc.retention_held) throw bad(`Retention held is ${sc.retention_held}`);
    workToDate = sc.certified_to_date; thisPeriod = 0; retention = 0; net = amount - deductions;
  } else {
    workToDate = b.percent !== undefined && b.percent !== '' ? Math.round((sc.value * Math.min(100, pos(b.percent, 'Percent', { allowZero: true }))) / 100) : money(b.work_done_to_date, 'Work done to date');
    if (workToDate > sc.value) throw bad(`Work done cannot exceed the subcontract value of ${sc.value}`);
    thisPeriod = workToDate - sc.certified_to_date;
    if (thisPeriod <= 0) throw bad(`Already certified ${sc.certified_to_date}; work done to date must be higher`);
    retention = Math.round((thisPeriod * sc.retention_pct) / 100);
    net = thisPeriod - retention - deductions;
  }
  if (net <= 0) throw bad('Net payable must be above zero');
  const id = Number(run(`INSERT INTO con_certificates(ipc_no,subcontract_id,project_id,period_to,work_done_to_date,previous_certified,this_period,retention_amount,deductions,net_payable,kind,notes,created_by,created_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, nextNo('IPC', 'IPC', 4), sc.id, sc.project_id, periodTo, workToDate, sc.certified_to_date, thisPeriod, retention, deductions, net, kind, str(b.notes, 500), req.user.id, now()).lastInsertRowid);
  audit(req, 'Payment certificate drafted', 'subcontract', sc.id, `${kind} net ${net}`);
  return id;
}
export function approveCertificate(id, req) {
  const c = get('SELECT * FROM con_certificates WHERE id=?', int(id));
  if (!c) throw notFound('Certificate not found');
  if (c.status !== 'draft') throw bad(`This certificate is already ${c.status}`);
  const sc = get('SELECT * FROM con_subcontracts WHERE id=?', c.subcontract_id);
  return tx(() => {
    const vid = costVoucher(req, { project_id: c.project_id, vendor_id: sc.vendor_id, amount: c.net_payable, description: `${c.ipc_no} ${c.kind === 'retention_release' ? 'retention release' : 'payment certificate'} · ${sc.sc_no} ${sc.title}`, account: '5100', date: c.period_to });
    run("UPDATE con_certificates SET status='approved', voucher_id=?, approved_by=?, approved_at=? WHERE id=?", vid, req.user.id, now(), c.id);
    audit(req, 'Payment certificate approved', 'subcontract', sc.id, `${c.ipc_no} -> voucher ${vid}`);
    return vid;
  });
}

// ---------------------------------------------------------------- labour
/** All unposted labour of a project (optionally a date range) becomes one labour cost voucher. */
export function postLabour(projectId, b, req) {
  const p = mustProject(projectId);
  const from = dateOr(b.from, '0000-01-01'), to = dateOr(b.to, today());
  const rows = all('SELECT * FROM con_labour_logs WHERE project_id=? AND voucher_id IS NULL AND date>=? AND date<=?', p.id, from, to);
  if (!rows.length) throw bad('No unposted labour in that period');
  const amount = rows.reduce((s, r) => s + r.amount, 0);
  if (amount <= 0) throw bad('The labour in that period has no cost');
  return tx(() => {
    const vid = costVoucher(req, { project_id: p.id, amount, description: `Labour ${rows[0].date === rows.at(-1).date ? rows[0].date : `${from === '0000-01-01' ? rows.map((r) => r.date).sort()[0] : from} to ${to}`} (${rows.length} entries)`, account: '5160', date: to });
    run(`UPDATE con_labour_logs SET voucher_id=? WHERE id IN (${rows.map(() => '?').join(',')})`, vid, ...rows.map((r) => r.id));
    audit(req, 'Labour posted to accounts', 'project', p.id, `${rows.length} entries, ${amount}`);
    return { voucher_id: vid, entries: rows.length, amount };
  });
}

// ---------------------------------------------------------------- progress
/** Measured progress on BOQ items (from a site report or directly). Never beyond the BOQ quantity. */
export function addProgress(projectId, items, { reportId = null, date = today() } = {}, req) {
  for (const it of items || []) {
    const boq = get('SELECT * FROM con_boq_items WHERE id=? AND project_id=?', int(it.boq_item_id), projectId);
    if (!boq) throw bad('BOQ item not found in this project');
    const q = num(it.qty, NaN);
    if (!Number.isFinite(q) || q === 0) throw bad('Progress quantity must be a number other than zero');
    const next = Math.round((boq.completed_qty + q) * 1000) / 1000;
    if (next < 0) throw bad(`${boq.description}: progress cannot go below zero`);
    if (next > boq.qty + 1e-9) throw bad(`${boq.description}: ${next} ${boq.unit} would exceed the BOQ quantity of ${boq.qty}. Raise a change order first.`);
    run('UPDATE con_boq_items SET completed_qty=?, updated_at=? WHERE id=?', next, now(), boq.id);
    run('INSERT INTO con_progress(report_id,boq_item_id,qty,note,date,created_by,created_at) VALUES(?,?,?,?,?,?,?)', reportId, boq.id, q, str(it.note, 200), date, req.user.id, now());
  }
}
