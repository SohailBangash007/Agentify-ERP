// Mortgage / financing module (switched on per region or workspace with the "mortgage" flag). Lenders, buyer finance
// profiles and applications with a simple pipeline and optional referral fee tracking. Amounts are minor units.
import { Router } from 'express';
import { all, get, run } from '../db.js';
import { audit, activity } from '../audit.js';
import { asyncH, bad, notFound, forbidden, now } from '../util.js';
import { can } from '../rbac.js';
import { currentTenant } from '../context.js';
import { flagOn, currentRegion } from './runtime.js';
import { payment, schedule, totals, loanToValue, affordability, MORTGAGE_STAGES, canMove } from '../../../shared/region/mortgage.js';


const r = Router();
r.use((req, _res, next) => (flagOn(currentTenant(), 'mortgage') ? next() : next(notFound('Mortgage tools are not switched on for this workspace'))));

const compounding = () => currentRegion().config.mortgage_compounding || 'monthly';
const int = (v, name, { min = 0 } = {}) => { const n = Number(v); if (!Number.isInteger(n) || n < min) throw bad(`${name} must be a whole number`); return n; };
const ownsContact = (req, contactId) => {
  if (!req.user.own_scope) return;
  if (get('SELECT agent_id FROM contacts WHERE id=?', contactId)?.agent_id !== req.user.id) throw forbidden('This contact is not assigned to you');
};

// Calculators (no data saved)
r.post('/calc', can('crm', 'view'), asyncH((req, res) => {
  const b = req.body || {};
  const principal = int(b.principal, 'Loan amount', { min: 1 });
  const term_months = int(b.term_months, 'Term (months)', { min: 1 });
  const annual_bp = int(b.rate_bp, 'Rate', { min: 0 });
  const rows = schedule({ principal, annual_bp, term_months, compounding: compounding(), extra_monthly: b.extra_monthly ? int(b.extra_monthly, 'Extra payment') : 0 });
  res.json({ payment: payment({ principal, annual_bp, term_months, compounding: compounding() }), totals: totals(rows), schedule: rows });
}));
r.post('/affordability', can('crm', 'view'), asyncH((req, res) => {
  const b = req.body || {};
  res.json(affordability({ gross_monthly_income: int(b.gross_monthly_income, 'Income', { min: 1 }), monthly_debts: int(b.monthly_debts ?? 0, 'Debts'), down: int(b.down ?? 0, 'Down payment'),
    max_dti_bp: b.max_dti_bp ? int(b.max_dti_bp, 'Limit', { min: 1 }) : 4300, annual_bp: int(b.rate_bp, 'Rate'), term_months: int(b.term_months, 'Term (months)', { min: 1 }), compounding: compounding() }));
}));

// Lenders and brokers
r.get('/lenders', can('crm', 'view'), (_req, res) => res.json(all('SELECT * FROM lenders WHERE active=1 ORDER BY name')));
r.post('/lenders', can('settings', 'edit'), asyncH((req, res) => {
  const b = req.body || {};
  if (!String(b.name || '').trim()) throw bad('Lender name is required');
  const id = Number(run('INSERT INTO lenders(name, kind, contact_name, phone, email, notes) VALUES(?,?,?,?,?,?)', String(b.name).trim(), ['bank', 'broker', 'credit_union', 'other'].includes(b.kind) ? b.kind : 'bank', b.contact_name || null, b.phone || null, b.email || null, b.notes || null).lastInsertRowid);
  audit(req, 'Added lender', 'lender', id, b.name);
  res.status(201).json(get('SELECT * FROM lenders WHERE id=?', id));
}));

// Buyer finance profile
r.get('/profile/:contactId', can('crm', 'view'), asyncH((req, res) => { ownsContact(req, Number(req.params.contactId)); res.json(get('SELECT * FROM mortgage_profiles WHERE contact_id=?', Number(req.params.contactId)) || null); }));
r.put('/profile/:contactId', can('crm', 'edit'), asyncH((req, res) => {
  const id = Number(req.params.contactId);
  if (!get('SELECT 1 FROM contacts WHERE id=?', id)) throw notFound('Contact not found');
  ownsContact(req, id);
  const b = req.body || {};
  const v = (k, n) => (b[k] === undefined || b[k] === null || b[k] === '' ? null : int(b[k], n));
  run(`INSERT INTO mortgage_profiles(contact_id, gross_monthly_income, monthly_debts, down_payment, employment, credit_band, first_time_buyer, notes, updated_by, updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(contact_id) DO UPDATE SET gross_monthly_income=excluded.gross_monthly_income, monthly_debts=excluded.monthly_debts, down_payment=excluded.down_payment, employment=excluded.employment,
       credit_band=excluded.credit_band, first_time_buyer=excluded.first_time_buyer, notes=excluded.notes, updated_by=excluded.updated_by, updated_at=excluded.updated_at`,
  id, v('gross_monthly_income', 'Income'), v('monthly_debts', 'Debts'), v('down_payment', 'Down payment'), b.employment || null, b.credit_band || null, b.first_time_buyer ? 1 : 0, b.notes || null, req.user.id, now());
  audit(req, 'Updated finance profile', 'contact', id);
  res.json(get('SELECT * FROM mortgage_profiles WHERE contact_id=?', id));
}));

// Applications
r.get('/applications', can('crm', 'view'), (req, res) => {
  const own = req.user.own_scope ? ' AND c.agent_id=?' : '';
  res.json(all(`SELECT a.*, c.full_name, l.name AS lender_name FROM mortgage_applications a JOIN contacts c ON c.id=a.contact_id LEFT JOIN lenders l ON l.id=a.lender_id WHERE 1=1${own} ORDER BY a.id DESC LIMIT 500`, ...(req.user.own_scope ? [req.user.id] : []))
    .map((a) => ({ ...a, ltv_bp: loanToValue({ price: a.price, down: a.down_payment }), payment: payment({ principal: a.amount, annual_bp: a.rate_bp, term_months: a.term_months, compounding: compounding() }) })));
});
r.post('/applications', can('crm', 'create'), asyncH((req, res) => {
  const b = req.body || {};
  const contactId = int(b.contact_id, 'Contact', { min: 1 });
  if (!get('SELECT 1 FROM contacts WHERE id=?', contactId)) throw notFound('Contact not found');
  ownsContact(req, contactId);
  const price = int(b.price, 'Price', { min: 1 }), down = int(b.down_payment ?? 0, 'Down payment');
  if (down >= price) throw bad('Down payment must be less than the price');
  const amount = b.amount ? int(b.amount, 'Loan amount', { min: 1 }) : price - down;
  const feeType = b.referral_fee_type || null;
  if (feeType && !['flat', 'percent_bp'].includes(feeType)) throw bad('Referral fee type must be flat or percent_bp');
  if (feeType && !b.referral_fee_disclosed) throw bad('A referral fee must be marked as disclosed to the customer before it is recorded');
  const id = Number(run(`INSERT INTO mortgage_applications(contact_id, property_id, sale_id, lender_id, loan_type, price, down_payment, amount, term_months, rate_bp, referral_fee_type, referral_fee_value, referral_fee_status, referral_fee_disclosed, notes, created_by, updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, contactId, b.property_id || null, b.sale_id || null, b.lender_id || null, b.loan_type || null, price, down, amount, int(b.term_months, 'Term (months)', { min: 1 }), int(b.rate_bp, 'Rate'),
  feeType, feeType ? int(b.referral_fee_value, 'Referral fee') : null, feeType ? 'pending' : 'none', feeType ? 1 : 0, b.notes || null, req.user.id, now()).lastInsertRowid);
  audit(req, 'Created mortgage application', 'mortgage', id);
  activity(contactId, req.user, 'Mortgage application started', { detail: `Application #${id}`, entityType: 'mortgage', entityId: id });
  res.status(201).json(get('SELECT * FROM mortgage_applications WHERE id=?', id));
}));
r.post('/applications/:id/stage', can('crm', 'edit'), asyncH((req, res) => {
  const a = get('SELECT * FROM mortgage_applications WHERE id=?', Number(req.params.id));
  if (!a) throw notFound('Application not found');
  ownsContact(req, a.contact_id);
  const to = req.body?.stage;
  if (!MORTGAGE_STAGES.includes(to)) throw bad('Unknown stage');
  if (!canMove(a.stage, to)) throw bad(`An application cannot move from ${a.stage} to ${to}`);
  run('UPDATE mortgage_applications SET stage=?, updated_at=? WHERE id=?', to, now(), a.id);
  audit(req, 'Mortgage stage changed', 'mortgage', a.id, `${a.stage} → ${to}`);
  activity(a.contact_id, req.user, 'Mortgage stage changed', { field: 'stage', prev: a.stage, next: to, entityType: 'mortgage', entityId: a.id });
  res.json(get('SELECT * FROM mortgage_applications WHERE id=?', a.id));
}));
r.post('/applications/:id/referral-received', can('accounting', 'approve'), asyncH((req, res) => {
  const a = get('SELECT * FROM mortgage_applications WHERE id=?', Number(req.params.id));
  if (!a || a.referral_fee_status !== 'pending') throw bad('No pending referral fee on this application');
  if (a.stage !== 'funded') throw bad('A referral fee can be marked received only once the loan is funded');
  run("UPDATE mortgage_applications SET referral_fee_status='received', updated_at=? WHERE id=?", now(), a.id);
  audit(req, 'Referral fee received', 'mortgage', a.id);
  res.json(get('SELECT * FROM mortgage_applications WHERE id=?', a.id));
}));
r.get('/applications/:id/schedule', can('crm', 'view'), asyncH((req, res) => {
  const a = get('SELECT * FROM mortgage_applications WHERE id=?', Number(req.params.id));
  if (!a) throw notFound('Application not found');
  ownsContact(req, a.contact_id);
  const rows = schedule({ principal: a.amount, annual_bp: a.rate_bp, term_months: a.term_months, compounding: compounding() });
  res.json({ application: a, totals: totals(rows), schedule: rows });
}));

export default r;
