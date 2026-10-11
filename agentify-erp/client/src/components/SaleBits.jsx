import { Link } from 'react-router-dom';
import { date, money, todayPK } from '../format.js';
import { LedgerSummary, StatusBadge } from './ui.jsx';

const KIND = { booking: 'Booking', advance: 'Advance', installment: 'Installment', balloon: 'Balloon' };

/** Payment plan schedule: paid / balance / overdue per row. */
export function InstallmentTable({ rows, portal }) {
  const t0 = todayPK();
  const total = rows.reduce((a, r) => ({ amount: a.amount + r.amount, paid: a.paid + r.paid }), { amount: 0, paid: 0 });
  return (
    <div className="table-wrap">
      <table className="t">
        <thead><tr><th>#</th><th>Type</th><th>Due date</th><th className="num">Amount</th><th className="num">Paid</th><th className="num">Balance</th><th>Paid on</th><th>Status</th></tr></thead>
        <tbody>
          {rows.map((r, i) => {
            const overdue = r.status !== 'paid' && r.due_date < t0;
            return (
              <tr key={r.id || i} style={overdue ? { background: 'var(--red-bg)' } : undefined}>
                <td>{r.seq}</td><td>{KIND[r.kind] || r.kind}</td><td>{date(r.due_date)}</td>
                <td className="num mono">{money(r.amount)}</td><td className="num mono">{money(r.paid)}</td><td className="num mono">{money(r.amount - r.paid)}</td>
                <td>{r.paid_date ? date(r.paid_date) : '—'}</td>
                <td>{r.claim_state ? <StatusBadge status={r.claim_state} tone={r.claim_state === 'verifying' ? 'purple' : 'blue'} label={r.claim_state === 'verifying' ? 'Under verification' : 'In process'} /> : overdue ? <StatusBadge status="overdue" /> : <StatusBadge status={r.status} />}{r.status === 'paid' && r.paid_date > r.due_date && <span className="pill amber" style={{ marginLeft: 6 }}>late</span>}</td>
              </tr>
            );
          })}
        </tbody>
        <tfoot><tr><td colSpan={3}>Total</td><td className="num mono">{money(total.amount)}</td><td className="num mono">{money(total.paid)}</td><td className="num mono">{money(total.amount - total.paid)}</td><td colSpan={2} /></tr></tfoot>
      </table>
    </div>
  );
}

/** The financial summary used across sale detail, property workspace and portal. */
export function SaleLedgerSummary({ s }) {
  return (
    <LedgerSummary items={[
      { label: 'Total property value', value: s.sale_price }, { label: 'Discount', value: s.discount }, { label: 'Net property value', value: s.net_price },
      { label: 'Booking amount', value: s.booking_amount }, s.advance_amount ? { label: 'Advance payment', value: s.advance_amount } : null,
      { label: 'Amount paid', value: s.paid_amount, tone: 'pos' }, { label: 'Remaining balance', value: s.outstanding, tone: s.outstanding ? 'warn' : 'pos' },
      { label: 'Overdue amount', value: s.overdue_amount, tone: s.overdue_amount ? 'neg' : '' },
      { label: 'Installments', value: `${s.installments_paid} paid / ${s.installments_remaining} remaining (of ${s.num_installments})`, money: false },
      { label: 'Installment amount', value: s.installment_amount },
      { label: 'Balloon payments', value: s.balloon_count ? `${s.balloon_count} × ${money(s.balloon_amount)}` : 'None', money: false },
      { label: 'Next payment', value: s.next_due ? `${date(s.next_due.due_date)} · ${money(s.next_due.amount)}` : 'None due', money: false },
    ]} />
  );
}

export const SaleLink = ({ s }) => <Link to={`/sales/${s.id}`}>{s.sale_no}</Link>;
