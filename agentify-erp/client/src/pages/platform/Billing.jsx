// Plans & pricing (plan builder), transactions & invoices, and subscription history.
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, Empty, ErrorBox, Field, Loading, Modal, StatusBadge, TextInput, Toggle } from '../../components/ui.jsx';
import { api } from '../../api.js';
import { useToast } from '../../context.jsx';
import { A, PageTitle } from './AdminShell.jsx';

const n0 = (v) => Number(v || 0).toLocaleString();
const limitText = (v) => (v == null ? 'Unlimited' : n0(v));
const priceText = (p, cur = 'PKR') => (p?.[cur] ? `${cur} ${n0(p[cur].month)}/mo · ${n0(p[cur].year)}/yr` : '—');
export function downloadCsv(name, header, rows) {
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const text = [header.map(esc).join(','), ...rows.map((r) => r.map(esc).join(','))].join('\n');
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv' })); a.download = name; a.click(); URL.revokeObjectURL(a.href);
}

// ---------------------------------------------------------------- plans
export function PlansPage() {
  const toast = useToast();
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  const [edit, setEdit] = useState(null);
  const [settings, setSettings] = useState(null);
  const load = useCallback(() => api.get(`${A}/plans`).then((x) => { setD(x); setSettings(x.settings); }).catch((e) => setErr(e.message)), []);
  useEffect(() => { load(); }, [load]);
  const open = (p) => setEdit(p ? { ...p, isNew: false, allModules: p.modules == null, modules: p.modules || [], price: { PKR: { ...(p.price.PKR || {}) }, USD: { ...(p.price.USD || {}) } } }
    : { isNew: true, id: '', name: '', description: '', seats: '', projects: '', grace_days: 7, allModules: true, modules: [], visible: true, active: true, price: { PKR: {}, USD: {} } });
  const save = async () => {
    const body = { name: edit.name, description: edit.description, seats: edit.seats === '' ? null : edit.seats, projects: edit.projects === '' ? null : edit.projects, grace_days: edit.grace_days,
      modules: edit.allModules ? null : edit.modules, visible: edit.visible, active: edit.active, price: edit.price };
    try { await api.put(`${A}/plans/${encodeURIComponent(edit.id.trim().toLowerCase())}`, body); toast('Plan saved'); setEdit(null); load(); } catch (e) { toast(e.message, 'err'); }
  };
  const saveSettings = async () => { try { setSettings(await api.put(`${A}/plan-settings`, settings)); toast('Trial settings saved'); load(); } catch (e) { toast(e.message, 'err'); } };
  return (
    <>
      <PageTitle title="Plans & pricing" sub="Changing a price affects new purchases and renewals only. Workspaces keep the price they are paying until they renew. Limit changes apply straight away to every workspace on the plan.">
        <button className="btn primary sm" onClick={() => open(null)}>New plan</button>
      </PageTitle>
      <ErrorBox error={err} />
      {!d ? (!err && <Loading />) : (
        <>
          <Card flush>
            <div className="table-wrap"><table className="t"><thead><tr><th>Plan</th><th>Price (PKR)</th><th>Price (USD)</th><th>Users</th><th>Projects</th><th>Modules</th><th>Subscribers</th><th>Status</th><th /></tr></thead><tbody>
              {d.plans.map((p) => (
                <tr key={p.id}>
                  <td><b>{p.name}</b><div className="muted mono">{p.id}</div>{p.description && <div className="muted">{p.description}</div>}</td>
                  <td className="nowrap">{priceText(p.price, 'PKR')}</td><td className="nowrap">{priceText(p.price, 'USD')}</td>
                  <td>{limitText(p.seats)}</td><td>{limitText(p.projects)}</td>
                  <td>{p.modules == null ? 'All' : p.modules.length ? p.modules.map((m) => d.modules[m]?.label || m).join(', ') : 'Core only'}</td>
                  <td>{p.subscribers}</td>
                  <td>{p.active ? <StatusBadge status="active" label={p.visible ? 'On sale' : 'On sale (hidden)'} /> : <StatusBadge status="inactive" label="Retired" />}</td>
                  <td className="right"><button className="btn sm" onClick={() => open(p)}>Edit</button></td>
                </tr>
              ))}
            </tbody></table></div>
          </Card>
          <Card title="Free trial">
            <div className="pa-grid2" style={{ marginBottom: 0 }}>
              <Field label="Trial length for new sign-ups (days)" hint="0 means no trial."><TextInput type="number" value={settings.default_trial_days} onChange={(v) => setSettings({ ...settings, default_trial_days: v })} /></Field>
              <Field label="Trial gets the limits of" hint="Users, projects and modules during the trial."><select className="input" value={settings.trial_plan} onChange={(e) => setSettings({ ...settings, trial_plan: e.target.value })}>{d.plans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
            </div>
            <button className="btn primary sm" onClick={saveSettings}>Save trial settings</button>
          </Card>
        </>
      )}
      {edit && (
        <Modal title={edit.isNew ? 'New plan' : `Edit plan · ${edit.name}`} size="lg" onClose={() => setEdit(null)} footer={<><button className="btn" onClick={() => setEdit(null)}>Cancel</button><button className="btn primary" onClick={save}>Save plan</button></>}>
          <div className="pa-grid2" style={{ marginBottom: 0 }}>
            <Field label="Plan ID" required hint={edit.isNew ? 'Lowercase, e.g. pro. Cannot be changed later.' : 'Fixed'}><TextInput value={edit.id} disabled={!edit.isNew} onChange={(v) => setEdit({ ...edit, id: v })} /></Field>
            <Field label="Name" required><TextInput value={edit.name} onChange={(v) => setEdit({ ...edit, name: v })} /></Field>
          </div>
          <Field label="Description"><TextInput value={edit.description || ''} onChange={(v) => setEdit({ ...edit, description: v })} /></Field>
          <h4 style={{ margin: '12px 0 6px' }}>Prices</h4>
          <div className="pa-grid2" style={{ marginBottom: 0 }}>
            {['PKR', 'USD'].flatMap((cur) => ['month', 'year'].map((int) => (
              <Field key={cur + int} label={`${cur} per ${int}`} hint={!edit.isNew && edit.price[cur]?.[int] != null ? `Now ${n0(d.plans.find((p) => p.id === edit.id)?.price?.[cur]?.[int])}` : cur === 'PKR' ? 'Required' : 'Optional (card payments in USD)'}>
                <TextInput type="number" value={edit.price[cur]?.[int] ?? ''} onChange={(v) => setEdit({ ...edit, price: { ...edit.price, [cur]: { ...edit.price[cur], [int]: v === '' ? undefined : Number(v) } } })} />
              </Field>
            )))}
          </div>
          <h4 style={{ margin: '12px 0 6px' }}>Limits</h4>
          <div className="pa-grid3" style={{ marginBottom: 0 }}>
            <Field label="Users" hint="Empty = unlimited"><TextInput type="number" value={edit.seats ?? ''} onChange={(v) => setEdit({ ...edit, seats: v })} /></Field>
            <Field label="Projects" hint="Empty = unlimited"><TextInput type="number" value={edit.projects ?? ''} onChange={(v) => setEdit({ ...edit, projects: v })} /></Field>
            <Field label="Grace days after a failed payment"><TextInput type="number" value={edit.grace_days} onChange={(v) => setEdit({ ...edit, grace_days: v })} /></Field>
          </div>
          <h4 style={{ margin: '12px 0 6px' }}>Modules</h4>
          <Toggle value={edit.allModules} onChange={(v) => setEdit({ ...edit, allModules: v })} label="All modules included" />
          {!edit.allModules && <div className="pa-grid2" style={{ marginTop: 8 }}>{Object.entries(d.modules).map(([k, m]) => (
            <label key={k} className="row" style={{ gap: 8 }}><input type="checkbox" checked={edit.modules.includes(k)} onChange={(e) => setEdit({ ...edit, modules: e.target.checked ? [...edit.modules, k] : edit.modules.filter((x) => x !== k) })} />{m.label}</label>
          ))}</div>}
          <p className="muted">CRM, properties, projects, sales and receipts are always included.</p>
          <h4 style={{ margin: '12px 0 6px' }}>Availability</h4>
          <Toggle value={edit.active} onChange={(v) => setEdit({ ...edit, active: v })} label="On sale (off = retired: current subscribers can still renew)" />
          <Toggle value={edit.visible} onChange={(v) => setEdit({ ...edit, visible: v })} label="Shown on the public price list" />
          {!edit.isNew && !!edit.price_history?.length && <>
            <h4 style={{ margin: '12px 0 6px' }}>Price history</h4>
            <div className="table-wrap"><table className="t"><tbody>{edit.price_history.map((h, i) => <tr key={i}><td className="muted nowrap">{h.effective_from.startsWith('2000') ? 'Original' : h.effective_from.slice(0, 16)}</td><td>{h.currency} per {h.interval}</td><td className="mono">{n0(h.amount)}</td><td className="muted">{h.created_by}</td></tr>)}</tbody></table></div>
          </>}
        </Modal>
      )}
    </>
  );
}

// ---------------------------------------------------------------- transactions
const TX_STATUS = [['', 'Any status'], ['paid', 'Invoice paid'], ['pending', 'Waiting for approval'], ['approved', 'Approved'], ['rejected', 'Rejected']];
export function TransactionsPage() {
  const nav = useNavigate();
  const [f, setF] = useState({ status: '', method: '', q: '', page: 0 });
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    setErr('');
    const p = new URLSearchParams(Object.entries({ ...f, per: 50 }).filter(([, v]) => v !== '' && v != null));
    const t = setTimeout(() => api.get(`${A}/transactions?${p}`).then(setD).catch((e) => setErr(e.message)), 200);
    return () => clearTimeout(t);
  }, [f]);
  const exportAll = async () => {
    const p = new URLSearchParams(Object.entries({ ...f, page: 0, per: 200 }).filter(([, v]) => v !== '' && v != null));
    let page = 0, rows = [];
    for (;;) { p.set('page', page); const r = await api.get(`${A}/transactions?${p}`); rows = rows.concat(r.rows); if (rows.length >= r.total || !r.rows.length) break; page += 1; }
    downloadCsv(`transactions-${new Date().toISOString().slice(0, 10)}.csv`, ['Date (UTC)', 'Workspace', 'Type', 'Reference', 'Method', 'Amount', 'Currency', 'Payment status', 'Invoice status', 'Plan', 'Period'],
      rows.map((r) => [r.created_at, r.tenant, r.kind, r.reference, r.method, r.amount, r.currency, r.payment_status, r.invoice_status, r.plan ? `${r.plan}/${r.interval}` : '', r.period_start ? `${r.period_start} to ${r.period_end}` : '']));
  };
  return (
    <>
      <PageTitle title="Transactions & invoices" sub="Every payment and invoice in one list. Payment status (for bank and wallet transfers) and invoice status are shown separately.">
        <button className="btn sm" onClick={exportAll} disabled={!d?.total}>Export CSV</button>
      </PageTitle>
      <Card flush title={d ? `${d.total} record${d.total === 1 ? '' : 's'}${Object.keys(d.paid_totals).length ? ` · paid ${Object.entries(d.paid_totals).map(([c, v]) => `${c} ${n0(v)}`).join(' · ')}` : ''}` : 'Loading'} actions={<>
        <input className="input" style={{ width: 220 }} placeholder="Reference or workspace" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value, page: 0 })} aria-label="Search transactions" />
        <select className="input" style={{ width: 190 }} value={f.status} onChange={(e) => setF({ ...f, status: e.target.value, page: 0 })} aria-label="Status">{TX_STATUS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        <select className="input" style={{ width: 160 }} value={f.method} onChange={(e) => setF({ ...f, method: e.target.value, page: 0 })} aria-label="Method"><option value="">Any method</option>{['stripe', 'bank', 'raast', 'easypaisa', 'jazzcash', 'sadapay', 'nayapay', 'manual'].map((m) => <option key={m}>{m}</option>)}</select>
      </>}>
        <ErrorBox error={err} />
        {!d ? (!err && <Loading />) : !d.rows.length ? <Empty title="No transactions match" /> : (
          <div className="table-wrap"><table className="t"><thead><tr><th>Date</th><th>Workspace</th><th>Reference</th><th>Method</th><th className="right">Amount</th><th>Payment</th><th>Invoice</th><th>Covers</th></tr></thead><tbody>
            {d.rows.map((r) => (
              <tr key={`${r.kind}-${r.id}`} style={{ cursor: 'pointer' }} onClick={() => nav(`/platform/workspaces/${r.tenant_id}`)}>
                <td className="nowrap muted">{String(r.created_at).slice(0, 16)}</td><td><b>{r.tenant}</b><div className="muted">{r.slug}</div></td>
                <td className="mono">{r.reference}{r.note && <div className="muted" style={{ fontFamily: 'inherit' }}>{r.note}</div>}</td><td>{r.method || '—'}</td>
                <td className="right mono nowrap">{r.currency} {n0(r.amount)}</td>
                <td>{r.payment_status ? <StatusBadge status={r.payment_status} /> : <span className="muted">—</span>}</td>
                <td>{r.invoice_status ? <StatusBadge status={r.invoice_status} /> : <span className="muted">Not issued</span>}</td>
                <td className="nowrap muted">{r.period_start ? `${r.period_start} → ${r.period_end}` : r.plan ? `${r.plan} / ${r.interval}` : '—'}</td>
              </tr>
            ))}
          </tbody></table></div>
        )}
        {d && d.total > d.per && <div className="pa-pager"><span className="muted">{d.page * d.per + 1}–{Math.min(d.total, (d.page + 1) * d.per)} of {d.total}</span><span><button className="btn sm" disabled={!d.page} onClick={() => setF({ ...f, page: f.page - 1 })}>Previous</button> <button className="btn sm" disabled={(d.page + 1) * d.per >= d.total} onClick={() => setF({ ...f, page: f.page + 1 })}>Next</button></span></div>}
      </Card>
    </>
  );
}

// ---------------------------------------------------------------- subscription history
export const historyLine = (h) => {
  const parts = [];
  if (h.from_plan !== h.to_plan) parts.push(`plan ${h.from_plan || '—'} → ${h.to_plan || '—'}`);
  if (h.from_status !== h.to_status) parts.push(`status ${h.from_status || '—'} → ${h.to_status || '—'}`);
  if (h.from_period_end !== h.to_period_end) parts.push(`paid until ${h.from_period_end || '—'} → ${h.to_period_end || '—'}`);
  if (!parts.length && h.trial_ends_at) parts.push(`trial until ${h.trial_ends_at}`);
  if (!parts.length && h.grace_until) parts.push(`grace until ${h.grace_until}`);
  if (!parts.length && h.price_amount != null) parts.push(`price ${h.price_currency} ${n0(h.price_amount)}`);
  return parts.join(' · ') || 'updated';
};
export function SubscriptionHistoryPage() {
  const nav = useNavigate();
  const [page, setPage] = useState(0);
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  useEffect(() => { api.get(`${A}/subscriptions/history?page=${page}&per=50`).then(setD).catch((e) => setErr(e.message)); }, [page]);
  return (
    <>
      <PageTitle title="Subscription history" sub="Every plan and billing change on every workspace: who or what made it, and why. This record cannot be edited." />
      <ErrorBox error={err} />
      <Card flush>
        {!d ? (!err && <Loading />) : !d.rows.length ? <Empty title="No changes recorded yet" /> : (
          <div className="table-wrap"><table className="t"><thead><tr><th>When (UTC)</th><th>Workspace</th><th>Change</th><th>By</th><th>Reason</th></tr></thead><tbody>
            {d.rows.map((h) => <tr key={h.id} style={{ cursor: 'pointer' }} onClick={() => nav(`/platform/workspaces/${h.tenant_id}`)}><td className="nowrap muted">{h.created_at.slice(0, 16)}</td><td><b>{h.tenant_name}</b></td><td>{historyLine(h)}</td><td>{h.actor || h.source}</td><td className="muted">{h.reason || '—'}</td></tr>)}
          </tbody></table></div>
        )}
        {d && d.total > 50 && <div className="pa-pager"><span className="muted">{page * 50 + 1}–{Math.min(d.total, (page + 1) * 50)} of {d.total}</span><span><button className="btn sm" disabled={!page} onClick={() => setPage(page - 1)}>Previous</button> <button className="btn sm" disabled={(page + 1) * 50 >= d.total} onClick={() => setPage(page + 1)}>Next</button></span></div>}
      </Card>
    </>
  );
}
