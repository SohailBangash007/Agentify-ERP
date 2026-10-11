import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import Icon from '../components/Icon.jsx';
import { Card, Empty, Loading, PageHead, ProgressBar, Select, StatusBadge } from '../components/ui.jsx';
import { useAuth, useFetch } from '../context.jsx';
import { money } from '../format.js';

const LEGEND = [['available', 'Available', '#16a34a'], ['reserved', 'Reserved', '#d97706'], ['sold', 'Sold', '#7c3aed'], ['defaulted', 'Defaulted / suspended', '#dc2626'], ['draft', 'Other', '#94a3b8']];
const groupOf = (s) => (['on_hold', 'cancelled', 'draft'].includes(s) ? 'draft' : s);

/** Visual plot map: every plot of a project as a colour-coded tile, grouped by block. Click a plot for its file, customer and quick actions. */
export default function PlotMap() {
  const { can } = useAuth();
  const [sp, setSp] = useSearchParams();
  const project = sp.get('project') || '';
  const { data, loading } = useFetch('/api/insights/plot-map', { project_id: project || undefined });
  const [focus, setFocus] = useState('');
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(null);

  const blocks = useMemo(() => {
    const m = new Map();
    for (const p of data?.plots || []) { const k = `${p.project_name || ''}||${p.block || ''}`; if (!m.has(k)) m.set(k, { project: p.project_name, block: p.block, plots: [] }); m.get(k).plots.push(p); }
    return [...m.values()];
  }, [data]);
  const counts = useMemo(() => { const c = {}; for (const p of data?.plots || []) c[groupOf(p.map_status)] = (c[groupOf(p.map_status)] || 0) + 1; return c; }, [data]);
  const match = (p) => (!focus || groupOf(p.map_status) === focus) && (!q || `${p.plot_no} ${p.block} ${p.customer || ''} ${p.registration_no || ''}`.toLowerCase().includes(q.toLowerCase()));
  const plot = sel && data?.plots.find((p) => p.id === sel);
  const pct = plot?.sale_net ? Math.round((plot.paid_amount / plot.sale_net) * 100) : 0;

  return (
    <div>
      <PageHead title="Plot map" sub="Every plot at a glance — click one to see its file, customer and balance.">
        <div style={{ width: 220 }}><Select value={project} onChange={(v) => { setSp(v ? { project: v } : {}); setSel(null); }} placeholder="All projects" options={(data?.projects || []).map((p) => ({ value: p.id, label: p.name }))} /></div>
        <input className="input" style={{ width: 170 }} placeholder="Find plot / customer…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Find plot" />
      </PageHead>
      <div className="pm-legend" style={{ marginBottom: 14 }}>
        {LEGEND.map(([k, l, c]) => (
          <button key={k} className={`view-chip ${focus === k ? 'on' : ''}`} onClick={() => setFocus(focus === k ? '' : k)} aria-pressed={focus === k}><i style={{ background: c }} />{l} <b>{counts[k] || 0}</b></button>
        ))}
        {(focus || q) && <button className="btn sm ghost" onClick={() => { setFocus(''); setQ(''); }}>Clear</button>}
      </div>
      {loading && !data ? <Loading rows={4} /> : !data?.plots.length ? <Card><Empty icon="grid" title="No plots to show" hint="Add properties to a project (with a block and plot number) and they will appear here." to={can('properties', 'create') ? { href: '/properties/new', label: 'Add a property' } : undefined} /></Card> : (
        <div className="pm-layout">
          <div>
            {blocks.map((b) => (
              <Card key={`${b.project}${b.block}`} className="pm-block" title={<span>{!project && b.project ? `${b.project} · ` : ''}{b.block ? `Block ${b.block}` : 'Plots'} <span className="muted" style={{ fontWeight: 400 }}>({b.plots.length})</span></span>}>
                <div className="pm-grid">
                  {b.plots.map((p) => (
                    <button key={p.id} className={`plot ${p.map_status} ${sel === p.id ? 'sel' : ''} ${match(p) ? '' : 'dim'}`} onClick={() => setSel(p.id)} title={`${p.title} — ${p.map_status}${p.customer ? ` · ${p.customer}` : ''}`} aria-label={`Plot ${p.plot_no} ${p.map_status}`}>
                      <b>{p.plot_no || '—'}</b>
                      <small>{p.area_size ? `${p.area_size} ${p.unit || ''}` : p.map_status}</small>
                      {p.overdue_count > 0 && <span className="flag" title="Overdue installments">!</span>}
                    </button>
                  ))}
                </div>
              </Card>
            ))}
          </div>
          <div className="pm-side">
            {!plot ? <Card><Empty icon="map" title="Pick a plot" hint="Details, customer and quick actions appear here." /></Card> : (
              <Card title={`Plot ${plot.plot_no}${plot.block ? ` · Block ${plot.block}` : ''}`} actions={<button className="icon-btn" onClick={() => setSel(null)} aria-label="Close"><Icon name="x" size={14} /></button>}>
                <div className="stack">
                  <div className="row between"><span className="muted">{plot.project_name}</span><StatusBadge status={plot.status} tone={plot.map_status === 'defaulted' ? 'red' : undefined} label={plot.map_status === 'defaulted' ? 'Defaulted' : undefined} /></div>
                  <div><b style={{ fontSize: 18 }}>{money(plot.net_price)}</b><div className="muted">{[plot.area_size && `${plot.area_size} ${plot.unit || ''}`, plot.property_type].filter(Boolean).join(' · ')}</div></div>
                  <div className="muted" style={{ fontSize: 12 }}>{[plot.registration_no && `Reg ${plot.registration_no}`, plot.file_no && `File ${plot.file_no}`, plot.file_status && `File ${plot.file_status}`].filter(Boolean).join(' · ') || '—'}</div>
                  {plot.customer && (
                    <div className="sum-box">
                      <div className="l">Customer</div>
                      <div className="v"><Link to={`/customers/${plot.contact_id}/360`}>{plot.customer}</Link></div>
                      <div style={{ marginTop: 8 }}><ProgressBar value={pct} tone="green" /></div>
                      <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>{money(plot.paid_amount)} of {money(plot.sale_net)} paid ({pct}%){plot.overdue_count ? ` · ${plot.overdue_count} overdue` : ''}</div>
                    </div>
                  )}
                  <div className="row wrap">
                    <Link className="btn sm" to={`/properties/${plot.id}`}>Open plot</Link>
                    {plot.map_status === 'available' && can('sales', 'create') && <Link className="btn sm primary" to={`/sales/new?property=${plot.id}`}>Book this plot</Link>}
                    {plot.sale_id && <Link className="btn sm" to={`/sales/${plot.sale_id}`}>Ledger</Link>}
                    {plot.sale_id && can('payments', 'create') && <Link className="btn sm primary" to={`/receipts/new?contact=${plot.contact_id}&sale=${plot.sale_id}`}>Receive payment</Link>}
                    {plot.contact_id && <Link className="btn sm" to={`/customers/${plot.contact_id}/360`}>Customer 360</Link>}
                  </div>
                </div>
              </Card>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
