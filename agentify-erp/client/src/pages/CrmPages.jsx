import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import DataTable, { ExportMenu, SearchBar, useTable } from '../components/DataTable.jsx';
import Icon from '../components/Icon.jsx';
import { BackLink, Card, ConfirmDialog, DateRangeFilter, Empty, Field, Loading, Modal, PageHead, ProgressBar, Select, Stat, StatusBadge, Tabs, TagInput, Toggle } from '../components/ui.jsx';
import { FormModal } from '../components/ResourcePage.jsx';
import { api } from '../api.js';
import { useAuth, useFetch, useLookups, useToast, useUndoDelete } from '../context.jsx';
import { ago, date, money, todayPK } from '../format.js';
import { celebrate } from '../celebrate.js';
import { WA, WhatsAppButton, useCompanyName } from '../components/WhatsApp.jsx';

const STALE_DAYS = 7;
const idleDays = (c) => { const t = c.last_activity_at || c.created_at; return t ? Math.floor((Date.now() - new Date(String(t).replace(' ', 'T')).getTime()) / 86400000) : 0; };
import { useContactFilterFields } from './Contacts.jsx';

// ---------------------------------------------------------------- Pipeline (Kanban)
export function Pipeline() {
  const toast = useToast();
  const nav = useNavigate();
  const { can } = useAuth();
  const { agents } = useLookups();
  const [agent, setAgent] = useState('');
  const [q, setQ] = useState('');
  const { data, loading, setData, reload } = useFetch('/api/pipeline', { agent, q });
  const [drag, setDrag] = useState(null);
  const [over, setOver] = useState(null);
  const [asked, setAsked] = useState(null);
  const [won, setWon] = useState(null);
  const co = useCompanyName();
  const t0 = todayPK();

  // optimistic move + 8-second Undo; the stage change (and its timeline entry) is written when the grace period ends
  const move = async (card, stageId) => {
    if (card.stage_id === stageId) return;
    const prev = data, stage = data.stages.find((s) => s.id === stageId);
    setData({ ...data, cards: data.cards.map((c) => (c.id === card.id ? { ...c, stage_id: stageId, last_activity_at: new Date().toISOString() } : c)) });
    if (stage?.meta?.kind === 'won') { setWon(card.id); celebrate(); setTimeout(() => setWon(null), 1200); }
    toast.undoable(`Moved ${card.full_name} to ${stage?.value || 'new stage'}`, {
      commit: () => api.put('/api/pipeline/move', { contact_id: card.id, stage_id: stageId }),
      onUndo: () => setData(prev), onDone: () => reload(),
    });
  };
  const cardsBy = useMemo(() => {
    const m = {};
    (data?.cards || []).forEach((c) => { (m[c.stage_id] ||= []).push(c); });
    return m;
  }, [data]);

  return (
    <div>
      <PageHead title="Sales pipeline" sub="Drag a card to change its stage — every move is logged on the contact timeline.">
        <SearchBar value={q} onChange={setQ} placeholder="Search name or phone…" width={220} />
        {!can('crm', 'approve') ? null : <div style={{ width: 190 }}><Select value={agent} onChange={setAgent} options={agents.map((a) => ({ value: a.id, label: a.name }))} placeholder="All agents" /></div>}
      </PageHead>
      {!data ? <Loading /> : (
        <div className="kanban" style={{ opacity: loading ? 0.7 : 1 }}>
          {data.stages.map((s) => {
            const cards = cardsBy[s.id] || [];
            return (
              <div key={s.id} className={`k-col ${over === s.id ? 'over' : ''}`} onDragOver={(e) => { e.preventDefault(); setOver(s.id); }} onDragLeave={() => setOver(null)}
                onDrop={(e) => { e.preventDefault(); setOver(null); if (drag) { if (s.meta?.kind === 'won') setAsked({ card: drag, stage: s }); else move(drag, s.id); } setDrag(null); }}>
                <div className="k-head"><span className="dot" style={{ background: s.color || '#94a3b8' }} />{s.value}{cards.some((c) => c.budget) && <span className="k-sum">{money(cards.reduce((a, c) => a + (c.budget || 0), 0))}</span>}<span className="tag" style={cards.some((c) => c.budget) ? undefined : { marginLeft: 'auto' }}>{cards.length}</span></div>
                <div className="k-body">
                  {cards.map((c) => (
                    <div key={c.id} className={`k-card ${drag?.id === c.id ? 'dragging' : ''} ${won === c.id ? 'won' : ''} ${!['won', 'lost'].includes(s.meta?.kind) && idleDays(c) >= STALE_DAYS ? 'stale' : ''}`} draggable onDragStart={() => setDrag(c)} onDragEnd={() => { setDrag(null); setOver(null); }} onClick={() => nav(`/contacts/${c.id}`)}>
                      <div className="row between"><span className="nm">{c.full_name}</span>{c.priority === 'High' && <span className="pill red">High</span>}</div>
                      <div className="meta">{c.phone || 'No phone'}</div>
                      {(c.project_name || c.property_title) && <div className="meta">{[c.project_name, c.property_title].filter(Boolean).join(' · ')}</div>}
                      {c.budget ? <div className="meta">Budget {money(c.budget)}</div> : null}
                      <div className="row between meta" style={{ marginTop: 6 }}>
                        <span>{c.agent_name || 'Unassigned'}</span>
                        <span className={c.followup_date && c.followup_date < t0 ? 'neg' : c.followup_date === t0 ? 'warn' : ''}>{c.followup_date ? `↻ ${date(c.followup_date)}` : ''}</span>
                      </div>
                      <div className="faint" style={{ fontSize: 11, marginTop: 2 }}>Active {ago(c.last_activity_at)}{!['won', 'lost'].includes(s.meta?.kind) && idleDays(c) >= STALE_DAYS && <span className="meta"> · <b>going cold ({idleDays(c)}d)</b></span>}</div>
                      <div className="qa-row" onClick={(e) => e.stopPropagation()}>{c.phone && <a className="qa" href={`tel:${c.phone}`} title="Call" aria-label={`Call ${c.full_name}`}><Icon name="phone" size={13} /></a>}<WhatsAppButton phone={c.phone} text={WA.followup({ name: c.full_name.split(' ')[0] }, co)} size={13} /></div>
                    </div>
                  ))}
                  {!cards.length && <div className="faint center" style={{ padding: 14 }}>No contacts</div>}
                </div>
              </div>
            );
          })}
        </div>
      )}
      {asked && (
        <ConfirmDialog title="Move to a closing stage?" confirmLabel="Move anyway"
          message={<span>Moving <b>{asked.card.full_name}</b> to <b>{asked.stage.value}</b> only changes the stage. To convert them to a customer, record a sale — this updates the property, ledger and commission automatically. <br /><br /><Link to={`/sales/new?contact=${asked.card.id}`}>Create a sale instead →</Link></span>}
          onCancel={() => setAsked(null)} onConfirm={async () => { await move(asked.card, asked.stage.id); setAsked(null); }} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------- Smart lists manager
export function SmartLists() {
  const nav = useNavigate();
  const toast = useToast();
  const fields = useContactFilterFields();
  const { data, reload, loading } = useFetch('/api/smart-lists');
  const [edit, setEdit] = useState(null);
  const [del, setDel] = useState(null);
  const label = (r) => `${fields.find((f) => f.key === r.field)?.label || r.field} ${r.op} ${r.value}`;
  const { hidden: hiddenLists, remove: removeList } = useUndoDelete('smart-lists');
  return (
    <div>
      <PageHead title="Smart Lists" sub="Saved, live filters over your contacts">
        <button className="btn primary" onClick={() => nav('/contacts')}><Icon name="plus" size={14} />Build a new list</button>
      </PageHead>
      {loading && !data ? <Loading /> : !data?.filter((l) => !hiddenLists.has(l.id)).length ? <Empty icon="filter" title="No smart lists yet" hint="Open Contacts → Filters, build a filter, then “Save as Smart List”." /> : (
        <div className="grid g-auto" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))' }}>
          {data.filter((l) => !hiddenLists.has(l.id)).map((l) => (
            <Card key={l.id} title={<span>{l.is_default ? '★ ' : ''}{l.name}</span>} actions={<>{l.shared ? <span className="pill blue">Shared</span> : <span className="pill grey">Private</span>}</>}>
              <div className="muted" style={{ marginBottom: 8 }}>Match {l.logic === 'OR' ? 'ANY' : 'ALL'} of:</div>
              <ul style={{ margin: 0, paddingLeft: 18 }}>{l.rules.map((r, i) => <li key={i}>{label(r)}</li>)}</ul>
              <div className="row wrap" style={{ marginTop: 12 }}>
                <button className="btn sm primary" onClick={() => nav(`/contacts?list=${l.id}`)}>Open</button>
                <button className="btn sm" onClick={() => setEdit(l)}>Rename</button>
                <button className="btn sm" onClick={async () => { await api.post(`/api/smart-lists/${l.id}/duplicate`); toast('Duplicated', 'ok'); reload(); }}>Duplicate</button>
                <button className="btn sm" onClick={async () => { await api.put(`/api/smart-lists/${l.id}`, { shared: !l.shared }); reload(); }}>{l.shared ? 'Unshare' : 'Share'}</button>
                <button className="btn sm" onClick={async () => { await api.put(`/api/smart-lists/${l.id}`, { is_default: !l.is_default }); reload(); }}>{l.is_default ? 'Unset default' : 'Set default'}</button>
                <button className="btn sm danger" onClick={() => setDel(l)}>Delete</button>
              </div>
            </Card>
          ))}
        </div>
      )}
      {edit && <FormModal title="Rename smart list" size="sm" fields={[{ name: 'name', label: 'Name', required: true }]} initial={edit} onClose={() => setEdit(null)} onSave={async (f) => { await api.put(`/api/smart-lists/${edit.id}`, { name: f.name }); setEdit(null); reload(); }} />}
      {del && <ConfirmDialog danger title="Delete smart list" message={`Delete “${del.name}”? Contacts are not affected.`} confirmLabel="Delete" onCancel={() => setDel(null)} onConfirm={async () => { const l = del; setDel(null); removeList(l.id, `“${l.name}” deleted`, () => api.del(`/api/smart-lists/${l.id}`), { onDone: reload }); }} />}
    </div>
  );
}

// ---------------------------------------------------------------- Tasks
export function Tasks() {
  const toast = useToast();
  const { can, user } = useAuth();
  const { users } = useLookups();
  const [filter, setFilter] = useState('open');
  const [adding, setAdding] = useState(false);
  const [mine, setMine] = useState(true);
  const params = filter === 'overdue' ? { due: 'overdue' } : filter === 'today' ? { due: 'today', status: 'open' } : { status: filter === 'all' ? undefined : filter };
  const { data, reload, loading } = useFetch('/api/tasks', { ...params, mine: mine ? 1 : undefined });
  const t0 = todayPK();
  return (
    <div>
      <PageHead title="Tasks & follow-ups">
        {can('crm', 'create') && <button className="btn primary" onClick={() => setAdding(true)}><Icon name="plus" size={14} />New task</button>}
      </PageHead>
      <div className="top-tabs">
        {[['open', 'Open'], ['today', 'Due today'], ['overdue', 'Overdue'], ['done', 'Completed'], ['all', 'All']].map(([k, l]) => <button key={k} className={`chip ${filter === k ? 'active' : ''}`} onClick={() => setFilter(k)}>{l}</button>)}
        {!user.own_scope && <label className="check" style={{ marginLeft: 12 }}><input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} />Assigned to / created by me</label>}
      </div>
      <Card flush>
        {loading && !data ? <Loading /> : !data?.length ? <Empty>No tasks here.</Empty> : (
          <table className="t"><thead><tr><th style={{ width: 30 }} /><th>Task</th><th>Contact</th><th>Assignee</th><th>Due</th><th>Priority</th></tr></thead>
            <tbody>{data.map((tk) => (
              <tr key={tk.id} style={{ opacity: tk.status === 'done' ? 0.55 : 1 }}>
                <td><input type="checkbox" checked={tk.status === 'done'} aria-label="Complete task" onChange={async (e) => { try { await api.put(`/api/tasks/${tk.id}`, { status: e.target.checked ? 'done' : 'open' }); reload(); } catch (er) { toast(er.message, 'err'); } }} /></td>
                <td style={{ textDecoration: tk.status === 'done' ? 'line-through' : 'none' }}>{tk.title}</td>
                <td>{tk.contact_name ? <Link to={`/contacts/${tk.entity_id}`}>{tk.contact_name}</Link> : '—'}</td>
                <td>{tk.assignee || '—'}</td>
                <td className={tk.status === 'open' && tk.due_date && tk.due_date < t0 ? 'neg bold' : ''}>{date(tk.due_date)}</td>
                <td><StatusBadge status={tk.priority || 'Medium'} tone={tk.priority === 'High' ? 'red' : tk.priority === 'Low' ? 'grey' : 'amber'} /></td>
              </tr>))}</tbody></table>
        )}
      </Card>
      {adding && <FormModal title="New task" size="sm" fields={[{ name: 'title', label: 'Task', required: true }, { name: 'due_date', label: 'Due date', type: 'date' }, { name: 'priority', label: 'Priority', type: 'select', options: ['Low', 'Medium', 'High'], allowEmpty: false },
        ...(user.own_scope ? [] : [{ name: 'assigned_to', label: 'Assign to', type: 'select', number: true, options: users.map((u) => ({ value: u.id, label: u.name })) }])]}
      initial={{ due_date: t0, priority: 'Medium', assigned_to: user.id }} onClose={() => setAdding(false)} onSave={async (f) => { await api.post('/api/tasks', { ...f, entity_type: 'general' }); setAdding(false); reload(); toast('Task created', 'ok'); }} />}
    </div>
  );
}

// ---------------------------------------------------------------- Notes feed
export function Notes() {
  const t = useTable('/api/notes', { limit: 30 });
  return (
    <div>
      <PageHead title="Notes" sub="Latest notes across your contacts" />
      <Card flush>
        <div className="toolbar"><SearchBar value={t.q} onChange={t.setQ} placeholder="Search notes…" /></div>
        <DataTable {...t.tableProps} hidePager={false} columns={[
          { key: 'created_at', label: 'When', render: (r) => ago(r.created_at) },
          { key: 'contact_name', label: 'Contact', render: (r) => <Link to={`/contacts/${r.entity_id}`}>{r.contact_name}</Link> },
          { key: 'body', label: 'Note', render: (r) => <div style={{ maxWidth: 560, whiteSpace: 'pre-wrap' }}>{r.body}</div> },
          { key: 'user_name', label: 'By', render: (r) => r.user_name || 'Website' },
        ]} />
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------- Sales agents
export const TierBadge = ({ tier }) => <span className={`tier ${tier}`}>{tier === 'Champion' ? '★ ' : ''}{tier.toUpperCase()}</span>;

export function Agents() {
  const { user } = useAuth();
  const [range, setRange] = useState({ range: 'all' });
  const { data, loading } = useFetch('/api/agents', range);
  const nav = useNavigate();
  return (
    <div>
      <PageHead title="Sales agents" sub="Performance, ranking and commission"><DateRangeFilter value={range} onChange={setRange} /></PageHead>
      {!data ? <Loading /> : (
        <>
          <div className="grid g-auto" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', marginBottom: 16, opacity: loading ? 0.6 : 1 }}>
            {data.rows.map((a) => (
              <div key={a.id} className="card" style={{ padding: 16, cursor: 'pointer' }} onClick={() => nav(`/agents/${a.id}`)}>
                <div className="row between"><span className="faint">#{a.rank}</span><TierBadge tier={a.tier} /></div>
                <div className="row" style={{ margin: '8px 0 10px' }}><div className="avatar lg" style={{ width: 44, height: 44 }}>{a.name.split(' ').map((x) => x[0]).join('').slice(0, 2)}</div><div><div className="bold" style={{ fontSize: 14 }}>{a.name}</div><div className="muted">{a.designation || 'Sales agent'}</div></div></div>
                <div className="grid g2" style={{ gap: 8 }}>
                  <div><div className="muted">Sales</div><b>{a.sales_count}</b></div><div><div className="muted">Sales value</div><b>{money(a.sales_value)}</b></div>
                  <div><div className="muted">Leads</div><b>{a.total_leads}</b> <span className="muted">({a.active_leads} active)</span></div><div><div className="muted">Conversion</div><b>{a.conversion_rate}%</b></div>
                </div>
                {a.next && <div style={{ marginTop: 10 }}><div className="muted" style={{ fontSize: 11.5, marginBottom: 3 }}>{a.next.remaining} more sale(s) to {a.next.name}</div><ProgressBar value={Math.round((a.lifetime_sales / a.next.min) * 100)} /></div>}
              </div>
            ))}
          </div>
          <Card title="Leaderboard" flush>
            <table className="t"><thead><tr><th>#</th><th>Agent</th><th>Tier</th><th className="num">Leads</th><th className="num">Active</th><th className="num">Converted</th><th className="num">Lost</th><th className="num">Follow-ups</th><th className="num">Sales</th><th className="num">Sales value</th><th className="num">Conv.</th>
              <th className="num">Commission earned</th><th className="num">Paid</th><th className="num">Pending</th></tr></thead>
              <tbody>{data.rows.map((a) => (
                <tr key={a.id} className="click" onClick={() => nav(`/agents/${a.id}`)}><td>{a.rank}</td><td className="cell-main">{a.name}</td><td><TierBadge tier={a.tier} /></td><td className="num">{a.total_leads}</td><td className="num">{a.active_leads}</td><td className="num">{a.converted_leads}</td><td className="num">{a.lost_leads}</td><td className="num">{a.followups}</td>
                  <td className="num">{a.sales_count}</td><td className="num mono">{money(a.sales_value)}</td><td className="num">{a.conversion_rate}%</td><td className="num mono">{money(a.commission_earned)}</td><td className="num mono">{money(a.commission_paid)}</td><td className="num mono">{money(a.commission_pending)}</td></tr>))}</tbody></table>
          </Card>
          {user.own_scope && null}
        </>
      )}
    </div>
  );
}

export function AgentDetail() {
  const { id } = useParams();
  const { data, error } = useFetch(`/api/agents/${id}`);
  const ledger = useFetch(`/api/agents/${id}/ledger`);
  const [tab, setTab] = useState('leads');
  if (error) return <div className="alert err">{error}</div>;
  if (!data) return <Loading />;
  const a = data.agent;
  return (
    <div>
      <BackLink to="/agents">Sales agents</BackLink>
      <PageHead title={a.name} sub={`${a.designation || 'Sales agent'}${a.emp_code ? ' · ' + a.emp_code : ''} · ${a.email}`}><TierBadge tier={a.tier} /></PageHead>
      <div className="grid g4" style={{ marginBottom: 14 }}>
        <Stat label="Total leads" value={a.total_leads} sub={`${a.active_leads} active · ${a.lost_leads} lost`} />
        <Stat label="Converted" value={a.converted_leads} sub={`${a.conversion_rate}% conversion`} />
        <Stat label="Sales" value={a.lifetime_sales} sub={money(a.sales_value)} />
        <Stat label="Commission pending" value={money(a.commission_pending)} sub={`${money(a.commission_earned)} earned · ${money(a.commission_paid)} paid`} />
      </div>
      <Card flush>
        <Tabs value={tab} onChange={setTab} tabs={[{ key: 'leads', label: 'Assigned leads', count: data.leads.length }, { key: 'sales', label: 'Sales', count: data.sales.length }, { key: 'commissions', label: 'Commissions', count: data.commissions.length }, { key: 'ledger', label: 'Commission ledger' }]} />
        {tab === 'leads' && <table className="t"><tbody>{data.leads.map((l) => <tr key={l.id}><td><Link to={`/contacts/${l.id}`}>{l.full_name}</Link></td><td>{l.phone}</td><td><span className="pill" style={{ background: (l.stage_color || '#94a3b8') + '1f', color: l.stage_color }}>{l.stage}</span></td><td>{date(l.followup_date)}</td><td className="num mono">{l.budget ? money(l.budget) : ''}</td></tr>)}</tbody></table>}
        {tab === 'sales' && <table className="t"><tbody>{data.sales.map((s) => <tr key={s.id}><td><Link to={`/sales/${s.id}`}>{s.sale_no}</Link>{s.kind === 'construction' && <span className="pill purple" style={{ marginLeft: 6 }}>Construction</span>}</td><td>{date(s.sale_date)}</td><td>{s.property}</td><td>{s.customer}</td><td className="num mono">{money(s.net_price)}</td></tr>)}</tbody></table>}
        {tab === 'ledger' && (ledger.data ? (
          <div>
            <div className="row wrap" style={{ gap: 18, padding: '12px 16px' }}><span>Balance owed to agent <b className="warn mono">{money(ledger.data.balance)}</b></span>{ledger.data.pending_approval > 0 && <span className="muted">+ {money(ledger.data.pending_approval)} awaiting approval</span>}</div>
            <table className="t"><thead><tr><th>Date</th><th>Reference</th><th>Description</th><th className="num">Earned (credit)</th><th className="num">Paid (debit)</th><th className="num">Balance</th></tr></thead>
              <tbody>{ledger.data.entries.map((e, i) => <tr key={i}><td>{date(e.date)}</td><td>{e.ref}</td><td>{e.description}</td><td className="num mono">{e.credit ? money(e.credit) : ''}</td><td className="num mono">{e.debit ? money(e.debit) : ''}</td><td className="num mono">{money(e.balance)}</td></tr>)}</tbody></table>
            {!ledger.data.entries.length && <Empty>No commission activity yet.</Empty>}
          </div>) : <Loading />)}
        {tab === 'commissions' && <table className="t"><tbody>{data.commissions.map((c) => <tr key={c.id}><td>{c.commission_no}</td><td className="num mono">{money(c.amount)}</td><td className="num mono">{money(c.paid_amount)}</td><td><StatusBadge status={c.status} /></td></tr>)}</tbody></table>}
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------- Commissions
export function Commissions() {
  const { can } = useAuth();
  const toast = useToast();
  const { agents, treasury } = useLookups();
  const [f, setF] = useState({ status: '', agent_id: '' });
  const { data, reload, loading } = useFetch('/api/commissions', f);
  const [paying, setPaying] = useState(null);
  const [open, setOpen] = useState(null);
  const act = async (url, msg) => { try { await api.post(url); toast(msg, 'ok'); reload(); } catch (e) { toast(e.message, 'err'); } };
  return (
    <div>
      <PageHead title="Commissions" sub="Generated automatically when a sale is confirmed">
        {can('settings', 'view') && <Link className="btn" to="/settings/commission-rules">Commission rules</Link>}
      </PageHead>
      {data && (
        <div className="grid g3" style={{ marginBottom: 12 }}>
          <Stat label="Total commission" value={money(data.totals.earned)} /><Stat label="Paid" value={money(data.totals.paid)} tone="pos" /><Stat label="Pending / unpaid" value={money(data.totals.pending)} tone="warn" />
        </div>
      )}
      <Card flush>
        <div className="toolbar">
          <div style={{ width: 170 }}><Select value={f.status} onChange={(v) => setF({ ...f, status: v })} placeholder="All statuses" options={['pending', 'approved', 'partially_paid', 'paid', 'cancelled'].map((s) => ({ value: s, label: s.replace('_', ' ') }))} /></div>
          {can('commissions', 'approve') && <div style={{ width: 190 }}><Select value={f.agent_id} onChange={(v) => setF({ ...f, agent_id: v })} placeholder="All agents" options={agents.map((a) => ({ value: a.id, label: a.name }))} /></div>}
        </div>
        {loading && !data ? <Loading /> : (
          <div className="table-wrap"><table className="t"><thead><tr><th>Commission</th><th>Agent</th><th>Customer</th><th>Property</th><th>Sale</th><th className="num">Sale value</th><th>Rule</th><th className="num">Commission</th><th className="num">Paid</th><th>Status</th><th /></tr></thead>
            <tbody>{data?.rows.map((c) => (
              <tr key={c.id}><td><a href="#o" onClick={(e) => { e.preventDefault(); setOpen(c); }}>{c.commission_no}</a></td><td>{c.agent_name}</td><td>{c.customer_name}</td><td>{c.property_title}</td><td><Link to={`/sales/${c.sale_id}`}>{c.sale_no}</Link></td>
                <td className="num mono">{money(c.base_amount)}</td><td>{c.rate_type === 'fixed' ? 'Fixed' : `${c.rate_value}%`}</td><td className="num mono">{money(c.amount)}</td><td className="num mono">{money(c.paid_amount)}</td><td><StatusBadge status={c.status} /></td>
                <td className="right nowrap">
                  {c.status === 'pending' && can('commissions', 'approve') && <button className="btn sm" onClick={() => act(`/api/commissions/${c.id}/approve`, 'Commission approved')}>Approve</button>}{' '}
                  {['approved', 'partially_paid'].includes(c.status) && can('accounting', 'create') && <button className="btn sm primary" onClick={() => setPaying(c)}>Pay</button>}{' '}
                  {!['paid', 'cancelled'].includes(c.status) && c.paid_amount === 0 && can('commissions', 'approve') && <button className="btn sm ghost danger" onClick={() => act(`/api/commissions/${c.id}/cancel`, 'Cancelled')}>Cancel</button>}
                </td></tr>))}</tbody></table>
            {!data?.rows.length && <Empty>No commissions yet.</Empty>}</div>
        )}
      </Card>
      {paying && <FormModal title={`Pay commission ${paying.commission_no}`} size="sm" initial={{ amount: paying.amount - paying.paid_amount, date: todayPK(), method: 'Bank Transfer' }}
        fields={[{ name: 'amount', label: 'Amount', type: 'money', required: true, hint: `Balance ${money(paying.amount - paying.paid_amount)}` }, { name: 'account_id', label: 'Pay from', type: 'select', number: true, required: true, options: treasury.map((a) => ({ value: a.id, label: a.name })) },
          { name: 'method', label: 'Method', type: 'select', lookup: 'payment_method', allowEmpty: false }, { name: 'date', label: 'Date', type: 'date' }, { name: 'reference_no', label: 'Reference' }]}
        onClose={() => setPaying(null)} onSave={async (b) => { await api.post(`/api/commissions/${paying.id}/pay`, b); toast('Payment recorded', 'ok'); setPaying(null); reload(); }} />}
      {open && <CommissionModal c={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

function CommissionModal({ c, onClose }) {
  const { data } = useFetch(`/api/commissions/${c.id}`);
  return (
    <Modal title={`Commission ${c.commission_no}`} onClose={onClose}>
      <div className="stack">
        <div className="grid g2">
          <div className="sum-box"><div className="l">Sale value</div><div className="v">{money(c.base_amount)}</div></div><div className="sum-box"><div className="l">Commission ({c.rate_type === 'fixed' ? 'fixed' : `${c.rate_value}%`})</div><div className="v">{money(c.amount)}</div></div>
        </div>
        <div>Agent: <b>{c.agent_name}</b> · Customer: <b>{c.customer_name}</b> · Property: <b>{c.property_title}</b> · Project: <b>{c.project_name || '—'}</b></div>
        <b>Payments</b>
        {data?.payments?.length ? <table className="t"><tbody>{data.payments.map((p) => <tr key={p.id}><td>{date(p.date)}</td><td>{p.method}</td><td className="num mono">{money(p.amount)}</td></tr>)}</tbody></table> : <div className="muted">No payments yet.</div>}
      </div>
    </Modal>
  );
}
