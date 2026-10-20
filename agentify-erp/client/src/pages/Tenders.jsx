import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import Icon from '../components/Icon.jsx';
import { FormModal } from '../components/ResourcePage.jsx';
import { DocumentsPanel } from '../components/Uploaders.jsx';
import { BackLink, Card, ConfirmDialog, CurrencyInput, Empty, Field, KV, Loading, Menu, Modal, PageHead, Select, Stat, StatusBadge, Tabs, Toggle } from '../components/ui.jsx';
import { api, download } from '../api.js';
import { useAuth, useFetch, useLookups, useToast } from '../context.jsx';
import { date, money, todayPK, cur } from '../format.js';

const TONE = { draft: 'grey', open: 'green', closed: 'amber', awarded: 'purple', cancelled: 'red' };
const BID_TONE = { submitted: 'blue', shortlisted: 'amber', awarded: 'green', rejected: 'red' };
const TStatus = ({ s }) => <StatusBadge status={s} tone={TONE[s]} />;

// ------------------------------------------------------------------ list
export function TenderList() {
  const { can } = useAuth();
  const nav = useNavigate();
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const { data, reload } = useFetch('/api/tenders', { status: status || undefined, q: q || undefined }, [status, q]);
  const [adding, setAdding] = useState(false);
  const s = data?.summary || {};
  return (
    <div>
      <PageHead title="Tenders & bids" sub="Announce contracts to your vendors, receive their BOQ rates and proposals, compare and award.">
        {can('vendors', 'create') && <button className="btn primary" onClick={() => setAdding(true)}><Icon name="plus" size={14} />New tender</button>}
      </PageHead>
      <div className="top-tabs">
        {[['', 'All'], ['open', `Open (${s.open || 0})`], ['draft', `Drafts (${s.draft || 0})`], ['closed', `Closed (${s.closed || 0})`], ['awarded', `Awarded (${s.awarded || 0})`], ['cancelled', 'Cancelled']].map(([k, l]) => <button key={k} className={`chip ${status === k ? 'active' : ''}`} onClick={() => setStatus(k)}>{l}</button>)}
        <input className="input" style={{ width: 220, marginLeft: 'auto' }} placeholder="Search title, number, category…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search tenders" />
      </div>
      <Card flush>
        {!data ? <Loading /> : !data.rows.length ? <Empty icon="file" title="No tenders yet" hint="Create one, add its BOQ, publish it and your vendors are notified." action={can('vendors', 'create') ? { label: 'New tender', onClick: () => setAdding(true) } : undefined} /> : (
          <div className="table-wrap"><table className="t"><thead><tr><th>Tender</th><th>Category</th><th>Project</th><th>Closes</th><th className="num">Bids</th><th className="num">Lowest bid</th><th>Status</th></tr></thead>
            <tbody>{data.rows.map((t) => (
              <tr key={t.id} className="click" onClick={() => nav(`/vendors/tenders/${t.id}`)}><td><span className="cell-main">{t.title}</span><div className="cell-sub">{t.tender_no}</div></td><td>{t.category || '—'}{t.visibility === 'category' && <span className="tag" style={{ marginLeft: 6 }}>category only</span>}</td>
                <td>{t.project_name || '—'}</td><td className="nw">{date(t.closes_on)}</td><td className="num">{t.bid_count}</td><td className="num mono">{t.lowest_bid ? money(t.lowest_bid) : '—'}</td><td><TStatus s={t.effective_status} /></td></tr>))}</tbody></table></div>
        )}
      </Card>
      {adding && <TenderForm onClose={() => setAdding(false)} onSaved={(id) => { setAdding(false); reload(); nav(`/vendors/tenders/${id}`); }} />}
    </div>
  );
}

// ------------------------------------------------------------------ create / edit
function TenderForm({ tender, onClose, onSaved }) {
  const toast = useToast();
  const { projects } = useLookups();
  const vendors = useFetch('/api/accounting/vendors', { limit: 500 });
  const categories = useMemo(() => [...new Set((vendors.data?.rows || []).map((v) => v.category).filter(Boolean))].sort(), [vendors.data]);
  const [f, setF] = useState(() => tender ? { ...tender, boq: tender.boq.length ? tender.boq : [{ description: '', unit: '', qty: '' }], estimated_budget: tender.estimated_budget ?? '' }
    : { title: '', category: '', project_id: '', location: '', closes_on: '', visibility: 'all', estimated_budget: '', show_budget: false, description: '', scope: '', required_docs: '', boq: [{ description: '', unit: '', qty: '' }] });
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const line = (i, k, v) => set('boq', f.boq.map((l, j) => (j === i ? { ...l, [k]: v } : l)));
  const locked = tender?.bid_count > 0;
  const save = async (publish) => {
    setBusy(true);
    try {
      const body = { ...f, project_id: f.project_id || null, estimated_budget: f.estimated_budget === '' ? null : f.estimated_budget, boq: f.boq.filter((l) => l.description.trim() || l.qty).map((l) => ({ ...l, qty: Number(l.qty) })) };
      if (locked) delete body.boq;
      let id = tender?.id;
      if (tender) await api.put(`/api/tenders/${tender.id}`, body); else id = (await api.post('/api/tenders', body)).id;
      if (publish) { const r = await api.post(`/api/tenders/${id}/publish`); toast(`Published — ${r.vendors} vendor(s) notified`, 'ok'); } else toast('Tender saved', 'ok');
      onSaved(id);
    } catch (e) { toast(e.message, 'err'); } finally { setBusy(false); }
  };
  return (
    <Modal title={tender ? `Edit ${tender.tender_no}` : 'New tender'} size="xl" onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn" disabled={busy} onClick={() => save(false)}>Save draft</button>
        {(!tender || tender.status === 'draft') && <button className="btn primary" disabled={busy} onClick={() => save(true)}>Save & publish to vendors</button>}</>}>
      <div className="form-grid">
        <Field label="Title" required className="full"><input className="input" value={f.title} onChange={(e) => set('title', e.target.value)} placeholder="e.g. Boundary wall — Block D" /></Field>
        <Field label="Vendor category" hint="Used when the tender is addressed to one category only"><input className="input" list="tcats" value={f.category || ''} onChange={(e) => set('category', e.target.value)} /><datalist id="tcats">{categories.map((c) => <option key={c} value={c} />)}</datalist></Field>
        <Field label="Who can see it"><Select allowEmpty={false} value={f.visibility} onChange={(v) => set('visibility', v)} options={[{ value: 'all', label: 'All active vendors' }, { value: 'category', label: 'Only vendors of that category' }]} /></Field>
        <Field label="Project"><Select value={f.project_id || ''} onChange={(v) => set('project_id', v ? Number(v) : '')} options={projects.map((p) => ({ value: p.id, label: p.name }))} placeholder="Not tied to a project" /></Field>
        <Field label="Site / location"><input className="input" value={f.location || ''} onChange={(e) => set('location', e.target.value)} /></Field>
        <Field label="Closing date" required hint="Bids are accepted up to and including this date"><input className="input" type="date" min={todayPK()} value={f.closes_on} onChange={(e) => set('closes_on', e.target.value)} /></Field>
        <Field label={`Your estimate (${cur()})`} hint="Internal — vendors only see it if you switch it on"><CurrencyInput value={f.estimated_budget} onChange={(v) => set('estimated_budget', v)} /><div style={{ marginTop: 6 }}><Toggle value={!!f.show_budget} onChange={(v) => set('show_budget', v)} label="Show the estimate to vendors" /></div></Field>
        <Field label="Description" className="full"><textarea className="textarea" rows={3} value={f.description || ''} onChange={(e) => set('description', e.target.value)} /></Field>
        <Field label="Scope of work" className="full"><textarea className="textarea" rows={3} value={f.scope || ''} onChange={(e) => set('scope', e.target.value)} /></Field>
        <Field label="Documents vendors must include" className="full"><input className="input" value={f.required_docs || ''} onChange={(e) => set('required_docs', e.target.value)} placeholder="e.g. NTN certificate, last 3 invoices, references" /></Field>
      </div>
      <h4 style={{ margin: '16px 0 6px' }}>Bill of quantities (BOQ)</h4>
      <div className="muted" style={{ marginBottom: 8 }}>{locked ? 'Bids have been received, so the BOQ is frozen.' : 'Vendors price every line and the total is calculated for them. Leave empty to ask for a single lump-sum price.'}</div>
      <table className="sheet"><thead><tr><th style={{ width: 36 }}>#</th><th>Item</th><th style={{ width: 90 }}>Unit</th><th style={{ width: 120 }}>Quantity</th><th style={{ width: 40 }} /></tr></thead>
        <tbody>{f.boq.map((l, i) => (
          <tr key={i}><td>{i + 1}</td><td><input disabled={locked} value={l.description} onChange={(e) => line(i, 'description', e.target.value)} placeholder="Description of work" /></td><td><input disabled={locked} value={l.unit} onChange={(e) => line(i, 'unit', e.target.value)} placeholder="sft" /></td>
            <td><input disabled={locked} type="number" min="0" step="any" value={l.qty} onChange={(e) => line(i, 'qty', e.target.value)} /></td>
            <td>{!locked && f.boq.length > 1 && <button className="btn sm ghost" aria-label="Remove line" onClick={() => set('boq', f.boq.filter((_, j) => j !== i))}>×</button>}</td></tr>))}</tbody></table>
      {!locked && <button className="btn sm" style={{ marginTop: 8 }} onClick={() => set('boq', [...f.boq, { description: '', unit: '', qty: '' }])}><Icon name="plus" size={13} />Add line</button>}
    </Modal>
  );
}

// ------------------------------------------------------------------ detail: bids side by side
export function TenderDetail() {
  const { id } = useParams();
  const { can } = useAuth();
  const toast = useToast();
  const nav = useNavigate();
  const { data: t, error, reload } = useFetch(`/api/tenders/${id}`);
  const [tab, setTab] = useState('bids');
  const [edit, setEdit] = useState(false);
  const [ask, setAsk] = useState(null); // { kind, bid }
  const [view, setView] = useState(null);
  if (error) return <div className="alert err">{error}</div>;
  if (!t) return <Loading />;
  const st = t.effective_status;
  const act = async (path, msg, body) => { try { await api.post(`/api/tenders/${t.id}/${path}`, body); toast(msg, 'ok'); reload(); } catch (e) { toast(e.message, 'err'); } };
  const bidAct = async (b, status) => { try { await api.put(`/api/tenders/bids/${b.id}`, { status }); toast(status === 'shortlisted' ? 'Shortlisted' : status === 'rejected' ? 'Rejected' : 'Reset', 'ok'); reload(); } catch (e) { toast(e.message, 'err'); } };
  const bids = t.bids;
  const totals = bids.filter((b) => b.status !== 'rejected').map((b) => b.total_amount);
  const minRate = (no) => Math.min(...bids.filter((b) => b.status !== 'rejected').map((b) => b.boq_rates.find((x) => x.no === no)?.rate ?? Infinity));
  const canDecide = can('vendors', 'approve') && ['open', 'closed'].includes(st);
  return (
    <div>
      <BackLink to="/vendors/tenders">Tenders & bids</BackLink>
      <PageHead title={<span>{t.title} <TStatus s={st} /></span>} sub={`${t.tender_no} · ${[t.category, t.project_name].filter(Boolean).join(' · ')} · closes ${date(t.closes_on)}`}>
        {can('vendors', 'edit') && st === 'draft' && <button className="btn primary" onClick={() => act('publish', 'Published to vendors')}>Publish</button>}
        {can('vendors', 'edit') && ['draft', 'open', 'closed'].includes(t.status) && <button className="btn" onClick={() => setEdit(true)}><Icon name="edit" size={14} />Edit</button>}
        {can('vendors', 'edit') && t.status === 'open' && st === 'open' && <button className="btn" onClick={() => act('close', 'Bidding closed')}>Close bidding</button>}
        {can('vendors', 'edit') && st === 'closed' && <button className="btn" onClick={() => setAsk({ kind: 'reopen' })}>Reopen</button>}
        {can('vendors', 'edit') && ['open', 'closed'].includes(st) && <button className="btn danger" onClick={() => setAsk({ kind: 'cancel' })}>Cancel tender</button>}
        {can('vendors', 'delete') && (t.status === 'draft' || (t.status === 'cancelled' && !bids.length)) && <button className="btn danger" onClick={() => setAsk({ kind: 'delete' })}>Delete</button>}
        {bids.length > 0 && <Menu trigger={<button className="btn"><Icon name="download" size={14} />Comparison</button>}>
          {['pdf', 'xlsx', 'csv'].map((f) => <button key={f} onClick={() => download(`/api/tenders/${t.id}/comparison`, { format: f }, `comparison-${t.tender_no}.${f}`).catch((e) => toast(e.message, 'err'))}>{f.toUpperCase()}</button>)}</Menu>}
      </PageHead>
      {st === 'awarded' && <div className="alert ok" style={{ marginBottom: 12 }}>Awarded to <b>{bids.find((b) => b.status === 'awarded')?.vendor_name}</b> for {money(bids.find((b) => b.status === 'awarded')?.total_amount)}{t.award_note ? ` — ${t.award_note.replace(/[.\s]+$/, '')}` : ''}.</div>}
      <div className="grid g4" style={{ marginBottom: 14 }}>
        <Stat label="Bids received" value={bids.length} sub={`${t.eligible_vendors} eligible vendor(s)`} icon="users" />
        <Stat label="Lowest bid" value={totals.length ? money(Math.min(...totals)) : '—'} tone="pos" icon="dollar" />
        <Stat label="Highest bid" value={totals.length ? money(Math.max(...totals)) : '—'} icon="chart" />
        <Stat label="Your estimate" value={t.estimated_budget ? money(t.estimated_budget) : '—'} sub={t.estimated_budget ? (t.show_budget ? 'shown to vendors' : 'private') : undefined} icon="wallet" />
      </div>
      <Card flush>
        <Tabs value={tab} onChange={setTab} tabs={[{ key: 'bids', label: 'Bids', count: bids.length }, { key: 'details', label: 'Details & BOQ' }, { key: 'docs', label: 'Documents for vendors', count: t.files.length }]} />
        {tab === 'bids' && (!bids.length ? <Empty icon="file" title="No bids yet" hint={st === 'draft' ? 'Publish the tender and your vendors are notified.' : 'Vendors’ bids will appear here as they arrive.'} /> : (
          <div className="table-wrap"><table className="t cmp-table">
            <thead><tr><th>{t.boq.length ? 'BOQ item' : ''}</th>{bids.map((b) => (
              <th key={b.id} className={`num ${b.is_lowest ? 'cmp-low' : ''}`}><div className="cell-main">{b.vendor_name}</div><div className="cell-sub">{b.vendor_code} · #{b.rank || '—'}{b.is_lowest ? ' · lowest' : ''}</div><div style={{ marginTop: 4 }}><StatusBadge status={b.status} tone={BID_TONE[b.status]} /></div></th>))}</tr></thead>
            <tbody>
              {t.boq.map((l) => (
                <tr key={l.no}><td>{l.no}. {l.description}<div className="cell-sub">{l.qty.toLocaleString('en-PK')} {l.unit}</div></td>
                  {bids.map((b) => { const rate = b.boq_rates.find((x) => x.no === l.no)?.rate; return <td key={b.id} className={`num mono ${rate && rate === minRate(l.no) && b.status !== 'rejected' ? 'pos bold' : ''}`}>{rate ? money(rate) : '—'}</td>; })}</tr>))}
              <tr className="cmp-total"><td><b>Total bid</b></td>{bids.map((b) => <td key={b.id} className="num mono bold">{money(b.total_amount)}{t.estimated_budget ? <div className="cell-sub">{b.total_amount > t.estimated_budget ? '+' : ''}{Math.round(((b.total_amount - t.estimated_budget) / t.estimated_budget) * 100)}% vs estimate</div> : null}</td>)}</tr>
              <tr><td>Time to complete</td>{bids.map((b) => <td key={b.id} className="num">{b.duration_days ? `${b.duration_days} days` : '—'}</td>)}</tr>
              <tr><td>Valid for</td>{bids.map((b) => <td key={b.id} className="num">{b.validity_days ? `${b.validity_days} days` : '—'}</td>)}</tr>
              <tr><td>Payment terms</td>{bids.map((b) => <td key={b.id} className="num">{b.payment_terms || '—'}</td>)}</tr>
              <tr><td>Submitted</td>{bids.map((b) => <td key={b.id} className="num">{date(b.submitted_at)}</td>)}</tr>
              <tr><td>Proposal & files</td>{bids.map((b) => <td key={b.id} className="num"><button className="btn sm" onClick={() => setView(b)}>View ({b.files.length})</button></td>)}</tr>
              {canDecide && <tr><td>Decision</td>{bids.map((b) => (
                <td key={b.id} className="num">{['submitted', 'shortlisted'].includes(b.status) ? (
                  <div className="stack" style={{ gap: 6, alignItems: 'flex-end' }}>
                    <button className="btn sm primary" onClick={() => setAsk({ kind: 'award', bid: b })}>Award</button>
                    <button className="btn sm" onClick={() => bidAct(b, b.status === 'shortlisted' ? 'submitted' : 'shortlisted')}>{b.status === 'shortlisted' ? 'Unshortlist' : 'Shortlist'}</button>
                    <button className="btn sm ghost danger" onClick={() => bidAct(b, 'rejected')}>Reject</button></div>) : <span className="muted">—</span>}</td>))}</tr>}
            </tbody></table></div>
        ))}
        {tab === 'details' && (
          <div className="card-b stack">
            <KV items={[['Status', <TStatus s={st} />], ['Visibility', t.visibility === 'category' ? `Only “${t.category}” vendors` : 'All active vendors'], ['Closing date', date(t.closes_on)], ['Project', t.project_name], ['Location', t.location], ['Documents required', t.required_docs]]} />
            {t.description && <div><b>Description</b><div style={{ whiteSpace: 'pre-wrap' }}>{t.description}</div></div>}
            {t.scope && <div><b>Scope</b><div style={{ whiteSpace: 'pre-wrap' }}>{t.scope}</div></div>}
            {t.boq.length > 0 ? <table className="t"><thead><tr><th>#</th><th>Item</th><th>Unit</th><th className="num">Quantity</th></tr></thead><tbody>{t.boq.map((l) => <tr key={l.no}><td>{l.no}</td><td>{l.description}</td><td>{l.unit}</td><td className="num mono">{l.qty.toLocaleString('en-PK')}</td></tr>)}</tbody></table> : <div className="muted">No BOQ — vendors give a lump-sum price.</div>}
          </div>
        )}
        {tab === 'docs' && <div className="card-b"><div className="muted" style={{ marginBottom: 8 }}>Drawings, specifications or forms. Tick “Share with vendors” so bidders can download them from their portal.</div>
          <DocumentsPanel entityType="tender" entityId={t.id} canEdit={can('vendors', 'edit')} categories={['Drawing', 'Specification', 'Form', 'Other']} portalToggle portalLabel="Share with vendors in their portal" /></div>}
      </Card>

      {edit && <TenderForm tender={{ ...t, boq: t.boq }} onClose={() => setEdit(false)} onSaved={() => { setEdit(false); reload(); }} />}
      {view && (
        <Modal title={`${view.vendor_name} — proposal`} size="lg" onClose={() => setView(null)}>
          <div className="stack">
            <KV items={[['Total bid', <b>{money(view.total_amount)}</b>], ['Time to complete', view.duration_days ? `${view.duration_days} days` : '—'], ['Valid for', view.validity_days ? `${view.validity_days} days` : '—'], ['Payment terms', view.payment_terms], ['Contact', view.vendor_phone], ['Contracts won earlier', view.awards_won]]} />
            <div><b>Proposal</b><div style={{ whiteSpace: 'pre-wrap' }}>{view.proposal || <span className="muted">No written proposal.</span>}</div></div>
            {view.notes && <div><b>Notes</b><div style={{ whiteSpace: 'pre-wrap' }}>{view.notes}</div></div>}
            <div><b>Files</b>{!view.files.length ? <div className="muted">None attached.</div> : view.files.map((x) => <div key={x.id} className="row between" style={{ padding: '4px 0' }}><span><Icon name="file" size={14} /> {x.name} <span className="tag">{x.category}</span></span><a className="btn sm" href={`/api/documents/${x.id}/file?download=1`}>Download</a></div>)}</div>
            <div><Link to={`/vendors/${view.vendor_id}`}>Open vendor record →</Link></div>
          </div>
        </Modal>
      )}
      {ask?.kind === 'award' && <FormModal title={`Award to ${ask.bid.vendor_name}`} size="sm" submitLabel="Award contract" initial={{ note: '' }}
        fields={[{ name: 'note', label: 'Message to the vendor (optional)', type: 'textarea', hint: `Total ${money(ask.bid.total_amount)}. All other bidders are told the tender is decided.` }]}
        onClose={() => setAsk(null)} onSave={async (f) => { await api.post(`/api/tenders/${t.id}/award`, { bid_id: ask.bid.id, note: f.note }); toast('Contract awarded — vendors notified', 'ok'); setAsk(null); reload(); }} />}
      {ask?.kind === 'reopen' && <FormModal title="Reopen bidding" size="sm" submitLabel="Reopen" initial={{ closes_on: '' }}
        fields={[{ name: 'closes_on', label: 'New closing date', type: 'date', required: true }]} onClose={() => setAsk(null)}
        onSave={async (f) => { await api.post(`/api/tenders/${t.id}/reopen`, f); toast('Bidding reopened', 'ok'); setAsk(null); reload(); }} />}
      {ask?.kind === 'cancel' && <ConfirmDialog danger title="Cancel this tender?" message="Vendors who bid are told it was cancelled. This cannot be undone." confirmLabel="Cancel tender" onCancel={() => setAsk(null)} onConfirm={async () => { await act('cancel', 'Tender cancelled'); setAsk(null); }} />}
      {ask?.kind === 'delete' && <ConfirmDialog danger title="Delete this tender?" message={`Delete ${t.tender_no}?`} confirmLabel="Delete" onCancel={() => setAsk(null)} onConfirm={async () => { try { await api.del(`/api/tenders/${t.id}`); nav('/vendors/tenders'); } catch (e) { toast(e.message, 'err'); } setAsk(null); }} />}
    </div>
  );
}
