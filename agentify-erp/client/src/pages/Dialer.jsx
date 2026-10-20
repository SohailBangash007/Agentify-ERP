// The CRM dialer: "Call next" shows who most needs a call right now and why. One press rings the agent's own phone first and
// then connects the lead; afterwards the agent records how it went, which schedules the next follow-up.
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, Empty, ErrorBox, Field, Loading, PageHead, StatusBadge } from '../components/ui.jsx';
import { api } from '../api.js';
import { useAuth, useToast } from '../context.jsx';
import { dateTime } from '../format.js';

const OUTCOMES = [['connected', 'Spoke with them'], ['interested', 'Interested'], ['callback', 'Asked for a call back'], ['no_answer', 'No answer'], ['voicemail', 'Left a voicemail'], ['not_interested', 'Not interested'], ['wrong_number', 'Wrong number'], ['do_not_call', 'Asked not to be called']];
const KEY = 'erp_agent_phone';

export default function Dialer() {
  const toast = useToast();
  const { user } = useAuth();
  const [q, setQ] = useState(null);
  const [log, setLog] = useState([]);
  const [err, setErr] = useState('');
  const [agent, setAgent] = useState(() => { try { return localStorage.getItem(KEY) || user?.phone || ''; } catch { return user?.phone || ''; } });
  const [active, setActive] = useState(null); // the call just started
  const [outcome, setOutcome] = useState({ outcome: 'connected', notes: '', followup_date: '' });
  const [sms, setSms] = useState(null);
  const [busy, setBusy] = useState(0);
  const load = useCallback(() => { api.get('/api/integrations/dialer/queue').then(setQ).catch((e) => setErr(e.message)); api.get('/api/integrations/calls').then(setLog).catch(() => {}); }, []);
  useEffect(() => { load(); }, [load]);
  const call = async (c) => {
    setBusy(c.id);
    try { if (agent) { try { localStorage.setItem(KEY, agent); } catch { /* ignore */ } } const r = await api.post('/api/integrations/calls', { contact_id: c.id, agent_number: agent || undefined }); setActive({ id: r.id, name: c.name, message: r.message }); setOutcome({ outcome: 'connected', notes: '', followup_date: '' }); load(); } catch (e) { toast(e.message, 'err'); } finally { setBusy(0); }
  };
  const saveOutcome = async () => { try { const r = await api.post(`/api/integrations/calls/${active.id}/outcome`, outcome); toast(r.followup_date ? `Saved. Next follow-up ${r.followup_date}` : 'Saved'); setActive(null); load(); } catch (e) { toast(e.message, 'err'); } };
  const sendSms = async () => { try { await api.post('/api/integrations/sms', { contact_id: sms.id, body: sms.body }); toast('Message sent'); setSms(null); } catch (e) { toast(e.message, 'err'); } };
  return (
    <>
      <PageHead title="Dialer" sub="Call next: the people who most need a call now, ranked, with the reason. Calls ring your own phone first, then connect the lead." />
      <ErrorBox error={err} />
      {q && !q.voice && <div className="alert warn">Calling is not connected yet. <Link to="/settings/integrations">Connect Twilio (or your voice provider)</Link> to start. It takes a few minutes.</div>}
      {active && (
        <Card title={`Call with ${active.name}`}>
          <div className="alert info">{active.message}</div>
          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 12 }}>
            <Field label="How did it go?"><select className="input" value={outcome.outcome} onChange={(e) => setOutcome({ ...outcome, outcome: e.target.value })}>{OUTCOMES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
            <Field label="Next follow-up (optional)"><input className="input" type="date" value={outcome.followup_date} onChange={(e) => setOutcome({ ...outcome, followup_date: e.target.value })} /></Field>
          </div>
          <Field label="Notes"><textarea className="input" rows={2} value={outcome.notes} onChange={(e) => setOutcome({ ...outcome, notes: e.target.value })} /></Field>
          <div className="row"><button className="btn primary" onClick={saveOutcome}>Save outcome</button><button className="btn" onClick={() => setActive(null)}>Later</button></div>
        </Card>)}
      <Card title="Call next" actions={<div className="row"><label className="muted">Ring me on <input className="input" style={{ width: 170, display: 'inline-block' }} value={agent} onChange={(e) => setAgent(e.target.value)} placeholder="Your mobile number" /></label><button className="btn sm" onClick={load}>Refresh</button></div>} flush>
        {!q ? <Loading /> : !q.queue.length ? <Empty title="Nobody needs a call right now" hint="New leads and follow-ups due will appear here." /> : (
          <div className="table-wrap"><table className="t"><thead><tr><th>Lead</th><th>Why now</th><th>Phone</th><th /></tr></thead><tbody>
            {q.queue.map((c) => <tr key={c.id}><td><Link to={`/contacts/${c.id}`}><b>{c.name}</b></Link></td><td>{c.reason}</td><td className="mono">{c.phone}</td>
              <td className="right nowrap"><button className="btn primary sm" disabled={!q.voice || busy === c.id} onClick={() => call(c)}>{busy === c.id ? 'Starting…' : 'Call'}</button>{' '}<button className="btn sm" onClick={() => setSms({ id: c.id, name: c.name, body: '' })}>Text</button></td></tr>)}
          </tbody></table></div>)}
      </Card>
      {sms && (
        <Card title={`Text ${sms.name}`}>
          <textarea className="input" rows={3} maxLength={600} value={sms.body} onChange={(e) => setSms({ ...sms, body: e.target.value })} placeholder="Write a short message. Only text people who agreed to be contacted." />
          <div className="row" style={{ marginTop: 8 }}><button className="btn primary" disabled={!sms.body.trim()} onClick={sendSms}>Send</button><button className="btn" onClick={() => setSms(null)}>Cancel</button></div>
        </Card>)}
      <Card title="Recent calls" flush>
        {!log.length ? <Empty title="No calls yet" /> : (
          <div className="table-wrap"><table className="t"><thead><tr><th>When</th><th>Who</th><th>Status</th><th>Length</th><th>Outcome</th><th /></tr></thead><tbody>
            {log.map((k) => <tr key={k.id}><td className="muted nowrap">{dateTime(k.started_at)}</td><td>{k.full_name || k.to_number}</td><td><StatusBadge status={k.status === 'completed' ? 'active' : k.status === 'failed' ? 'danger' : 'pending'} label={k.status.replace('_', ' ')} /></td><td>{k.duration != null ? `${k.duration}s` : '—'}</td><td>{k.outcome ? k.outcome.replace(/_/g, ' ') : <button className="btn sm" onClick={() => { setActive({ id: k.id, name: k.full_name || k.to_number, message: '' }); setOutcome({ outcome: 'connected', notes: '', followup_date: '' }); }}>Record</button>}</td><td className="muted">{k.notes}</td></tr>)}
          </tbody></table></div>)}
      </Card>
    </>
  );
}
