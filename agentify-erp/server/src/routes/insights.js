import { Router } from 'express';
import { all, get } from '../db.js';
import { can, hasPerm, ownerId, requireStaff } from '../rbac.js';
import { asyncH, forbidden, notFound, today, addDays } from '../util.js';

/**
 * Read-only "smart" views that stitch existing records together: the role-aware Today feed, the customer 360 timeline
 * with a next-best-action, and the plot map. Nothing here writes data.
 */
const r = Router();
r.use(requireStaff);

const OPEN_STAGE = `(SELECT id FROM lookups WHERE type='lead_stage' AND meta LIKE '%"kind":"open"%')`;
const daysBetween = (a, b) => Math.round((new Date(`${b}T00:00:00Z`) - new Date(`${a}T00:00:00Z`)) / 86400000);

// ------------------------------------------------------------------ Today
r.get('/today', asyncH((req, res) => {
  const t = today(), me = req.user.id, own = ownerId(req);
  const cards = [];
  const card = (key, title, icon, count, items, extra = {}) => { if (count > 0 || extra.always) cards.push({ key, title, icon, count, items, ...extra }); };

  // everyone: assigned work
  const wt = all(`SELECT id,title,due_date,priority FROM work_tasks WHERE assigned_to=? AND status<>'done' AND due_date IS NOT NULL AND due_date<=? ORDER BY due_date LIMIT 5`, me, t);
  const wtN = get(`SELECT COUNT(*) n FROM work_tasks WHERE assigned_to=? AND status<>'done' AND due_date IS NOT NULL AND due_date<=?`, me, t).n;
  card('work', 'Tasks assigned to me', 'check', wtN, wt.map((x) => ({ title: x.title, sub: x.due_date < t ? `Overdue since ${x.due_date}` : 'Due today', badge: x.priority, hot: x.due_date < t, link: '/my/tasks' })), { link: '/my/tasks', hot: wt.some((x) => x.due_date < t) });

  if (hasPerm(req.user, 'crm', 'view')) {
    const scope = own ? `AND (c.agent_id=${own} OR c.created_by=${own})` : '';
    const fu = all(`SELECT c.id,c.full_name,c.followup_date,c.phone FROM contacts c WHERE c.followup_date IS NOT NULL AND c.followup_date<=? AND c.is_customer=0 ${scope} ORDER BY c.followup_date LIMIT 5`, t);
    const fuN = get(`SELECT COUNT(*) n FROM contacts c WHERE c.followup_date IS NOT NULL AND c.followup_date<=? AND c.is_customer=0 ${scope}`, t).n;
    card('followups', 'Follow-ups due', 'phone', fuN, fu.map((x) => ({ title: x.full_name, sub: x.followup_date < t ? `Was due ${x.followup_date}` : 'Call today', hot: x.followup_date < t, link: `/contacts/${x.id}`, phone: x.phone })), { link: '/tasks', hot: fu.some((x) => x.followup_date < t) });
    const ctask = all(`SELECT k.id,k.title,k.due_date,k.entity_id,c.full_name FROM tasks k LEFT JOIN contacts c ON k.entity_type='contact' AND c.id=k.entity_id WHERE k.assigned_to=? AND k.status='open' AND k.due_date IS NOT NULL AND k.due_date<=? ORDER BY k.due_date LIMIT 5`, me, t);
    const ctaskN = get(`SELECT COUNT(*) n FROM tasks WHERE assigned_to=? AND status='open' AND due_date IS NOT NULL AND due_date<=?`, me, t).n;
    card('crmtasks', 'CRM tasks due', 'task', ctaskN, ctask.map((x) => ({ title: x.title, sub: x.full_name ? `${x.full_name} · ${x.due_date}` : x.due_date, hot: x.due_date < t, link: x.entity_id ? `/contacts/${x.entity_id}` : '/tasks' })), { link: '/tasks' });
    const cutoff = addDays(t, -7);
    const stale = all(`SELECT c.id,c.full_name,COALESCE(c.last_activity_at,c.created_at) last FROM contacts c WHERE c.is_customer=0 AND c.stage_id IN ${OPEN_STAGE} AND date(COALESCE(c.last_activity_at,c.created_at))<? ${scope} ORDER BY last LIMIT 5`, cutoff);
    const staleN = get(`SELECT COUNT(*) n FROM contacts c WHERE c.is_customer=0 AND c.stage_id IN ${OPEN_STAGE} AND date(COALESCE(c.last_activity_at,c.created_at))<? ${scope}`, cutoff).n;
    card('stale', 'Leads going cold', 'clock', staleN, stale.map((x) => ({ title: x.full_name, sub: `No activity for ${daysBetween(String(x.last).slice(0, 10), t)} days`, link: `/contacts/${x.id}` })), { link: '/pipeline' });
  }

  if (hasPerm(req.user, 'payments', 'view')) {
    const base = `FROM installments i JOIN sales s ON s.id=i.sale_id JOIN contacts c ON c.id=s.contact_id WHERE s.status='confirmed' AND i.status<>'paid' ${own ? `AND s.agent_id=${own}` : ''}`;
    const od = all(`SELECT i.id,i.due_date,i.amount-i.paid bal,c.id cid,c.full_name,s.sale_no ${base} AND i.due_date<? ORDER BY i.due_date LIMIT 5`, t);
    const odAgg = get(`SELECT COUNT(*) n, COALESCE(SUM(i.amount-i.paid),0) v ${base} AND i.due_date<?`, t);
    card('overdue', 'Overdue installments', 'dollar', odAgg.n, od.map((x) => ({ title: x.full_name, sub: `${daysBetween(x.due_date, t)} days late · ${x.sale_no}`, amount: x.bal, hot: true, link: `/customers/${x.cid}/360` })), { link: '/payments/installments?status=overdue', hot: true, total: odAgg.v });
    const wk = addDays(t, 7);
    const soon = all(`SELECT i.id,i.due_date,i.amount-i.paid bal,c.id cid,c.full_name,s.sale_no ${base} AND i.due_date>=? AND i.due_date<=? ORDER BY i.due_date LIMIT 5`, t, wk);
    const soonAgg = get(`SELECT COUNT(*) n, COALESCE(SUM(i.amount-i.paid),0) v ${base} AND i.due_date>=? AND i.due_date<=?`, t, wk);
    card('duesoon', 'Due in the next 7 days', 'calendar', soonAgg.n, soon.map((x) => ({ title: x.full_name, sub: `${x.due_date === t ? 'Today' : x.due_date} · ${x.sale_no}`, amount: x.bal, link: `/customers/${x.cid}/360` })), { link: '/payments/installments?status=upcoming', total: soonAgg.v });
  }

  if (hasPerm(req.user, 'accounting', 'approve')) {
    const ev = all(`SELECT v.id,v.voucher_no,v.description,v.amount,vn.name vendor FROM expense_vouchers v LEFT JOIN vendors vn ON vn.id=v.vendor_id WHERE v.status='submitted' ORDER BY v.id LIMIT 5`);
    const evN = get(`SELECT COUNT(*) n FROM expense_vouchers WHERE status='submitted'`).n;
    card('vouchers', 'Vouchers awaiting approval', 'wallet', evN, ev.map((x) => ({ title: `${x.voucher_no} · ${x.description || x.vendor || 'Expense'}`, sub: x.vendor || '', amount: x.amount, link: `/expenses/${x.id}` })), { link: '/expenses?status=submitted' });
  }
  if (hasPerm(req.user, 'listings', 'approve')) {
    const lp = all(`SELECT p.id,p.title,COALESCE(a.name,c.name) agent FROM properties p LEFT JOIN users a ON a.id=p.agent_id LEFT JOIN users c ON c.id=p.created_by WHERE p.review_state='review' ORDER BY p.updated_at LIMIT 5`);
    const lpN = get("SELECT COUNT(*) n FROM properties WHERE review_state='review'").n + get("SELECT COUNT(*) n FROM projects WHERE site_state='requested'").n;
    card('listings', 'Listings awaiting approval', 'building', lpN, lp.map((x) => ({ title: x.title, sub: `Added by ${x.agent || 'an agent'}`, link: '/listings/approvals' })), { link: '/listings/approvals', hot: lpN > 0 });
  }
  if (hasPerm(req.user, 'vendors', 'approve')) {
    const tn = all(`SELECT t.id,t.tender_no,t.title,t.closes_on,(SELECT COUNT(*) FROM tender_bids b WHERE b.tender_id=t.id AND b.status IN ('submitted','shortlisted')) bids
      FROM tenders t WHERE t.status IN ('open','closed') AND EXISTS (SELECT 1 FROM tender_bids b WHERE b.tender_id=t.id AND b.status IN ('submitted','shortlisted')) ORDER BY t.closes_on LIMIT 5`);
    card('tenders', 'Tenders with bids to review', 'file', tn.length, tn.map((x) => ({ title: `${x.tender_no} · ${x.title}`, sub: `${x.bids} bid(s) · ${x.closes_on < t ? 'closed' : `closes ${x.closes_on}`}`, link: `/vendors/tenders/${x.id}` })), { link: '/vendors/tenders' });
  }
  if (hasPerm(req.user, 'commissions', 'approve')) {
    const n = get(`SELECT COUNT(*) n FROM commissions WHERE status='pending'`).n;
    card('commissions', 'Commissions to approve', 'badge', n, [], { link: '/commissions' });
  }
  if (hasPerm(req.user, 'hrm', 'view') || hasPerm(req.user, 'accounting', 'view')) {
    const incomplete = `(category IS NULL OR category='' OR ((brand_model IS NULL OR brand_model='') AND (serial_no IS NULL OR serial_no='')))`;
    const a = all(`SELECT id,asset_no,name FROM assets WHERE ${incomplete} ORDER BY id DESC LIMIT 5`);
    card('assets', 'Assets missing details', 'layers', get(`SELECT COUNT(*) n FROM assets WHERE ${incomplete}`).n, a.map((x) => ({ title: `${x.asset_no} · ${x.name}`, sub: 'Add category, make/model or serial no.', link: '/assets' })), { link: '/assets' });
  }
  if (hasPerm(req.user, 'hrm', 'edit')) {
    const lv = all(`SELECT l.id,l.type,l.from_date,l.to_date,e.name FROM leaves l JOIN employees e ON e.id=l.employee_id WHERE l.status='pending' ORDER BY l.created_at LIMIT 5`);
    card('leaves', 'Leave requests to decide', 'calendar', get(`SELECT COUNT(*) n FROM leaves WHERE status='pending'`).n, lv.map((x) => ({ title: x.name, sub: `${x.type} · ${x.from_date} → ${x.to_date}`, link: '/hrm/leave' })), { link: '/hrm/leave' });
    const dow = new Date(`${t}T00:00:00Z`).getUTCDay();
    if (dow !== 0) {
      const un = all(`SELECT e.id,e.name FROM employees e WHERE e.status='active' AND NOT EXISTS (SELECT 1 FROM attendance a WHERE a.employee_id=e.id AND a.date=?) AND NOT EXISTS (SELECT 1 FROM leaves l WHERE l.employee_id=e.id AND l.status='approved' AND ? BETWEEN l.from_date AND l.to_date) ORDER BY e.name LIMIT 5`, t, t);
      const unN = get(`SELECT COUNT(*) n FROM employees e WHERE e.status='active' AND NOT EXISTS (SELECT 1 FROM attendance a WHERE a.employee_id=e.id AND a.date=?) AND NOT EXISTS (SELECT 1 FROM leaves l WHERE l.employee_id=e.id AND l.status='approved' AND ? BETWEEN l.from_date AND l.to_date)`, t, t).n;
      card('attendance', "Attendance not marked today", 'clock', unN, un.map((x) => ({ title: x.name, sub: 'Mark present / absent', link: '/hrm/attendance' })), { link: '/hrm/attendance' });
    }
  }
  if (hasPerm(req.user, 'content', 'view')) {
    const c = all(`SELECT id,title,post_time FROM content_posts WHERE post_date=? AND status<>'posted' ORDER BY post_time LIMIT 5`, t);
    card('content', 'Posts to publish today', 'calendar', get(`SELECT COUNT(*) n FROM content_posts WHERE post_date=? AND status<>'posted'`, t).n, c.map((x) => ({ title: x.title, sub: x.post_time || 'Any time', link: '/content' })), { link: '/content' });
  }
  const attention = cards.reduce((n, c) => n + c.count, 0);
  const hour = Number(new Date(Date.now() + 5 * 3600000).toISOString().slice(11, 13));
  res.json({ date: t, greeting: hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening', attention, cards });
}));

// ------------------------------------------------------------------ Customer 360
r.get('/customer/:id(\\d+)', can('customers', 'view'), asyncH((req, res) => {
  const t = today();
  const c = get(`SELECT c.*, a.name agent_name FROM contacts c LEFT JOIN users a ON a.id=c.agent_id WHERE c.id=?`, req.params.id);
  if (!c) throw notFound('Customer not found');
  if (req.user.own_scope && c.agent_id !== req.user.id && c.created_by !== req.user.id) throw forbidden('This customer is assigned to another agent');
  const sales = all(`SELECT s.id,s.sale_no,s.kind,s.sale_date,s.net_price,s.paid_amount,s.status,s.property_id,p.title property_title,p.file_status,p.registration_no,p.plot_no,p.block,pr.name project_name
    FROM sales s LEFT JOIN properties p ON p.id=s.property_id LEFT JOIN projects pr ON pr.id=COALESCE(s.project_id,p.project_id) WHERE s.contact_id=? ORDER BY s.sale_date DESC`, c.id);
  const confirmed = sales.filter((s) => s.status === 'confirmed');
  const inst = confirmed.length ? all(`SELECT i.id,i.sale_id,i.seq,i.kind,i.due_date,i.amount,i.paid,i.status,s.sale_no FROM installments i JOIN sales s ON s.id=i.sale_id WHERE s.contact_id=? AND s.status='confirmed' ORDER BY i.due_date,i.id`, c.id) : [];
  const unpaid = inst.filter((i) => i.status !== 'paid');
  const overdue = unpaid.filter((i) => i.due_date < t);
  const upcoming = unpaid.filter((i) => i.due_date >= t);
  const receipts = all(`SELECT rc.id,rc.receipt_no,rc.date,rc.amount,rc.method,rc.payment_type,rc.status FROM receipts rc WHERE rc.contact_id=? ORDER BY rc.date DESC,rc.id DESC LIMIT 60`, c.id);
  const notes = all(`SELECT n.id,n.body,n.created_at,u.name user_name FROM notes n LEFT JOIN users u ON u.id=n.user_id WHERE n.entity_type='contact' AND n.entity_id=? ORDER BY n.id DESC LIMIT 40`, c.id);
  const acts = all(`SELECT id,user_name,action,field,prev_value,new_value,detail,created_at FROM activities WHERE contact_id=? AND IFNULL(entity_type,'') NOT IN ('receipt','sale') ORDER BY id DESC LIMIT 40`, c.id);
  const docs = all(`SELECT id,name,category,created_at FROM documents WHERE entity_type='contact' AND entity_id=? ORDER BY id DESC LIMIT 30`, c.id);
  const tasks = all(`SELECT id,title,due_date,status,completed_at,created_at FROM tasks WHERE entity_type='contact' AND entity_id=? ORDER BY id DESC LIMIT 30`, c.id);
  const portal = get(`SELECT last_login FROM users WHERE contact_id=?`, c.id);

  const ev = [];
  for (const x of receipts) ev.push({ type: 'receipt', at: x.date, title: `Payment received — PKR ${x.amount.toLocaleString('en-PK')}`, sub: `${x.receipt_no} · ${x.payment_type || ''} · ${x.method}${x.status === 'void' ? ' · VOID' : ''}`, link: `/receipts/${x.id}` });
  for (const x of sales) ev.push({ type: 'sale', at: x.sale_date, title: `${x.kind === 'construction' ? 'Construction contract' : 'Booked'} ${x.property_title || ''} (${x.sale_no})`, sub: `PKR ${x.net_price.toLocaleString('en-PK')}${x.status !== 'confirmed' ? ` · ${x.status}` : ''}`, link: `/sales/${x.id}` });
  for (const x of notes) ev.push({ type: 'note', at: x.created_at.slice(0, 10), time: x.created_at, title: x.body.length > 140 ? `${x.body.slice(0, 140)}…` : x.body, sub: x.user_name || '' });
  for (const x of acts) ev.push({ type: 'activity', at: x.created_at.slice(0, 10), time: x.created_at, title: `${x.action}${x.field ? ` · ${x.field}` : ''}${x.new_value ? `: ${x.prev_value ? `${x.prev_value} → ` : ''}${x.new_value}` : ''}`, sub: x.user_name || '' });
  for (const x of docs) ev.push({ type: 'document', at: x.created_at.slice(0, 10), time: x.created_at, title: `Document added — ${x.name}`, sub: x.category || '' });
  for (const x of tasks) ev.push({ type: 'task', at: (x.completed_at || x.created_at || x.due_date || '').slice(0, 10), title: `${x.status === 'done' ? 'Task done' : 'Task'}: ${x.title}`, sub: x.due_date ? `due ${x.due_date}` : '' });
  for (const x of overdue.slice(0, 6)) ev.push({ type: 'overdue', at: x.due_date, title: `Installment overdue — PKR ${(x.amount - x.paid).toLocaleString('en-PK')}`, sub: `${daysBetween(x.due_date, t)} days late · ${x.sale_no}`, link: `/sales/${x.sale_id}` });
  for (const x of upcoming.slice(0, 3)) ev.push({ type: 'installment', future: true, at: x.due_date, title: `Installment due — PKR ${(x.amount - x.paid).toLocaleString('en-PK')}`, sub: `${x.kind} · ${x.sale_no}`, link: `/sales/${x.sale_id}` });
  ev.sort((a, b) => (b.at + (b.time || '')).localeCompare(a.at + (a.time || '')));

  // ---- next best action: the single most useful thing to do now
  const net = confirmed.reduce((s, x) => s + x.net_price, 0), paid = confirmed.reduce((s, x) => s + x.paid_amount, 0);
  const oldest = overdue[0], overdueAmt = overdue.reduce((s, i) => s + (i.amount - i.paid), 0);
  const lastTouch = [...acts.map((a) => a.created_at), ...notes.map((n) => n.created_at), c.last_activity_at].filter(Boolean).sort().pop();
  const idle = lastTouch ? daysBetween(lastTouch.slice(0, 10), t) : null;
  const hasCnicDoc = docs.some((d) => /cnic|identity|id card/i.test(`${d.category} ${d.name}`));
  const badFile = confirmed.find((s) => s.file_status && s.file_status !== 'Active');
  let nba = { tone: 'ok', title: 'All good — nothing needs attention right now.', kind: 'none' };
  if (oldest) nba = { tone: 'bad', kind: 'overdue', title: `Installment overdue by ${daysBetween(oldest.due_date, t)} days — PKR ${overdueAmt.toLocaleString('en-PK')} outstanding`, detail: 'Send a friendly reminder, then record the payment as soon as it arrives.', amount: overdueAmt, days: daysBetween(oldest.due_date, t), due_date: oldest.due_date, sale_no: oldest.sale_no, sale_id: oldest.sale_id };
  else if (badFile) nba = { tone: 'bad', kind: 'file', title: `File ${badFile.registration_no || badFile.sale_no} is ${badFile.file_status}`, detail: 'Review the file status with the customer and update it once resolved.', sale_id: badFile.id };
  else if (upcoming[0] && daysBetween(t, upcoming[0].due_date) <= 7) nba = { tone: 'warn', kind: 'due', title: `Next installment of PKR ${(upcoming[0].amount - upcoming[0].paid).toLocaleString('en-PK')} is due ${upcoming[0].due_date === t ? 'today' : `in ${daysBetween(t, upcoming[0].due_date)} days`}`, detail: 'A heads-up message now avoids a late payment.', amount: upcoming[0].amount - upcoming[0].paid, due_date: upcoming[0].due_date, sale_no: upcoming[0].sale_no, sale_id: upcoming[0].sale_id };
  else if (confirmed.length && !hasCnicDoc) nba = { tone: 'warn', kind: 'docs', title: 'No CNIC copy on file', detail: 'Add it under Documents so the file is complete.' };
  else if (idle !== null && idle >= 30 && !c.is_customer) nba = { tone: 'warn', kind: 'reach', title: `No contact for ${idle} days`, detail: 'A quick check-in keeps the relationship warm.' };
  else if (confirmed.length && net > 0 && paid >= net) nba = { tone: 'ok', kind: 'complete', title: 'Fully paid — ready for file completion / transfer paperwork.', detail: 'Congratulate the customer and start the handover steps.' };

  res.json({
    contact: { id: c.id, full_name: c.full_name, customer_code: c.customer_code, phone: c.phone, whatsapp: c.whatsapp, email: c.email, cnic: c.cnic, city: c.city, address: c.address, is_customer: !!c.is_customer, customer_since: c.customer_since, agent_name: c.agent_name, tags: c.tags },
    kpis: { net, paid, outstanding: net - paid, overdue: overdueAmt, overdue_count: overdue.length, next_due: upcoming[0] ? { due_date: upcoming[0].due_date, amount: upcoming[0].amount - upcoming[0].paid } : null, files: confirmed.length, idle_days: idle },
    sales, nba, events: ev.slice(0, 120), portal: portal ? { last_login: portal.last_login } : null,
  });
}));

// ------------------------------------------------------------------ Plot map
r.get('/plot-map', can('properties', 'view'), asyncH((req, res) => {
  const t = today();
  const project = Number(req.query.project_id) || null;
  const rows = all(`SELECT p.id,p.code,p.title,p.project_id,pr.name project_name,COALESCE(p.block,'') block,p.plot_no,p.area_size,p.unit,p.status,p.net_price,p.file_status,p.registration_no,p.file_no,p.property_type,
      s.id sale_id,s.agent_id sale_agent_id,s.sale_no,s.net_price sale_net,s.paid_amount,c.id contact_id,c.full_name customer, c.phone customer_phone,
      (SELECT COUNT(*) FROM installments i WHERE i.sale_id=s.id AND i.status<>'paid' AND i.due_date<?) overdue_count
    FROM properties p LEFT JOIN projects pr ON pr.id=p.project_id
    LEFT JOIN sales s ON s.property_id=p.id AND s.status='confirmed' AND s.kind='property' LEFT JOIN contacts c ON c.id=s.contact_id
    WHERE p.status<>'cancelled' AND p.project_id IS NOT NULL ${project ? 'AND p.project_id=?' : ''} ORDER BY pr.name, p.block, CAST(p.plot_no AS INTEGER), p.plot_no`, ...(project ? [t, project] : [t]));
  // Who owns a plot is customer data: show it only to roles that may see customers/sales, and agents only for their own sales.
  const mayView = hasPerm(req.user, 'sales', 'view') || hasPerm(req.user, 'customers', 'view');
  const own = ownerId(req);
  const redact = (x) => (mayView && (!own || x.sale_agent_id === own) ? x
    : { ...x, sale_id: null, sale_no: null, sale_net: null, paid_amount: null, contact_id: null, customer: null, customer_phone: null, overdue_count: 0 });
  const plots = rows.map(({ ...x }) => ({ ...redact(x), map_status: x.status === 'sold' && ['Defaulted', 'Suspended'].includes(x.file_status) ? 'defaulted' : (x.status === 'featured' ? 'available' : x.status) }));
  const summary = {};
  for (const x of plots) summary[x.map_status] = (summary[x.map_status] || 0) + 1;
  res.json({ projects: all('SELECT id,name FROM projects ORDER BY name'), plots, summary, total: plots.length });
}));

export default r;
