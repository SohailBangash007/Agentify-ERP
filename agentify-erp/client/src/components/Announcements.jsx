// Announcements and release notes from the platform, shown at the top of the workspace until dismissed.
import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';

const TONE = { maintenance: 'warn', billing: 'warn', release: 'info', feature: 'info', info: 'info' };
const LABEL = { release: 'Release notes', feature: 'New', maintenance: 'Maintenance', billing: 'Billing', info: 'Update' };

export default function Announcements() {
  const [items, setItems] = useState([]);
  const [open, setOpen] = useState(null);
  const load = useCallback(() => api.get('/api/announcements').then((d) => setItems(d.items || [])).catch(() => {}), []);
  useEffect(() => { load(); const t = setInterval(load, 15 * 60 * 1000); return () => clearInterval(t); }, [load]);
  const unread = items.filter((a) => !a.read);
  if (!unread.length) return null;
  const dismiss = async (a) => { setItems((x) => x.map((y) => (y.id === a.id ? { ...y, read: true } : y))); try { await api.post(`/api/announcements/${a.id}/read`); } catch { /* shown again next time */ } };
  return unread.slice(0, 2).map((a) => (
    <div key={a.id} className={`alert ${TONE[a.kind] || 'info'} no-print`} role="status" style={{ margin: '0 0 12px' }}>
      <div className="row between" style={{ gap: 8, alignItems: 'flex-start' }}>
        <div><b>{LABEL[a.kind] || 'Update'}{a.version_tag ? ` ${a.version_tag}` : ''}: {a.title}</b>
          {open === a.id ? <div style={{ whiteSpace: 'pre-wrap', marginTop: 6 }}>{a.body}</div> : <button className="btn sm" style={{ marginLeft: 8 }} onClick={() => setOpen(a.id)}>Read more</button>}</div>
        <button className="btn sm" onClick={() => dismiss(a)} aria-label={`Dismiss ${a.title}`}>Dismiss</button>
      </div>
    </div>
  ));
}
