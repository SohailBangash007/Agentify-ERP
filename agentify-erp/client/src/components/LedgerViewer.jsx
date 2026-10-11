import { useState } from 'react';
import Icon from './Icon.jsx';
import { Empty, Loading } from './ui.jsx';
import { download } from '../api.js';
import { useFetch, useToast } from '../context.jsx';
import { date, money } from '../format.js';

/** Customer ledger with a date filter and real PDF / Excel / CSV downloads (portal). */
export default function LedgerViewer({ saleId, combined, selectable }) {
  const toast = useToast();
  const [range, setRange] = useState({ from: '', to: '' });
  const [sel, setSel] = useState('all'); // all | p:<project> | s:<sale> | b:<sale of a combined plan>
  const opts = useFetch(selectable ? '/api/portal/ledger-options' : null);
  const pick = (() => { const [k, id] = sel.split(':'); return k === 'p' ? { project_id: id } : k === 's' ? { sale_id: id } : k === 'b' ? { sale_id: id, combined: 1 } : {}; })();
  const params = { sale_id: saleId, combined: combined ? 1 : undefined, ...(selectable ? pick : {}), from: range.from || undefined, to: range.to || undefined };
  const o = opts.data;
  const slug = (selectable && sel !== 'all' ? `-${sel.replace(':', '')}` : '');
  const { data, loading } = useFetch('/api/portal/ledger', params);
  const dl = async (format) => { try { await download('/api/portal/ledger', { ...params, format }, `my-ledger${slug}.${format}`); } catch (e) { toast(e.message, 'err'); } };
  const quick = (months) => { const d = new Date(); d.setMonth(d.getMonth() - months); setRange({ from: d.toLocaleDateString('en-CA'), to: '' }); };
  return (
    <div className="stack">
      {selectable && o && (o.sales.length > 1 || o.projects.length > 0) && (
        <div className="row wrap ledger-pick">
          <label className="row"><span className="muted">Show ledger for</span>
            <select className="input" style={{ minWidth: 280 }} value={sel} onChange={(e) => setSel(e.target.value)}>
              <option value="all">Everything — all properties &amp; contracts</option>
              {o.projects.length > 0 && <optgroup label="By project">{o.projects.map((p) => <option key={p.id} value={`p:${p.id}`}>Project: {p.name}</option>)}</optgroup>}
              {o.sales.length > 0 && <optgroup label="By property / contract (installment plan)">{o.sales.map((s) => <option key={s.id} value={`s:${s.id}`}>{s.kind === 'construction' ? 'House construction' : 'Plot'} — {s.title} ({s.sale_no})</option>)}</optgroup>}
              {o.bundles.length > 0 && <optgroup label="Plot + house together">{o.bundles.map((b) => <option key={b.sale_id} value={`b:${b.sale_id}`}>Combined plan — {b.title}</option>)}</optgroup>}
            </select></label>
          {sel !== 'all' && <button className="btn sm ghost" onClick={() => setSel('all')}>Show everything</button>}
        </div>
      )}
      <div className="row wrap">
        <label className="row"><span className="muted">From</span><input className="input" type="date" style={{ width: 150 }} value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} /></label>
        <label className="row"><span className="muted">To</span><input className="input" type="date" style={{ width: 150 }} value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} /></label>
        <button className="btn sm ghost" onClick={() => quick(3)}>Last 3 months</button><button className="btn sm ghost" onClick={() => quick(12)}>Last year</button>
        {(range.from || range.to) && <button className="btn sm ghost" onClick={() => setRange({ from: '', to: '' })}>Clear</button>}
        <div className="grow" />
        <button className="btn primary sm" onClick={() => dl('pdf')}><Icon name="download" size={13} />Download PDF</button>
        <button className="btn sm" onClick={() => dl('xlsx')}>Excel</button><button className="btn sm" onClick={() => dl('csv')}>CSV</button>
      </div>
      {!data ? <Loading /> : (
        <div className="table-wrap" style={{ opacity: loading ? 0.6 : 1 }}>
          <table className="t"><thead><tr><th>Date</th><th>Reference</th><th>Description</th><th className="num">Debit</th><th className="num">Credit</th><th className="num">Balance</th></tr></thead>
            <tbody>
              {data.opening !== undefined && <tr><td colSpan={5} className="muted">Opening balance{data.from ? ` (before ${date(data.from)})` : ''}</td><td className="num mono">{money(data.opening)}</td></tr>}
              {data.entries.map((e, i) => <tr key={i}><td>{date(e.date)}</td><td>{e.ref}</td><td>{e.description}</td><td className="num mono">{e.debit ? money(e.debit) : ''}</td><td className="num mono">{e.credit ? money(e.credit) : ''}</td><td className="num mono">{money(e.balance)}</td></tr>)}
            </tbody>
            <tfoot><tr><td colSpan={5}>Closing balance (amount you owe)</td><td className="num mono">{money(data.balance)}</td></tr></tfoot></table>
          {!data.entries.length && <Empty>No transactions in this period.</Empty>}
        </div>
      )}
    </div>
  );
}
