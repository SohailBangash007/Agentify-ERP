import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import DataTable, { ExportMenu, SearchBar, useTable, ViewsBar } from '../components/DataTable.jsx';
import { WhatsAppButton, leadMessage, useCompanyName } from '../components/WhatsApp.jsx';
import FilterPanel from '../components/FilterPanel.jsx';
import Icon from '../components/Icon.jsx';
import { Avatar, Card, ConfirmDialog, Field, Menu, Modal, PageHead, Select, StagePill, TagInput } from '../components/ui.jsx';
import { api } from '../api.js';
import { useAuth, useFetch, useLookups, useToast, useUndoDelete } from '../context.jsx';
import { ago, date, money } from '../format.js';
import ContactForm from './ContactForm.jsx';

export function useContactFilterFields() {
  const { stages, agents, projects, list } = useLookups();
  const opts = (arr) => arr.map((v) => ({ value: v, label: v }));
  return useMemo(() => [
    { key: 'stage', label: 'Lead stage', type: 'select', options: stages.map((s) => ({ value: s.id, label: s.value })) },
    { key: 'source', label: 'Lead source', type: 'select', options: opts(list('lead_source')) },
    { key: 'agent', label: 'Sales agent', type: 'select', options: agents.map((a) => ({ value: a.id, label: a.name })) },
    { key: 'project', label: 'Project', type: 'select', options: projects.map((p) => ({ value: p.id, label: p.name })) },
    { key: 'city', label: 'City', type: 'text' },
    { key: 'budget', label: 'Budget', type: 'number' },
    { key: 'created', label: 'Created date', type: 'date' },
    { key: 'last_activity', label: 'Last activity', type: 'date' },
    { key: 'followup', label: 'Follow-up date', type: 'date' },
    { key: 'tags', label: 'Tags', type: 'tags' },
    { key: 'customer_type', label: 'Customer type', type: 'select', options: opts(list('lead_type')) },
    { key: 'payment_status', label: 'Payment status', type: 'select', options: [{ value: 'overdue', label: 'Overdue' }, { value: 'current', label: 'Current' }, { value: 'paid', label: 'Fully paid' }, { value: 'none', label: 'No sales' }] },
    { key: 'is_customer', label: 'Customer / Lead', type: 'select', options: [{ value: 1, label: 'Customer' }, { value: 0, label: 'Lead' }] },
    { key: 'property_type', label: 'Property type', type: 'select', options: opts(list('property_type')) },
    { key: 'priority', label: 'Priority', type: 'select', options: opts(['Low', 'Medium', 'High']) },
  ], [stages, agents, projects, list]);
}

function SaveListModal({ rules, logic, onClose, onSaved }) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [shared, setShared] = useState(false);
  const [err, setErr] = useState('');
  return (
    <Modal title="Save as Smart List" size="sm" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button>
      <button className="btn primary" onClick={async () => { try { const l = await api.post('/api/smart-lists', { name, logic, rules, shared }); toast('Smart list saved', 'ok'); onSaved(l); } catch (e) { setErr(e.message); } }}>Save</button></>}>
      <div className="stack">{err && <div className="alert err">{err}</div>}
        <Field label="List name" required><input className="input" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Hot leads" /></Field>
        <label className="check"><input type="checkbox" checked={shared} onChange={(e) => setShared(e.target.checked)} />Share with my team</label>
        <div className="muted">{rules.length} condition(s) will be saved and re-evaluated live each time the list is opened.</div></div>
    </Modal>
  );
}

function ImportModal({ onClose, onDone }) {
  const toast = useToast();
  const [rows, setRows] = useState(null);
  const [result, setResult] = useState(null);
  const [err, setErr] = useState('');
  const ref = useRef(null);
  const parse = async (file) => {
    const text = (await file.text()).replace(/^﻿/, '');
    const lines = []; let cur = [], cell = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) { if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c; }
      else if (c === '"') q = true; else if (c === ',') { cur.push(cell); cell = ''; }
      else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; cur.push(cell); lines.push(cur); cur = []; cell = ''; }
      else cell += c;
    }
    if (cell || cur.length) { cur.push(cell); lines.push(cur); }
    const [head, ...body] = lines.filter((l) => l.some((x) => x.trim()));
    const map = { name: 'full_name', 'full name': 'full_name', full_name: 'full_name', phone: 'phone', mobile: 'phone', email: 'email', company: 'company', city: 'city', source: 'lead_source', 'lead source': 'lead_source', budget: 'budget', cnic: 'cnic' };
    const keys = head.map((h) => map[h.trim().toLowerCase()]);
    if (!keys.includes('full_name')) throw new Error('The CSV needs a "Name" column. Columns: Name, Phone, Email, Company, City, Source, Budget, CNIC');
    return body.map((r) => Object.fromEntries(keys.map((k, i) => [k, r[i]?.trim()]).filter(([k, v]) => k && v)));
  };
  return (
    <Modal title="Import contacts" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Close</button>
      {rows && !result && <button className="btn primary" onClick={async () => { try { const r = await api.post('/api/contacts/import', { rows }); setResult(r); toast(`${r.created} contact(s) imported`, 'ok'); onDone(); } catch (e) { setErr(e.message); } }}>Import {rows.length} row(s)</button>}</>}>
      <div className="stack">
        {err && <div className="alert err">{err}</div>}
        <div className="muted">Upload a CSV with the columns <b>Name, Phone, Email, Company, City, Source, Budget, CNIC</b>. Duplicates (same phone or email) are skipped.</div>
        <input ref={ref} type="file" accept=".csv,text/csv" className="input" style={{ padding: 4 }} onChange={async (e) => { setErr(''); setResult(null); try { setRows(await parse(e.target.files[0])); } catch (er) { setRows(null); setErr(er.message); } }} />
        {rows && !result && <div className="alert info">{rows.length} row(s) ready to import. First: {rows[0]?.full_name}</div>}
        {result && <div className="alert ok">{result.created} created, {result.skipped} skipped.{result.errors.length > 0 && <ul>{result.errors.map((e) => <li key={e}>{e}</li>)}</ul>}</div>}
      </div>
    </Modal>
  );
}

export default function Contacts({ type, title = 'Contacts' }) {
  const { can, user } = useAuth();
  const toast = useToast();
  const nav = useNavigate();
  const [sp, setSp] = useSearchParams();
  const listId = sp.get('list') || '';
  const { stages, agents, stageById, list: lk } = useLookups();
  const fields = useContactFilterFields();
  const lists = useFetch('/api/smart-lists');
  const [showFilters, setShowFilters] = useState(false);
  const [draft, setDraft] = useState({ logic: 'AND', rules: [] });
  const [applied, setApplied] = useState(null);
  const [selected, setSelected] = useState([]);
  const [adding, setAdding] = useState(sp.get('new') === '1');
  const { hidden, remove } = useUndoDelete('contacts');
  const [importing, setImporting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [bulk, setBulk] = useState(null);
  const [confirmDel, setConfirmDel] = useState(false);
  const [renaming, setRenaming] = useState(null);

  const t = useTable('/api/contacts', { sort: 'created', dir: 'desc', filters: { type }, viewsKey: `contacts-${type || 'all'}` });
  const co = useCompanyName();
  const effective = useMemo(() => ({ type, smart_list: listId || undefined, filters: !listId && applied?.rules?.length ? applied : undefined }), [type, listId, applied]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { t.setFilter(effective); }, [effective]);
  const active = (lists.data || []).find((l) => String(l.id) === listId);

  const cols = [
    { key: 'full_name', label: 'Contact name', sortKey: 'name', render: (r) => <Link to={`/contacts/${r.id}`} className="row" style={{ color: 'inherit' }}><Avatar name={r.full_name} size="sm" /><span className="cell-main">{r.full_name}</span>{r.is_demo ? <span className="demo-chip">DEMO</span> : null}</Link> },
    { key: 'phone', label: 'Phone', sortKey: 'phone' },
    { key: 'email', label: 'Email', sortKey: 'email' },
    { key: 'company', label: 'Business', sortKey: 'company' },
    { key: 'lead_source', label: 'Lead source', sortKey: 'source' },
    { key: 'stage', label: 'Lead stage', sortKey: 'stage', render: (r) => <StagePill name={r.stage} color={r.stage_color} />,
      edit: { type: 'select', can: (r) => can('crm', 'edit') && !r.is_customer, allowEmpty: false, value: (r) => r.stage_id ?? '', options: stages.map((s) => ({ value: s.id, label: s.value })), save: async (r, v) => { await api.put('/api/pipeline/move', { contact_id: r.id, stage_id: Number(v) }); t.reload(); } } },
    { key: 'agent_name', label: 'Sales agent', sortKey: 'agent' },
    { key: 'created_at', label: 'Created (PKT)', sortKey: 'created', render: (r) => date(r.created_at) },
    { key: 'last_activity_at', label: 'Last activity', sortKey: 'activity', render: (r) => ago(r.last_activity_at) },
    { key: 'followup_date', label: 'Next follow-up', sortKey: 'followup', edit: { type: 'date', can: can('crm', 'edit'), save: async (r, v) => { await api.put(`/api/contacts/${r.id}`, { followup_date: v || null }); t.reload(); } }, render: (r) => (r.followup_date ? <span className={r.followup_date < new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Karachi' }) ? 'neg' : ''}>{date(r.followup_date)}</span> : '—') },
    { key: 'property_title', label: 'Property interest', hidden: false, render: (r) => r.property_title || r.project_name || '—' },
    { key: 'budget', label: 'Budget', sortKey: 'budget', num: true, hidden: true, render: (r) => (r.budget ? money(r.budget) : '—') },
    { key: 'tags', label: 'Tags', render: (r) => r.tags.map((x) => <span className="tag" key={x}>{x}</span>) },
    { key: 'is_customer', label: 'Customer / Lead', render: (r) => (r.is_customer ? <span className="pill green">Customer</span> : <span className="pill grey">Lead</span>) },
  ];

  const runBulk = async (action, value) => {
    try { const r = await api.post('/api/contacts/bulk', { ids: selected, action, value }); toast(`${r.updated} contact(s) updated`, 'ok'); setSelected([]); setBulk(null); t.reload(); }
    catch (e) { toast(e.message, 'err'); }
  };

  return (
    <div>
      <PageHead title={title} sub={`${t.total} contact${t.total === 1 ? '' : 's'}`}>
        {can('crm', 'create') && <button className="btn" onClick={() => setImporting(true)}><Icon name="upload" size={14} />Import</button>}
        {can('crm', 'create') && <button className="btn primary" onClick={() => setAdding(true)}><Icon name="plus" size={14} />Add Contact</button>}
      </PageHead>

      <div className="top-tabs">
        <button className={`chip ${!listId ? 'active' : ''}`} onClick={() => { setSp({}); }}>All</button>
        {(lists.data || []).map((l) => (
          <span key={l.id} className="row" style={{ gap: 0 }}>
            <button className={`chip ${String(l.id) === listId ? 'active' : ''}`} onClick={() => setSp({ list: l.id })}>{l.is_default ? '★ ' : ''}{l.name}{l.shared ? ' · shared' : ''}</button>
            {String(l.id) === listId && (
              <Menu trigger={<button className="icon-btn" style={{ width: 26, height: 26, marginLeft: 2 }} aria-label="List actions"><Icon name="more" size={14} /></button>} align="left">
                <button onClick={() => setRenaming(l)}>Rename</button>
                <button onClick={async () => { await api.post(`/api/smart-lists/${l.id}/duplicate`); toast('Duplicated', 'ok'); lists.reload(); }}>Duplicate</button>
                <button onClick={async () => { await api.put(`/api/smart-lists/${l.id}`, { shared: !l.shared }); lists.reload(); }}>{l.shared ? 'Stop sharing' : 'Share with team'}</button>
                <button onClick={async () => { await api.put(`/api/smart-lists/${l.id}`, { is_default: !l.is_default }); lists.reload(); }}>{l.is_default ? 'Unset default' : 'Make default'}</button>
                <button className="danger" onClick={async () => { await api.del(`/api/smart-lists/${l.id}`); setSp({}); lists.reload(); }}>Delete</button>
              </Menu>
            )}
          </span>
        ))}
        <button className="chip" onClick={() => { setShowFilters(true); }}>+ Add Smart List</button>
      </div>

      <Card flush>
        <div className="toolbar">
          <button className={`btn ${showFilters || applied?.rules?.length ? 'primary' : ''}`} onClick={() => setShowFilters(!showFilters)}><Icon name="filter" size={14} />Filters{applied?.rules?.length ? ` (${applied.rules.length})` : ''}</button>
          <SearchBar value={t.q} onChange={t.setQ} placeholder="Search contacts…" width={280} />
          {selected.length > 0 && can('crm', 'edit') && (
            <Menu trigger={<button className="btn">{selected.length} selected · Bulk actions <Icon name="chevD" size={13} /></button>} align="left">
              {!user.own_scope && <button onClick={() => setBulk({ action: 'assign' })}>Assign to agent…</button>}
              <button onClick={() => setBulk({ action: 'stage' })}>Change stage…</button>
              <button onClick={() => setBulk({ action: 'add_tag' })}>Add tag…</button>
              <button onClick={() => setBulk({ action: 'remove_tag' })}>Remove tag…</button>
              {can('crm', 'delete') && <button className="danger" onClick={() => setConfirmDel(true)}>Delete…</button>}
            </Menu>
          )}
          <div className="grow" />
          <button className="btn" onClick={() => nav('/settings/custom-fields')}><Icon name="settings" size={14} />Manage fields</button>
          <ExportMenu url="/api/contacts" params={t.params} name="contacts" module="crm" />
        </div>
        {showFilters && (
          <FilterPanel fields={fields} value={draft} onChange={setDraft}
            onApply={() => { setSp({}); setApplied(draft); }} onClear={() => { setDraft({ logic: 'AND', rules: [] }); setApplied(null); }}
            onSave={draft.rules.length ? () => setSaving(true) : undefined} />
        )}
        <ViewsBar t={t} />
        <DataTable {...t.tableProps} hiddenIds={hidden} quickActions={(r) => <>{r.phone && <a className="qa" href={`tel:${r.phone}`} title="Call" aria-label={`Call ${r.full_name}`}><Icon name="phone" size={13} /></a>}<WhatsAppButton phone={r.whatsapp || r.phone} text={leadMessage(r, co)} size={13} />{r.is_customer ? <Link className="qa" to={`/customers/${r.id}/360`} title="Customer 360" aria-label="Customer 360"><Icon name="route" size={13} /></Link> : null}</>} columns={cols} tableId="contacts" selectable selected={selected} onSelect={setSelected} onRowClick={(r) => nav(`/contacts/${r.id}`)} emptyText="No contacts match. Try clearing filters or add a contact." />
      </Card>

      {adding && <ContactForm onClose={() => setAdding(false)} onSaved={(c) => { setAdding(false); if (!c?.id) { toast('Saved on this device — it will be added when you are back online', 'ok'); return; } nav(`/contacts/${c.id}`); }} />}
      {importing && <ImportModal onClose={() => setImporting(false)} onDone={t.reload} />}
      {saving && <SaveListModal rules={draft.rules} logic={draft.logic} onClose={() => setSaving(false)} onSaved={(l) => { setSaving(false); lists.reload(); setApplied(null); setSp({ list: l.id }); }} />}
      {bulk && <BulkModal bulk={bulk} stages={stages} agents={agents} onClose={() => setBulk(null)} onRun={runBulk} />}
      {confirmDel && <ConfirmDialog danger title="Delete contacts" message={`Delete ${selected.length} selected contact(s)? Contacts with sales are skipped.`} confirmLabel="Delete" onCancel={() => setConfirmDel(false)} onConfirm={async () => { const ids = selected; setConfirmDel(false); setSelected([]); remove(ids, `${ids.length} contact(s) deleted`, () => api.post('/api/contacts/bulk', { ids, action: 'delete' }), { onDone: () => t.reload() }); }} />}
      {renaming && <RenameModal list={renaming} onClose={() => setRenaming(null)} onDone={() => { setRenaming(null); lists.reload(); }} />}
    </div>
  );
}

function RenameModal({ list, onClose, onDone }) {
  const [name, setName] = useState(list.name);
  return (
    <Modal title="Rename smart list" size="sm" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" onClick={async () => { await api.put(`/api/smart-lists/${list.id}`, { name }); onDone(); }}>Save</button></>}>
      <Field label="Name"><input className="input" autoFocus value={name} onChange={(e) => setName(e.target.value)} /></Field>
    </Modal>
  );
}

function BulkModal({ bulk, stages, agents, onClose, onRun }) {
  const [v, setV] = useState('');
  const label = { assign: 'Assign to agent', stage: 'Change lead stage', add_tag: 'Add tag', remove_tag: 'Remove tag' }[bulk.action];
  return (
    <Modal title={label} size="sm" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!v} onClick={() => onRun(bulk.action, bulk.action === 'assign' || bulk.action === 'stage' ? Number(v) : v)}>Apply</button></>}>
      {bulk.action === 'assign' && <Select value={v} onChange={setV} options={agents.map((a) => ({ value: a.id, label: a.name }))} />}
      {bulk.action === 'stage' && <Select value={v} onChange={setV} options={stages.map((s) => ({ value: s.id, label: s.value }))} />}
      {(bulk.action === 'add_tag' || bulk.action === 'remove_tag') && <input className="input" autoFocus value={v} onChange={(e) => setV(e.target.value)} placeholder="Tag" />}
    </Modal>
  );
}
