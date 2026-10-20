import { useMemo, useState } from 'react';
import { buildPlan, addMonthsISO, addDaysISO } from '../../../shared/installmentPlan.js';
import { MoneyBox, fullPrice, useSite, curCode } from './siteCore.jsx';
import { getRegion } from '../format.js';

const num = (v) => (v === '' || v == null ? 0 : Number(v));
const inr = (n) => `${getRegion().config.currency} ${Math.round(n).toLocaleString(getRegion().config.locale)}`;
const todayISO = () => getRegion().fmt.today(); // the workspace's timezone (Asia/Karachi for Pakistan)
const fmtDate = (s) => getRegion().fmt.date(s);
const fmtDateLegacy = (s) => { const [y, m, d] = s.split('-').map(Number); return `${String(d).padStart(2, '0')}-${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m - 1]}-${y}`; };

/**
 * Full installment plan generator. Enter the price, booking, advance, number of installments and balloon payments —
 * it produces every due date and amount, which can be downloaded as CSV or PDF.
 */
export function InstallmentCalculator({ price: initialPrice, compact }) {
  const { config } = useSite();
  const c = config.calculators.installment;
  const t0 = todayISO();
  const [f, setF] = useState(() => {
    const price = initialPrice || 5_000_000;
    return { price: String(price), booking: String(Math.round(price * 0.05)), advance: String(Math.round(price * ((c.default_down_pct ?? 20) / 100) - price * 0.05)), installments: String((c.default_years ?? 3) * 12), balloons: '0', balloon_amount: '',
      markup_pct: String(c.markup_pct ?? 0), booking_date: t0, advance_date: addDaysISO(t0, 30), first_date: addMonthsISO(addDaysISO(t0, 30), 1), every_months: '1', balloon_every: '' };
  });
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v?.target ? v.target.value : v }));
  // changing the advance date moves the first installment with it, until the visitor sets one themselves
  const [touchedFirst, setTouchedFirst] = useState(false);
  const setAdvanceDate = (v) => setF((x) => ({ ...x, advance_date: v, first_date: touchedFirst || !v ? x.first_date : addMonthsISO(v, 1) }));
  const plan = useMemo(() => buildPlan(f), [f]);
  const t = plan.totals;

  const files = async (kind) => {
    setBusy(kind); setErr('');
    try {
      if (kind === 'csv') {
        const esc = (v) => `"${String(v).replace(/"/g, '""')}"`;
        const lines = [['#', 'Due date', 'Payment', `Amount (${curCode()})`, `Balance after (${curCode()})`].map(esc).join(','), ...plan.rows.map((r, i) => [i + 1, r.date, r.label, r.amount, r.balance].map(esc).join(','))];
        save(new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' }), 'installment-plan.csv');
      } else {
        const r = await fetch('/api/site/installment-plan/pdf', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'ERP' }, body: JSON.stringify(f) });
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Could not create the PDF');
        save(await r.blob(), 'installment-plan.pdf');
      }
    } catch (e) { setErr(e.message); } finally { setBusy(''); }
  };
  const save = (blob, name) => { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); };

  return (
    <div>
      <div className={`calc ${compact ? 'compact' : ''}`}>
        <div className="calc-form">
          <label>Total price ({curCode()})<MoneyBox value={f.price} onChange={set('price')} placeholder="e.g. 5,000,000" /></label>
          <div className="two">
            <label>Booking amount ({curCode()})<MoneyBox value={f.booking} onChange={set('booking')} placeholder="e.g. 250,000" /></label>
            <label>Advance payment ({curCode()})<MoneyBox value={f.advance} onChange={set('advance')} placeholder="e.g. 750,000" /></label>
          </div>
          <div className="two">
            <label>Number of installments<input type="number" min="1" max="360" value={f.installments} onChange={set('installments')} placeholder="e.g. 60" /></label>
            <label>Gap between installments (months)<input type="number" min="1" max="12" value={f.every_months} onChange={set('every_months')} /></label>
          </div>
          <div className="two">
            <label>Balloon payments (how many)<input type="number" min="0" max="60" value={f.balloons} onChange={set('balloons')} placeholder="e.g. 5" /></label>
            <label>Each balloon ({curCode()})<MoneyBox value={f.balloon_amount} onChange={set('balloon_amount')} placeholder={`blank = 5% (${Math.round(num(f.price) * 0.05).toLocaleString('en-PK')})`} disabled={!num(f.balloons)} /></label>
          </div>
          {num(f.balloons) > 0 && <label>Balloon every (installments)<input type="number" min="1" value={f.balloon_every} onChange={set('balloon_every')} placeholder={`blank = spread evenly (every ${Math.max(1, Math.floor(num(f.installments) / num(f.balloons)))})`} /></label>}
          <div className="three">
            <label>Booking date<input type="date" value={f.booking_date} onChange={set('booking_date')} /></label>
            <label>Advance due<input type="date" value={f.advance_date} onChange={(e) => setAdvanceDate(e.target.value)} /></label>
            <label>First installment<input type="date" value={f.first_date} onChange={(e) => { setTouchedFirst(true); set('first_date')(e.target.value); }} /></label>
          </div>
          {c.markup_pct !== undefined && <label>Markup per year (%)<input type="number" min="0" max="30" step="0.5" value={f.markup_pct} onChange={set('markup_pct')} /></label>}
        </div>
        <div className="calc-result">
          {plan.ok ? (
            <>
              <div className="calc-big"><span>Monthly installment</span><b>{inr(t.installment_amount)}</b><small>for {t.installments} installment{t.installments === 1 ? '' : 's'}{t.last_installment !== t.installment_amount ? ` (last one ${inr(t.last_installment)})` : ''}</small></div>
              <dl>
                {t.booking > 0 && <div><dt>Booking</dt><dd>{inr(t.booking)}</dd></div>}
                {t.advance > 0 && <div><dt>Advance</dt><dd>{inr(t.advance)}</dd></div>}
                <div><dt>{t.installments} installments</dt><dd>{inr(t.regular_total)}</dd></div>
                {t.balloons > 0 && <div><dt>{t.balloons} balloon payment{t.balloons === 1 ? '' : 's'}</dt><dd>{t.balloons} × {inr(t.balloon_amount)}</dd></div>}
                {t.markup > 0 && <div><dt>Markup</dt><dd>{inr(t.markup)}</dd></div>}
                <div><dt>Total payable</dt><dd><b>{inr(t.payable)}</b></dd></div>
                <div><dt>Plan runs</dt><dd>{fmtDate(plan.rows[0].date)} → {fmtDate(t.last_date)}</dd></div>
              </dl>
              <p className="note">{c.note}</p>
            </>
          ) : <div className="plan-err">{plan.errors[0]}</div>}
        </div>
      </div>
      {plan.ok && (
        <div className="plan-wrap" id="plan">
          <div className="plan-head">
            <b>Your payment schedule — {plan.rows.length} payments</b>
            <span style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button type="button" className="btn-s" disabled={!!busy} onClick={() => files('csv')}>{busy === 'csv' ? '…' : '⬇ Excel / CSV'}</button>
              <button type="button" className="btn-p sm" disabled={!!busy} onClick={() => files('pdf')}>{busy === 'pdf' ? 'Preparing…' : '⬇ Download PDF'}</button>
            </span>
          </div>
          <div className="plan-sum">
            <div><span>Total price</span><b>{inr(t.price)}</b></div><div><span>Paid up-front</span><b>{inr(t.upfront)}</b></div>
            <div><span>Monthly</span><b>{inr(t.installment_amount)}</b></div>{t.balloons > 0 && <div><span>Balloon total</span><b>{inr(t.balloon_total)}</b></div>}
            <div><span>Total payable</span><b>{inr(t.payable)}</b></div>
          </div>
          {err && <div className="plan-err" style={{ margin: 12 }}>{err}</div>}
          <div className="plan-tbl">
            <table>
              <thead><tr><th>#</th><th>Due date</th><th>Payment</th><th className="n">Amount</th><th className="n">Balance after</th></tr></thead>
              <tbody>{plan.rows.map((r, i) => <tr key={i} className={r.type}><td>{i + 1}</td><td>{fmtDate(r.date)}</td><td>{r.label}</td><td className="n">{inr(r.amount)}</td><td className="n">{inr(r.balance)}</td></tr>)}</tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

export { fullPrice };
