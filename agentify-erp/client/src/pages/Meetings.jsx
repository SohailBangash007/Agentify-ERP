// Video meetings: schedule, invite by link (email, text message, WhatsApp), join, and see what was recorded.
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, Empty, ErrorBox, Field, Loading, Modal, PageHead, StatusBadge, Tabs } from '../components/ui.jsx';
import { api } from '../api.js';
import { useAuth, useLookups, useToast } from '../context.jsx';

const pad = (n) => String(n).padStart(2, '0');
const nowLocal = (plusMin = 30) => { const d = new Date(Date.now() + plusMin * 60000); d.setMinutes(Math.ceil(d.getMinutes() / 5) * 5, 0, 0); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };

function Schedule({ settings, onClose, onDone }) {
  const toast = useToast();
  const { users } = useLookups();
  const { user } = useAuth();
  const [f, setF] = useState({ title: '', description: '', starts_at: nowLocal(), max_minutes: settings.defaults.default_minutes, record: settings.defaults.record_default, transcribe: true, script_id: '', allow_guests: true });
  const [team, setTeam] = useState([]);
  const [extra, setExtra] = useState([]); // { kind, name, email, phone }
  const [draft, setDraft] = useState({ name: '', contact: '' });
  const [contacts, setContacts] = useState([]);
  const [pick, setPick] = useState('');
  const [via, setVia] = useState({ email: true, sms: false, whatsapp: true });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [made, setMade] = useState(null);
  useEffect(() => { api.get('/api/contacts').then((r) => setContacts(Array.isArray(r) ? r : r.items || r.rows || [])).catch(() => {}); }, []);
  const addPerson = () => {
    const v = draft.contact.trim(); if (!v && !draft.name.trim()) return;
    const isMail = v.includes('@');
    setExtra([...extra, { kind: isMail ? 'email' : 'phone', name: draft.name.trim(), email: isMail ? v : '', phone: isMail ? '' : v }]); setDraft({ name: '', contact: '' });
  };
  const submit = async () => {
    setBusy(true); setErr('');
    try {
      const invitees = [...team.map((id) => ({ kind: 'user', user_id: id })), ...extra, ...(pick ? [{ kind: 'contact', contact_id: Number(pick) }] : [])];
      const m = await api.post('/api/meetings', { ...f, starts_at: f.starts_at.replace('T', ' '), script_id: f.script_id || null, invitees, send: Object.keys(via).filter((k) => via[k] && k !== 'whatsapp') });
      setMade(m); onDone();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  const copy = (t) => { navigator.clipboard?.writeText(t); toast('Link copied'); };
  if (made) return (
    <Modal title="Meeting scheduled" onClose={onClose} footer={<button className="btn primary" onClick={onClose}>Done</button>}>
      <p>People you chose have been notified{made.sent?.length ? '' : ' in the app'}. Send each person their own link too:</p>
      <div className="table-wrap"><table className="t"><tbody>
        {made.invites.filter((i) => !(i.kind === 'user' && i.user_id === user.id)).map((i) => (
          <tr key={i.id}><td><b>{i.name || i.email || i.phone}</b><div className="muted">{i.email || i.phone}</div></td>
            <td className="right nowrap">{via.whatsapp && i.whatsapp && <a className="btn sm" href={i.whatsapp} target="_blank" rel="noreferrer">WhatsApp</a>}{' '}<button className="btn sm" onClick={() => copy(i.link)}>Copy link</button></td></tr>))}
        {!made.invites.length && <tr><td className="muted">Nobody invited yet. Share the general link instead.</td></tr>}
      </tbody></table></div>
      <div className="row" style={{ marginTop: 10 }}><button className="btn" onClick={() => copy(made.join_url)}>Copy general link</button><a className="btn primary" href={`/meet/${made.code}`} target="_blank" rel="noreferrer">Open the room</a></div>
    </Modal>);
  return (
    <Modal title="Schedule a video meeting" onClose={onClose} size="lg" footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy || !f.title.trim()} onClick={submit}>{busy ? 'Scheduling…' : 'Schedule and invite'}</button></>}>
      <ErrorBox error={err} />
      <Field label="Title" required><input className="input" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="e.g. Site walkthrough with Mr. Khan" autoFocus /></Field>
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 12 }}>
        <Field label="Date and time"><input className="input" type="datetime-local" value={f.starts_at} onChange={(e) => setF({ ...f, starts_at: e.target.value })} /></Field>
        <Field label="Length (minutes)" hint={`At most ${settings.caps.max_minutes} on this platform`}><input className="input" type="number" min="5" max={settings.caps.max_minutes} value={f.max_minutes} onChange={(e) => setF({ ...f, max_minutes: e.target.value })} /></Field>
        <Field label="Script for the side window"><select className="input" value={f.script_id} onChange={(e) => setF({ ...f, script_id: e.target.value })}><option value="">None</option>{settings.scripts.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
      </div>
      <Field label="Notes for the invitation (optional)"><textarea className="input" rows={2} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
      <div className="row" style={{ gap: 18, flexWrap: 'wrap', margin: '6px 0' }}>
        {settings.caps.recording && <label><input type="checkbox" checked={f.record} onChange={(e) => setF({ ...f, record: e.target.checked })} /> Record this meeting</label>}
        <label><input type="checkbox" checked={f.transcribe} onChange={(e) => setF({ ...f, transcribe: e.target.checked })} /> Save live captions as a transcript</label>
        <label><input type="checkbox" checked={f.allow_guests} onChange={(e) => setF({ ...f, allow_guests: e.target.checked })} /> Guests can join with the link</label>
      </div>
      <Field label="Colleagues">
        <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>{users.filter((u) => u.id !== user.id).map((u) => <button type="button" key={u.id} className={`btn sm ${team.includes(u.id) ? 'primary' : ''}`} onClick={() => setTeam(team.includes(u.id) ? team.filter((x) => x !== u.id) : [...team, u.id])}>{u.name}</button>)}</div>
      </Field>
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 12 }}>
        <Field label="Client from your contacts"><select className="input" value={pick} onChange={(e) => setPick(e.target.value)}><option value="">None</option>{contacts.slice(0, 300).map((c) => <option key={c.id} value={c.id}>{c.full_name}</option>)}</select></Field>
        <Field label="Someone else (name, then email or phone)">
          <div className="row"><input className="input" style={{ width: '40%' }} placeholder="Name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /><input className="input" placeholder="Email or +phone" value={draft.contact} onChange={(e) => setDraft({ ...draft, contact: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && addPerson()} /><button type="button" className="btn" onClick={addPerson}>Add</button></div>
        </Field>
      </div>
      {extra.length > 0 && <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>{extra.map((p, i) => <span key={i} className="chip">{p.name || p.email || p.phone} <button type="button" className="link" aria-label="Remove" onClick={() => setExtra(extra.filter((_, j) => j !== i))}>×</button></span>)}</div>}
      <Field label="Send the invitation by" hint="WhatsApp opens a ready message for you to send from your own WhatsApp. Text messages need Twilio connected.">
        <div className="row" style={{ gap: 18 }}>{[['email', 'Email'], ['sms', 'Text message'], ['whatsapp', 'WhatsApp']].map(([k, l]) => <label key={k}><input type="checkbox" checked={via[k]} onChange={(e) => setVia({ ...via, [k]: e.target.checked })} /> {l}</label>)}</div>
      </Field>
    </Modal>);
}

function Detail({ id, onClose, onChanged }) {
  const toast = useToast();
  const [m, setM] = useState(null);
  const load = useCallback(() => api.get(`/api/meetings/${id}`).then(setM), [id]);
  useEffect(() => { load(); }, [load]);
  if (!m) return <Modal title="Meeting" onClose={onClose}><Loading /></Modal>;
  const resend = async (via, ids) => { const r = await api.post(`/api/meetings/${id}/send`, { via, invite_ids: ids }); toast(r.sent.some((s) => s.sent.length) ? 'Invitation sent' : 'Nothing to send. Check the contact details.'); load(); };
  return (
    <Modal title={m.title} onClose={onClose} size="lg" footer={<>{m.status !== 'canceled' && m.status !== 'ended' && <button className="btn danger" onClick={async () => { if (!window.confirm('Cancel this meeting? Everyone invited will no longer be able to join.')) return; await api.post(`/api/meetings/${id}/cancel`); onChanged(); onClose(); }}>Cancel meeting</button>}<button className="btn" onClick={onClose}>Close</button></>}>
      <p className="muted">{m.starts_at.slice(0, 16)} · up to {m.max_minutes} minutes · {m.record ? 'recorded' : 'not recorded'}</p>
      <div className="row"><button className="btn" onClick={() => { navigator.clipboard?.writeText(m.join_url); toast('Link copied'); }}>Copy general link</button></div>
      <h4>People</h4>
      <div className="table-wrap"><table className="t"><tbody>{m.invites.map((i) => (
        <tr key={i.id}><td><b>{i.name || i.email || i.phone}</b><div className="muted">{i.email || i.phone || 'colleague'}</div></td><td className="muted">{i.joined_at ? 'Joined' : i.sent_at ? `Sent by ${i.sent_via}` : 'Not sent'}</td>
          <td className="right nowrap">{i.email && <button className="btn sm" onClick={() => resend(['email'], [i.id])}>Email</button>}{' '}{i.whatsapp && <a className="btn sm" href={i.whatsapp} target="_blank" rel="noreferrer">WhatsApp</a>}{' '}<button className="btn sm" onClick={() => { navigator.clipboard?.writeText(i.link); toast('Link copied'); }}>Copy</button></td></tr>))}</tbody></table></div>
      {m.recordings.length > 0 && <p><Link to="/recordings">{m.recordings.length} recording(s)</Link> and {m.caption_lines} caption lines were saved.</p>}
    </Modal>);
}

export default function Meetings() {
  const { can } = useAuth();
  const [scope, setScope] = useState('upcoming');
  const [rows, setRows] = useState(null);
  const [settings, setSettings] = useState(null);
  const [err, setErr] = useState('');
  const [show, setShow] = useState(false);
  const [open, setOpen] = useState(null);
  const load = useCallback(() => { api.get(`/api/meetings?scope=${scope}`).then(setRows).catch((e) => setErr(e.message)); }, [scope]);
  useEffect(() => { load(); const t = setInterval(load, 30000); return () => clearInterval(t); }, [load]);
  useEffect(() => { api.get('/api/meetings/settings').then(setSettings).catch((e) => setErr(e.message)); }, []);
  const setDefault = async (patch) => { setSettings({ ...settings, defaults: await api.put('/api/meetings/settings', patch) }); };
  return (
    <>
      <PageHead title="Meetings" sub="Video meetings with screen sharing, captions, recording and a script beside you. Send each person a link." >
        {settings?.caps.enabled && <button className="btn primary" onClick={() => setShow(true)}>Schedule a meeting</button>}
      </PageHead>
      <ErrorBox error={err} />
      {settings && !settings.caps.enabled && <div className="alert warn">Video meetings are switched off for this platform.</div>}
      {settings && <div className="alert info">Each meeting can last up to <b>{settings.caps.max_minutes} minutes</b> and hold up to <b>{settings.caps.max_participants} people</b>. Rooms open {settings.caps.early_join_minutes} minutes early and close automatically when time is up.{!settings.openai && ' Add an OpenAI or Gemini key under Integrations to transcribe recordings. Live captions work without it.'}</div>}
      <Tabs tabs={[{ key: 'upcoming', label: 'Upcoming' }, { key: 'past', label: 'Past' }]} value={scope} onChange={setScope} />
      <Card flush>
        {!rows ? <Loading /> : !rows.length ? <Empty icon="calendar" title={scope === 'upcoming' ? 'No meetings scheduled' : 'No past meetings'} hint="Schedule one and send the link on email, text or WhatsApp." /> : (
          <div className="table-wrap"><table className="t"><thead><tr><th>When</th><th>Meeting</th><th>Host</th><th>People</th><th>Status</th><th /></tr></thead><tbody>
            {rows.map((m) => <tr key={m.id}><td className="nowrap">{m.starts_at.slice(0, 16)}</td><td><b>{m.title}</b><div className="muted">{m.max_minutes} min{m.record ? ' · recorded' : ''}</div></td><td>{m.host_name}</td><td>{m.invitees}{m.joined_now ? ` (${m.joined_now} in the room)` : ''}</td>
              <td><StatusBadge status={m.status === 'live' ? 'active' : m.status === 'canceled' ? 'danger' : 'pending'} label={m.status} /></td>
              <td className="right nowrap">{['scheduled', 'live'].includes(m.status) && <a className="btn primary sm" href={`/meet/${m.code}`} target="_blank" rel="noreferrer">{m.status === 'live' ? 'Join' : 'Open room'}</a>}{' '}<button className="btn sm" onClick={() => setOpen(m.id)}>Details</button></td></tr>)}
          </tbody></table></div>)}
      </Card>
      {settings && can('settings', 'edit') && (
        <Card title="Defaults for your company">
          <div className="row" style={{ gap: 18, flexWrap: 'wrap' }}>
            <label>Default length <input className="input" style={{ width: 90, display: 'inline-block' }} type="number" min="5" max={settings.caps.max_minutes} defaultValue={settings.defaults.default_minutes} onBlur={(e) => setDefault({ default_minutes: e.target.value }).catch((x) => alert(x.message))} /> minutes</label>
            {settings.caps.recording && <label><input type="checkbox" checked={settings.defaults.record_default} onChange={(e) => setDefault({ record_default: e.target.checked })} /> Record new meetings by default</label>}
          </div>
          <p className="muted">Tell guests when a meeting is recorded. The room shows a recording notice automatically. The platform limits above are set by the platform owner.</p>
        </Card>)}
      {show && settings && <Schedule settings={settings} onClose={() => setShow(false)} onDone={load} />}
      {open && <Detail id={open} onClose={() => setOpen(null)} onChanged={load} />}
    </>
  );
}
