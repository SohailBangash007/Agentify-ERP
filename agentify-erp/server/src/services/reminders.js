import { all, get, run, getSetting, setSetting } from '../db.js';
import { notify, notifyPerm } from '../audit.js';
import { today, addDays, now } from '../util.js';
import { pkr } from '../util.js';

/**
 * Daily system notifications: installments due soon / overdue, follow-ups due, vendor payments due.
 * Idempotent per PKT day — safe to call on every start-up and hourly.
 */
export function runReminders(force = false) {
  const t = today();
  if (!force && getSetting('reminders_last_run') === t) return { skipped: true };
  const days = Number(getSetting('installment_reminder_days', 7)) || 7;
  let n = 0;

  // Installment due in N days (exactly N days out, so each installment reminds once)
  for (const i of all(`SELECT i.id,i.amount-i.paid bal,i.due_date,s.id sale_id,s.agent_id,c.full_name FROM installments i JOIN sales s ON s.id=i.sale_id JOIN contacts c ON c.id=s.contact_id
    WHERE s.status='confirmed' AND i.status<>'paid' AND i.due_date=?`, addDays(t, days))) {
    notifyPerm('payments', 'view', 'installment', `Installment due in ${days} days`, `${i.full_name}: ${pkr(i.bal)} due ${i.due_date}`, `/sales/${i.sale_id}`);
    n++;
  }
  // The customer's own reminders (portal bell + push), one message per customer per day: coming up, due today, overdue
  const cust = (contactId) => all('SELECT id FROM users WHERE contact_id=? AND active=1', contactId).map((u) => u.id);
  const soon = new Map();
  for (const i of all(`SELECT i.id,i.amount-i.paid bal,i.due_date,s.contact_id,COALESCE(s.title,p.title) title,CAST(julianday(i.due_date)-julianday(?) AS INTEGER) dleft
    FROM installments i JOIN sales s ON s.id=i.sale_id LEFT JOIN properties p ON p.id=s.property_id WHERE s.status='confirmed' AND i.status<>'paid' AND i.due_date>=? AND i.due_date<=?`, t, t, addDays(t, days))) {
    if (![days, 1, 0].includes(i.dleft)) continue;
    const k = `${i.contact_id}|${i.dleft}`; const g = soon.get(k) || { contact: i.contact_id, left: i.dleft, due: i.due_date, total: 0, titles: new Set(), n: 0 };
    g.total += i.bal; g.n++; g.titles.add(i.title || 'your plan'); soon.set(k, g);
  }
  for (const g of soon.values()) {
    const when = g.left === 0 ? 'today' : g.left === 1 ? 'tomorrow' : `in ${g.left} days`;
    notify(cust(g.contact), 'installment', g.left === 0 ? 'Payment due today' : `Payment due ${when}`, `${pkr(g.total)} for ${[...g.titles].join(' + ')} is due ${g.due}. You can pay and report it from the Payments page.`, '/portal/payments?pay=1', { dedupe: `cinst-${g.contact}-${g.left}-${t}` });
    n++;
  }
  const late = new Map();
  for (const i of all(`SELECT i.id,i.amount-i.paid bal,i.due_date,s.contact_id,CAST(julianday(?)-julianday(i.due_date) AS INTEGER) late
    FROM installments i JOIN sales s ON s.id=i.sale_id WHERE s.status='confirmed' AND i.status<>'paid' AND i.due_date<?`, t, t)) {
    const g = late.get(i.contact_id) || { total: 0, n: 0, oldest: i.due_date, nudge: false };
    g.total += i.bal; g.n++; if (i.due_date < g.oldest) g.oldest = i.due_date;
    if (i.late === 1 || i.late % 7 === 0) g.nudge = true;
    late.set(i.contact_id, g);
  }
  for (const [contact, g] of late) {
    if (!g.nudge) continue;
    notify(cust(contact), 'overdue', 'Payment overdue', `${pkr(g.total)} is overdue (${g.n} installment${g.n > 1 ? 's' : ''}, oldest due ${g.oldest}). Please pay and report it from the Payments page.`, '/portal/payments?pay=1', { dedupe: `cover-${contact}-${t}` });
    n++;
  }
  // Overdue: remind on the first overdue day and then weekly
  for (const i of all(`SELECT i.id,i.amount-i.paid bal,i.due_date,s.id sale_id,s.agent_id,c.full_name,CAST(julianday(?)-julianday(i.due_date) AS INTEGER) late FROM installments i JOIN sales s ON s.id=i.sale_id JOIN contacts c ON c.id=s.contact_id
    WHERE s.status='confirmed' AND i.status<>'paid' AND i.due_date<?`, t, t)) {
    if (i.late === 1 || i.late % 7 === 0) {
      notifyPerm('payments', 'view', 'overdue', 'Installment overdue', `${i.full_name}: ${pkr(i.bal)} overdue by ${i.late} day(s)`, `/sales/${i.sale_id}`);
      if (i.agent_id) notify(i.agent_id, 'overdue', 'Customer installment overdue', `${i.full_name}: ${pkr(i.bal)} (${i.late} days)`, `/sales/${i.sale_id}`);
      n++;
    }
  }
  // Follow-ups due today
  for (const c of all(`SELECT id,full_name,agent_id FROM contacts WHERE followup_date=? AND agent_id IS NOT NULL AND is_customer=0`, t)) {
    notify(c.agent_id, 'followup', 'Follow-up due today', c.full_name, `/contacts/${c.id}`);
    n++;
  }
  // Vendor payments due
  for (const v of all(`SELECT e.id,e.voucher_no,e.amount-e.paid_amount bal,e.due_date,vn.name FROM expense_vouchers e JOIN vendors vn ON vn.id=e.vendor_id
    WHERE e.is_credit=1 AND e.status IN ('approved','partial') AND e.due_date IS NOT NULL AND e.due_date<=?`, addDays(t, 3))) {
    notifyPerm('vendors', 'view', 'vendor', 'Vendor payment due', `${v.name}: ${pkr(v.bal)} due ${v.due_date} (${v.voucher_no})`, `/expenses/${v.id}`);
    n++;
  }
  // Schedule tasks that slipped past their planned finish: tell the project manager and the affected customers once
  for (const k of all(`SELECT t.id,t.name,t.project_id,t.sale_id,p.name project,p.manager_id,CAST(julianday(?)-julianday(t.planned_end) AS INTEGER) late
    FROM project_tasks t JOIN projects p ON p.id=t.project_id WHERE t.actual_end IS NULL AND t.progress<100 AND t.planned_end<? AND t.delay_notified=0`, t, t)) {
    notify(k.manager_id, 'development', 'Schedule task delayed', `${k.project}: ${k.name} is ${k.late} day(s) late`, `/projects/${k.project_id}`);
    const customers = k.sale_id
      ? all(`SELECT u.id FROM users u JOIN sales s ON s.contact_id=u.contact_id WHERE s.id=?`, k.sale_id)
      : all(`SELECT DISTINCT u.id FROM users u JOIN sales s ON s.contact_id=u.contact_id WHERE s.project_id=? AND s.status='confirmed'`, k.project_id);
    for (const c of customers) notify(c.id, 'development', 'Project schedule update', `${k.project}: "${k.name}" is running ${k.late} day(s) behind schedule`, '/portal/development');
    run('UPDATE project_tasks SET delay_notified=1 WHERE id=?', k.id);
    n++;
  }
  // Work tasks: due today or overdue (once per task per day)
  for (const k of all("SELECT id,title,assigned_to,due_date FROM work_tasks WHERE status<>'done' AND due_date IS NOT NULL AND due_date<=?", t)) {
    notify(k.assigned_to, 'task', k.due_date < t ? 'Task overdue' : 'Task due today', k.title, '/my/tasks', { dedupe: `wtask-${k.id}-${t}` });
    n++;
  }
  setSetting('reminders_last_run', t);
  return { sent: n };
}
