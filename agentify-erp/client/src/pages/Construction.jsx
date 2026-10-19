// Construction Management screens: overview, project control (budget vs actual, BOQ, change orders, procurement, stock,
// labour, subcontracts & payment certificates, site reports, sites & milestones), estimates, purchase orders and materials.
// Every figure comes from /api/construction; costs become expense vouchers that Finance approves as usual.
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Card, ConfirmDialog, Empty, ErrorBox, Field, Loading, Modal, PageHead, ProgressBar, Stat, StatusBadge, Tabs, TextInput, Toggle } from '../components/ui.jsx';
import { api, download } from '../api.js';
import { useAuth, useFetch, useToast } from '../context.jsx';
import { money, num, date as fdate } from '../format.js';

const B = '/api/construction';
const today = () => new Date().toLocaleDateString('en-CA');
const pct = (v) => (v == null ? '—' : `${v}%`);
const TONE = { draft: 'pending', sent: 'pending', submitted: 'pending', approved: 'active', accepted: 'active', active: 'active', partially_received: 'pending', received: 'active', closed: 'inactive', cancelled: 'inactive', rejected: 'overdue', completed: 'active', terminated: 'inactive' };
const Badge = ({ s }) => <StatusBadge status={TONE[s] || s} label={String(s).replace(/_/g, ' ')} />;

function useAct(reload) {
  const toast = useToast();
  return async (fn, msg) => { try { const out = await fn(); if (msg) toast(msg); reload?.(); return out ?? true; } catch (e) { toast(e.message, 'err'); return null; } };
}
const sel = (rows, label = 'name') => rows?.map((x) => <option key={x.id} value={x.id}>{x[label]}{x.code ? ` (${x.code})` : ''}</option>);

// ---------------------------------------------------------------- overview
export function ConstructionOverview() {
  const { can } = useAuth();
  const nav = useNavigate();
  const { data, error, reload } = useFetch(`${B}/overview`);
  const [create, setCreate] = useState(null);
  const act = useAct(reload);
  if (error) return <ErrorBox error={error} />;
  if (!data) return <Loading />;
  const tot = data.projects.reduce((t, p) => ({ budget: t.budget + p.budget, actual: t.actual + p.actual_cost, committed: t.committed + p.committed }), { budget: 0, actual: 0, committed: 0 });
  const save = async () => { const p = await act(() => api.post('/api/projects', { ...create, kind: 'construction', is_development: 0 }), 'Project created'); if (p) { setCreate(null); nav(`/construction/projects/${p.id}`); } };
  return (
    <div>
      <PageHead title="Construction" sub="Projects, budgets, procurement, labour and progress">
        {can('projects', 'create') && <button className="btn primary" onClick={() => setCreate({ code: '', name: '', location: '', start_date: '', expected_completion: '' })}>New construction project</button>}
      </PageHead>
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', marginBottom: 16 }}>
        <Stat label="Projects" value={data.projects.length} />
        <Stat label="Total budget" value={money(tot.budget)} />
        <Stat label="Committed" value={money(tot.committed)} sub="Approved POs and subcontracts" />
        <Stat label="Actual cost" value={money(tot.actual)} sub="Approved vouchers" />
        <Stat label="Waiting for you" value={data.pending.change_orders + data.pending.purchase_orders + data.pending.certificates} sub={`${data.pending.change_orders} change orders · ${data.pending.purchase_orders} POs · ${data.pending.certificates} certificates`} />
        <Stat label="Low stock items" value={data.pending.low_stock} to="/construction/materials" />
      </div>
      <Card flush title="Projects">
        {!data.projects.length ? <Empty title="No construction projects yet" hint="Create a project, then add its BOQ, sites and suppliers." /> : (
          <div className="table-wrap"><table className="t"><thead><tr><th>Project</th><th>Progress</th><th className="right">Budget</th><th className="right">Committed</th><th className="right">Actual</th><th className="right">Remaining</th><th>Client contracts</th></tr></thead><tbody>
            {data.projects.map((p) => (
              <tr key={p.id} style={{ cursor: 'pointer' }} onClick={() => nav(`/construction/projects/${p.id}`)}>
                <td><b>{p.name}</b><div className="muted">{p.code}{p.location ? ` · ${p.location}` : ''}{p.manager_name ? ` · ${p.manager_name}` : ''}</div></td>
                <td style={{ minWidth: 140 }}><ProgressBar value={p.percent_complete || 0} tone="green" /><div className="muted">{pct(p.percent_complete)} of BOQ value</div></td>
                <td className="right mono">{money(p.budget)}</td><td className="right mono">{money(p.committed)}</td>
                <td className="right mono">{money(p.actual_cost)}{p.cost_variance_pct > 0 && <div className="err">{p.cost_variance_pct}% over</div>}</td>
                <td className="right mono">{money(p.remaining_budget)}</td><td>{p.client_contracts ? `${p.client_contracts} · ${money(p.client_contract_value)}` : '—'}</td>
              </tr>
            ))}
          </tbody></table></div>
        )}
      </Card>
      {create && (
        <Modal title="New construction project" onClose={() => setCreate(null)} footer={<><button className="btn" onClick={() => setCreate(null)}>Cancel</button><button className="btn primary" onClick={save}>Create</button></>}>
          <div className="grid" style={{ gridTemplateColumns: '1fr 2fr', gap: 12 }}>
            <Field label="Code" required><TextInput value={create.code} onChange={(v) => setCreate({ ...create, code: v })} placeholder="H-12" /></Field>
            <Field label="Name" required><TextInput value={create.name} onChange={(v) => setCreate({ ...create, name: v })} /></Field>
          </div>
          <Field label="Location"><TextInput value={create.location} onChange={(v) => setCreate({ ...create, location: v })} /></Field>
          <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="Start"><input type="date" className="input" value={create.start_date} onChange={(e) => setCreate({ ...create, start_date: e.target.value })} /></Field>
            <Field label="Expected completion"><input type="date" className="input" value={create.expected_completion} onChange={(e) => setCreate({ ...create, expected_completion: e.target.value })} /></Field>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- project control
const TABS = [['summary', 'Budget & cost'], ['boq', 'BOQ'], ['changes', 'Change orders'], ['procurement', 'Procurement'], ['stock', 'Site stock'], ['labour', 'Labour'], ['subcontracts', 'Subcontracts'], ['reports', 'Site reports'], ['sites', 'Sites & milestones']];
export function ConstructionProject() {
  const { id } = useParams();
  const [tab, setTab] = useState('summary');
  const { data, error, reload } = useFetch(`${B}/projects/${id}/summary`);
  if (error) return <ErrorBox error={error} />;
  if (!data) return <Loading />;
  const p = data.project, f = data.figures;
  return (
    <div>
      <PageHead title={p.name} sub={[p.code, p.location].filter(Boolean).join(' · ')} crumbs={<Link to="/construction">Construction</Link>}>
        <Link className="btn" to={`/projects/${p.id}`}>Schedule & documents</Link>
        <button className="btn" onClick={() => download(`${B}/projects/${p.id}/cost-report`, { format: 'pdf' }, `cost-report-${p.code}.pdf`)}>Cost report PDF</button>
      </PageHead>
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(170px,1fr))', marginBottom: 12 }}>
        <Stat label="Budget" value={money(f.budget)} sub={`BOQ ${money(f.boq_value)} + changes ${money(f.change_orders_approved)}`} />
        <Stat label="Committed" value={money(f.committed)} sub={`POs ${money(f.purchase_orders)} · subcontracts ${money(f.subcontracts)}`} />
        <Stat label="Actual cost" value={money(f.actual_cost)} sub={f.cost_awaiting_approval ? `${money(f.cost_awaiting_approval)} awaiting approval` : 'Approved vouchers'} tone={f.actual_cost > f.budget ? 'red' : undefined} />
        <Stat label="Remaining" value={money(f.remaining_budget)} />
        <Stat label="Complete" value={pct(f.percent_complete)} sub={`Earned ${money(f.earned_value)}`} />
        <Stat label="Client" value={money(f.client_received)} sub={`received of ${money(f.client_contract_value)} contracted`} />
      </div>
      <Tabs tabs={TABS.map(([key, label]) => ({ key, label }))} value={tab} onChange={setTab} />
      <div style={{ marginTop: 12 }}>
        {tab === 'summary' && <SummaryTab d={data} />}
        {tab === 'boq' && <BoqTab project={p} phases={data.phases} onChange={reload} />}
        {tab === 'changes' && <ChangesTab project={p} onChange={reload} />}
        {tab === 'procurement' && <PurchaseOrders project={p} sites={data.sites} onChange={reload} />}
        {tab === 'stock' && <StockTab project={p} sites={data.sites} />}
        {tab === 'labour' && <LabourTab project={p} sites={data.sites} onChange={reload} />}
        {tab === 'subcontracts' && <Subcontracts project={p} onChange={reload} />}
        {tab === 'reports' && <ReportsTab project={p} sites={data.sites} onChange={reload} />}
        {tab === 'sites' && <SitesTab project={p} d={data} onChange={reload} />}
      </div>
    </div>
  );
}

function SummaryTab({ d }) {
  const f = d.figures;
  return (
    <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(320px,1fr))', gap: 16 }}>
      <Card title="Budget by BOQ category" flush>
        {!d.by_category.budget.length ? <Empty title="No BOQ yet" /> : <div className="table-wrap"><table className="t"><thead><tr><th>Category</th><th className="right">Budget</th><th className="right">Earned</th><th>Progress</th></tr></thead><tbody>
          {d.by_category.budget.map((c) => <tr key={c.category}><td>{c.category}</td><td className="right mono">{money(c.budget)}</td><td className="right mono">{money(c.earned)}</td><td style={{ width: 120 }}><ProgressBar value={c.budget ? Math.round((c.earned / c.budget) * 100) : 0} tone="green" /></td></tr>)}
        </tbody></table></div>}
      </Card>
      <Card title="Actual cost by account" flush>
        {!d.by_category.actual.length ? <Empty title="No approved costs yet" /> : <div className="table-wrap"><table className="t"><tbody>{d.by_category.actual.map((a) => <tr key={a.account}><td>{a.account}</td><td className="right mono">{money(a.actual)}</td></tr>)}</tbody></table></div>}
      </Card>
      <Card title="Other figures"><div className="table-wrap"><table className="t"><tbody>
        {[['Change orders waiting', money(f.change_orders_pending)], ['Days added by change orders', f.schedule_days_added], ['Labour not yet posted to accounts', money(f.labour_not_posted)], ['Paid out to suppliers', money(f.paid_out)], ['Retention held', money(f.retention_held)], ['Client billed (due to date)', money(f.client_billed)]].map(([l, v]) => <tr key={l}><td>{l}</td><td className="right mono">{v}</td></tr>)}
      </tbody></table></div></Card>
      <Card title="Latest cost vouchers" flush>
        {!d.recent_vouchers.length ? <Empty title="No vouchers yet" /> : <div className="table-wrap"><table className="t"><tbody>{d.recent_vouchers.map((v) => <tr key={v.id}><td><Link to={`/expenses/${v.id}`}>{v.voucher_no}</Link><div className="muted">{v.description}</div></td><td>{v.vendor || ''}</td><td className="right mono">{money(v.amount)}</td><td><Badge s={v.status} /></td></tr>)}</tbody></table></div>}
      </Card>
    </div>
  );
}

function BoqTab({ project, phases, onChange }) {
  const { can } = useAuth();
  const { data, reload } = useFetch(`${B}/projects/${project.id}/boq`);
  const [edit, setEdit] = useState(null);
  const [imp, setImp] = useState(null);
  const [prog, setProg] = useState(null);
  const act = useAct(() => { reload(); onChange(); });
  if (!data) return <Loading />;
  const total = data.reduce((s, b) => s + b.amount, 0);
  const save = async () => { if (await act(() => (edit.id ? api.put(`${B}/boq/${edit.id}`, edit) : api.post(`${B}/boq`, { ...edit, project_id: project.id })), 'Saved')) setEdit(null); };
  const parse = (text) => text.split('\n').map((l) => l.split(/\t|;|,(?=(?:[^"]*"[^"]*")*[^"]*$)/).map((x) => x.trim().replace(/^"|"$/g, ''))).filter((c) => c.length >= 4 && c[0]).map(([category, description, unit, qty, rate, code]) => ({ category, description, unit, qty: Number(qty), rate: Number(rate), code }));
  return (
    <Card flush title={`Bill of quantities · ${money(total)}`} actions={<>
      <button className="btn sm" onClick={() => download(`${B}/projects/${project.id}/boq`, { format: 'xlsx' }, `boq-${project.code}.xlsx`)}>Excel</button>
      <button className="btn sm" onClick={() => download(`${B}/projects/${project.id}/boq`, { format: 'pdf' }, `boq-${project.code}.pdf`)}>PDF</button>
      {can('construction', 'edit') && <button className="btn sm" onClick={() => setProg(Object.fromEntries(data.map((b) => [b.id, ''])))}>Record progress</button>}
      {can('construction', 'create') && <><button className="btn sm" onClick={() => setImp('')}>Import</button><button className="btn sm primary" onClick={() => setEdit({ category: 'General', description: '', unit: 'nos', qty: '', rate: '' })}>Add item</button></>}
    </>}>
      {!data.length ? <Empty title="No BOQ items" hint="Add items, import from a spreadsheet, or convert an accepted estimate." /> : (
        <div className="table-wrap"><table className="t"><thead><tr><th>Item</th><th>Unit</th><th className="right">Qty</th><th className="right">Rate</th><th className="right">Amount</th><th>Done</th><th /></tr></thead><tbody>
          {data.map((b) => <tr key={b.id}><td><b>{b.description}</b><div className="muted">{[b.code, b.category, b.phase].filter(Boolean).join(' · ')}</div></td><td>{b.unit}</td><td className="right">{num(b.qty)}</td><td className="right mono">{num(b.rate)}</td><td className="right mono">{num(b.amount)}</td>
            <td style={{ minWidth: 120 }}><ProgressBar value={b.percent} tone="green" /><div className="muted">{num(b.completed_qty)} {b.unit} · {b.percent}%</div></td>
            <td className="right nowrap">{can('construction', 'edit') && <button className="btn sm" onClick={() => setEdit({ ...b })}>Edit</button>}{' '}{can('construction', 'delete') && !b.completed_qty && <button className="btn sm danger" onClick={() => act(() => api.del(`${B}/boq/${b.id}`), 'Deleted')}>Delete</button>}</td></tr>)}
        </tbody></table></div>
      )}
      {edit && (
        <Modal title={edit.id ? 'Edit BOQ item' : 'Add BOQ item'} onClose={() => setEdit(null)} footer={<><button className="btn" onClick={() => setEdit(null)}>Cancel</button><button className="btn primary" onClick={save}>Save</button></>}>
          <div className="grid" style={{ gridTemplateColumns: '1fr 2fr', gap: 12 }}><Field label="Code"><TextInput value={edit.code || ''} onChange={(v) => setEdit({ ...edit, code: v })} /></Field><Field label="Category"><TextInput value={edit.category} onChange={(v) => setEdit({ ...edit, category: v })} /></Field></div>
          <Field label="Description" required><TextInput value={edit.description} onChange={(v) => setEdit({ ...edit, description: v })} /></Field>
          <div className="grid" style={{ gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
            <Field label="Unit"><TextInput value={edit.unit} onChange={(v) => setEdit({ ...edit, unit: v })} /></Field>
            <Field label="Quantity" required><TextInput type="number" value={edit.qty} onChange={(v) => setEdit({ ...edit, qty: v })} /></Field>
            <Field label="Rate" required><TextInput type="number" value={edit.rate} onChange={(v) => setEdit({ ...edit, rate: v })} /></Field>
          </div>
          {!!phases.length && <Field label="Phase"><select className="input" value={edit.phase_id || ''} onChange={(e) => setEdit({ ...edit, phase_id: e.target.value || null })}><option value="">—</option>{sel(phases)}</select></Field>}
        </Modal>
      )}
      {imp !== null && (
        <Modal title="Import BOQ" size="lg" onClose={() => setImp(null)} footer={<><button className="btn" onClick={() => setImp(null)}>Cancel</button><button className="btn primary" disabled={!parse(imp).length} onClick={async () => { if (await act(() => api.post(`${B}/projects/${project.id}/boq/import`, { rows: parse(imp) }), `${parse(imp).length} items imported`)) setImp(null); }}>Import {parse(imp).length || ''} items</button></>}>
          <p className="muted">Paste rows from Excel or a CSV file: <b>Category, Description, Unit, Qty, Rate</b> (optional 6th column: code). One item per line, no header.</p>
          <textarea className="input mono" rows={12} value={imp} onChange={(e) => setImp(e.target.value)} placeholder={'Structure\tBrick masonry 9"\tcft\t1200\t95'} />
        </Modal>
      )}
      {prog && (
        <Modal title="Record measured progress" size="lg" onClose={() => setProg(null)} footer={<><button className="btn" onClick={() => setProg(null)}>Cancel</button><button className="btn primary" onClick={async () => { const items = Object.entries(prog).filter(([, q]) => Number(q)).map(([k, q]) => ({ boq_item_id: Number(k), qty: Number(q) })); if (items.length && await act(() => api.post(`${B}/projects/${project.id}/progress`, { items }), 'Progress recorded')) setProg(null); }}>Save</button></>}>
          <p className="muted">Quantity completed since the last measurement (negative to correct). It cannot exceed the BOQ quantity.</p>
          <div className="table-wrap"><table className="t"><tbody>{data.map((b) => <tr key={b.id}><td>{b.description}<div className="muted">{num(b.completed_qty)} of {num(b.qty)} {b.unit}</div></td><td style={{ width: 120 }}><input className="input" type="number" value={prog[b.id]} onChange={(e) => setProg({ ...prog, [b.id]: e.target.value })} aria-label={`Progress for ${b.description}`} /></td></tr>)}</tbody></table></div>
        </Modal>
      )}
    </Card>
  );
}

function ChangesTab({ project, onChange }) {
  const { can } = useAuth();
  const { data, reload } = useFetch(`${B}/projects/${project.id}/change-orders`);
  const [edit, setEdit] = useState(null);
  const [rej, setRej] = useState(null);
  const act = useAct(() => { reload(); onChange(); });
  if (!data) return <Loading />;
  return (
    <Card flush title="Change orders" actions={can('construction', 'create') && <button className="btn sm primary" onClick={() => setEdit({ title: '', description: '', amount: '', days_impact: 0, origin: 'client', client_visible: true })}>New change order</button>}>
      <p className="muted" style={{ padding: '0 16px' }}>Approved change orders adjust the project budget. To bill the client for a variation, add it to their construction contract as an extra contract.</p>
      {!data.length ? <Empty title="No change orders" /> : <div className="table-wrap"><table className="t"><thead><tr><th>No.</th><th>Change</th><th className="right">Amount</th><th>Days</th><th>Status</th><th /></tr></thead><tbody>
        {data.map((c) => <tr key={c.id}><td className="mono">{c.co_no}</td><td><b>{c.title}</b><div className="muted">{c.origin} · {c.client_visible ? 'shown to client' : 'internal'}{c.decision_note ? ` · ${c.decision_note}` : ''}</div></td><td className="right mono">{money(c.amount)}</td><td>{c.days_impact}</td><td><Badge s={c.status} /></td>
          <td className="right nowrap">{c.status === 'draft' && can('construction', 'edit') && <button className="btn sm" onClick={() => act(() => api.post(`${B}/change-orders/${c.id}/submit`), 'Submitted for approval')}>Submit</button>}{' '}
            {['draft', 'submitted'].includes(c.status) && can('construction', 'approve') && <><button className="btn sm primary" onClick={() => act(() => api.post(`${B}/change-orders/${c.id}/approve`), 'Approved')}>Approve</button>{' '}<button className="btn sm" onClick={() => setRej(c)}>Reject</button></>}</td></tr>)}
      </tbody></table></div>}
      {edit && (
        <Modal title="New change order" onClose={() => setEdit(null)} footer={<><button className="btn" onClick={() => setEdit(null)}>Cancel</button><button className="btn primary" onClick={async () => { if (await act(() => api.post(`${B}/change-orders`, { ...edit, project_id: project.id }), 'Change order created')) setEdit(null); }}>Save</button></>}>
          <Field label="Title" required><TextInput value={edit.title} onChange={(v) => setEdit({ ...edit, title: v })} /></Field>
          <Field label="Description"><textarea className="input" rows={3} value={edit.description} onChange={(e) => setEdit({ ...edit, description: e.target.value })} /></Field>
          <div className="grid" style={{ gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
            <Field label="Amount" hint="Negative for a reduction"><TextInput type="number" value={edit.amount} onChange={(v) => setEdit({ ...edit, amount: v })} /></Field>
            <Field label="Schedule impact (days)"><TextInput type="number" value={edit.days_impact} onChange={(v) => setEdit({ ...edit, days_impact: v })} /></Field>
            <Field label="Requested by"><select className="input" value={edit.origin} onChange={(e) => setEdit({ ...edit, origin: e.target.value })}><option value="client">Client</option><option value="internal">Internal</option><option value="site">Site condition</option></select></Field>
          </div>
          <Toggle value={edit.client_visible} onChange={(v) => setEdit({ ...edit, client_visible: v })} label="Show to the client in their portal" />
        </Modal>
      )}
      {rej && <ConfirmDialog title={`Reject ${rej.co_no}?`} danger reason confirmLabel="Reject" message="The reason is kept with the change order." onCancel={() => setRej(null)} onConfirm={async (note) => { await act(() => api.post(`${B}/change-orders/${rej.id}/reject`, { note }), 'Rejected'); setRej(null); }} />}
    </Card>
  );
}

// ---------------------------------------------------------------- procurement
export function PurchaseOrders({ project, sites, onChange }) {
  const { can } = useAuth();
  const { data, reload } = useFetch(`${B}/purchase-orders`, project ? { project_id: project.id } : undefined);
  const vendors = useFetch('/api/accounting/vendors').data;
  const materials = useFetch(`${B}/materials`).data;
  const projects = useFetch(project ? null : `${B}/overview`).data;
  const [open, setOpen] = useState(null);
  const [edit, setEdit] = useState(null);
  const act = useAct(() => { reload(); onChange?.(); if (open) api.get(`${B}/purchase-orders/${open.id}`).then(setOpen).catch(() => {}); });
  const vendorRows = Array.isArray(vendors) ? vendors : vendors?.rows || [];
  const editSites = useSites(edit?.project_id, sites);
  if (!data) return <Loading />;
  const newPo = () => setEdit({ project_id: project?.id || '', site_id: sites?.[0]?.id || '', vendor_id: '', order_date: today(), expected_date: '', notes: '', lines: [{ material_id: '', description: '', unit: '', qty: '', rate: '' }] });
  const setLine = (i, k, v) => setEdit({ ...edit, lines: edit.lines.map((l, j) => (j === i ? { ...l, [k]: v } : l)) });
  return (
    <Card flush title="Purchase orders" actions={can('construction', 'create') && <button className="btn sm primary" onClick={newPo}>New purchase order</button>}>
      {!data.length ? <Empty title="No purchase orders" /> : <div className="table-wrap"><table className="t"><thead><tr><th>PO</th><th>Supplier</th>{!project && <th>Project</th>}<th>Date</th><th className="right">Total</th><th className="right">Billed</th><th>Status</th></tr></thead><tbody>
        {data.map((po) => <tr key={po.id} style={{ cursor: 'pointer' }} onClick={() => api.get(`${B}/purchase-orders/${po.id}`).then(setOpen)}><td className="mono">{po.po_no}</td><td>{po.vendor_name}<div className="muted">{po.site_name || ''}</div></td>{!project && <td>{po.project_name}</td>}<td>{fdate(po.order_date)}</td><td className="right mono">{money(po.total)}</td><td className="right mono">{money(po.billed)}</td><td><Badge s={po.status} /></td></tr>)}
      </tbody></table></div>}
      {open && <PoPanel po={open} onClose={() => setOpen(null)} act={act} />}
      {edit && (
        <Modal title="New purchase order" size="lg" onClose={() => setEdit(null)} footer={<><button className="btn" onClick={() => setEdit(null)}>Cancel</button><button className="btn primary" onClick={async () => { const out = await act(() => api.post(`${B}/purchase-orders`, { ...edit, lines: edit.lines.filter((l) => l.qty) }), 'Purchase order created as draft'); if (out) setEdit(null); }}>Save draft</button></>}>
          <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            {!project && <Field label="Project" required><select className="input" value={edit.project_id} onChange={(e) => setEdit({ ...edit, project_id: e.target.value, site_id: '' })}><option value="">Choose</option>{sel(projects?.projects)}</select></Field>}
            <Field label="Supplier" required><select className="input" value={edit.vendor_id} onChange={(e) => setEdit({ ...edit, vendor_id: e.target.value })}><option value="">Choose</option>{sel(vendorRows)}</select></Field>
            <Field label="Deliver to site"><select className="input" value={edit.site_id} onChange={(e) => setEdit({ ...edit, site_id: e.target.value })}><option value="">—</option>{sel(editSites)}</select></Field>
            <Field label="Order date"><input type="date" className="input" value={edit.order_date} onChange={(e) => setEdit({ ...edit, order_date: e.target.value })} /></Field>
            <Field label="Expected delivery"><input type="date" className="input" value={edit.expected_date} onChange={(e) => setEdit({ ...edit, expected_date: e.target.value })} /></Field>
          </div>
          <div className="table-wrap"><table className="t"><thead><tr><th>Material</th><th>Description</th><th>Unit</th><th>Qty</th><th>Rate</th><th className="right">Amount</th></tr></thead><tbody>
            {edit.lines.map((l, i) => <tr key={i}>
              <td><select className="input" value={l.material_id} onChange={(e) => { const m = materials?.find((x) => x.id === Number(e.target.value)); setEdit({ ...edit, lines: edit.lines.map((x, j) => (j === i ? { ...x, material_id: e.target.value, description: x.description || m?.name || '', unit: m?.unit || x.unit } : x)) }); }} aria-label="Material"><option value="">Other</option>{sel(materials)}</select></td>
              <td><input className="input" value={l.description} onChange={(e) => setLine(i, 'description', e.target.value)} aria-label="Description" /></td>
              <td style={{ width: 80 }}><input className="input" value={l.unit} onChange={(e) => setLine(i, 'unit', e.target.value)} aria-label="Unit" /></td>
              <td style={{ width: 90 }}><input className="input" type="number" value={l.qty} onChange={(e) => setLine(i, 'qty', e.target.value)} aria-label="Quantity" /></td>
              <td style={{ width: 110 }}><input className="input" type="number" value={l.rate} onChange={(e) => setLine(i, 'rate', e.target.value)} aria-label="Rate" /></td>
              <td className="right mono">{num(Math.round((Number(l.qty) || 0) * (Number(l.rate) || 0)))}</td></tr>)}
          </tbody></table></div>
          <button className="btn sm" style={{ marginTop: 8 }} onClick={() => setEdit({ ...edit, lines: [...edit.lines, { material_id: '', description: '', unit: '', qty: '', rate: '' }] })}>Add line</button>
        </Modal>
      )}
    </Card>
  );
}
function useSites(projectId, given) {
  const { data } = useFetch(!given && projectId ? `${B}/projects/${projectId}/sites` : null);
  return given || data || [];
}
function PoPanel({ po, onClose, act }) {
  const { can } = useAuth();
  const [rec, setRec] = useState(null);
  return (
    <Modal title={`${po.po_no} · ${po.vendor_name}`} size="lg" onClose={onClose} footer={<>
      <button className="btn" onClick={() => download(`${B}/purchase-orders/${po.id}`, { format: 'pdf' }, `${po.po_no}.pdf`)}>PDF</button>
      {po.status === 'draft' && can('construction', 'approve') && <button className="btn primary" onClick={() => act(() => api.post(`${B}/purchase-orders/${po.id}/approve`), 'Approved')}>Approve</button>}
      {['approved', 'partially_received'].includes(po.status) && can('construction', 'edit') && <button className="btn primary" onClick={() => setRec(Object.fromEntries(po.lines.map((l) => [l.id, ''])))}>Receive goods</button>}
      {po.unbilled > 0 && can('construction', 'approve') && <button className="btn" onClick={() => act(() => api.post(`${B}/purchase-orders/${po.id}/bill`, {}), 'Supplier bill sent to Finance for approval')}>Bill {money(po.unbilled)}</button>}
      {['draft', 'approved'].includes(po.status) && !po.lines.some((l) => l.received_qty) && can('construction', 'approve') && <button className="btn danger" onClick={() => act(() => api.post(`${B}/purchase-orders/${po.id}/cancel`), 'Cancelled')}>Cancel PO</button>}
      {['approved', 'partially_received', 'received'].includes(po.status) && can('construction', 'approve') && <button className="btn" onClick={() => act(() => api.post(`${B}/purchase-orders/${po.id}/close`), 'Closed')}>Close</button>}
      <button className="btn" onClick={onClose}>Done</button></>}>
      <p>{po.project_name}{po.site_name ? ` · deliver to ${po.site_name}` : ''} · ordered {fdate(po.order_date)} · <Badge s={po.status} /></p>
      <div className="table-wrap"><table className="t"><thead><tr><th>Item</th><th className="right">Ordered</th><th className="right">Received</th><th className="right">Rate</th><th className="right">Amount</th>{rec && <th>Receive now</th>}</tr></thead><tbody>
        {po.lines.map((l) => <tr key={l.id}><td>{l.description}</td><td className="right">{num(l.qty)} {l.unit}</td><td className="right">{num(l.received_qty)}</td><td className="right mono">{num(l.rate)}</td><td className="right mono">{num(Math.round(l.qty * l.rate))}</td>
          {rec && <td style={{ width: 110 }}><input className="input" type="number" value={rec[l.id]} onChange={(e) => setRec({ ...rec, [l.id]: e.target.value })} aria-label={`Receive ${l.description}`} /></td>}</tr>)}
      </tbody></table></div>
      {rec && <div className="row" style={{ gap: 8, marginTop: 8 }}><button className="btn primary" onClick={async () => { if (await act(() => api.post(`${B}/purchase-orders/${po.id}/receive`, { lines: Object.entries(rec).filter(([, q]) => Number(q)).map(([line_id, qty]) => ({ line_id: Number(line_id), qty: Number(qty) })) }), 'Goods received into site stock')) setRec(null); }}>Save receipt</button><button className="btn" onClick={() => setRec(null)}>Cancel</button></div>}
      <p className="muted">Received value {money(po.received_value)} · billed {money(po.billed)} · not billed {money(po.unbilled)}</p>
      {!!po.bills.length && <div className="table-wrap"><table className="t"><tbody>{po.bills.map((b) => <tr key={b.id}><td><Link to={`/expenses/${b.voucher_id}`}>{b.voucher_no}</Link></td><td className="mono">{money(b.amount)}</td><td><Badge s={b.voucher_status} /></td></tr>)}</tbody></table></div>}
    </Modal>
  );
}

// ---------------------------------------------------------------- stock and materials
function StockTab({ project, sites }) {
  const { can } = useAuth();
  const { data, reload } = useFetch(`${B}/stock`, { project_id: project.id });
  const moves = useFetch(`${B}/stock/moves`, { project_id: project.id });
  const materials = useFetch(`${B}/materials`).data;
  const boq = useFetch(`${B}/projects/${project.id}/boq`).data;
  const [mv, setMv] = useState(null);
  const act = useAct(() => { reload(); moves.reload(); });
  if (!data) return <Loading />;
  return (
    <>
      <Card flush title="Stock at this project's sites" actions={can('construction', 'edit') && <button className="btn sm primary" onClick={() => setMv({ kind: 'issue', material_id: '', site_id: sites[0]?.id || '', to_site_id: '', qty: '', boq_item_id: '', note: '', date: today() })}>Issue / move stock</button>}>
        {!data.length ? <Empty title="No stock yet" hint="Stock arrives when goods on a purchase order are received at a site." /> : <div className="table-wrap"><table className="t"><thead><tr><th>Site</th><th>Material</th><th className="right">In stock</th><th className="right">Issued</th><th className="right">Avg cost</th></tr></thead><tbody>
          {data.map((s) => <tr key={`${s.site_id}-${s.material_id}`}><td>{s.site_name}</td><td>{s.material}{s.low && <StatusBadge status="overdue" label="Low" />}</td><td className="right">{num(s.balance)} {s.unit}</td><td className="right">{num(s.issued_qty)}</td><td className="right mono">{s.avg_cost == null ? '—' : num(s.avg_cost)}</td></tr>)}
        </tbody></table></div>}
      </Card>
      <Card flush title="Movements">{!moves.data?.length ? <Empty title="No movements" /> : <div className="table-wrap"><table className="t"><tbody>{moves.data.map((m) => <tr key={m.id}><td className="nowrap">{fdate(m.date)}</td><td>{m.kind.replace('_', ' ')}</td><td>{m.material}</td><td className="right">{num(m.qty)} {m.unit}</td><td>{m.site_name}</td><td className="muted">{m.note || ''} {m.by_name ? `· ${m.by_name}` : ''}</td></tr>)}</tbody></table></div>}</Card>
      {mv && (
        <Modal title="Stock movement" onClose={() => setMv(null)} footer={<><button className="btn" onClick={() => setMv(null)}>Cancel</button><button className="btn primary" onClick={async () => { if (await act(() => api.post(`${B}/stock/moves`, mv), 'Saved')) setMv(null); }}>Save</button></>}>
          <Field label="Movement"><select className="input" value={mv.kind} onChange={(e) => setMv({ ...mv, kind: e.target.value })}><option value="issue">Issue to work</option><option value="return">Return from work</option><option value="transfer">Transfer to another site</option><option value="adjust_in">Adjustment: add</option><option value="adjust_out">Adjustment: remove (loss, damage)</option></select></Field>
          <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="Material" required><select className="input" value={mv.material_id} onChange={(e) => setMv({ ...mv, material_id: e.target.value })}><option value="">Choose</option>{sel(materials)}</select></Field>
            <Field label="Quantity" required><TextInput type="number" value={mv.qty} onChange={(v) => setMv({ ...mv, qty: v })} /></Field>
            <Field label="Site" required><select className="input" value={mv.site_id} onChange={(e) => setMv({ ...mv, site_id: e.target.value })}>{sel(sites)}</select></Field>
            {mv.kind === 'transfer' ? <Field label="To site" required><select className="input" value={mv.to_site_id} onChange={(e) => setMv({ ...mv, to_site_id: e.target.value })}><option value="">Choose</option>{sel(sites.filter((s) => String(s.id) !== String(mv.site_id)))}</select></Field>
              : mv.kind === 'issue' ? <Field label="For BOQ item"><select className="input" value={mv.boq_item_id} onChange={(e) => setMv({ ...mv, boq_item_id: e.target.value })}><option value="">—</option>{sel(boq, 'description')}</select></Field> : <span />}
          </div>
          <Field label="Date"><input type="date" className="input" value={mv.date} onChange={(e) => setMv({ ...mv, date: e.target.value })} /></Field>
          <Field label="Note" required={mv.kind.startsWith('adjust')}><TextInput value={mv.note} onChange={(v) => setMv({ ...mv, note: v })} /></Field>
        </Modal>
      )}
    </>
  );
}

export function MaterialsPage() {
  const { can } = useAuth();
  const { data, reload } = useFetch(`${B}/materials`);
  const stock = useFetch(`${B}/stock`);
  const [edit, setEdit] = useState(null);
  const act = useAct(() => { reload(); stock.reload(); });
  if (!data) return <Loading />;
  return (
    <div>
      <PageHead title="Materials & stock" sub="Material catalogue and stock at every site">
        <button className="btn" onClick={() => download(`${B}/stock`, { format: 'xlsx' }, 'site-stock.xlsx')}>Export stock</button>
        {can('construction', 'create') && <button className="btn primary" onClick={() => setEdit({ code: '', name: '', unit: 'nos', category: '', reorder_level: '' })}>New material</button>}
      </PageHead>
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(360px,1fr))', gap: 16 }}>
        <Card flush title="Catalogue">{!data.length ? <Empty title="No materials yet" /> : <div className="table-wrap"><table className="t"><thead><tr><th>Material</th><th>Unit</th><th>Reorder at</th><th /></tr></thead><tbody>
          {data.map((m) => <tr key={m.id}><td><b>{m.name}</b><div className="muted">{[m.code, m.category].filter(Boolean).join(' · ')}{m.active ? '' : ' · inactive'}</div></td><td>{m.unit}</td><td>{m.reorder_level ?? '—'}</td><td className="right">{can('construction', 'edit') && <button className="btn sm" onClick={() => setEdit({ ...m })}>Edit</button>}</td></tr>)}
        </tbody></table></div>}</Card>
        <Card flush title="Stock by site">{!stock.data?.length ? <Empty title="No stock yet" /> : <div className="table-wrap"><table className="t"><tbody>{stock.data.map((s) => <tr key={`${s.site_id}-${s.material_id}`}><td>{s.site_name}</td><td>{s.material}{s.low && <StatusBadge status="overdue" label="Low" />}</td><td className="right">{num(s.balance)} {s.unit}</td></tr>)}</tbody></table></div>}</Card>
      </div>
      {edit && (
        <Modal title={edit.id ? 'Edit material' : 'New material'} onClose={() => setEdit(null)} footer={<><button className="btn" onClick={() => setEdit(null)}>Cancel</button><button className="btn primary" onClick={async () => { if (await act(() => (edit.id ? api.put(`${B}/materials/${edit.id}`, edit) : api.post(`${B}/materials`, edit)), 'Saved')) setEdit(null); }}>Save</button></>}>
          <div className="grid" style={{ gridTemplateColumns: '1fr 2fr', gap: 12 }}><Field label="Code"><TextInput value={edit.code || ''} disabled={!!edit.id} onChange={(v) => setEdit({ ...edit, code: v })} /></Field><Field label="Name" required><TextInput value={edit.name} onChange={(v) => setEdit({ ...edit, name: v })} /></Field></div>
          <div className="grid" style={{ gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
            <Field label="Unit"><TextInput value={edit.unit} onChange={(v) => setEdit({ ...edit, unit: v })} /></Field>
            <Field label="Category"><TextInput value={edit.category || ''} onChange={(v) => setEdit({ ...edit, category: v })} /></Field>
            <Field label="Reorder level"><TextInput type="number" value={edit.reorder_level ?? ''} onChange={(v) => setEdit({ ...edit, reorder_level: v })} /></Field>
          </div>
          {edit.id && <Toggle value={!!edit.active} onChange={(v) => setEdit({ ...edit, active: v })} label="Active" />}
        </Modal>
      )}
    </div>
  );
}
export function PurchaseOrdersPage() {
  return <div><PageHead title="Purchase orders" sub="Orders to suppliers across all construction projects" /><PurchaseOrders /></div>;
}

// ---------------------------------------------------------------- labour
function LabourTab({ project, sites, onChange }) {
  const { can } = useAuth();
  const { data, reload } = useFetch(`${B}/projects/${project.id}/labour`);
  const vendors = useFetch('/api/accounting/vendors').data;
  const [edit, setEdit] = useState(null);
  const [post, setPost] = useState(null);
  const act = useAct(() => { reload(); onChange(); });
  if (!data) return <Loading />;
  const unposted = data.filter((l) => !l.voucher_id);
  const vendorRows = Array.isArray(vendors) ? vendors : vendors?.rows || [];
  return (
    <Card flush title="Labour" actions={<>
      {can('construction', 'approve') && !!unposted.length && <button className="btn sm" onClick={() => setPost({ from: '', to: today() })}>Post {money(unposted.reduce((s, l) => s + l.amount, 0))} to accounts</button>}
      {can('construction', 'create') && <button className="btn sm primary" onClick={() => setEdit({ date: today(), site_id: sites[0]?.id || '', trade: '', workers: '', days: 1, rate: '', vendor_id: '', notes: '' })}>Add labour</button>}
    </>}>
      {!data.length ? <Empty title="No labour recorded" /> : <div className="table-wrap"><table className="t"><thead><tr><th>Date</th><th>Trade</th><th>Site</th><th className="right">Workers × days</th><th className="right">Rate</th><th className="right">Amount</th><th>Accounts</th><th /></tr></thead><tbody>
        {data.map((l) => <tr key={l.id}><td className="nowrap">{fdate(l.date)}</td><td>{l.trade}{l.vendor_name ? <div className="muted">{l.vendor_name}</div> : null}</td><td>{l.site_name || '—'}</td><td className="right">{l.workers} × {l.days}</td><td className="right mono">{num(l.rate)}</td><td className="right mono">{num(l.amount)}</td>
          <td>{l.voucher_no ? <Link to={`/expenses/${l.voucher_id}`}>{l.voucher_no}</Link> : <span className="muted">not posted</span>}</td><td className="right">{!l.voucher_id && can('construction', 'delete') && <button className="btn sm danger" onClick={() => act(() => api.del(`${B}/labour/${l.id}`), 'Deleted')}>Delete</button>}</td></tr>)}
      </tbody></table></div>}
      {edit && (
        <Modal title="Add labour" onClose={() => setEdit(null)} footer={<><button className="btn" onClick={() => setEdit(null)}>Cancel</button><button className="btn primary" onClick={async () => { if (await act(() => api.post(`${B}/labour`, { ...edit, project_id: project.id }), 'Saved')) setEdit(null); }}>Save</button></>}>
          <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="Date"><input type="date" className="input" value={edit.date} onChange={(e) => setEdit({ ...edit, date: e.target.value })} /></Field>
            <Field label="Site"><select className="input" value={edit.site_id} onChange={(e) => setEdit({ ...edit, site_id: e.target.value })}><option value="">—</option>{sel(sites)}</select></Field>
            <Field label="Trade" required><TextInput value={edit.trade} onChange={(v) => setEdit({ ...edit, trade: v })} placeholder="Mason, Helper, Steel fixer…" /></Field>
            <Field label="Labour contractor"><select className="input" value={edit.vendor_id} onChange={(e) => setEdit({ ...edit, vendor_id: e.target.value })}><option value="">Direct (own workers)</option>{sel(vendorRows)}</select></Field>
            <Field label="Workers" required><TextInput type="number" value={edit.workers} onChange={(v) => setEdit({ ...edit, workers: v })} /></Field>
            <Field label="Days"><TextInput type="number" value={edit.days} onChange={(v) => setEdit({ ...edit, days: v })} /></Field>
            <Field label="Rate per worker-day" required><TextInput type="number" value={edit.rate} onChange={(v) => setEdit({ ...edit, rate: v })} /></Field>
            <Field label="Amount"><div className="mono" style={{ paddingTop: 8 }}>{num(Math.round((Number(edit.workers) || 0) * (Number(edit.days) || 0) * (Number(edit.rate) || 0)))}</div></Field>
          </div>
        </Modal>
      )}
      {post && (
        <Modal title="Post labour to accounts" onClose={() => setPost(null)} footer={<><button className="btn" onClick={() => setPost(null)}>Cancel</button><button className="btn primary" onClick={async () => { if (await act(() => api.post(`${B}/projects/${project.id}/labour/post`, post), 'Labour voucher sent to Finance for approval')) setPost(null); }}>Post</button></>}>
          <p>All unposted labour in the period becomes one labour expense voucher for this project. Finance approves and pays it as usual.</p>
          <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 12 }}><Field label="From (optional)"><input type="date" className="input" value={post.from} onChange={(e) => setPost({ ...post, from: e.target.value })} /></Field><Field label="To"><input type="date" className="input" value={post.to} onChange={(e) => setPost({ ...post, to: e.target.value })} /></Field></div>
        </Modal>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------- subcontracts
export function Subcontracts({ project, onChange }) {
  const { can } = useAuth();
  const { data, reload } = useFetch(`${B}/subcontracts`, project ? { project_id: project.id } : undefined);
  const vendors = useFetch('/api/accounting/vendors').data;
  const projects = useFetch(project ? null : `${B}/overview`).data;
  const [edit, setEdit] = useState(null);
  const [open, setOpen] = useState(null);
  const [ipc, setIpc] = useState(null);
  const refresh = (id) => api.get(`${B}/subcontracts/${id}`).then(setOpen).catch(() => {});
  const act = useAct(() => { reload(); onChange?.(); if (open) refresh(open.id); });
  const vendorRows = Array.isArray(vendors) ? vendors : vendors?.rows || [];
  if (!data) return <Loading />;
  return (
    <Card flush title="Subcontracts" actions={can('construction', 'create') && <button className="btn sm primary" onClick={() => setEdit({ project_id: project?.id || '', vendor_id: '', title: '', scope: '', value: '', retention_pct: 5, start_date: '', end_date: '' })}>New subcontract</button>}>
      {!data.length ? <Empty title="No subcontracts" /> : <div className="table-wrap"><table className="t"><thead><tr><th>No.</th><th>Work</th><th>Contractor</th>{!project && <th>Project</th>}<th className="right">Value</th><th>Certified</th><th>Status</th></tr></thead><tbody>
        {data.map((s) => <tr key={s.id} style={{ cursor: 'pointer' }} onClick={() => refresh(s.id)}><td className="mono">{s.sc_no}</td><td>{s.title}</td><td>{s.vendor_name}</td>{!project && <td>{s.project_name}</td>}<td className="right mono">{money(s.value)}</td><td style={{ minWidth: 120 }}><ProgressBar value={Math.round((s.certified / s.value) * 100)} tone="green" /><div className="muted">{money(s.certified)}</div></td><td><Badge s={s.status} /></td></tr>)}
      </tbody></table></div>}
      {edit && (
        <Modal title="New subcontract" onClose={() => setEdit(null)} footer={<><button className="btn" onClick={() => setEdit(null)}>Cancel</button><button className="btn primary" onClick={async () => { if (await act(() => api.post(`${B}/subcontracts`, edit), 'Subcontract created as draft')) setEdit(null); }}>Save</button></>}>
          {!project && <Field label="Project" required><select className="input" value={edit.project_id} onChange={(e) => setEdit({ ...edit, project_id: e.target.value })}><option value="">Choose</option>{sel(projects?.projects)}</select></Field>}
          <Field label="Contractor" required><select className="input" value={edit.vendor_id} onChange={(e) => setEdit({ ...edit, vendor_id: e.target.value })}><option value="">Choose</option>{sel(vendorRows)}</select></Field>
          <Field label="Work package" required><TextInput value={edit.title} onChange={(v) => setEdit({ ...edit, title: v })} placeholder="Masonry, plumbing, electrical…" /></Field>
          <Field label="Scope"><textarea className="input" rows={3} value={edit.scope} onChange={(e) => setEdit({ ...edit, scope: e.target.value })} /></Field>
          <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="Contract value" required><TextInput type="number" value={edit.value} onChange={(v) => setEdit({ ...edit, value: v })} /></Field>
            <Field label="Retention %" hint="Held from each certificate (0-20%)"><TextInput type="number" value={edit.retention_pct} onChange={(v) => setEdit({ ...edit, retention_pct: v })} /></Field>
            <Field label="Start"><input type="date" className="input" value={edit.start_date} onChange={(e) => setEdit({ ...edit, start_date: e.target.value })} /></Field>
            <Field label="End"><input type="date" className="input" value={edit.end_date} onChange={(e) => setEdit({ ...edit, end_date: e.target.value })} /></Field>
          </div>
        </Modal>
      )}
      {open && (
        <Modal title={`${open.sc_no} · ${open.title}`} size="lg" onClose={() => setOpen(null)} footer={<>
          {open.status === 'draft' && can('construction', 'approve') && <button className="btn primary" onClick={() => act(() => api.post(`${B}/subcontracts/${open.id}/status`, { status: 'active' }), 'Activated')}>Activate</button>}
          {open.status === 'active' && can('construction', 'create') && <button className="btn primary" onClick={() => setIpc({ kind: 'progress', mode: 'percent', percent: '', work_done_to_date: '', deductions: '', period_to: today(), notes: '' })}>New payment certificate</button>}
          {open.retention_held > 0 && ['active', 'completed'].includes(open.status) && can('construction', 'create') && <button className="btn" onClick={() => setIpc({ kind: 'retention_release', amount: open.retention_held, period_to: today(), notes: '' })}>Release retention</button>}
          {open.status === 'active' && can('construction', 'approve') && <button className="btn" onClick={() => act(() => api.post(`${B}/subcontracts/${open.id}/status`, { status: 'completed' }), 'Marked completed')}>Mark completed</button>}
          <button className="btn" onClick={() => setOpen(null)}>Done</button></>}>
          <p>{open.vendor_name} · {open.project_name} · value {money(open.value)} · retention {open.retention_pct}% · <Badge s={open.status} /></p>
          <div className="grid" style={{ gridTemplateColumns: 'repeat(4,1fr)', gap: 8, marginBottom: 8 }}>
            <Stat label="Certified" value={money(open.certified_to_date)} /><Stat label="Remaining" value={money(open.remaining)} /><Stat label="Retention held" value={money(open.retention_held)} /><Stat label="Net certified" value={money(open.paid_to_date)} />
          </div>
          {!open.certificates.length ? <Empty title="No certificates yet" /> : <div className="table-wrap"><table className="t"><thead><tr><th>IPC</th><th>To</th><th className="right">Work to date</th><th className="right">This period</th><th className="right">Retention</th><th className="right">Net</th><th>Status</th><th /></tr></thead><tbody>
            {open.certificates.map((c) => <tr key={c.id}><td className="mono">{c.ipc_no}{c.kind === 'retention_release' ? <div className="muted">retention release</div> : null}</td><td>{fdate(c.period_to)}</td><td className="right mono">{num(c.work_done_to_date)}</td><td className="right mono">{num(c.this_period)}</td><td className="right mono">{num(c.retention_amount)}</td><td className="right mono">{num(c.net_payable)}</td>
              <td><Badge s={c.status} />{c.voucher_no && <div><Link to={`/expenses/${c.voucher_id}`}>{c.voucher_no}</Link></div>}</td>
              <td className="right nowrap">{c.status === 'draft' && <>{can('construction', 'approve') && <button className="btn sm primary" onClick={() => act(() => api.post(`${B}/certificates/${c.id}/approve`), 'Approved; voucher sent to Finance')}>Approve</button>}{' '}<button className="btn sm" onClick={() => act(() => api.post(`${B}/certificates/${c.id}/cancel`), 'Cancelled')}>Cancel</button></>}</td></tr>)}
          </tbody></table></div>}
        </Modal>
      )}
      {ipc && open && (
        <Modal title={ipc.kind === 'retention_release' ? 'Release retention' : 'Payment certificate'} onClose={() => setIpc(null)} footer={<><button className="btn" onClick={() => setIpc(null)}>Cancel</button><button className="btn primary" onClick={async () => {
          const body = ipc.kind === 'retention_release' ? { kind: 'retention_release', amount: ipc.amount, period_to: ipc.period_to, notes: ipc.notes } : { kind: 'progress', ...(ipc.mode === 'percent' ? { percent: ipc.percent } : { work_done_to_date: ipc.work_done_to_date }), deductions: ipc.deductions || 0, period_to: ipc.period_to, notes: ipc.notes };
          if (await act(() => api.post(`${B}/subcontracts/${open.id}/certificates`, body), 'Draft certificate created')) setIpc(null); }}>Create draft</button></>}>
          {ipc.kind === 'retention_release' ? <Field label="Amount to release" hint={`Held: ${money(open.retention_held)}`}><TextInput type="number" value={ipc.amount} onChange={(v) => setIpc({ ...ipc, amount: v })} /></Field> : <>
            <p className="muted">Enter the cumulative work done to date. The certificate pays the difference from what was already certified ({money(open.certified_to_date)}), less {open.retention_pct}% retention and any deductions.</p>
            <Field label="Measure as"><select className="input" value={ipc.mode} onChange={(e) => setIpc({ ...ipc, mode: e.target.value })}><option value="percent">% of the subcontract complete</option><option value="amount">Value of work done to date</option></select></Field>
            {ipc.mode === 'percent' ? <Field label="% complete to date"><TextInput type="number" value={ipc.percent} onChange={(v) => setIpc({ ...ipc, percent: v })} /></Field> : <Field label="Work done to date"><TextInput type="number" value={ipc.work_done_to_date} onChange={(v) => setIpc({ ...ipc, work_done_to_date: v })} /></Field>}
            <Field label="Other deductions" hint="e.g. materials supplied, advance recovery"><TextInput type="number" value={ipc.deductions} onChange={(v) => setIpc({ ...ipc, deductions: v })} /></Field></>}
          <Field label="Period to"><input type="date" className="input" value={ipc.period_to} onChange={(e) => setIpc({ ...ipc, period_to: e.target.value })} /></Field>
          <Field label="Notes"><TextInput value={ipc.notes} onChange={(v) => setIpc({ ...ipc, notes: v })} /></Field>
        </Modal>
      )}
    </Card>
  );
}
export function SubcontractsPage() {
  return <div><PageHead title="Subcontracts" sub="Contractors, payment certificates and retention" /><Subcontracts /></div>;
}

// ---------------------------------------------------------------- site reports
function ReportsTab({ project, sites, onChange }) {
  const { can } = useAuth();
  const { data, reload } = useFetch(`${B}/projects/${project.id}/reports`);
  const boq = useFetch(`${B}/projects/${project.id}/boq`).data;
  const [edit, setEdit] = useState(null);
  const act = useAct(() => { reload(); onChange(); });
  if (!data) return <Loading />;
  return (
    <Card flush title="Daily site reports" actions={can('construction', 'create') && <button className="btn sm primary" onClick={() => setEdit({ date: today(), site_id: sites[0]?.id || '', weather: '', workers_on_site: '', work_done: '', issues: '', safety: '', client_visible: false, progress: {} })}>New report</button>}>
      {!data.length ? <Empty title="No site reports yet" /> : data.map((d) => (
        <div key={d.id} style={{ padding: '12px 16px', borderTop: '1px solid var(--border)' }}>
          <div className="row between"><b>{fdate(d.date)}{d.site_name ? ` · ${d.site_name}` : ''}</b><span className="muted">{[d.weather, d.workers_on_site != null && `${d.workers_on_site} workers`, d.by_name, d.client_visible ? 'shown to client' : null].filter(Boolean).join(' · ')}</span></div>
          <div style={{ whiteSpace: 'pre-wrap', marginTop: 4 }}>{d.work_done}</div>
          {d.issues && <div className="muted" style={{ marginTop: 4 }}><b>Issues:</b> {d.issues}</div>}
          {d.safety && <div className="muted"><b>Safety:</b> {d.safety}</div>}
          {!!d.progress.length && <div className="muted" style={{ marginTop: 4 }}>Progress: {d.progress.map((p) => `${p.description} +${num(p.qty)} ${p.unit}`).join('; ')}</div>}
          {can('construction', 'edit') && <button className="btn sm" style={{ marginTop: 6 }} onClick={() => act(() => api.put(`${B}/reports/${d.id}`, { client_visible: !d.client_visible }), d.client_visible ? 'Hidden from the client' : 'Shown to the client')}>{d.client_visible ? 'Hide from client' : 'Show to client'}</button>}
        </div>
      ))}
      {edit && (
        <Modal title="Daily site report" size="lg" onClose={() => setEdit(null)} footer={<><button className="btn" onClick={() => setEdit(null)}>Cancel</button><button className="btn primary" onClick={async () => {
          const progress = Object.entries(edit.progress).filter(([, q]) => Number(q)).map(([k, q]) => ({ boq_item_id: Number(k), qty: Number(q) }));
          if (await act(() => api.post(`${B}/reports`, { ...edit, project_id: project.id, progress }), 'Report saved')) setEdit(null); }}>Save</button></>}>
          <div className="grid" style={{ gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 12 }}>
            <Field label="Date"><input type="date" className="input" max={today()} value={edit.date} onChange={(e) => setEdit({ ...edit, date: e.target.value })} /></Field>
            <Field label="Site"><select className="input" value={edit.site_id} onChange={(e) => setEdit({ ...edit, site_id: e.target.value })}><option value="">—</option>{sel(sites)}</select></Field>
            <Field label="Weather"><TextInput value={edit.weather} onChange={(v) => setEdit({ ...edit, weather: v })} /></Field>
            <Field label="Workers on site"><TextInput type="number" value={edit.workers_on_site} onChange={(v) => setEdit({ ...edit, workers_on_site: v })} /></Field>
          </div>
          <Field label="Work done" required><textarea className="input" rows={3} value={edit.work_done} onChange={(e) => setEdit({ ...edit, work_done: e.target.value })} /></Field>
          <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="Issues / delays"><textarea className="input" rows={2} value={edit.issues} onChange={(e) => setEdit({ ...edit, issues: e.target.value })} /></Field>
            <Field label="Safety"><textarea className="input" rows={2} value={edit.safety} onChange={(e) => setEdit({ ...edit, safety: e.target.value })} /></Field>
          </div>
          {!!boq?.length && <details><summary>Measured progress on BOQ items (optional)</summary><div className="table-wrap"><table className="t"><tbody>{boq.map((b) => <tr key={b.id}><td>{b.description}<div className="muted">{num(b.completed_qty)} of {num(b.qty)} {b.unit}</div></td><td style={{ width: 110 }}><input className="input" type="number" value={edit.progress[b.id] || ''} onChange={(e) => setEdit({ ...edit, progress: { ...edit.progress, [b.id]: e.target.value } })} aria-label={`Progress ${b.description}`} /></td></tr>)}</tbody></table></div></details>}
          <Toggle value={edit.client_visible} onChange={(v) => setEdit({ ...edit, client_visible: v })} label="Show this report to the client in their portal" />
          <p className="muted">Add site photos afterwards under Schedule & documents.</p>
        </Modal>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------- sites, phases, milestones
function SitesTab({ project, d, onChange }) {
  const { can } = useAuth();
  const users = useFetch('/api/settings/meta').data?.users || [];
  const [site, setSite] = useState(null);
  const [phase, setPhase] = useState(null);
  const [ms, setMs] = useState(null);
  const act = useAct(onChange);
  const installments = useFetch(ms ? '/api/installments' : null, ms ? { project_id: project.id, limit: 500 } : undefined).data;
  const instRows = useMemo(() => (Array.isArray(installments) ? installments : installments?.rows || []).filter((i) => d.contracts.some((c) => c.id === i.sale_id)), [installments, d.contracts]);
  return (
    <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(340px,1fr))', gap: 16 }}>
      <Card flush title="Sites" actions={can('construction', 'create') && <button className="btn sm" onClick={() => setSite({ name: '', address: '', supervisor_id: '', start_date: '' })}>Add site</button>}>
        {!d.sites.length ? <Empty title="No sites yet" /> : <div className="table-wrap"><table className="t"><tbody>{d.sites.map((s) => <tr key={s.id}><td><b>{s.name}</b><div className="muted">{[s.address, s.supervisor_name].filter(Boolean).join(' · ')}</div></td><td><Badge s={s.status} /></td><td className="right">{can('construction', 'edit') && <select className="input" style={{ width: 120 }} value={s.status} onChange={(e) => act(() => api.put(`${B}/sites/${s.id}`, { status: e.target.value }), 'Updated')} aria-label="Site status"><option value="active">Active</option><option value="on_hold">On hold</option><option value="closed">Closed</option></select>}</td></tr>)}</tbody></table></div>}
      </Card>
      <Card flush title="Phases" actions={can('construction', 'create') && <button className="btn sm" onClick={() => setPhase({ name: '', planned_start: '', planned_end: '' })}>Add phase</button>}>
        {!d.phases.length ? <Empty title="No phases yet" /> : <div className="table-wrap"><table className="t"><tbody>{d.phases.map((p) => <tr key={p.id}><td><b>{p.name}</b><div className="muted">{[p.planned_start && fdate(p.planned_start), p.planned_end && fdate(p.planned_end)].filter(Boolean).join(' → ')}</div></td><td>{can('construction', 'edit') ? <select className="input" style={{ width: 130 }} value={p.status} onChange={(e) => act(() => api.put(`${B}/phases/${p.id}`, { status: e.target.value }), 'Updated')} aria-label="Phase status"><option value="planned">Planned</option><option value="in_progress">In progress</option><option value="completed">Completed</option></select> : <Badge s={p.status} />}</td></tr>)}</tbody></table></div>}
      </Card>
      <Card flush title="Milestones" actions={can('construction', 'create') && <button className="btn sm" onClick={() => setMs({ name: '', due_date: '', phase_id: '', installment_id: '', client_visible: true })}>Add milestone</button>}>
        {!d.milestones.length ? <Empty title="No milestones yet" /> : <div className="table-wrap"><table className="t"><tbody>{d.milestones.map((m) => <tr key={m.id}><td><b>{m.name}</b><div className="muted">{m.due_date ? `due ${fdate(m.due_date)}` : ''}{m.installment_id ? ` · bills ${money(m.installment_amount)} (due ${fdate(m.installment_due)})` : ''}</div></td>
          <td>{m.achieved_at ? <StatusBadge status="active" label={`Achieved ${fdate(m.achieved_at)}`} /> : can('construction', 'approve') && <button className="btn sm primary" onClick={() => act(() => api.post(`${B}/milestones/${m.id}/achieve`), m.installment_id ? 'Achieved; the linked client payment is now due' : 'Achieved')}>Mark achieved</button>}</td></tr>)}</tbody></table></div>}
      </Card>
      <Card flush title="Client contracts" actions={<Link className="btn sm" to="/sales/new?kind=construction">New contract</Link>}>
        {!d.contracts.length ? <Empty title="No client contract on this project" hint="A construction contract holds the client's payment schedule, receipts and statement." /> : <div className="table-wrap"><table className="t"><tbody>{d.contracts.map((c) => <tr key={c.id}><td><Link to={`/sales/${c.id}`}>{c.sale_no}</Link><div className="muted">{c.client} · {c.title}</div></td><td className="right mono">{money(c.paid_amount)} / {money(c.net_price)}</td></tr>)}</tbody></table></div>}
      </Card>
      {site && <Modal title="Add site" onClose={() => setSite(null)} footer={<><button className="btn" onClick={() => setSite(null)}>Cancel</button><button className="btn primary" onClick={async () => { if (await act(() => api.post(`${B}/sites`, { ...site, project_id: project.id }), 'Site added')) setSite(null); }}>Save</button></>}>
        <Field label="Name" required><TextInput value={site.name} onChange={(v) => setSite({ ...site, name: v })} /></Field>
        <Field label="Address"><TextInput value={site.address} onChange={(v) => setSite({ ...site, address: v })} /></Field>
        <Field label="Supervisor"><select className="input" value={site.supervisor_id} onChange={(e) => setSite({ ...site, supervisor_id: e.target.value })}><option value="">—</option>{sel(users)}</select></Field>
      </Modal>}
      {phase && <Modal title="Add phase" onClose={() => setPhase(null)} footer={<><button className="btn" onClick={() => setPhase(null)}>Cancel</button><button className="btn primary" onClick={async () => { if (await act(() => api.post(`${B}/phases`, { ...phase, project_id: project.id }), 'Phase added')) setPhase(null); }}>Save</button></>}>
        <Field label="Name" required><TextInput value={phase.name} onChange={(v) => setPhase({ ...phase, name: v })} placeholder="Foundation, Structure, Finishing…" /></Field>
        <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 12 }}><Field label="Planned start"><input type="date" className="input" value={phase.planned_start} onChange={(e) => setPhase({ ...phase, planned_start: e.target.value })} /></Field><Field label="Planned end"><input type="date" className="input" value={phase.planned_end} onChange={(e) => setPhase({ ...phase, planned_end: e.target.value })} /></Field></div>
      </Modal>}
      {ms && <Modal title="Add milestone" onClose={() => setMs(null)} footer={<><button className="btn" onClick={() => setMs(null)}>Cancel</button><button className="btn primary" onClick={async () => { if (await act(() => api.post(`${B}/milestones`, { ...ms, project_id: project.id }), 'Milestone added')) setMs(null); }}>Save</button></>}>
        <Field label="Name" required><TextInput value={ms.name} onChange={(v) => setMs({ ...ms, name: v })} placeholder="Slab poured, Grey structure complete…" /></Field>
        <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Field label="Due"><input type="date" className="input" value={ms.due_date} onChange={(e) => setMs({ ...ms, due_date: e.target.value })} /></Field>
          <Field label="Phase"><select className="input" value={ms.phase_id} onChange={(e) => setMs({ ...ms, phase_id: e.target.value })}><option value="">—</option>{sel(d.phases)}</select></Field>
        </div>
        {!!d.contracts.length && <Field label="Client payment linked to this milestone" hint="When the milestone is achieved, this installment becomes due today."><select className="input" value={ms.installment_id} onChange={(e) => setMs({ ...ms, installment_id: e.target.value })}><option value="">None</option>{instRows.filter((i) => i.status !== 'paid').map((i) => <option key={i.id} value={i.id}>{i.sale_no || ''} #{i.seq} · {money(i.amount)} due {fdate(i.due_date)}</option>)}</select></Field>}
        <Toggle value={ms.client_visible} onChange={(v) => setMs({ ...ms, client_visible: v })} label="Show to the client" />
      </Modal>}
    </div>
  );
}

// ---------------------------------------------------------------- estimates
export function EstimatesPage() {
  const { can } = useAuth();
  const nav = useNavigate();
  const { data, reload } = useFetch(`${B}/estimates`);
  const contacts = useFetch('/api/contacts', { limit: 500 }).data;
  const projects = useFetch(`${B}/overview`).data;
  const [edit, setEdit] = useState(null);
  const [conv, setConv] = useState(null);
  const act = useAct(reload);
  if (!data) return <Loading />;
  const contactRows = (Array.isArray(contacts) ? contacts : contacts?.rows || []).map((c) => ({ id: c.id, name: c.full_name }));
  const open = (e) => api.get(`${B}/estimates/${e.id}`).then((x) => setEdit({ ...x, lines: x.lines.map(({ category, description, unit, qty, rate }) => ({ category, description, unit, qty, rate })) }));
  const setLine = (i, k, v) => setEdit({ ...edit, lines: edit.lines.map((l, j) => (j === i ? { ...l, [k]: v } : l)) });
  const sub = edit ? edit.lines.reduce((s, l) => s + (Number(l.qty) || 0) * (Number(l.rate) || 0), 0) : 0;
  const readOnly = edit && ['accepted', 'rejected'].includes(edit.status);
  return (
    <div>
      <PageHead title="Estimates" sub="Price a job, send it to the client, and turn the accepted estimate into the project BOQ">
        {can('construction', 'create') && <button className="btn primary" onClick={() => setEdit({ title: '', contact_id: '', project_id: '', valid_until: '', markup_pct: 0, notes: '', lines: [{ category: 'General', description: '', unit: 'nos', qty: '', rate: '' }] })}>New estimate</button>}
      </PageHead>
      <Card flush>{!data.length ? <Empty title="No estimates yet" /> : <div className="table-wrap"><table className="t"><thead><tr><th>No.</th><th>Title</th><th>Client</th><th className="right">Total</th><th>Status</th><th>BOQ</th></tr></thead><tbody>
        {data.map((e) => <tr key={e.id} style={{ cursor: 'pointer' }} onClick={() => open(e)}><td className="mono">{e.estimate_no}</td><td>{e.title}</td><td>{e.client_name || '—'}</td><td className="right mono">{money(e.total)}</td><td><Badge s={e.status} /></td><td>{e.converted_at ? <Link to={`/construction/projects/${e.project_id}`} onClick={(ev) => ev.stopPropagation()}>{e.project_name}</Link> : '—'}</td></tr>)}
      </tbody></table></div>}</Card>
      {edit && (
        <Modal title={edit.id ? `${edit.estimate_no} · ${edit.title}` : 'New estimate'} size="lg" onClose={() => setEdit(null)} footer={<>
          {edit.id && <button className="btn" onClick={() => download(`${B}/estimates/${edit.id}`, { format: 'pdf' }, `${edit.estimate_no}.pdf`)}>PDF</button>}
          {edit.id && can('construction', 'approve') && edit.status === 'draft' && <button className="btn" onClick={() => act(() => api.post(`${B}/estimates/${edit.id}/status`, { status: 'sent' }), 'Marked as sent').then(() => open(edit))}>Mark sent</button>}
          {edit.id && can('construction', 'approve') && ['draft', 'sent'].includes(edit.status) && <><button className="btn" onClick={() => act(() => api.post(`${B}/estimates/${edit.id}/status`, { status: 'rejected' }), 'Marked rejected').then(() => setEdit(null))}>Rejected</button><button className="btn primary" onClick={() => act(() => api.post(`${B}/estimates/${edit.id}/status`, { status: 'accepted' }), 'Accepted').then(() => open(edit))}>Accepted</button></>}
          {edit.id && edit.status === 'accepted' && !edit.converted_at && can('construction', 'create') && <button className="btn primary" onClick={() => setConv({ project_id: edit.project_id || '' })}>Create BOQ</button>}
          {!readOnly && can('construction', edit.id ? 'edit' : 'create') && <button className="btn primary" onClick={async () => { const body = { ...edit, lines: edit.lines.filter((l) => l.description) }; const out = await act(() => (edit.id ? api.put(`${B}/estimates/${edit.id}`, body) : api.post(`${B}/estimates`, body)), 'Saved'); if (out) setEdit(null); }}>Save</button>}
          <button className="btn" onClick={() => setEdit(null)}>Close</button></>}>
          <div className="grid" style={{ gridTemplateColumns: '2fr 1fr 1fr', gap: 12 }}>
            <Field label="Title" required><TextInput value={edit.title} disabled={readOnly} onChange={(v) => setEdit({ ...edit, title: v })} /></Field>
            <Field label="Valid until"><input type="date" className="input" disabled={readOnly} value={edit.valid_until || ''} onChange={(e) => setEdit({ ...edit, valid_until: e.target.value })} /></Field>
            <Field label="Markup %"><TextInput type="number" disabled={readOnly} value={edit.markup_pct} onChange={(v) => setEdit({ ...edit, markup_pct: v })} /></Field>
            <Field label="Client"><select className="input" disabled={readOnly} value={edit.contact_id || ''} onChange={(e) => setEdit({ ...edit, contact_id: e.target.value })}><option value="">—</option>{sel(contactRows)}</select></Field>
            <Field label="Project"><select className="input" disabled={readOnly} value={edit.project_id || ''} onChange={(e) => setEdit({ ...edit, project_id: e.target.value })}><option value="">—</option>{sel(projects?.projects)}</select></Field>
          </div>
          <div className="table-wrap"><table className="t"><thead><tr><th>Category</th><th>Description</th><th>Unit</th><th>Qty</th><th>Rate</th><th className="right">Amount</th></tr></thead><tbody>
            {edit.lines.map((l, i) => <tr key={i}>{['category', 'description', 'unit', 'qty', 'rate'].map((k) => <td key={k} style={{ width: { category: 130, unit: 70, qty: 90, rate: 110 }[k] }}><input className="input" disabled={readOnly} type={['qty', 'rate'].includes(k) ? 'number' : 'text'} value={l[k]} onChange={(e) => setLine(i, k, e.target.value)} aria-label={k} /></td>)}<td className="right mono">{num(Math.round((Number(l.qty) || 0) * (Number(l.rate) || 0)))}</td></tr>)}
          </tbody></table></div>
          {!readOnly && <button className="btn sm" style={{ marginTop: 8 }} onClick={() => setEdit({ ...edit, lines: [...edit.lines, { category: edit.lines.at(-1)?.category || 'General', description: '', unit: 'nos', qty: '', rate: '' }] })}>Add line</button>}
          <p style={{ textAlign: 'right' }}>Subtotal {money(Math.round(sub))} · markup {money(Math.round((sub * (Number(edit.markup_pct) || 0)) / 100))} · <b>Total {money(Math.round(sub * (1 + (Number(edit.markup_pct) || 0) / 100)))}</b></p>
          <Field label="Notes / terms"><textarea className="input" rows={2} disabled={readOnly} value={edit.notes || ''} onChange={(e) => setEdit({ ...edit, notes: e.target.value })} /></Field>
        </Modal>
      )}
      {conv && edit && (
        <Modal title="Create the project BOQ" onClose={() => setConv(null)} footer={<><button className="btn" onClick={() => setConv(null)}>Cancel</button><button className="btn primary" disabled={!conv.project_id} onClick={async () => { const out = await act(() => api.post(`${B}/estimates/${edit.id}/convert`, conv), 'BOQ created'); if (out) { setConv(null); setEdit(null); nav(`/construction/projects/${out.project_id}`); } }}>Create BOQ</button></>}>
          <p>The estimate's lines become BOQ items; the markup is spread into the rates so the BOQ total equals the accepted price.</p>
          <Field label="Project" required><select className="input" value={conv.project_id} onChange={(e) => setConv({ project_id: e.target.value })}><option value="">Choose</option>{sel(projects?.projects)}</select></Field>
        </Modal>
      )}
    </div>
  );
}
