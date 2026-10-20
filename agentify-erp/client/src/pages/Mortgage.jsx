// Mortgage / financing: payment calculator, affordability estimate and the applications pipeline.
// Shown only where the region (or workspace) has the "mortgage" switch on. Figures are estimates, not lending advice.
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, CurrencyInput, Empty, ErrorBox, Field, Loading, PageHead, StatusBadge } from '../components/ui.jsx';
import { api } from '../api.js';
import { useToast } from '../context.jsx';
import { money, titleCase } from '../format.js';

const STAGES = ['enquiry', 'pre_qualified', 'documents', 'submitted', 'approved', 'funded', 'declined', 'withdrawn'];
const NEXT = { enquiry: ['pre_qualified'], pre_qualified: ['documents', 'declined'], documents: ['submitted'], submitted: ['approved', 'declined'], approved: ['funded'], funded: [], declined: ['enquiry'], withdrawn: ['enquiry'] };
const bp = (pct) => Math.round(Number(pct || 0) * 100);

function Calculator() {
  const toast = useToast();
  const [f, setF] = useState({ principal: '', rate: '6.5', years: '30', income: '', debts: '' });
  const [out, setOut] = useState(null);
  const [aff, setAff] = useState(null);
  const run = async () => {
    try {
      const body = { principal: f.principal, rate_bp: bp(f.rate), term_months: Number(f.years) * 12 };
      setOut(await api.post('/api/mortgage/calc', body));
    } catch (e) { toast(e.message, 'err'); }
  };
  const afford = async () => {
    try { setAff(await api.post('/api/mortgage/affordability', { gross_monthly_income: f.income, monthly_debts: f.debts || 0, rate_bp: bp(f.rate), term_months: Number(f.years) * 12 })); } catch (e) { toast(e.message, 'err'); }
  };
  return (
    <Card title="Payment calculator">
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 12 }}>
        <Field label="Loan amount"><CurrencyInput value={f.principal} onChange={(v) => setF({ ...f, principal: v })} /></Field>
        <Field label="Interest rate (% a year)"><input className="input" value={f.rate} onChange={(e) => setF({ ...f, rate: e.target.value })} /></Field>
        <Field label="Term (years)"><input className="input" value={f.years} onChange={(e) => setF({ ...f, years: e.target.value })} /></Field>
        <Field label="Monthly income (before tax)"><CurrencyInput value={f.income} onChange={(v) => setF({ ...f, income: v })} /></Field>
        <Field label="Monthly debts"><CurrencyInput value={f.debts} onChange={(v) => setF({ ...f, debts: v })} /></Field>
      </div>
      <div className="row" style={{ marginTop: 8 }}>
        <button className="btn primary" disabled={!f.principal} onClick={run}>Calculate payment</button>
        <button className="btn" disabled={!f.income} onClick={afford}>Estimate what they can afford</button>
      </div>
      {out && <div className="alert info" style={{ marginTop: 12 }}>Monthly payment <b>{money(out.payment)}</b> · total interest <b>{money(out.totals.interest)}</b> · total paid <b>{money(out.totals.paid)}</b></div>}
      {aff && <div className="alert info" style={{ marginTop: 12 }}>Up to <b>{money(aff.max_payment)}</b> a month → a loan of about <b>{money(aff.max_loan)}</b>. An estimate for discussion only; a lender decides.</div>}
    </Card>
  );
}

export default function Mortgage() {
  const toast = useToast();
  const [apps, setApps] = useState(null);
  const [err, setErr] = useState('');
  const load = useCallback(() => api.get('/api/mortgage/applications').then(setApps).catch((e) => setErr(e.message)), []);
  useEffect(() => { load(); }, [load]);
  const move = async (a, stage) => { try { await api.post(`/api/mortgage/applications/${a.id}/stage`, { stage }); load(); } catch (e) { toast(e.message, 'err'); } };
  return (
    <>
      <PageHead title="Mortgage & financing" sub="Help buyers finance a purchase: estimate payments, track each application and any referral fee." />
      <ErrorBox error={err} />
      <Calculator />
      <Card title="Applications" flush>
        {!apps ? (!err && <Loading />) : !apps.length ? <Empty title="No applications yet" hint="Start one from a customer's page." /> : (
          <div className="table-wrap"><table className="t"><thead><tr><th>Customer</th><th>Lender</th><th className="num">Loan</th><th className="num">Monthly</th><th>Stage</th><th>Referral fee</th><th /></tr></thead><tbody>
            {apps.map((a) => (
              <tr key={a.id}>
                <td><Link to={`/contacts/${a.contact_id}`}>{a.full_name}</Link></td><td>{a.lender_name || '—'}</td>
                <td className="num">{money(a.amount)}</td><td className="num">{money(a.payment)}</td>
                <td><StatusBadge status={a.stage === 'funded' || a.stage === 'approved' ? 'active' : a.stage === 'declined' || a.stage === 'withdrawn' ? 'inactive' : 'pending'} label={titleCase(a.stage)} /></td>
                <td>{a.referral_fee_status === 'none' ? '—' : titleCase(a.referral_fee_status)}</td>
                <td className="right nowrap">{(NEXT[a.stage] || []).filter((s) => STAGES.includes(s)).map((s) => <button key={s} className="btn sm" onClick={() => move(a, s)}>{titleCase(s)}</button>)}</td>
              </tr>))}
          </tbody></table></div>)}
      </Card>
    </>
  );
}
