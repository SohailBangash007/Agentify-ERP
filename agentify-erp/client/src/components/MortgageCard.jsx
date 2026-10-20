// "Financing" card on a customer's page: their mortgage applications and a button to start one. Shown only where the
// region has the mortgage module on.
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, CurrencyInput, Field, Modal } from './ui.jsx';
import { api } from '../api.js';
import { useToast } from '../context.jsx';
import { money, titleCase, getRegion } from '../format.js';

const blank = () => ({ price: '', down_payment: '', lender_id: '', term_years: String(getRegion().config.calculators?.mortgage?.default_term || 25), rate: String((getRegion().config.calculators?.mortgage?.default_rate_bp || 600) / 100), fee: '', disclosed: false });

export default function MortgageCard({ contactId }) {
  const toast = useToast();
  const on = !!getRegion().config.flags?.mortgage;
  const [apps, setApps] = useState(null);
  const [lenders, setLenders] = useState([]);
  const [f, setF] = useState(null);
  const load = useCallback(() => api.get('/api/mortgage/applications').then((all) => setApps(all.filter((a) => a.contact_id === Number(contactId)))).catch(() => setApps([])), [contactId]);
  useEffect(() => { if (on) { load(); api.get('/api/mortgage/lenders').then(setLenders).catch(() => {}); } }, [on, load]);
  if (!on || apps === null) return null;
  const save = async () => {
    try {
      await api.post('/api/mortgage/applications', {
        contact_id: Number(contactId), price: f.price, down_payment: f.down_payment || 0, lender_id: f.lender_id || null, term_months: Math.round(Number(f.term_years) * 12), rate_bp: Math.round(Number(f.rate) * 100),
        ...(f.fee ? { referral_fee_type: 'flat', referral_fee_value: f.fee, referral_fee_disclosed: f.disclosed } : {}),
      });
      toast('Application started'); setF(null); load();
    } catch (e) { toast(e.message, 'err'); }
  };
  return (
    <Card title="Financing" actions={<button className="btn primary sm" onClick={() => setF(blank())}>Start mortgage application</button>}>
      {!apps.length ? <div className="muted">No mortgage applications for this customer yet.</div> : (
        <div className="stack">{apps.map((a) => <div key={a.id} className="row"><b>{money(a.amount)}</b><span className="muted">{a.lender_name || 'No lender yet'} · {money(a.payment)} / month · {titleCase(a.stage)}</span></div>)}
          <Link to="/mortgage">Open the financing pipeline →</Link></div>)}
      {f && (
        <Modal title="Start mortgage application" onClose={() => setF(null)} footer={<><button className="btn" onClick={() => setF(null)}>Cancel</button><button className="btn primary" disabled={!f.price || (f.fee && !f.disclosed)} onClick={save}>Start</button></>}>
          <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="Purchase price" required><CurrencyInput value={f.price} onChange={(v) => setF({ ...f, price: v })} /></Field>
            <Field label="Deposit"><CurrencyInput value={f.down_payment} onChange={(v) => setF({ ...f, down_payment: v })} /></Field>
            <Field label="Interest rate (% a year)"><input className="input" value={f.rate} onChange={(e) => setF({ ...f, rate: e.target.value })} /></Field>
            <Field label="Term (years)"><input className="input" value={f.term_years} onChange={(e) => setF({ ...f, term_years: e.target.value })} /></Field>
          </div>
          <Field label="Lender or broker"><select className="input" value={f.lender_id} onChange={(e) => setF({ ...f, lender_id: e.target.value })}><option value="">Not chosen yet</option>{lenders.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></Field>
          <Field label="Referral fee (optional)" hint="Only record a fee you have disclosed to the customer."><CurrencyInput value={f.fee} onChange={(v) => setF({ ...f, fee: v })} /></Field>
          {f.fee ? <label className="check"><input type="checkbox" checked={f.disclosed} onChange={(e) => setF({ ...f, disclosed: e.target.checked })} /> I have disclosed this referral fee to the customer</label> : null}
        </Modal>)}
    </Card>
  );
}
