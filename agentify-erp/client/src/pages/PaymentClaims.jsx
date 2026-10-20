import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, ConfirmDialog, Empty, Field, Loading, Modal, PageHead, StatusBadge, Tabs, Toggle } from '../components/ui.jsx';
import { api } from '../api.js';
import { useAuth, useFetch, useLookups, useToast } from '../context.jsx';
import { date, money, cur } from '../format.js';

const TONE = { pending: 'blue', verifying: 'purple', approved: 'green', rejected: 'red' };
const LABEL = { pending: 'In process', verifying: 'Under verification', approved: 'Paid', rejected: 'Declined' };
const CHANNELS = ['Bank portal', 'Easypaisa account', 'JazzCash account', 'Other wallet', 'Cash received', 'Bank statement', 'Other'];
const today = () => new Date().toLocaleDateString('en-CA');

/** Customers' payment reports: In process → Under verification → Paid (receipt issued), with manual or automatic confirmation. */
export default function PaymentClaims() {
  const { can } = useAuth();
  const toast = useToast();
  const nav = useNavigate();
  const { treasury } = useLookups();
  const [status, setStatus] = useState('open');
  const { data, loading, reload } = useFetch('/api/payment-claims', { status: status || undefined }, [status]);
  const [approve, setApprove] = useState(null);
  const [f, setF] = useState({});
  const [reject, setReject] = useState(null);
  const [bulk, setBulk] = useState(false);
  const [importing, setImporting] = useState(false);
  const [sync, setSync] = useState(false);
  const canAct = can('payments', 'create');
  const guess = (c) => treasury.find((a) => (c.method === 'Cash' ? a.subtype === 'cash' : ['Cheque', 'Bank Transfer'].includes(c.method) ? a.subtype === 'bank' : ['online', 'bank'].includes(a.subtype)))?.id || '';
  if (loading && !data) return <Loading />;
  const rows = data?.rows || [];
  const matched = rows.filter((c) => c.auto_matched && ['pending', 'verifying'].includes(c.status));
  const open = (c) => { setApprove(c); setF({ account_id: String(guess(c)), verified_channel: c.feed_channel ? `Bank statement` : (c.method === 'Easypaisa' ? 'Easypaisa account' : c.method === 'JazzCash' ? 'JazzCash account' : 'Bank portal'), verified_ref: c.txn_id || '', amount: String(c.amount), received_date: c.feed_date || c.paid_date || today(), verified_note: '' }); };
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const issue = async () => {
    try { const r = await api.post(`/api/payment-claims/${approve.id}/approve`, { ...f, account_id: Number(f.account_id), amount: Number(f.amount) }); toast('Marked paid — receipt issued and the customer was notified', 'ok'); setApprove(null); nav(`/receipts/${r.receipt_id}`); } catch (e) { toast(e.message, 'err'); }
  };
  const verifying = async (c) => { try { await api.post(`/api/payment-claims/${c.id}/verifying`); toast('Customer sees “Under verification”', 'ok'); reload(); } catch (e) { toast(e.message, 'err'); } };

  return (
    <div className="stack">
      <PageHead title="Customer payment reports" sub="Payments customers report from the portal. Check the proof (usually sent on WhatsApp) against the bank or wallet, then mark it paid — the receipt is issued and the portal updates.">
        {canAct && <button className="btn" onClick={() => setImporting(true)}>Import bank / wallet statement</button>}
        {can('payments', 'approve') && <button className="btn" onClick={() => setSync(true)}>Auto-sync settings</button>}
      </PageHead>
      {matched.length > 0 && canAct && <div className="alert ok row between wrap" style={{ gap: 8 }}><span><b>{matched.length}</b> report{matched.length > 1 ? 's were' : ' was'} matched to a bank / wallet transaction (same ID and amount).</span><button className="btn sm primary" onClick={() => setBulk(true)}>Confirm all matched</button></div>}
      <Tabs value={status} onChange={setStatus} tabs={[{ key: 'open', label: 'Open', count: data?.open }, { key: 'approved', label: 'Paid' }, { key: 'rejected', label: 'Declined' }, { key: '', label: 'All' }]} />
      <Card flush>
        {!rows.length ? <Empty icon="check" title={status === 'open' ? 'Nothing waiting' : 'Nothing here'} hint="When a customer reports a payment from the portal it appears here." /> : (
          <table className="t"><thead><tr><th>Reference</th><th>Customer</th><th>Plan</th><th>Payment &amp; proof</th><th className="num">Amount</th><th>Status</th><th /></tr></thead>
            <tbody>{rows.map((c) => (
              <tr key={c.id}>
                <td className="nowrap"><b>{c.ref}</b><div className="cell-sub">{date(c.created_at)} · paid {date(c.paid_date)}</div></td>
                <td><b>{c.customer}</b><div className="cell-sub">{c.customer_code} · {c.phone}</div></td>
                <td>{c.property}<div className="cell-sub">{c.sale_no}{c.dues ? ` · ${c.dues}` : ''}</div></td>
                <td>{c.method}<div className="cell-sub">{[c.txn_id, c.bank, c.cheque_no].filter(Boolean).join(' · ')}</div>{c.note && <div className="cell-sub">“{c.note}”</div>}
                  <div className="row wrap" style={{ gap: 6, marginTop: 4 }}>
                    {c.has_slip && <a className="pill grey" href={`/api/payment-claims/${c.id}/slip`} target="_blank" rel="noreferrer">Slip</a>}
                    {c.proof_sent_at && <span className="pill green" title={c.proof_sent_at}>Proof sent on WhatsApp</span>}
                    {c.auto_matched ? <span className="pill purple" title={`${c.feed_channel || ''} ${c.feed_date || ''}`}>Matched in bank / wallet feed</span> : null}
                  </div></td>
                <td className="num mono">{money(c.amount)}{c.received_amount && c.received_amount !== c.amount ? <div className="cell-sub">received {money(c.received_amount)}</div> : null}</td>
                <td><StatusBadge status={c.status} tone={TONE[c.status]} label={LABEL[c.status]} />{c.receipt_no && <div className="cell-sub">{c.receipt_no}</div>}
                  {c.verified_channel && <div className="cell-sub">{c.auto_synced ? 'Auto-synced · ' : ''}verified on {c.verified_channel}{c.verified_ref ? ` (${c.verified_ref})` : ''}</div>}{c.reject_reason && <div className="cell-sub">{c.reject_reason}</div>}</td>
                <td className="right"><div className="row" style={{ gap: 4, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                  {c.status === 'pending' && canAct && <button className="btn sm" onClick={() => verifying(c)} title="You have the proof and are checking it">Under verification</button>}
                  {['pending', 'verifying'].includes(c.status) && canAct && <button className="btn sm primary" onClick={() => open(c)}>Mark paid</button>}
                  {['pending', 'verifying'].includes(c.status) && canAct && <button className="btn sm ghost danger" onClick={() => setReject(c)}>Decline</button>}
                  {c.receipt_id && <button className="btn sm" onClick={() => nav(`/receipts/${c.receipt_id}`)}>Receipt</button>}</div></td>
              </tr>))}</tbody></table>
        )}
      </Card>

      {approve && (
        <Modal title={`Mark paid · ${approve.ref}`} size="lg" onClose={() => setApprove(null)} footer={<><button className="btn" onClick={() => setApprove(null)}>Cancel</button><button className="btn primary" disabled={!f.account_id || !f.verified_channel || !(Number(f.amount) > 0)} onClick={issue}>Issue receipt &amp; mark paid</button></>}>
          <div className="stack">
            <div><b>{approve.customer}</b> reports <b>{money(approve.amount)}</b> by {approve.method}{approve.txn_id ? ` (${approve.txn_id})` : ''} for {approve.property}{approve.dues ? ` — ${approve.dues}` : ''}.</div>
            {approve.auto_matched ? <div className="alert ok">This report matches a transaction in the bank / wallet feed ({approve.feed_channel}).</div> : <div className="muted">Confirm on the bank portal or the Easypaisa / JazzCash account first, then record the details below.</div>}
            <div className="form-grid">
              <Field label="Verified on" required><select className="input" value={f.verified_channel} onChange={set('verified_channel')}>{CHANNELS.map((c) => <option key={c}>{c}</option>)}</select></Field>
              <Field label="Bank / wallet reference seen"><input className="input" value={f.verified_ref} onChange={set('verified_ref')} placeholder="transaction ID in your statement" /></Field>
              <Field label={`Amount received (${cur()})`} required hint={Number(f.amount) !== approve.amount ? `The customer reported ${money(approve.amount)}` : ''}><input className="input" type="number" min="1" value={f.amount} onChange={set('amount')} /></Field>
              <Field label="Date received" required><input className="input" type="date" max={today()} value={f.received_date} onChange={set('received_date')} /></Field>
              <Field label="Deposited to" required className="full"><select className="input" value={f.account_id} onChange={set('account_id')}><option value="">Select account…</option>{treasury.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></Field>
              <Field label="Note (optional)" className="full"><input className="input" value={f.verified_note} onChange={set('verified_note')} /></Field>
            </div>
            <div className="muted" style={{ fontSize: 12.5 }}>The receipt is allocated to the plan’s installments automatically; the customer’s portal shows it as Paid and they are notified.</div>
          </div>
        </Modal>
      )}
      {reject && <ConfirmDialog danger reason title="Decline this report?" message={`Tell ${reject.customer} why the ${money(reject.amount)} payment could not be confirmed.`} confirmLabel="Decline" onCancel={() => setReject(null)}
        onConfirm={async (reason) => { try { await api.post(`/api/payment-claims/${reject.id}/reject`, { reason }); toast('Sent back to the customer', 'ok'); setReject(null); reload(); } catch (e) { toast(e.message, 'err'); } }} />}
      {bulk && <BulkModal ids={matched.map((c) => c.id)} treasury={treasury} onClose={() => setBulk(false)} onDone={() => { setBulk(false); reload(); }} />}
      {importing && <ImportModal onClose={() => setImporting(false)} onDone={() => { setImporting(false); reload(); }} />}
      {sync && <SyncModal onClose={() => setSync(false)} />}
    </div>
  );
}

function BulkModal({ ids, treasury, onClose, onDone }) {
  const toast = useToast();
  const [acc, setAcc] = useState(treasury.find((a) => a.subtype === 'bank')?.id || '');
  return (
    <Modal title={`Confirm ${ids.length} matched payment${ids.length > 1 ? 's' : ''}`} size="sm" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!acc} onClick={async () => { try { const r = await api.post('/api/payment-claims/bulk-approve', { ids, account_id: Number(acc), verified_channel: 'Bank statement' }); toast(`${r.approved} receipt(s) issued${r.failed.length ? `, ${r.failed.length} need attention` : ''}`, r.failed.length ? 'err' : 'ok'); onDone(); } catch (e) { toast(e.message, 'err'); } }}>Issue receipts</button></>}>
      <div className="stack"><div>Each matched report becomes a receipt for the amount in the bank / wallet record.</div>
        <Field label="Deposited to" required><select className="input" value={acc} onChange={(e) => setAcc(e.target.value)}><option value="">Select account…</option>{treasury.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></Field></div>
    </Modal>
  );
}

function ImportModal({ onClose, onDone }) {
  const toast = useToast();
  const [csv, setCsv] = useState('');
  const [channel, setChannel] = useState('Bank statement');
  const [res, setRes] = useState(null);
  const [busy, setBusy] = useState(false);
  const run = async () => { setBusy(true); try { setRes(await api.post('/api/payment-claims/statement', { csv, channel })); } catch (e) { toast(e.message, 'err'); } setBusy(false); };
  return (
    <Modal title="Import bank / wallet statement" size="lg" onClose={res ? onDone : onClose} footer={res ? <button className="btn primary" onClick={onDone}>Done</button> : <><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy || !csv.trim()} onClick={run}>{busy ? 'Matching…' : 'Import & match'}</button></>}>
      {res ? (
        <div className="stack">
          <div className="grid g4"><div className="card stat"><span className="label">New transactions</span><span className="value">{res.new}</span></div><div className="card stat"><span className="label">Matched to reports</span><span className="value">{res.matched.length}</span></div><div className="card stat"><span className="label">Already imported</span><span className="value">{res.duplicate}</span></div><div className="card stat"><span className="label">No report found</span><span className="value">{res.unmatched}</span></div></div>
          <p className="muted" style={{ margin: 0 }}>{res.matched.length ? 'Matched reports are marked on the list — review them and use “Confirm all matched”.' : 'Nothing matched yet. Reports are matched by transaction ID and amount, also when a customer reports a payment later.'}</p>
        </div>
      ) : (
        <div className="stack">
          <p className="muted" style={{ margin: 0 }}>Paste the rows from your bank or Easypaisa / JazzCash statement (CSV or copied from Excel) including the header row. Credits are matched to customer reports by <b>transaction ID + amount</b>; debits are ignored.</p>
          <Field label="Channel"><input className="input" value={channel} onChange={(e) => setChannel(e.target.value)} /></Field>
          <Field label="Statement file (optional)"><input type="file" accept=".csv,.txt,.tsv" onChange={async (e) => { const t = await e.target.files?.[0]?.text(); if (t) setCsv(t); }} /></Field>
          <Field label="Statement rows" hint="Header like: Date, Description, Debit, Credit, Reference No"><textarea className="textarea" rows={9} value={csv} onChange={(e) => setCsv(e.target.value)} placeholder={'Date,Description,Debit,Credit,Reference No\n10/10/2026,IBFT from Ali,,25000,HBL-77123'} /></Field>
        </div>
      )}
    </Modal>
  );
}

function SyncModal({ onClose }) {
  const toast = useToast();
  const { data, reload } = useFetch('/api/payment-claims/sync-settings');
  const [confirmKey, setConfirmKey] = useState(false);
  if (!data) return null;
  const copy = (t) => { navigator.clipboard?.writeText(t); toast('Copied', 'ok'); };
  const curl = `curl -X POST ${data.webhook} \\\n  -H "Content-Type: application/json" -H "X-Feed-Key: ${data.feed_key}" \\\n  -d '{"channel":"Easypaisa","txn_id":"EP123456","amount":25000,"date":"2026-10-10","sender":"0300 1234567"}'`;
  return (
    <Modal title="Auto-sync with bank / wallet" size="lg" onClose={onClose} footer={<button className="btn primary" onClick={onClose}>Close</button>}>
      <div className="stack">
        <p className="muted" style={{ margin: 0 }}>Any system that can send a web request (a bank or wallet alert forwarder, an SMS-forwarding app, a statement script) can post incoming transactions here. They are matched to customer reports by transaction ID and amount.</p>
        <div className="row between"><div><b>Confirm matched payments automatically</b><div className="muted" style={{ fontSize: 12.5 }}>When on, a matching transaction issues the receipt by itself (to the default bank / wallet account) and the customer sees Paid. When off, finance is notified and confirms with one click.</div></div>
          <Toggle value={data.auto_approve} onChange={async (v) => { await api.put('/api/payment-claims/sync-settings', { auto_approve: v }); reload(); }} /></div>
        <Field label="Webhook address"><div className="row"><input className="input" readOnly value={data.webhook} /><button className="btn sm" onClick={() => copy(data.webhook)}>Copy</button></div></Field>
        <Field label="Secret key (send as header X-Feed-Key)"><div className="row"><input className="input mono" readOnly value={data.feed_key} /><button className="btn sm" onClick={() => copy(data.feed_key)}>Copy</button><button className="btn sm ghost danger" onClick={() => setConfirmKey(true)}>New key</button></div></Field>
        <Field label="Example"><pre style={{ background: 'var(--surface-2)', padding: 10, borderRadius: 8, fontSize: 12, overflowX: 'auto', margin: 0 }}>{curl}</pre></Field>
        <div className="muted" style={{ fontSize: 12.5 }}>{data.total} transaction(s) received so far, {data.matched} matched{data.last ? ` · last ${String(data.last).replace('T', ' ').slice(0, 16)}` : ''}.</div>
      </div>
      {confirmKey && <ConfirmDialog danger title="Create a new key?" message="Anything using the old key will stop working until it is updated." confirmLabel="Create new key" onCancel={() => setConfirmKey(false)} onConfirm={async () => { await api.put('/api/payment-claims/sync-settings', { regenerate: true }); setConfirmKey(false); reload(); toast('New key created', 'ok'); }} />}
    </Modal>
  );
}
