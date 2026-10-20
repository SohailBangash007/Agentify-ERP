import { get, all, run, tx, nextNo, getSetting } from '../db.js';
import { now, today, bad, int, jparse, moneyText, curCode } from '../util.js';
import { postJournal, assertFunds, assertTreasury } from './accounting.js';
import { audit, activity, notify } from '../audit.js';

export const COMMISSION_STATUS = ['pending', 'approved', 'partially_paid', 'paid', 'cancelled'];

/** Most specific active rule wins: property > project > property type > general. */
export function pickRule(sale, property) {
  const rules = all('SELECT * FROM commission_rules WHERE active=1');
  const score = (r) => {
    if (r.sale_kind && r.sale_kind !== (sale.kind || 'property')) return -1;
    const kindBonus = r.sale_kind ? 0.5 : 0;
    if (r.property_id) return r.property_id === sale.property_id ? 4 + kindBonus : -1;
    if (r.project_id) return r.project_id === sale.project_id ? 3 + kindBonus : -1;
    if (r.property_type) return r.property_type === property?.property_type ? 2 + kindBonus : -1;
    return 1 + kindBonus;
  };
  return rules.map((r) => ({ r, s: score(r) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s)[0]?.r || null;
}

export function computeCommission(rule, base) {
  if (!rule) {
    const pct = Number(getSetting('default_commission_pct', 2));
    return { type: 'percentage', value: pct, amount: Math.round((base * pct) / 100) };
  }
  if (rule.type === 'fixed') return { type: 'fixed', value: rule.value, amount: Math.round(rule.value) };
  if (rule.type === 'tier') {
    const tiers = jparse(rule.tiers, []);
    const t = tiers.find((x) => base >= Number(x.min || 0) && (x.max == null || x.max === '' || base <= Number(x.max)));
    const pct = t ? Number(t.rate) : Number(rule.value);
    return { type: 'tier', value: pct, amount: Math.round((base * pct) / 100) };
  }
  return { type: 'percentage', value: rule.value, amount: Math.round((base * rule.value) / 100) };
}

/** Called after a sale is confirmed. */
export function generateCommission(saleId, user) {
  const sale = get('SELECT * FROM sales WHERE id=?', saleId);
  if (!sale || sale.status !== 'confirmed' || !sale.agent_id) return null;
  if (get("SELECT id FROM commissions WHERE sale_id=? AND status<>'cancelled'", saleId)) return null;
  const property = sale.property_id ? get('SELECT * FROM properties WHERE id=?', sale.property_id) : null;
  const rule = pickRule(sale, property);
  const c = computeCommission(rule, sale.net_price);
  const no = nextNo('CM', 'CM');
  const r = run(`INSERT INTO commissions(commission_no,sale_id,agent_id,contact_id,property_id,project_id,base_amount,rule_id,rate_type,rate_value,amount,status,created_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`, no, saleId, sale.agent_id, sale.contact_id, sale.property_id, sale.project_id,
  sale.net_price, rule?.id ?? null, c.type, c.value, c.amount, 'pending', now());
  const id = Number(r.lastInsertRowid);
  activity(sale.contact_id, user, 'Commission generated', { detail: `${no} — ${moneyText(c.amount)}`, entityType: 'commission', entityId: id });
  notify(sale.agent_id, 'commission', 'Commission generated', `${no}: ${moneyText(c.amount)} pending approval`, `/commissions`);
  return id;
}

export function approveCommission(id, req) {
  return tx(() => {
    const c = get('SELECT * FROM commissions WHERE id=?', id);
    if (!c) throw bad('Commission not found');
    if (c.status !== 'pending') throw bad(`Only pending commissions can be approved (current: ${c.status})`);
    const jid = postJournal({
      memo: `Commission ${c.commission_no} approved`, refType: 'commission', refId: id, projectId: c.project_id, userId: req.user.id,
      lines: [{ account: '5700', debit: c.amount }, { account: '2300', credit: c.amount, contactId: c.contact_id, saleId: c.sale_id }],
    });
    run("UPDATE commissions SET status='approved', approved_by=?, journal_id=? WHERE id=?", req.user.id, jid, id);
    audit(req, 'Approved commission', 'commission', id, `${c.commission_no} ${curCode()} ${c.amount}`);
    activity(c.contact_id, req.user, 'Commission approved', { detail: c.commission_no, entityType: 'commission', entityId: id });
    notify(c.agent_id, 'commission', 'Commission approved', `${c.commission_no} has been approved`, '/commissions');
  });
}

export function payCommission(id, inp, req) {
  return tx(() => {
    const c = get('SELECT * FROM commissions WHERE id=?', id);
    if (!c) throw bad('Commission not found');
    if (!['approved', 'partially_paid'].includes(c.status)) throw bad('Commission must be approved before payment');
    const amount = int(inp.amount, c.amount - c.paid_amount);
    if (amount <= 0 || amount > c.amount - c.paid_amount) throw bad('Invalid payment amount');
    const acc = assertTreasury(inp.account_id);
    assertFunds(acc.id, amount);
    const jid = postJournal({
      date: inp.date || today(), memo: `Commission ${c.commission_no} payment`, refType: 'commission_payment', refId: id,
      projectId: c.project_id, userId: req.user.id,
      lines: [{ account: '2300', debit: amount, contactId: c.contact_id, saleId: c.sale_id }, { account: acc.id, credit: amount }],
    });
    run(`INSERT INTO commission_payments(commission_id,amount,account_id,date,method,reference_no,journal_id,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?)`,
      id, amount, acc.id, inp.date || today(), inp.method ?? null, inp.reference_no ?? null, jid, req.user.id, now());
    const paid = c.paid_amount + amount;
    run('UPDATE commissions SET paid_amount=?, status=? WHERE id=?', paid, paid >= c.amount ? 'paid' : 'partially_paid', id);
    audit(req, 'Paid commission', 'commission', id, `${c.commission_no} ${curCode()} ${amount}`);
    notify(c.agent_id, 'commission', 'Commission paid', `${moneyText(amount)} paid for ${c.commission_no}`, '/commissions');
  });
}

export function cancelCommission(id, req) {
  return tx(() => {
    const c = get('SELECT * FROM commissions WHERE id=?', id);
    if (!c) throw bad('Commission not found');
    if (c.paid_amount > 0) throw bad('Commission with payments cannot be cancelled');
    if (c.status === 'cancelled') return;
    if (c.journal_id) {
      postJournal({
        memo: `Commission ${c.commission_no} cancelled`, refType: 'commission', refId: id, projectId: c.project_id, userId: req.user.id,
        lines: [{ account: '2300', debit: c.amount, contactId: c.contact_id, saleId: c.sale_id }, { account: '5700', credit: c.amount }],
      });
    }
    run("UPDATE commissions SET status='cancelled' WHERE id=?", id);
    audit(req, 'Cancelled commission', 'commission', id, c.commission_no);
  });
}
