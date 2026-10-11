import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, Empty, Field, Loading, Modal, PageHead, ProgressBar, StatusBadge } from '../components/ui.jsx';
import { api } from '../api.js';
import { useAuth, useFetch, useToast } from '../context.jsx';
import { dateTime } from '../format.js';

const price = (p, currency, interval) => {
  const cur = p.price[currency] ? currency : 'USD';
  return new Intl.NumberFormat('en', { style: 'currency', currency: cur, maximumFractionDigits: 0 }).format(p.price[cur][interval]);
};

/** Slim bar above every page while the workspace is on trial, past due or read-only. Renders nothing when all is well. */
export function BillingBanner() {
  const { can } = useAuth();
  const { data } = useFetch('/api/billing/status');
  if (!data) return null;
  const manage = can('settings', 'view') ? <> <Link to="/settings/billing"><b>Choose a plan</b></Link></> : ' Ask an admin to choose a plan.';
  if (data.locked) return <div className="alert err no-print" role="alert" style={{ margin: '0 0 12px' }}>{data.message}{manage}</div>;
  if (data.status === 'past_due') return <div className="alert warn no-print" role="alert" style={{ margin: '0 0 12px' }}>Your last payment failed. Update it by {data.grace_until} to keep editing.{manage}</div>;
  if (data.status === 'canceled') return <div className="alert warn no-print" style={{ margin: '0 0 12px' }}>Your subscription is cancelled and ends on {data.period_end}.{manage}</div>;
  if (data.status === 'trialing' && data.days_left != null && data.days_left <= 7) return <div className="alert info no-print" style={{ margin: '0 0 12px' }}>Your free trial ends in {data.days_left} day{data.days_left === 1 ? '' : 's'}.{manage}</div>;
  return null;
}

/** Shown to a signed-in user whose email address is not confirmed yet. */
export function VerifyBanner() {
  const { user } = useAuth();
  const toast = useToast();
  const [sent, setSent] = useState(false);
  if (!user || user.portal || user.email_verified !== false) return null;
  const resend = async () => { try { await api.post('/api/auth/resend-verification'); setSent(true); } catch (e) { toast(e.message, 'err'); } };
  return <div className="alert info no-print" role="status" style={{ margin: '0 0 12px' }}>Please confirm your email address with the link we sent to {user.email}. {sent ? 'Sent again, check your inbox.' : <button className="btn sm" onClick={resend}>Resend the email</button>}</div>;
}

export default function Billing() {
  const { can } = useAuth();
  const toast = useToast();
  const { data, reload } = useFetch('/api/billing');
  const [interval, setInterval] = useState('month');
  const [busy, setBusy] = useState('');
  const [manual, setManual] = useState(null);
  const [paying, setPaying] = useState(null);
  if (!data) return <Loading />;
  // no online or local method configured: ask the server for its instructions (contact us / bank transfer)
  const choose = async (plan) => {
    if (data.methods?.length) return setPaying({ plan, method: data.methods[0].id, reference: '', note: '' });
    setBusy(plan);
    try { const out = await api.post('/api/billing/checkout', { plan, interval }); if (out.mode === 'redirect') window.location.assign(out.url); else setManual({ plan, text: out.instructions }); }
    catch (e) { toast(e.message, 'err'); } finally { setBusy(''); }
  };
  const pay = async () => {
    const m = data.methods.find((x) => x.id === paying.method);
    setBusy('pay');
    try {
      if (m.kind === 'online') { const out = await api.post('/api/billing/checkout', { plan: paying.plan, interval }); window.location.assign(out.url); return; }
      await api.post('/api/billing/manual-payment', { plan: paying.plan, interval, method: paying.method, reference: paying.reference, note: paying.note });
      setPaying(null); reload(); toast('Payment submitted. We will confirm it shortly.', 'ok');
    } catch (e) { toast(e.message, 'err'); } finally { setBusy(''); }
  };
  const openPortal = async () => { try { const out = await api.post('/api/billing/portal'); window.location.assign(out.url); } catch (e) { toast(e.message, 'err'); } };
  const lim = data.limits;
  const seatsUsed = data.usage.seats + data.usage.invited;
  const label = data.status === 'trialing' ? (data.locked ? 'Trial ended' : `Free trial · ${data.days_left} day${data.days_left === 1 ? '' : 's'} left`) : lim.name;
  const bar = (used, max) => (max == null ? null : <ProgressBar value={Math.round((used / max) * 100)} tone={used >= max ? 'red' : used / max > 0.8 ? 'amber' : 'green'} />);
  return (
    <div>
      <PageHead title="Plan & billing" sub="Your plan, usage and invoices" />
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))', marginBottom: 16 }}>
        <Card title="Current plan">
          <div className="stack">
            <div className="row between"><b style={{ fontSize: 18 }}>{label}</b><StatusBadge status={data.locked ? 'inactive' : data.status === 'past_due' ? 'pending' : 'active'} /></div>
            {data.period_end && <div className="muted">{data.status === 'canceled' ? 'Access until' : 'Renews'} {data.period_end}</div>}
            {data.status === 'past_due' && <div className="muted">Pay by {data.grace_until} to keep editing.</div>}
            {data.plan === 'legacy' && <div className="muted">This workspace is not metered.</div>}
            {data.card_portal && can('settings', 'edit') && <button className="btn sm" onClick={openPortal}>Manage card, plan or cancel</button>}
            {data.payments?.filter((p) => p.status === 'pending').map((p) => <div key={p.id} className="alert info">Payment of PKR {p.amount.toLocaleString('en-PK')} by {data.methods.find((m) => m.id === p.method)?.label || p.method} is waiting for confirmation (ref {p.reference}).</div>)}
          </div>
        </Card>
        <Card title="Usage">
          <div className="stack">
            <div><div className="row between"><span>Team members</span><span className="muted">{seatsUsed}{lim.seats != null ? ` of ${lim.seats}` : ''}{data.usage.invited ? ` (${data.usage.invited} invited)` : ''}</span></div>{bar(seatsUsed, lim.seats)}</div>
            <div><div className="row between"><span>Projects</span><span className="muted">{data.usage.projects}{lim.projects != null ? ` of ${lim.projects}` : ' · unlimited'}</span></div>{bar(data.usage.projects, lim.projects)}</div>
          </div>
        </Card>
      </div>
      {data.plan !== 'legacy' && (
        <Card title="Choose a plan" actions={<div className="row" style={{ gap: 6 }}>{['month', 'year'].map((i) => <button key={i} className={`btn sm ${interval === i ? 'primary' : ''}`} onClick={() => setInterval(i)}>{i === 'month' ? 'Monthly' : 'Yearly (2 months free)'}</button>)}</div>}>
          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))' }}>
            {data.plans.map((p) => {
              const current = data.plan === p.id && data.status === 'active';
              return (
                <div key={p.id} className="card" style={{ padding: 16, border: current ? '2px solid var(--primary)' : undefined }}>
                  <b style={{ fontSize: 16 }}>{p.name}</b>
                  <div style={{ fontSize: 26, fontWeight: 700, margin: '8px 0' }}>{price(p, data.currency, interval)}<small className="muted" style={{ fontSize: 13, fontWeight: 400 }}> / {interval === 'month' ? 'mo' : 'yr'}</small></div>
                  <ul className="muted" style={{ paddingLeft: 18, margin: '0 0 12px' }}><li>{p.seats == null ? 'Unlimited' : `Up to ${p.seats}`} team members</li><li>{p.projects == null ? 'Unlimited' : `Up to ${p.projects}`} projects</li><li>CRM, sales, accounting, HR, portals, website</li></ul>
                  {can('settings', 'edit') ? <button className="btn primary" style={{ width: '100%' }} disabled={current || busy === p.id} onClick={() => choose(p.id)}>{current ? 'Current plan' : busy === p.id ? 'Opening…' : data.status === 'active' ? 'Switch to this plan' : 'Choose plan'}</button> : <div className="muted">Ask an admin to change plan.</div>}
                </div>
              );
            })}
          </div>
        </Card>
      )}
      {data.invoices?.length > 0 && (
        <Card title="Invoices" flush style={{ marginTop: 16 }}>
          <table className="t"><thead><tr><th>Date</th><th>Amount</th><th>Status</th><th /></tr></thead>
            <tbody>{data.invoices.map((i) => <tr key={i.id}><td>{dateTime(i.created_at)}</td><td>{new Intl.NumberFormat('en', { style: 'currency', currency: i.currency, maximumFractionDigits: 0 }).format(i.amount)}</td><td><StatusBadge status={i.status === 'paid' ? 'active' : 'pending'} /></td><td className="right">{i.hosted_url && <a className="btn sm" href={i.hosted_url} target="_blank" rel="noreferrer">View</a>}</td></tr>)}</tbody></table>
        </Card>
      )}
      {!data.invoices?.length && data.plan !== 'legacy' && <Empty title="No invoices yet" />}
      {paying && (() => {
        const p = data.plans.find((x) => x.id === paying.plan);
        const m = data.methods.find((x) => x.id === paying.method);
        return (
          <Modal title={`Pay for ${p.name}`} size="sm" onClose={() => setPaying(null)}
            footer={<><button className="btn" onClick={() => setPaying(null)}>Cancel</button><button className="btn primary" disabled={busy === 'pay' || (m.kind === 'transfer' && paying.reference.trim().length < 6)} onClick={pay}>{busy === 'pay' ? 'Please wait…' : m.kind === 'online' ? 'Continue to payment' : 'I have paid'}</button></>}>
            <div className="stack">
              <Field label="Payment method"><select className="input" value={paying.method} onChange={(e) => setPaying({ ...paying, method: e.target.value })}>{data.methods.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}</select></Field>
              {m.kind === 'online' ? <div className="muted">You will pay {price(p, data.currency, interval)} per {interval} on a secure card page.</div> : (
                <>
                  <div className="alert info">Send <b>{price(p, 'PKR', interval)}</b> by {m.label} to <b>{m.account}</b>{m.account_name ? ` (${m.account_name})` : ''}{m.note ? `. ${m.note}` : ''}. Then enter the transaction ID from your receipt.</div>
                  <Field label="Transaction ID / reference" required><input className="input" value={paying.reference} onChange={(e) => setPaying({ ...paying, reference: e.target.value })} autoFocus /></Field>
                  <Field label="Note (optional)"><input className="input" value={paying.note} onChange={(e) => setPaying({ ...paying, note: e.target.value })} /></Field>
                </>
              )}
            </div>
          </Modal>
        );
      })()}
      {manual && <Modal title="Activate your plan" size="sm" onClose={() => setManual(null)} footer={<button className="btn primary" onClick={() => setManual(null)}>Close</button>}><p>{manual.text}</p></Modal>}
    </div>
  );
}
