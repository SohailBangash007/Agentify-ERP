import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Icon from './Icon.jsx';
import { StatusBadge } from './ui.jsx';
import { api } from '../api.js';
import { money } from '../format.js';

const FILE_TONE = { Active: 'green', Inactive: 'grey', Suspended: 'red', Defaulted: 'red', Paused: 'amber' };
const SALE_TEXT = { available: 'Available for sale', featured: 'Available — featured', reserved: 'Reserved for a customer', sold: 'Sold', on_hold: 'On hold', draft: 'Draft — not yet listed', cancelled: 'Cancelled' };

/** Enter a registration number (or file no., plot, code) and see the property's status at once. */
export default function PropertyStatusCheck() {
  const [q, setQ] = useState('');
  const [rows, setRows] = useState(null);
  useEffect(() => {
    if (q.trim().length < 2) { setRows(null); return undefined; }
    const t = setTimeout(() => api.get('/api/properties/lookup', { q: q.trim() }).then(setRows).catch(() => setRows([])), 250);
    return () => clearTimeout(t);
  }, [q]);
  return (
    <div className="pcheck" style={{ marginBottom: 12 }}>
      <div className="row wrap" style={{ gap: 10 }}>
        <b style={{ whiteSpace: 'nowrap' }}><Icon name="search" size={14} /> Check a property</b>
        <input className="input" style={{ maxWidth: 380, flex: 1 }} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Enter the registration number (e.g. REG-0012), file no. or plot…" aria-label="Property registration number" />
        {q && <button className="btn sm ghost" onClick={() => setQ('')}>Clear</button>}
      </div>
      {rows && !rows.length && <div className="muted" style={{ marginTop: 10 }}>No property found for “{q}”.</div>}
      {rows?.map((p) => (
        <div key={p.id} className="row wrap" style={{ marginTop: 10, padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 8, gap: 14 }}>
          <div className="grow" style={{ minWidth: 220 }}>
            <Link to={`/properties/${p.id}`}><b>{p.title}</b></Link>
            <div className="muted" style={{ fontSize: 12.5 }}>Reg <b className="mono">{p.registration_no}</b>{p.file_no ? ` · File ${p.file_no}` : ''}{p.project_name ? ` · ${p.project_name}` : ''}{p.plot_no ? ` · Plot ${p.plot_no}` : ''}{p.area_size ? ` · ${p.area_size} ${p.unit}` : ''}</div>
          </div>
          <div><div className="muted" style={{ fontSize: 11 }}>Sale status</div><StatusBadge status={p.status} label={SALE_TEXT[p.status] || p.status} />{p.sold_to && <div className="cell-sub">to {p.sold_to}</div>}</div>
          <div><div className="muted" style={{ fontSize: 11 }}>File status</div>{p.file_status ? <StatusBadge status={p.file_status} tone={FILE_TONE[p.file_status]} /> : <span className="muted">Not set</span>}{p.file_notes && <div className="cell-sub">{p.file_notes}</div>}</div>
          <div style={{ textAlign: 'right' }}><div className="muted" style={{ fontSize: 11 }}>Net price</div><b className="mono">{money(p.net_price)}</b></div>
        </div>
      ))}
    </div>
  );
}
