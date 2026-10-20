// Calculators for the public website of a workspace outside Pakistan (and the area converter for any region that lists it).
// Every default, band and fee comes from the region pack (see server/src/regions/packs/*.json), never from this file.
import { useMemo, useState } from 'react';
import { payment, schedule, totals, affordability } from '../../../shared/region/mortgage.js';
import { sdlt, dldFees, closingCosts, monthlyExtras } from '../../../shared/region/purchaseCosts.js';
import { MoneyBox, fullPrice, minorOf, curCode } from './siteCore.jsx';
import { getRegion } from '../format.js';

const num = (v) => (v === '' || v == null ? 0 : Number(v));
const cfg = () => getRegion().config;
const Estimate = ({ review }) => <p className="note">Estimate only. {review ? 'Rates and fees are starting values that have not yet been reviewed by a local professional. ' : ''}Your lender, solicitor or conveyancer will confirm the actual figures.</p>;
const Row = ({ label, value, strong }) => <div><dt>{label}</dt><dd>{strong ? <b>{value}</b> : value}</dd></div>;

/** Zillow-style: monthly payment with taxes, insurance, HOA and PMI where the region uses them, plus a yearly balance chart. */
export function MortgageCalculator({ initialPrice }) {
  const c = cfg();
  const m = c.calculators?.mortgage || {};
  const [price, setPrice] = useState(String(initialPrice ? Math.round(initialPrice / getRegion().price.unit) : 500000));
  const [downPct, setDownPct] = useState(String(m.default_down_pct ?? 20));
  const [downAmt, setDownAmt] = useState('');
  const [mode, setMode] = useState('pct');
  const [rate, setRate] = useState(String((m.default_rate_bp ?? 600) / 100));
  const [years, setYears] = useState(String(m.default_term ?? 25));
  const [kind, setKind] = useState('repayment');
  const [hoa, setHoa] = useState(String(Math.round((m.hoa_monthly || 0) / getRegion().price.unit)));
  const r = useMemo(() => {
    const P = minorOf(price);
    const down = mode === 'pct' ? Math.round((P * num(downPct)) / 100) : minorOf(downAmt);
    const principal = Math.max(0, P - down);
    const annual_bp = Math.round(num(rate) * 100), term_months = Math.round(num(years) * 12);
    if (!(principal > 0) || !(term_months > 0)) return null;
    const comp = c.mortgage_compounding || 'monthly';
    const interestOnly = kind === 'interest_only';
    const pay = interestOnly ? Math.round((principal * annual_bp) / 10000 / 12) : payment({ principal, annual_bp, term_months, compounding: comp });
    const rows = interestOnly ? [] : schedule({ principal, annual_bp, term_months, compounding: comp });
    const extras = monthlyExtras(P, down, { property_tax_bp: m.property_tax_bp || 0, insurance_annual: m.insurance_annual || 0, hoa_monthly: minorOf(hoa), pmi_bp: m.pmi_bp || 0 });
    const tot = interestOnly ? { interest: pay * term_months, paid: pay * term_months } : totals(rows);
    const byYear = [];
    for (let y = 0; y * 12 < rows.length; y += 1) { const slice = rows.slice(y * 12, y * 12 + 12); byYear.push({ y: y + 1, interest: slice.reduce((s, x) => s + x.interest, 0), principal: slice.reduce((s, x) => s + x.principal, 0), balance: slice.at(-1).balance }); }
    return { P, down, principal, pay, extras, total: pay + extras.property_tax + extras.insurance + extras.hoa + extras.pmi, tot, byYear, ltv: Math.round((principal / P) * 100) };
  }, [price, downPct, downAmt, mode, rate, years, kind, hoa, c.mortgage_compounding]); // eslint-disable-line react-hooks/exhaustive-deps
  const max = Math.max(1, ...(r?.byYear || []).map((b) => b.interest + b.principal));
  return (
    <div className="calc">
      <div className="calc-form">
        <label>Home price ({curCode()})<MoneyBox value={price} onChange={setPrice} /></label>
        <div className="two">
          <label>Deposit {mode === 'pct' ? '(%)' : `(${curCode()})`}
            {mode === 'pct' ? <input type="number" min="0" max="95" step="0.5" value={downPct} onChange={(e) => setDownPct(e.target.value)} /> : <MoneyBox value={downAmt} onChange={setDownAmt} />}</label>
          <label>Deposit as<div className="seg2"><button type="button" className={mode === 'pct' ? 'on' : ''} onClick={() => setMode('pct')}>%</button><button type="button" className={mode === 'amt' ? 'on' : ''} onClick={() => setMode('amt')}>{curCode()}</button></div></label>
        </div>
        <div className="two">
          <label>Interest rate (% a year)<input type="number" min="0" max="30" step="0.05" value={rate} onChange={(e) => setRate(e.target.value)} /></label>
          <label>Term (years)<select value={years} onChange={(e) => setYears(e.target.value)}>{[...new Set([...(m.terms || [25]), num(years)])].sort((a, b) => b - a).map((t) => <option key={t} value={t}>{t}</option>)}</select></label>
        </div>
        {m.repayment_types && <label>Mortgage type<div className="seg2">{m.repayment_types.map((k) => <button type="button" key={k} className={kind === k ? 'on' : ''} onClick={() => setKind(k)}>{k === 'repayment' ? 'Repayment' : 'Interest only'}</button>)}</div></label>}
        {m.property_tax_bp > 0 && <label>HOA / monthly fees ({curCode()})<MoneyBox value={hoa} onChange={setHoa} /></label>}
      </div>
      <div className="calc-result">
        {r ? (
          <>
            <div className="calc-big"><span>{m.property_tax_bp > 0 ? 'Estimated monthly payment' : 'Monthly payment'}</span><b>{fullPrice(r.total)}</b><small>Loan {fullPrice(r.principal)} · {r.ltv}% of the price · deposit {fullPrice(r.down)}</small></div>
            <dl>
              <Row label={kind === 'interest_only' ? 'Interest' : 'Principal and interest'} value={fullPrice(r.pay)} />
              {r.extras.property_tax > 0 && <Row label="Property tax" value={fullPrice(r.extras.property_tax)} />}
              {r.extras.insurance > 0 && <Row label="Home insurance" value={fullPrice(r.extras.insurance)} />}
              {r.extras.hoa > 0 && <Row label="HOA / fees" value={fullPrice(r.extras.hoa)} />}
              {r.extras.pmi > 0 && <Row label="Mortgage insurance (PMI)" value={fullPrice(r.extras.pmi)} />}
              <Row label="Total interest over the term" value={fullPrice(r.tot.interest)} />
              <Row label="Total paid" value={fullPrice(r.tot.paid)} strong />
            </dl>
            {r.byYear.length > 0 && (
              <svg viewBox={`0 0 ${r.byYear.length * 14 + 10} 80`} role="img" aria-label="Interest and principal paid each year" style={{ width: '100%', maxHeight: 120 }}>
                {r.byYear.map((b, i) => { const h1 = (b.principal / max) * 70, h2 = (b.interest / max) * 70; return <g key={b.y}><rect x={8 + i * 14} y={75 - h1} width="10" height={h1} fill="var(--s-primary,#0f766e)" /><rect x={8 + i * 14} y={75 - h1 - h2} width="10" height={h2} fill="var(--s-accent,#f59e0b)" /></g>; })}
              </svg>
            )}
            {r.byYear.length > 0 && <small className="money-words">Each bar is a year: <span style={{ color: 'var(--s-primary,#0f766e)' }}>principal</span> and <span style={{ color: 'var(--s-accent,#f59e0b)' }}>interest</span>.</small>}
            <Estimate />
          </>
        ) : <div className="plan-err">Enter a price and a deposit smaller than the price.</div>}
      </div>
    </div>
  );
}

/** UK Stamp Duty, Dubai DLD fees or US closing costs, chosen by the region pack. */
export function PurchaseCostCalculator({ initialPrice }) {
  const c = cfg();
  const kind = c.calculators?.purchase_costs;
  const [price, setPrice] = useState(String(initialPrice ? Math.round(initialPrice / getRegion().price.unit) : kind === 'dld' ? 2000000 : kind === 'sdlt' ? 400000 : 500000));
  const [buyer, setBuyer] = useState('standard');
  const [nonRes, setNonRes] = useState(false);
  const [loan, setLoan] = useState('');
  const [agent, setAgent] = useState(true);
  const [rate, setRate] = useState(String((c.fees?.closing_costs?.default_bp || 300) / 100));
  const P = minorOf(price);
  const res = useMemo(() => {
    if (kind === 'sdlt') return { sdlt: sdlt(P, c.fees.sdlt, { buyer, non_resident: nonRes }) };
    if (kind === 'dld') return { dld: dldFees(P, c.fees.dld, { loan: minorOf(loan), with_agent: agent }) };
    if (kind === 'closing_costs') return { cc: closingCosts(P, c.fees.closing_costs, Math.round(num(rate) * 100)) };
    return {};
  }, [P, buyer, nonRes, loan, agent, rate, kind]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!kind) return null;
  const review = c.fees?.[kind === 'closing_costs' ? 'closing_costs' : kind]?.needs_legal_review;
  return (
    <div className="calc">
      <div className="calc-form">
        <label>Purchase price ({curCode()})<MoneyBox value={price} onChange={setPrice} /></label>
        {kind === 'sdlt' && <>
          <label>Buyer<select value={buyer} onChange={(e) => setBuyer(e.target.value)}><option value="standard">Home mover</option><option value="first_time">First-time buyer</option><option value="additional">Additional property</option></select></label>
          <label className="chk"><input type="checkbox" checked={nonRes} onChange={(e) => setNonRes(e.target.checked)} /> Buyer is not UK resident</label>
          <small className="money-words">England and Northern Ireland rates ({c.fees.sdlt.effective_from} onwards). Scotland and Wales use different taxes.</small>
        </>}
        {kind === 'dld' && <>
          <label>Mortgage amount (optional, {curCode()})<MoneyBox value={loan} onChange={setLoan} /></label>
          <label className="chk"><input type="checkbox" checked={agent} onChange={(e) => setAgent(e.target.checked)} /> Include agent commission and VAT</label>
          <small className="money-words">Dubai Land Department fees. Other emirates differ.</small>
        </>}
        {kind === 'closing_costs' && <label>Closing costs (% of price)<input type="number" min="0" max="15" step="0.1" value={rate} onChange={(e) => setRate(e.target.value)} /></label>}
      </div>
      <div className="calc-result">
        {res.sdlt && <>
          <div className="calc-big"><span>Stamp Duty Land Tax</span><b>{fullPrice(res.sdlt.total)}</b><small>{(res.sdlt.effective_bp / 100).toFixed(2)}% of the price{res.sdlt.first_time_relief ? ' · first-time buyer relief applied' : ''}</small></div>
          <dl>{res.sdlt.lines.filter((l) => l.tax > 0).map((l) => <Row key={l.from} label={`${fullPrice(l.from)} to ${fullPrice(l.to)} at ${l.rate_bp / 100}%`} value={fullPrice(l.tax)} />)}
            {res.sdlt.surcharges.map((s) => <Row key={s.label} label={`${s.label} (${s.rate_bp / 100}%)`} value={fullPrice(s.tax)} />)}</dl>
        </>}
        {res.dld && <>
          <div className="calc-big"><span>Estimated purchase costs</span><b>{fullPrice(res.dld.total)}</b><small>{((res.dld.total / Math.max(1, P)) * 100).toFixed(2)}% of the price</small></div>
          <dl>{res.dld.rows.map((x) => <Row key={x.label} label={x.label} value={fullPrice(x.amount)} />)}</dl>
        </>}
        {res.cc && <>
          <div className="calc-big"><span>Estimated closing costs</span><b>{fullPrice(res.cc.total)}</b><small>Typical range {fullPrice(res.cc.low)} to {fullPrice(res.cc.high)}</small></div>
          <small className="money-words">{c.fees.closing_costs.note}</small>
        </>}
        <Estimate review={review} />
      </div>
    </div>
  );
}

export function AffordabilityCalculator() {
  const c = cfg();
  const m = c.calculators?.mortgage || {};
  const [f, setF] = useState({ income: '', debts: '', down: '', rate: String((m.default_rate_bp ?? 600) / 100), years: String(m.default_term ?? 25) });
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v?.target ? v.target.value : v }));
  const r = useMemo(() => (num(f.income) > 0 ? affordability({ gross_monthly_income: minorOf(f.income), monthly_debts: minorOf(f.debts), max_dti_bp: 4300, annual_bp: Math.round(num(f.rate) * 100), term_months: Math.round(num(f.years) * 12), compounding: c.mortgage_compounding || 'monthly', down: minorOf(f.down) }) : null), [f]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="calc">
      <div className="calc-form">
        <label>Monthly income before tax ({curCode()})<MoneyBox value={f.income} onChange={set('income')} /></label>
        <label>Monthly debt payments ({curCode()})<MoneyBox value={f.debts} onChange={set('debts')} /></label>
        <label>Deposit you have ({curCode()})<MoneyBox value={f.down} onChange={set('down')} /></label>
        <div className="two"><label>Interest rate (% a year)<input type="number" step="0.05" value={f.rate} onChange={set('rate')} /></label><label>Term (years)<input type="number" min="1" max="40" value={f.years} onChange={set('years')} /></label></div>
      </div>
      <div className="calc-result">
        {r ? <>
          <div className="calc-big"><span>You might afford a home around</span><b>{fullPrice(r.max_price)}</b><small>Loan up to {fullPrice(r.max_loan)} · payment up to {fullPrice(r.max_payment)} a month (43% of income including debts)</small></div>
        </> : <div className="plan-err">Enter your monthly income.</div>}
        <Estimate />
      </div>
    </div>
  );
}

/** Area converter between the units the region lists (e.g. sq ft and sq m, or Marla, Kanal, sq ft, sq yd in Pakistan). */
export function UnitConverter() {
  const c = cfg();
  const allowed = c.area?.allowed || ['sqft', 'sqm'];
  const labels = c.area?.labels || {};
  const [v, setV] = useState('1000');
  const [from, setFrom] = useState(allowed[0]);
  const units = getRegion().units;
  return (
    <div className="calc">
      <div className="calc-form">
        <div className="two"><label>Area<input type="number" min="0" value={v} onChange={(e) => setV(e.target.value)} /></label>
          <label>From<select value={from} onChange={(e) => setFrom(e.target.value)}>{allowed.map((u) => <option key={u} value={u}>{labels[u] || u}</option>)}</select></label></div>
      </div>
      <div className="calc-result"><dl>{allowed.filter((u) => u !== from).map((u) => <Row key={u} label={labels[u] || u} value={units.round(units.convertArea(num(v), from, u), 2).toLocaleString(c.locale)} />)}</dl></div>
    </div>
  );
}
