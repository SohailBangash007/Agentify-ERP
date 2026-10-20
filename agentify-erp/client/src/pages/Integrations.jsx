// Settings > Integrations: everything a workspace can connect, with plain steps and links, for its own country.
import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Card, ErrorBox, Field, Loading, PageHead, StatusBadge } from '../components/ui.jsx';
import { api } from '../api.js';
import { useAuth, useToast } from '../context.jsx';

const STATE = { connected: ['active', 'Connected'], not_connected: ['inactive', 'Not connected'], configured: ['pending', 'Saved, not tested'], error: ['danger', 'Needs attention'] };
const Steps = ({ steps }) => <ol style={{ margin: '8px 0 12px 18px', padding: 0, display: 'grid', gap: 6 }}>{steps.map((s, i) => <li key={i}>{s}</li>)}</ol>;
const Links = ({ links }) => <div className="row wrap" style={{ gap: 8, marginBottom: 10 }}>{(links || []).map(([l, u]) => <a key={u} className="btn sm" href={u} target="_blank" rel="noreferrer">{l} ↗</a>)}</div>;
const OAUTH_MESSAGES = { cancelled: 'Connection cancelled.', failed: 'The provider did not accept the connection. Try again, or ask the platform administrator to check the app settings.', workspace_unavailable: 'This workspace is not active.' };

function Twilio({ item, base, reload, can }) {
  const toast = useToast();
  const [f, setF] = useState({ account_sid: '', auth_token: '', phone_number: item.info?.number || '' });
  const [busy, setBusy] = useState(false);
  const save = async () => { setBusy(true); try { await api.put('/api/integrations/twilio', f); toast('Twilio connected'); setF({ ...f, auth_token: '' }); reload(); } catch (e) { toast(e.message, 'err'); } finally { setBusy(false); } };
  const off = async () => { if (!window.confirm('Disconnect Twilio? Calling and texting stop until you connect again.')) return; await api.del('/api/integrations/twilio'); reload(); };
  return (
    <>
      <Links links={item.links} /><Steps steps={item.steps} />
      {item.status === 'connected' && <div className="alert info">Connected as <b>{item.info.name}</b> · number <b>{item.info.number}</b> · account {item.info.account}. Open the <a href="/dialer">dialer</a> to start calling.</div>}
      {can && (
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 12 }}>
          <Field label="Account SID"><input className="input" value={f.account_sid} onChange={(e) => setF({ ...f, account_sid: e.target.value })} placeholder="ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" autoComplete="off" /></Field>
          <Field label="Auth Token" hint={item.status === 'connected' ? 'Leave blank to keep the saved token' : ''}><input className="input" type="password" value={f.auth_token} onChange={(e) => setF({ ...f, auth_token: e.target.value })} autoComplete="new-password" /></Field>
          <Field label="Your Twilio phone number"><input className="input" value={f.phone_number} onChange={(e) => setF({ ...f, phone_number: e.target.value })} placeholder="+14155550100" /></Field>
        </div>)}
      {can && <div className="row" style={{ marginTop: 8 }}><button className="btn primary" disabled={busy || !f.account_sid || (!f.auth_token && item.status !== 'connected') || !f.phone_number} onClick={save}>{busy ? 'Checking with Twilio…' : 'Save and test'}</button>{item.status !== 'not_connected' && <button className="btn danger" onClick={off}>Disconnect</button>}</div>}
      {item.status === 'connected' && <details style={{ marginTop: 10 }}><summary className="muted">Web addresses for incoming calls (optional)</summary><div className="muted">In your Twilio number settings you may set the status callback to <span className="mono">{base}/api/hooks/twilio/status</span>. Outgoing calls need nothing else.</div></details>}
    </>
  );
}

function VoiceHttp({ item, reload, can }) {
  const toast = useToast();
  const [f, setF] = useState({ endpoint: '', api_key: '', from_number: item.info?.from || '', auth_header: 'Authorization', auth_prefix: 'Bearer ', field_to: 'to', field_from: 'from', field_agent: 'agent' });
  const [busy, setBusy] = useState(false);
  const save = async () => { setBusy(true); try { await api.put('/api/integrations/voice_http', f); toast('Voice provider connected'); setF({ ...f, api_key: '' }); reload(); } catch (e) { toast(e.message, 'err'); } finally { setBusy(false); } };
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  return (
    <>
      <Links links={item.links} /><Steps steps={item.steps} />
      {item.status === 'connected' && <div className="alert info">Connected to <b>{item.info.endpoint}</b>. Open the <a href="/dialer">dialer</a> to start calling.</div>}
      {can && <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 12 }}>
        <Field label="Provider call endpoint"><input className="input" value={f.endpoint} onChange={set('endpoint')} placeholder="https://api.provider.pk/v1/calls" /></Field>
        <Field label="API key"><input className="input" type="password" value={f.api_key} onChange={set('api_key')} autoComplete="new-password" /></Field>
        <Field label="Caller number from the provider"><input className="input" value={f.from_number} onChange={set('from_number')} /></Field>
        <Field label="Header name"><input className="input" value={f.auth_header} onChange={set('auth_header')} /></Field>
        <Field label="Header prefix"><input className="input" value={f.auth_prefix} onChange={set('auth_prefix')} /></Field>
        <Field label="Field names (to / from / agent)"><div className="row"><input className="input" value={f.field_to} onChange={set('field_to')} /><input className="input" value={f.field_from} onChange={set('field_from')} /><input className="input" value={f.field_agent} onChange={set('field_agent')} /></div></Field>
      </div>}
      {can && <div className="row" style={{ marginTop: 8 }}><button className="btn primary" disabled={busy || !f.endpoint || (!f.api_key && item.status !== 'connected')} onClick={save}>{busy ? 'Testing…' : 'Save and test'}</button>{item.status !== 'not_connected' && <button className="btn danger" onClick={async () => { await api.del('/api/integrations/voice_http'); reload(); }}>Disconnect</button>}</div>}
    </>
  );
}

function Calendar({ item }) {
  const toast = useToast();
  const [st, setSt] = useState(null);
  const load = useCallback(() => api.get('/api/integrations/oauth-status').then(setSt), []);
  useEffect(() => { load(); }, [load]);
  const connect = async () => { try { const r = await api.get('/api/integrations/oauth/google/start'); window.location.href = r.url; } catch (e) { toast(e.message, 'err'); } };
  const cal = st?.google_calendar;
  return (
    <>
      <Links links={item.links} /><Steps steps={item.steps} />
      {cal ? <div className="alert info">Connected to <b>{cal.email || 'your Google account'}</b>. New appointments appear in that calendar.</div> : null}
      {st && !st.providers.google && <div className="alert warn">Google is not set up on this platform yet. Ask the platform administrator to add the Google app in the console (Integrations).</div>}
      <div className="row"><button className="btn primary" disabled={!st?.providers.google} onClick={connect}>{cal ? 'Reconnect Google Calendar' : 'Connect Google Calendar'}</button>{cal && <button className="btn danger" onClick={async () => { await api.del('/api/integrations/google_calendar'); load(); }}>Disconnect</button>}<a className="btn" href="/appointments">Open appointments</a></div>
    </>
  );
}

function Domain({ can }) {
  const toast = useToast();
  const [d, setD] = useState(null);
  const [domain, setDomain] = useState('');
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => api.get('/api/integrations/domain').then(setD), []);
  useEffect(() => { load(); }, [load]);
  if (!d) return <Loading />;
  const cur = d.current;
  const add = async () => { try { await api.put('/api/integrations/domain', { domain }); setDomain(''); load(); } catch (e) { toast(e.message, 'err'); } };
  const verify = async () => { setBusy(true); try { await api.post('/api/integrations/domain/verify'); toast('Your domain is connected'); load(); } catch (e) { toast(e.message, 'err'); load(); } finally { setBusy(false); } };
  return (
    <>
      {!cur && <><Steps steps={['Type the domain you own, for example www.yourcompany.com.', 'Add the two records we show you at the company where you bought the domain (GoDaddy, Namecheap, Cloudflare and so on).', 'Press Verify. DNS changes can take a few minutes, sometimes up to an hour.', 'Once verified, your website opens on your own domain with a secure padlock.']} />
        {can && <div className="row"><input className="input" style={{ maxWidth: 360 }} value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="www.yourcompany.com" /><button className="btn primary" disabled={!domain} onClick={add}>Continue</button></div>}</>}
      {cur && (
        <>
          <p>Domain <b>{cur.domain}</b> · <StatusBadge status={cur.status === 'verified' ? 'active' : 'pending'} label={cur.status === 'verified' ? 'Connected' : 'Waiting for DNS'} /></p>
          {cur.status !== 'verified' && <>
            <p className="muted">Add these records at your domain provider, then press Verify.</p>
            <div className="table-wrap"><table className="t"><thead><tr><th>Type</th><th>Name / host</th><th>Value</th><th>Why</th></tr></thead><tbody>{cur.records.map((r) => <tr key={r.type}><td><b>{r.type}</b></td><td className="mono">{r.name}</td><td className="mono">{r.value}</td><td className="muted">{r.purpose}</td></tr>)}</tbody></table></div>
            {cur.note && <p className="muted">{cur.note}</p>}
            {cur.error && <div className="alert err">{cur.error}</div>}</>}
          {can && <div className="row" style={{ marginTop: 8 }}>{cur.status !== 'verified' && <button className="btn primary" disabled={busy} onClick={verify}>{busy ? 'Checking DNS…' : 'Verify'}</button>}<button className="btn danger" onClick={async () => { if (window.confirm('Remove this domain? Your website stays on its address here.')) { await api.del('/api/integrations/domain'); load(); } }}>Remove</button></div>}
        </>)}
    </>
  );
}

function Portals({ can }) {
  const toast = useToast();
  const [d, setD] = useState(null);
  const [api_, setApi] = useState({});
  const load = useCallback(() => api.get('/api/integrations/portals').then(setD), []);
  useEffect(() => { load(); }, [load]);
  if (!d) return <Loading />;
  return (
    <>
      <p className="muted">Each portal gets its own listing feed address. Give it to the portal (or download the file and upload it there). Publish listings to portals from a property's page: only published listings with all the fields a portal requires are included.</p>
      {d.portals.map((p) => (
        <div key={p.id} className="card" style={{ padding: 12, marginBottom: 10 }}>
          <div className="row" style={{ justifyContent: 'space-between' }}><b>{p.name}</b><span className="muted">{p.mode} · {p.published} listing{p.published === 1 ? '' : 's'} published</span></div>
          <div className="muted" style={{ margin: '6px 0' }}>{p.note} <a href={p.apply} target="_blank" rel="noreferrer">Apply or learn more ↗</a></div>
          <div className="row wrap" style={{ gap: 6 }}><a className="btn sm" href={p.feed.xml} target="_blank" rel="noreferrer">XML feed</a><a className="btn sm" href={p.feed.csv} target="_blank" rel="noreferrer">CSV file</a><button className="btn sm" onClick={() => { navigator.clipboard?.writeText(p.feed.xml); toast('Feed address copied'); }}>Copy feed address</button></div>
          {p.api && can && <div className="row wrap" style={{ gap: 6, marginTop: 8 }}>
            <input className="input" style={{ maxWidth: 320 }} placeholder="Your board's API endpoint (https://…)" value={api_[p.id]?.endpoint || ''} onChange={(e) => setApi({ ...api_, [p.id]: { ...api_[p.id], endpoint: e.target.value } })} />
            <input className="input" style={{ maxWidth: 220 }} type="password" placeholder="Token" value={api_[p.id]?.token || ''} onChange={(e) => setApi({ ...api_, [p.id]: { ...api_[p.id], token: e.target.value } })} />
            <button className="btn sm primary" onClick={async () => { try { await api.put(`/api/integrations/portals/${p.id}/api`, api_[p.id]); toast('Saved'); load(); } catch (e) { toast(e.message, 'err'); } }}>{p.api_connected ? 'Update API' : 'Save API'}</button></div>}
        </div>))}
      {can && <button className="btn sm" onClick={async () => { if (window.confirm('This changes every feed address. Portals using the old one will stop receiving updates until you give them the new one.')) { await api.post('/api/integrations/portals/rotate-token'); load(); } }}>Change feed addresses</button>}
    </>
  );
}

const PROVIDER_LABEL = { facebook: 'Facebook Page', instagram: 'Instagram', linkedin: 'LinkedIn', tiktok: 'TikTok' };
function Social({ can }) {
  const toast = useToast();
  const [accounts, setAccounts] = useState(null);
  const [rep, setRep] = useState(null);
  const [st, setSt] = useState(null);
  const [f, setF] = useState({ account_id: '', message: '', media_url: '', link: '', scheduled_at: '' });
  const load = useCallback(() => { api.get('/api/integrations/social/accounts').then(setAccounts); api.get('/api/integrations/social/report').then(setRep); api.get('/api/integrations/oauth-status').then(setSt); }, []);
  useEffect(() => { load(); }, [load]);
  const connect = async (p) => { try { const r = await api.get(`/api/integrations/oauth/${p}/start`); window.location.href = r.url; } catch (e) { toast(e.message, 'err'); } };
  const post = async () => { try { const r = await api.post('/api/integrations/social/posts', f); toast(r.status === 'published' ? 'Posted' : r.status === 'failed' ? `Not posted: ${r.error}` : 'Scheduled', r.status === 'failed' ? 'err' : 'ok'); setF({ ...f, message: '', media_url: '', link: '', scheduled_at: '' }); load(); } catch (e) { toast(e.message, 'err'); } };
  if (!accounts) return <Loading />;
  return (
    <>
      <p className="muted">Connect your accounts, then write a post and publish it now or schedule it. Facebook, Instagram, LinkedIn and TikTok each review apps before they allow posting for other people, so connecting only works once the platform's app is approved by them.</p>
      <div className="row wrap" style={{ gap: 8, marginBottom: 10 }}>
        {[['meta', 'Facebook and Instagram'], ['linkedin', 'LinkedIn'], ['tiktok', 'TikTok']].map(([p, l]) => <button key={p} className="btn" disabled={!can || (st && !st.providers[p])} title={st && !st.providers[p] ? 'Not set up on this platform yet' : ''} onClick={() => connect(p)}>Connect {l}</button>)}
      </div>
      {accounts.length > 0 && <div className="row wrap" style={{ gap: 8, marginBottom: 12 }}>{accounts.map((a) => <span key={a.id} className="pill grey">{PROVIDER_LABEL[a.provider]}: {a.name} {can && <button className="btn sm" style={{ marginLeft: 6 }} onClick={async () => { if (window.confirm(`Disconnect ${a.name}?`)) { await api.del(`/api/integrations/social/accounts/${a.id}`); load(); } }}>×</button>}</span>)}</div>}
      {accounts.length > 0 && (
        <div className="card" style={{ padding: 12, marginBottom: 12 }}>
          <b>New post</b>
          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 10, marginTop: 8 }}>
            <Field label="Post to"><select className="input" value={f.account_id} onChange={(e) => setF({ ...f, account_id: e.target.value })}><option value="">Choose…</option>{accounts.map((a) => <option key={a.id} value={a.id}>{PROVIDER_LABEL[a.provider]}: {a.name}</option>)}</select></Field>
            <Field label="Publish at (blank = now)"><input className="input" type="datetime-local" value={f.scheduled_at} onChange={(e) => setF({ ...f, scheduled_at: e.target.value })} /></Field>
            <Field label="Picture or video address (https)"><input className="input" value={f.media_url} onChange={(e) => setF({ ...f, media_url: e.target.value })} /></Field>
            <Field label="Link"><input className="input" value={f.link} onChange={(e) => setF({ ...f, link: e.target.value })} /></Field>
          </div>
          <Field label="Text"><textarea className="input" rows={3} value={f.message} onChange={(e) => setF({ ...f, message: e.target.value })} /></Field>
          <button className="btn primary" disabled={!f.account_id || !f.message.trim()} onClick={post}>{f.scheduled_at ? 'Schedule' : 'Post now'}</button>
        </div>)}
      {rep && rep.posts.length > 0 && (
        <>
          <div className="row wrap" style={{ gap: 18, margin: '8px 0' }}>{[['Published', rep.totals.published], ['Scheduled', rep.totals.scheduled], ['Failed', rep.totals.failed], ['Likes', rep.totals.likes], ['Comments', rep.totals.comments], ['Reach', rep.totals.reach]].map(([l, v]) => <div key={l}><div className="muted">{l}</div><b style={{ fontSize: 20 }}>{v}</b></div>)}<button className="btn sm" onClick={() => api.get('/api/integrations/social/report?refresh=1').then(setRep)}>Refresh numbers</button></div>
          <div className="table-wrap"><table className="t"><thead><tr><th>Post</th><th>Account</th><th>Status</th><th>When</th><th className="num">Likes</th><th className="num">Reach</th><th /></tr></thead><tbody>
            {rep.posts.map((p) => <tr key={p.id}><td style={{ maxWidth: 320 }}>{p.message.slice(0, 90)}</td><td>{PROVIDER_LABEL[p.provider]}</td><td><StatusBadge status={p.status === 'published' ? 'active' : p.status === 'failed' ? 'danger' : 'pending'} label={p.status} />{p.error && <div className="muted">{p.error}</div>}</td><td className="muted nowrap">{p.published_at || p.scheduled_at || ''}</td><td className="num">{p.likes ?? '—'}</td><td className="num">{p.reach ?? '—'}</td>
              <td>{p.status === 'scheduled' && <button className="btn sm" onClick={async () => { await api.post(`/api/integrations/social/posts/${p.id}/cancel`); load(); }}>Cancel</button>}{p.status === 'failed' && <button className="btn sm" onClick={async () => { await api.post(`/api/integrations/social/posts/${p.id}/retry`); load(); }}>Retry</button>}</td></tr>)}</tbody></table></div>
        </>)}
    </>
  );
}

export default function Integrations() {
  const toast = useToast();
  const { can } = useAuth();
  const [sp, setSp] = useSearchParams();
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  const [open, setOpen] = useState('');
  const load = useCallback(() => api.get('/api/integrations').then(setD).catch((e) => setErr(e.message)), []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const ok = sp.get('connected'), bad = sp.get('oauth_error');
    if (ok) { toast('Connected'); setOpen(ok === 'google_calendar' ? 'google_calendar' : 'social'); }
    if (bad) toast(OAUTH_MESSAGES[bad] || 'The connection did not complete.', 'err');
    if (ok || bad) { sp.delete('connected'); sp.delete('oauth_error'); setSp(sp, { replace: true }); }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const admin = can('settings', 'edit');
  const body = (i) => i.id === 'twilio' ? <Twilio item={i} base={d.base} reload={load} can={admin} /> : i.id === 'voice_http' ? <VoiceHttp item={i} reload={load} can={admin} /> : i.id === 'google_calendar' ? <Calendar item={i} /> : i.id === 'domain' ? <Domain can={admin} /> : i.id === 'portals' ? <Portals can={admin} /> : i.id === 'social' ? <Social can={admin} /> : null;
  return (
    <>
      <PageHead title="Integrations" sub="Connect your calls, calendar, listing portals, social accounts and your own web address. Each one shows Connected only after a real test." />
      <ErrorBox error={err} />
      {!d ? (!err && <Loading />) : d.items.map((i) => {
        const [tone, label] = STATE[i.status] || STATE.not_connected;
        const isOpen = open === i.id;
        const showStatus = ['twilio', 'voice_http', 'google_calendar'].includes(i.id);
        return (
          <Card key={i.id} title={i.name} actions={<div className="row" style={{ gap: 8 }}>{showStatus && <StatusBadge status={tone} label={label} />}<button className="btn sm" onClick={() => setOpen(isOpen ? '' : i.id)}>{isOpen ? 'Close' : i.status === 'connected' ? 'Manage' : 'Set up'}</button></div>}>
            <div className="muted">{i.group} · {i.purpose}</div>
            {i.error && <div className="alert err" style={{ marginTop: 8 }}>{i.error}</div>}
            {isOpen && <div style={{ marginTop: 10 }}>{body(i)}</div>}
          </Card>);
      })}
    </>
  );
}
