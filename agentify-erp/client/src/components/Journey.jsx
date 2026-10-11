import { date, money, todayPK } from '../format.js';

/** "Your journey": booking → upfront paid → installments → fully paid → file complete, worked out from the customer's own plan. */
export function Journey({ sale, rows, property, schedule }) {
  const upfront = rows.filter((r) => ['booking', 'advance'].includes(r.kind));
  const regular = rows.filter((r) => r.kind === 'installment');
  const paidRegular = regular.filter((r) => r.status === 'paid').length;
  const upfrontDone = upfront.length ? upfront.every((r) => r.status === 'paid') : sale.paid_amount > 0;
  const allDone = sale.net_price > 0 && sale.paid_amount >= sale.net_price;
  const steps = [
    { label: 'Booked', sub: date(sale.sale_date), done: true },
    { label: 'Booking paid', sub: upfrontDone ? 'Received' : 'Pending', done: upfrontDone },
    { label: 'Installments', sub: regular.length ? `${paidRegular} of ${regular.length} paid` : '—', done: regular.length > 0 && paidRegular === regular.length },
    ...(schedule ? [{ label: 'Construction', sub: `${schedule.actual_pct}% built`, done: schedule.actual_pct >= 100 }] : []),
    { label: 'Fully paid', sub: allDone ? 'Complete' : `${money(sale.net_price - sale.paid_amount)} left`, done: allDone },
    { label: 'File complete', sub: allDone ? (property?.file_status || 'Active') : 'After final payment', done: false },
  ];
  const firstOpen = steps.findIndex((s) => !s.done);
  const now = firstOpen === -1 ? steps.length - 1 : firstOpen;
  return (
    <div className="journey" role="list" aria-label="Your journey">
      {steps.map((s, i) => (
        <div key={s.label} role="listitem" className={`j-step ${i < now || s.done ? 'done' : i === now ? 'now' : ''}`}>
          <div className="j-dot">{i < now || s.done ? '✓' : i + 1}</div>
          <div>{s.label}</div><div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 400 }}>{s.sub}</div>
        </div>
      ))}
    </div>
  );
}

/** Month-by-month payment calendar: what was paid, what is due, what is late. */
export function PayCalendar({ rows }) {
  const t0 = todayPK();
  const cur = t0.slice(0, 7);
  const months = new Map();
  for (const r of rows) { const k = r.due_date.slice(0, 7); if (!months.has(k)) months.set(k, []); months.get(k).push(r); }
  const keys = [...months.keys()].sort();
  // keep the view focused: last 3 months + everything still to come (max 24 months)
  const from = keys.findIndex((k) => k >= cur);
  const start = Math.max(0, (from === -1 ? keys.length : from) - 3);
  const list = keys.slice(start, start + 24);
  const label = (k) => new Date(`${k}-01T00:00:00Z`).toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' });
  if (!list.length) return null;
  return (
    <div className="paycal">
      {list.map((k) => (
        <div key={k} className={`paycal-m ${k === cur ? 'cur' : ''}`}>
          <h5>{label(k)}{k === cur ? ' · this month' : ''}</h5>
          {months.get(k).map((r) => {
            const late = r.status !== 'paid' && r.due_date < t0;
            return <div key={r.id || `${k}${r.seq}`} className={`paycal-i ${r.status === 'paid' ? 'paid' : late ? 'overdue' : ''}`} title={`${r.kind} due ${date(r.due_date)}`}><span>{r.due_date.slice(8)} · {r.kind === 'installment' ? `#${r.seq}` : r.kind}</span><span className="mono">{money(r.amount - (r.status === 'paid' ? 0 : r.paid || 0))}</span></div>;
          })}
        </div>
      ))}
    </div>
  );
}
