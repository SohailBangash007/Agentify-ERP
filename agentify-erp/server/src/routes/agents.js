import { Router } from 'express';
import { all, get, getSetting } from '../db.js';
import { can, ownerId, requireStaff } from '../rbac.js';
import { asyncH, forbidden, notFound, jparse, today, dateRange } from '../util.js';

const r = Router();
r.use(requireStaff);

const DEFAULT_TARGETS = { Bronze: 1, Silver: 3, Gold: 6, Platinum: 10, Champion: 15 };

export function tierFor(sales) {
  const targets = jparse(getSetting('agent_targets'), DEFAULT_TARGETS) || DEFAULT_TARGETS;
  const levels = Object.entries(targets).sort((a, b) => a[1] - b[1]);
  let current = null, next = null;
  for (const [name, min] of levels) { if (sales >= min) current = { name, min }; else if (!next) next = { name, min }; }
  return { tier: current?.name ?? 'Starter', next: next ? { ...next, remaining: next.min - sales } : null, levels: levels.map(([name, min]) => ({ name, min })) };
}

/** Agent KPIs. `from`/`to` limit sales/commission to a period; leads are lifetime. */
export function agentStats(agentId, from = '1900-01-01', to = '2999-12-31') {
  const lost = "(SELECT id FROM lookups WHERE type='lead_stage' AND meta LIKE '%\"kind\":\"lost\"%')";
  const leads = get(`SELECT COUNT(*) total, SUM(is_customer=0 AND stage_id NOT IN ${lost}) active, SUM(is_customer=1) converted, SUM(is_customer=0 AND stage_id IN ${lost}) lost,
    SUM(followup_date IS NOT NULL AND followup_date<=? AND is_customer=0) followups FROM contacts WHERE agent_id=?`, today(), agentId);
  const sales = get(`SELECT COUNT(*) n, COALESCE(SUM(net_price),0) value FROM sales WHERE agent_id=? AND status='confirmed' AND sale_date BETWEEN ? AND ?`, agentId, from, to);
  const lifetime = get("SELECT COUNT(*) n FROM sales WHERE agent_id=? AND status='confirmed'", agentId).n;
  const comm = get(`SELECT COALESCE(SUM(amount),0) earned, COALESCE(SUM(paid_amount),0) paid FROM commissions WHERE agent_id=? AND status<>'cancelled'`, agentId);
  const total = leads.total || 0;
  return {
    agent_id: agentId, total_leads: total, active_leads: leads.active || 0, converted_leads: leads.converted || 0, lost_leads: leads.lost || 0, followups: leads.followups || 0,
    sales_count: sales.n, sales_value: sales.value, lifetime_sales: lifetime,
    commission_earned: comm.earned, commission_paid: comm.paid, commission_pending: comm.earned - comm.paid,
    conversion_rate: total ? Math.round(((leads.converted || 0) / total) * 1000) / 10 : 0, ...tierFor(lifetime),
  };
}

r.get('/', can('crm', 'view'), asyncH((req, res) => {
  const o = ownerId(req);
  const { from, to } = dateRange(req.query.range, req.query.from, req.query.to);
  const agents = all(`SELECT u.id,u.name,u.email,u.phone,u.active,e.emp_code,e.designation,e.hire_date FROM users u JOIN roles r ON r.id=u.role_id LEFT JOIN employees e ON e.user_id=u.id
    WHERE r.name='Sales Agent' ${o ? 'AND u.id=' + o : ''} ORDER BY u.name`);
  const rows = agents.map((a) => ({ ...a, ...agentStats(a.id, from, to) })).sort((x, y) => y.sales_value - x.sales_value || y.converted_leads - x.converted_leads);
  rows.forEach((x, i) => { x.rank = i + 1; });
  res.json({ rows, targets: tierFor(0).levels });
}));

r.get('/:id(\\d+)', can('crm', 'view'), asyncH((req, res) => {
  const id = Number(req.params.id);
  if (ownerId(req) && ownerId(req) !== id) throw forbidden();
  const a = get(`SELECT u.id,u.name,u.email,u.phone,u.active,e.emp_code,e.designation,e.hire_date,e.department FROM users u LEFT JOIN employees e ON e.user_id=u.id WHERE u.id=?`, id);
  if (!a) throw notFound();
  res.json({
    agent: { ...a, ...agentStats(id) },
    leads: all(`SELECT c.id,c.full_name,c.phone,st.value stage,st.color stage_color,c.followup_date,c.budget,c.is_customer FROM contacts c LEFT JOIN lookups st ON st.id=c.stage_id WHERE c.agent_id=? ORDER BY c.last_activity_at DESC LIMIT 100`, id),
    sales: all(`SELECT s.id,s.sale_no,s.sale_date,s.net_price,s.paid_amount,s.kind,COALESCE(s.title,p.title) property,c.full_name customer FROM sales s LEFT JOIN properties p ON p.id=s.property_id JOIN contacts c ON c.id=s.contact_id WHERE s.agent_id=? AND s.status='confirmed' ORDER BY s.id DESC LIMIT 50`, id),
    commissions: all(`SELECT id,commission_no,amount,paid_amount,status,created_at FROM commissions WHERE agent_id=? ORDER BY id DESC LIMIT 50`, id),
  });
}));

/** Agent commission ledger: accruals (approved commissions) and payments with a running balance. */
r.get('/:id(\\d+)/ledger', can('crm', 'view'), asyncH((req, res) => {
  const id = Number(req.params.id);
  if (ownerId(req) && ownerId(req) !== id) throw forbidden();
  const a = get('SELECT id,name FROM users WHERE id=?', id);
  if (!a) throw notFound();
  const accruals = all(`SELECT cm.id, cm.commission_no ref, cm.amount, s.sale_no, s.kind, COALESCE(s.title,p.title) subject, c.full_name customer,
      (SELECT date FROM journals WHERE id=cm.journal_id) date FROM commissions cm JOIN sales s ON s.id=cm.sale_id LEFT JOIN properties p ON p.id=s.property_id
      LEFT JOIN contacts c ON c.id=cm.contact_id WHERE cm.agent_id=? AND cm.journal_id IS NOT NULL AND cm.status<>'cancelled'`, id);
  const pays = all(`SELECT cp.id, cp.amount, cp.date, cp.method, cp.reference_no, cm.commission_no ref, c.full_name customer FROM commission_payments cp JOIN commissions cm ON cm.id=cp.commission_id
      LEFT JOIN contacts c ON c.id=cm.contact_id WHERE cm.agent_id=?`, id);
  const entries = [
    ...accruals.map((x) => ({ date: x.date, ref: x.ref, description: `Commission earned — ${x.subject} (${x.customer})`, credit: x.amount, debit: 0 })),
    ...pays.map((x) => ({ date: x.date, ref: x.ref, description: `Payment${x.method ? ' via ' + x.method : ''} — ${x.customer || ''}`, debit: x.amount, credit: 0 })),
  ].sort((p, q) => String(p.date).localeCompare(String(q.date)));
  let bal = 0; for (const e of entries) { bal += e.credit - e.debit; e.balance = bal; }
  res.json({ agent: a, entries, balance: bal, pending_approval: get(`SELECT COALESCE(SUM(amount),0) v FROM commissions WHERE agent_id=? AND status='pending'`, id).v });
}));

export default r;
