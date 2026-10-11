import { progressSql } from './schedule.js';
import { get, all } from '../db.js';

/** Project accounting, entirely derived from journals + sales (never stored). */
export function projectFinancials(projectId) {
  const sales = get(`SELECT COUNT(*) n, COALESCE(SUM(net_price),0) value, COALESCE(SUM(paid_amount),0) collected
    FROM sales WHERE project_id=? AND status='confirmed'`, projectId);
  const exp = get(`SELECT COALESCE(SUM(l.debit-l.credit),0) v FROM journal_lines l JOIN accounts a ON a.id=l.account_id
    WHERE l.project_id=? AND a.type='expense' AND a.code<>'5700'`, projectId).v;
  const commission = get(`SELECT COALESCE(SUM(l.debit-l.credit),0) v FROM journal_lines l JOIN accounts a ON a.id=l.account_id WHERE l.project_id=? AND a.code='5700'`, projectId).v;
  const paidExp = get(`SELECT COALESCE(SUM(paid_amount),0) v FROM expense_vouchers WHERE project_id=? AND status IN ('approved','partial','paid')`, projectId).v;
  const byAccount = all(`SELECT a.name account, SUM(l.debit-l.credit) amount FROM journal_lines l JOIN accounts a ON a.id=l.account_id
    WHERE l.project_id=? AND a.type='expense' GROUP BY a.id HAVING amount<>0 ORDER BY amount DESC`, projectId);
  const units = get(`SELECT COUNT(*) total, SUM(status='sold') sold, SUM(status IN ('available','featured')) available, SUM(status='reserved') reserved
    FROM properties WHERE project_id=? AND status<>'cancelled'`, projectId);
  const project = get('SELECT total_value FROM projects WHERE id=?', projectId);
  const progress = get(`SELECT ${progressSql(String(Number(projectId)))} v`).v ?? 0;
  const totalExpenses = exp + commission;
  return {
    project_value: project?.total_value ?? 0,
    total_sales: sales.value, sales_count: sales.n,
    collections: sales.collected, receivables: sales.value - sales.collected,
    development_cost: exp, commission_cost: commission, expenses: totalExpenses,
    outstanding_development_cost: exp - paidExp,
    income: sales.value, gross_profit: sales.value - totalExpenses, cash_position: sales.collected - paidExp,
    units_total: units.total || 0, units_sold: units.sold || 0, units_available: units.available || 0, units_reserved: units.reserved || 0,
    development_pct: progress, expense_breakdown: byAccount,
  };
}
