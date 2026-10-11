import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Icon from './Icon.jsx';
import { Empty, Loading, Menu, Select } from './ui.jsx';
import { useFetch, useAuth, useToast } from '../context.jsx';
import { download } from '../api.js';

/**
 * Server-driven list state: search, sort, pagination and arbitrary filters, all in one hook.
 * `tableProps` can be spread straight onto <DataTable/>.
 */
export function useTable(url, { limit = 25, sort, dir = 'desc', filters = {}, pick = (d) => d, viewsKey } = {}) {
  const [q, setQ] = useState('');
  const [dq, setDq] = useState('');
  const [page, setPage] = useState(1);
  const [sortState, setSort] = useState({ sort, dir });
  const [extra, setExtra] = useState(filters);
  useEffect(() => { const t = setTimeout(() => { setDq(q); setPage(1); }, 250); return () => clearTimeout(t); }, [q]);
  const params = useMemo(() => ({ q: dq, page, limit, sort: sortState.sort, dir: sortState.dir, ...extra }), [dq, page, limit, sortState, extra]);
  const { data, loading, error, reload } = useFetch(url, params);
  const view = data ? pick(data) : null;
  const setFilter = useCallback((patch) => { setExtra((e) => ({ ...e, ...patch })); setPage(1); }, []);
  // saved views: named search + filter + sort combinations, remembered in this browser
  const vk = viewsKey ? `views:${viewsKey}` : null;
  const [views, setViews] = useState(() => { try { return vk ? JSON.parse(localStorage.getItem(vk) || '[]') : []; } catch { return []; } });
  const persist = (v) => { setViews(v); if (vk) try { localStorage.setItem(vk, JSON.stringify(v)); } catch { /* ignore */ } };
  const saveView = (name) => persist([...views.filter((x) => x.name !== name), { name, q, extra, sort: sortState }]);
  const applyView = (v) => { setQ(v.q || ''); setDq(v.q || ''); setExtra(v.extra || {}); setSort(v.sort || { sort, dir }); setPage(1); };
  const deleteView = (name) => persist(views.filter((x) => x.name !== name));
  return {
    views, saveView, applyView, deleteView, viewsEnabled: !!vk,
    q, setQ, page, setPage, params, extra, setFilter, setExtra, reload, error, loading, data: view, raw: data,
    rows: view?.rows || [], total: view?.total || 0, sortState,
    tableProps: {
      rows: view?.rows || [], total: view?.total || 0, page, limit, loading, onPage: setPage, sort: sortState,
      onSort: (key) => setSort((s) => ({ sort: key, dir: s.sort === key && s.dir === 'desc' ? 'asc' : 'desc' })),
    },
  };
}

/** Chips for the table's saved views + "Save view". Render it right under the toolbar. */
export function ViewsBar({ t }) {
  const [active, setActive] = useState('');
  if (!t.viewsEnabled) return null;
  const dirty = t.q || Object.values(t.extra || {}).some((v) => v !== '' && v !== undefined && v !== null);
  return (
    <div className="views-bar" aria-label="Saved views">
      {t.views.map((v) => (
        <span key={v.name} className={`view-chip ${active === v.name ? 'on' : ''}`} onClick={() => { setActive(v.name); t.applyView(v); }}>{v.name}
          <button aria-label={`Delete view ${v.name}`} title="Delete view" onClick={(e) => { e.stopPropagation(); if (active === v.name) setActive(''); t.deleteView(v.name); }}>×</button></span>
      ))}
      {dirty && <button className="btn sm ghost" onClick={() => { const name = window.prompt('Name this view (e.g. Overdue this month)'); if (name?.trim()) { t.saveView(name.trim()); setActive(name.trim()); } }}>+ Save this view</button>}
      {active && <button className="btn sm ghost" onClick={() => { setActive(''); t.setQ(''); t.setExtra({}); }}>Clear</button>}
    </div>
  );
}

/** Click-to-edit cell. `edit` = { type: 'text'|'number'|'date'|'select', options?, save: async (row, value) => void }. */
function InlineCell({ row, col, onSaved, toast }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState('');
  const e = col.edit;
  const shown = col.render ? col.render(row) : (row[col.key] ?? <span className="faint">—</span>);
  if (e.can === false || (typeof e.can === 'function' && !e.can(row))) return shown;
  const current = () => (e.value ? e.value(row) : (row[col.key] ?? ''));
  const start = (ev) => { ev.stopPropagation(); setVal(current()); setEditing(true); };
  const commit = async (v) => {
    setEditing(false);
    if (String(v ?? '') === String(current() ?? '')) return;
    try { await e.save(row, v); onSaved(row); } catch (er) { toast(er.message || 'Could not save', 'err'); }
  };
  if (!editing) return <span className="inline-cell" role="button" tabIndex={0} title="Click to edit" onClick={start} onKeyDown={(ev) => ev.key === 'Enter' && start(ev)}>{shown}</span>;
  const stop = (ev) => ev.stopPropagation();
  if (e.type === 'select') {
    const opts = typeof e.options === 'function' ? e.options(row) : e.options;
    return <span onClick={stop}><Select autoFocus className="select inline-edit" allowEmpty={e.allowEmpty ?? true} value={val} options={opts} onChange={(v) => commit(v)} onBlur={() => setEditing(false)} /></span>;
  }
  const norm = (v) => (e.type === 'number' ? (v === '' ? '' : Number(v)) : v);
  return <input className="input inline-edit" autoFocus type={e.type || 'text'} value={val} onClick={stop} onChange={(ev) => setVal(ev.target.value)}
    onBlur={() => commit(norm(val))} onKeyDown={(ev) => { if (ev.key === 'Enter') commit(norm(val)); if (ev.key === 'Escape') setEditing(false); }} />;
}

export function SearchBar({ value, onChange, placeholder = 'Search…', width = 260 }) {
  return (
    <div className="search" style={{ width, maxWidth: '100%' }}>
      <Icon name="search" size={15} />
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={placeholder} />
    </div>
  );
}

export function ExportMenu({ url, params, name, module }) {
  const { can } = useAuth();
  const toast = useToast();
  if (module && !can(module, 'export')) return null;
  const go = async (format, ext) => {
    try { await download(url, { ...params, format, page: 1, limit: undefined }, `${name}.${ext}`); } catch (e) { toast(e.message, 'err'); }
  };
  return (
    <Menu trigger={<button className="btn"><Icon name="download" size={14} />Export</button>}>
      <button onClick={() => go('xlsx', 'xlsx')}>Excel (.xlsx)</button>
      <button onClick={() => go('pdf', 'pdf')}>PDF document</button>
      <button onClick={() => go('csv', 'csv')}>CSV</button>
      <button onClick={() => window.print()}>Print this page</button>
    </Menu>
  );
}

/**
 * columns: [{key,label,render?,num?,sortKey?,hidden?,fixed?}]
 * Column visibility is remembered per tableId in localStorage.
 */
export default function DataTable({
  columns, rows, loading, total, page = 1, limit = 25, onPage, sort, onSort, selectable, selected = [], onSelect, onRowClick,
  tableId, rowActions, quickActions, footer, emptyText, rowKey = 'id', rowClass, hidePager, hiddenIds,
}) {
  const toast = useToast();
  const [flash, setFlash] = useState(null);
  if (hiddenIds?.size) rows = rows.filter((r) => !hiddenIds.has(r[rowKey]));
  const storeKey = tableId ? `cols:${tableId}` : null;
  const [hiddenCols, setHiddenCols] = useState(() => {
    if (!storeKey) return columns.filter((c) => c.hidden).map((c) => c.key);
    try { const s = JSON.parse(localStorage.getItem(storeKey)); if (Array.isArray(s)) return s; } catch { /* ignore */ }
    return columns.filter((c) => c.hidden).map((c) => c.key);
  });
  const [colMenu, setColMenu] = useState(false);
  const menuRef = useRef(null);
  useEffect(() => {
    if (!colMenu) return undefined;
    const h = (e) => { if (!menuRef.current?.contains(e.target)) setColMenu(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [colMenu]);
  const toggleCol = (key) => {
    const next = hiddenCols.includes(key) ? hiddenCols.filter((k) => k !== key) : [...hiddenCols, key];
    setHiddenCols(next);
    if (storeKey) try { localStorage.setItem(storeKey, JSON.stringify(next)); } catch { /* ignore */ }
  };
  const visible = columns.filter((c) => !hiddenCols.includes(c.key));
  const allSel = rows.length > 0 && rows.every((r) => selected.includes(r[rowKey]));
  const pages = Math.max(1, Math.ceil((total ?? rows.length) / limit));
  const from = total ? (page - 1) * limit + 1 : 0;

  return (
    <div>
      <div className="table-wrap" style={{ position: 'relative' }}>
        <table className="t">
          <thead>
            <tr>
              {selectable && <th style={{ width: 34 }}><input type="checkbox" aria-label="Select all" checked={allSel} onChange={(e) => onSelect(e.target.checked ? rows.map((r) => r[rowKey]) : [])} /></th>}
              {visible.map((c) => (
                <th key={c.key} className={`${c.num ? 'num' : ''} ${c.sortKey !== false && onSort && (c.sortKey || c.sortable) ? 'sortable' : ''}`} style={c.width ? { width: c.width } : undefined}
                  onClick={() => onSort && (c.sortKey || c.sortable) && onSort(c.sortKey || c.key)}>
                  {c.label}{sort?.sort === (c.sortKey || c.key) && <Icon name={sort.dir === 'asc' ? 'chevU' : 'chevD'} size={11} style={{ marginLeft: 4 }} />}
                </th>
              ))}
              <th style={{ width: 34, textAlign: 'right', position: 'relative' }} ref={menuRef}>
                {tableId && (
                  <>
                    <button className="btn ghost sm" style={{ padding: '0 6px' }} aria-label="Choose columns" onClick={() => setColMenu((o) => !o)}><Icon name="list" size={14} /></button>
                    {colMenu && (
                      <div className="colmenu" role="menu">
                        <div className="muted" style={{ padding: '2px 8px 6px', fontSize: 11 }}>VISIBLE COLUMNS</div>
                        {columns.map((c) => <label key={c.key}><input type="checkbox" checked={!hiddenCols.includes(c.key)} onChange={() => toggleCol(c.key)} />{c.label}</label>)}
                      </div>
                    )}
                  </>
                )}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r[rowKey] ?? JSON.stringify(r)} className={`${onRowClick ? 'click' : ''} ${selected.includes(r[rowKey]) ? 'sel' : ''} ${flash === r[rowKey] ? 'flash' : ''} ${rowClass ? rowClass(r) : ''}`} onClick={() => onRowClick?.(r)}>
                {selectable && <td onClick={(e) => e.stopPropagation()}><input type="checkbox" aria-label="Select row" checked={selected.includes(r[rowKey])} onChange={(e) => onSelect(e.target.checked ? [...selected, r[rowKey]] : selected.filter((x) => x !== r[rowKey]))} /></td>}
                {visible.map((c) => <td key={c.key} className={`${c.num ? 'num' : ''} ${/(^|_)(date|due|no|code|at|since|phone|terms|cnic|whatsapp|mobile)($|_)|_no$|_date$|_phone$/.test(c.key) ? 'nw' : ''}`}>{c.edit ? <InlineCell row={r} col={c} toast={toast} onSaved={(row) => { setFlash(row[rowKey]); setTimeout(() => setFlash(null), 1500); }} /> : c.render ? c.render(r) : (r[c.key] ?? <span className="faint">—</span>)}</td>)}
                <td onClick={(e) => e.stopPropagation()} style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                  {quickActions && <span className="row-actions">{quickActions(r)}</span>}
                  {rowActions && <Menu trigger={<button className="btn ghost sm" aria-label="Row actions" style={{ padding: '0 6px' }}><Icon name="more" size={16} /></button>}>{rowActions(r)}</Menu>}
                </td>
              </tr>
            ))}
          </tbody>
          {footer && rows.length > 0 && <tfoot>{footer}</tfoot>}
        </table>
        {loading && !rows.length && <Loading />}
        {!loading && !rows.length && <Empty icon="search" title="Nothing to show" hint={emptyText || 'No records match. Try a different search or clear your filters.'} />}
      </div>
      {!hidePager && (
        <div className="pager">
          <span>{total ? `${from}–${Math.min(page * limit, total)} of ${total}` : 'No results'}</span>
          <span className="pg">
            <button className="btn sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>Prev</button>
            <span style={{ padding: '0 8px' }}>{page} / {pages}</span>
            <button className="btn sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>Next</button>
          </span>
        </div>
      )}
    </div>
  );
}
