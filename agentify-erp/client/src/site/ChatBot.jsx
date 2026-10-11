import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { useSite, waLink } from './siteCore.jsx';

const INTERESTS = ['Buy a plot', 'Buy a house', 'Rent a property', 'Commercial property', 'Agricultural land', 'Build a house', 'Invest'];
const sessionId = () => {
  try { let s = sessionStorage.getItem('site-bot'); if (!s) { s = `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`; sessionStorage.setItem('site-bot', s); } return s; } catch { return 'anon'; }
};
const Go = ({ href, children, ...p }) => (/^\/(?!\/)/.test(href) ? <Link to={href} {...p}>{children}</Link> : <a href={href} target="_blank" rel="noreferrer" {...p}>{children}</a>);

function LeadForm({ session, onDone, onCancel }) {
  const [f, setF] = useState({ name: '', phone: '', interest: '', budget: '', project: '', message: '', website: '' });
  const [st, setSt] = useState({ busy: false, err: '' });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const submit = async (e) => {
    e.preventDefault(); setSt({ busy: true, err: '' });
    try { const r = await api.post('/api/site/bot/lead', { ...f, session }); onDone(r.reference); } catch (x) { setSt({ busy: false, err: x.message }); }
  };
  return (
    <form className="cb-lead" onSubmit={submit}>
      <b>Tell us what you are looking for</b>
      <input placeholder="Your name *" value={f.name} onChange={set('name')} required autoComplete="name" />
      <input placeholder="Mobile number *" value={f.phone} onChange={set('phone')} required inputMode="tel" autoComplete="tel" />
      <select value={f.interest} onChange={set('interest')} aria-label="Interested in"><option value="">I am interested in…</option>{INTERESTS.map((i) => <option key={i}>{i}</option>)}</select>
      <div className="cb-two"><input placeholder="Budget (e.g. 50 lakh)" value={f.budget} onChange={set('budget')} /><input placeholder="Project / area" value={f.project} onChange={set('project')} /></div>
      <textarea rows="2" placeholder="Anything else? (optional)" value={f.message} onChange={set('message')} />
      <input className="hp" tabIndex="-1" autoComplete="off" aria-hidden="true" value={f.website} onChange={set('website')} />
      {st.err && <div className="cb-err">{st.err}</div>}
      <div className="cb-row"><button type="submit" className="cb-send" disabled={st.busy}>{st.busy ? 'Sending…' : 'Request a call back'}</button><button type="button" className="cb-link" onClick={onCancel}>Not now</button></div>
    </form>
  );
}

export default function ChatBot() {
  const { config, preview } = useSite();
  const bot = config.bot || {};
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [lead, setLead] = useState(false);
  const [done, setDone] = useState('');
  const [asked, setAsked] = useState(0);
  const end = useRef(null);
  const session = useRef(sessionId());
  useEffect(() => { if (open && !msgs.length) setMsgs([{ from: 'bot', text: bot.greeting, chips: (bot.quick_replies || []).filter(Boolean) }]); }, [open]); // eslint-disable-line
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [msgs, lead, busy, open]);
  if (!bot.enabled || preview) return null;
  const wa = config.contact?.whatsapp;

  const send = async (q) => {
    const message = (q ?? text).trim();
    if (!message || busy) return;
    setText(''); setLead(false);
    setMsgs((m) => [...m, { from: 'me', text: message }]);
    setBusy(true);
    try {
      const r = await api.post('/api/site/bot/message', { message, session: session.current });
      setMsgs((m) => [...m, { from: 'bot', text: r.answer, cards: r.cards, links: r.links, chips: r.suggestions }]);
      const n = asked + 1; setAsked(n);
      if (!done && (r.action === 'lead' || n === Number(bot.lead_after || 2))) setLead(true);
    } catch (e) { setMsgs((m) => [...m, { from: 'bot', text: e.message || 'Sorry, something went wrong. Please try again.' }]); }
    setBusy(false);
  };

  return (
    <>
      {!open && <button className="cb-fab" onClick={() => setOpen(true)} aria-label={`Chat with ${bot.name}`}><span aria-hidden="true">🤖</span><b>Ask {bot.name || 'us'}</b></button>}
      {open && (
        <section className="cb-panel" role="dialog" aria-label={bot.name}>
          <header><span className="cb-av" aria-hidden="true">🤖</span><div><b>{bot.name}</b><small>Typically replies instantly</small></div><button onClick={() => setOpen(false)} aria-label="Close chat">×</button></header>
          <div className="cb-body">
            {msgs.map((m, i) => (
              <div key={i} className={`cb-msg ${m.from}`}>
                <div className="cb-bubble">{m.text}</div>
                {m.cards?.length > 0 && <div className="cb-cards">{m.cards.map((c, k) => <Go key={k} href={c.href} className="cb-card" onClick={() => setOpen(false)}>{c.image && <img src={c.image} alt="" loading="lazy" />}<span><b>{c.title}</b><small>{c.subtitle}</small></span></Go>)}</div>}
                {m.links?.length > 0 && <div className="cb-links">{m.links.map((l, k) => <Go key={k} href={l.href} onClick={() => setOpen(false)}>{l.label} →</Go>)}</div>}
                {m.chips?.length > 0 && i === msgs.length - 1 && <div className="cb-chips">{m.chips.map((c) => <button key={c} onClick={() => (c === 'Talk to an agent' ? setLead(true) : send(c))}>{c}</button>)}</div>}
              </div>
            ))}
            {busy && <div className="cb-msg bot"><div className="cb-bubble typing"><i /><i /><i /></div></div>}
            {lead && !done && <LeadForm session={session.current} onDone={(ref) => { setLead(false); setDone(ref); setMsgs((m) => [...m, { from: 'bot', text: `Thank you! Your request (${ref}) has reached our sales team — an agent will contact you shortly. You can keep asking me questions meanwhile.` }]); }} onCancel={() => setLead(false)} />}
            <div ref={end} />
          </div>
          <footer>
            <form onSubmit={(e) => { e.preventDefault(); send(); }}>
              <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Ask about projects, prices, construction…" maxLength={400} aria-label="Your message" />
              <button type="submit" disabled={busy || !text.trim()} aria-label="Send">➤</button>
            </form>
            <div className="cb-foot">{!done && !lead && <button className="cb-link" onClick={() => setLead(true)}>Leave my details</button>}{wa && <a href={waLink(wa, 'Hello, I would like to know more about your properties.')} target="_blank" rel="noreferrer">Continue on WhatsApp</a>}</div>
          </footer>
        </section>
      )}
    </>
  );
}
