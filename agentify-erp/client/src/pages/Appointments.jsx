// Appointments: viewings, site visits, meetings and calls, added to your Google Calendar when it is connected.
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, Empty, ErrorBox, Field, Loading, Modal, PageHead, StatusBadge } from '../components/ui.jsx';
import { api } from '../api.js';
import { useToast } from '../context.jsx';
import { dateTime } from '../format.js';

const KINDS = [['viewing', 'Viewing'], ['site_visit', 'Site visit'], ['meeting', 'Meeting'], ['call', 'Call'], ['signing', 'Signing'], ['other', 'Other']];
const blank = () => ({ title: '', kind: 'viewing', starts_at: '', ends_at: '', location: '', notes: '', contact_id: '' });

export default function Appointments() {
  const toast = useToast();
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  const [f, setF] = useState(null);
  const [contacts, setContacts] = useState([]);
  const load = useCallback(() => api.get('/api/appointments').then(setD).catch((e) => setErr(e.message)), []);
  useEffect(() => { load(); api.get('/api/contacts').then((r) => setContacts(Array.isArray(r) ? r : r.items || r.rows || [])).catch(() => {}); }, [load]);
  const save = async () => {
    try {
      const body = { ...f, contact_id: f.contact_id || undefined };
      if (f.id) await api.put(`/api/appointments/${f.id}`, body); else await api.post('/api/appointments', body);
      toast('Saved'); setF(null); load();
    } catch (e) { toast(e.message, 'err'); }
  };
  const cancel = async (a) => { if (!window.confirm('Cancel this appointment?')) return; await api.post(`/api/appointments/${a.id}/cancel`); load(); };
  return (
    <>
      <PageHead title="Appointments" sub={d?.calendar_connected ? 'Connected to your Google Calendar: new appointments appear there.' : 'Connect Google Calendar in Settings > Integrations to see these in your calendar.'}>
        <button className="btn primary sm" onClick={() => setF(blank())}>New appointment</button>
      </PageHead>
      <ErrorBox error={err} />
      {!d ? (!err && <Loading />) : !d.items.length ? <Empty title="No appointments yet" hint="Book a viewing or site visit with a client." /> : (
        <Card flush><div className="table-wrap"><table className="t"><thead><tr><th>When</th><th>What</th><th>With</th><th>Property</th><th>Where</th><th>Calendar</th><th /></tr></thead><tbody>
          {d.items.map((a) => <tr key={a.id} style={a.status === 'canceled' ? { opacity: 0.5 } : undefined}>
            <td className="nowrap">{dateTime(a.starts_at)}</td><td><b>{a.title}</b><div className="muted">{(KINDS.find(([k]) => k === a.kind) || [])[1]}</div></td>
            <td>{a.contact_id ? <Link to={`/contacts/${a.contact_id}`}>{a.contact_name}</Link> : '—'}</td><td>{a.property_title || '—'}</td><td>{a.location || '—'}</td>
            <td>{a.status === 'canceled' ? <StatusBadge status="inactive" label="Canceled" /> : a.google_event_id ? <StatusBadge status="active" label="In Google Calendar" /> : a.sync_error ? <span className="muted" title={a.sync_error}>Not synced</span> : '—'}</td>
            <td className="right nowrap">{a.status !== 'canceled' && <><button className="btn sm" onClick={() => setF({ ...a, contact_id: a.contact_id || '', starts_at: a.starts_at.slice(0, 16).replace(' ', 'T'), ends_at: a.ends_at.slice(0, 16).replace(' ', 'T') })}>Edit</button>{' '}<button className="btn sm danger" onClick={() => cancel(a)}>Cancel</button></>}</td></tr>)}
        </tbody></table></div></Card>)}
      {f && (
        <Modal title={f.id ? 'Edit appointment' : 'New appointment'} onClose={() => setF(null)} footer={<><button className="btn" onClick={() => setF(null)}>Close</button><button className="btn primary" onClick={save}>Save</button></>}>
          <Field label="Title" required><input className="input" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="Viewing at 12 Maple Street" /></Field>
          <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="Kind"><select className="input" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>{KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
            <Field label="With"><select className="input" value={f.contact_id} onChange={(e) => setF({ ...f, contact_id: e.target.value })}><option value="">Nobody in particular</option>{contacts.map((c) => <option key={c.id} value={c.id}>{c.full_name}</option>)}</select></Field>
            <Field label="Starts" required><input className="input" type="datetime-local" value={f.starts_at} onChange={(e) => setF({ ...f, starts_at: e.target.value })} /></Field>
            <Field label="Ends (default one hour)"><input className="input" type="datetime-local" value={f.ends_at} onChange={(e) => setF({ ...f, ends_at: e.target.value })} /></Field>
          </div>
          <Field label="Where"><input className="input" value={f.location || ''} onChange={(e) => setF({ ...f, location: e.target.value })} /></Field>
          <Field label="Notes"><textarea className="input" rows={2} value={f.notes || ''} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
        </Modal>)}
    </>
  );
}
