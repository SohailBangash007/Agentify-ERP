// AI Studio: ask Claude or ChatGPT about your own numbers, and make short promotional videos from a listing's photos.
// The AI writes the script and captions; the video itself is drawn here in the browser from the listing's own pictures.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, Empty, ErrorBox, Field, Loading, PageHead, Tabs } from '../components/ui.jsx';
import { api } from '../api.js';
import { useAuth, useToast } from '../context.jsx';
import { dateTime } from '../format.js';

/** Connect a provider key (used in Integrations and here). Keys are stored encrypted and never shown again. */
export function AiConnect({ can }) {
  const toast = useToast();
  const [d, setD] = useState(null);
  const [keys, setKeys] = useState({});
  const [busy, setBusy] = useState('');
  const load = useCallback(() => api.get('/api/integrations/ai').then(setD), []);
  useEffect(() => { load(); }, [load]);
  if (!d) return <Loading />;
  const save = async (p) => { setBusy(p); try { await api.put(`/api/integrations/ai/${p}`, { api_key: keys[p] }); toast('Connected'); setKeys({ ...keys, [p]: '' }); load(); } catch (e) { toast(e.message, 'err'); } finally { setBusy(''); } };
  const settings = async (patch) => { await api.put('/api/integrations/ai-settings', patch); load(); };
  return (
    <>
      <p className="muted">Bring your own key. You pay the provider directly for what you use. The key is saved encrypted and is never shown again. The AI can only read summaries of your own data, never change anything.</p>
      {d.providers.map((p) => (
        <div key={p.id} className="card" style={{ padding: 12, marginBottom: 10 }}>
          <div className="row" style={{ justifyContent: 'space-between' }}><b>{p.label}</b><span className="muted">{p.status ? `Connected · ${p.status.key} · ${p.status.model}` : 'Not connected'}</span></div>
          <div className="muted" style={{ margin: '4px 0 8px' }}>Create a key at <a href={p.key_url} target="_blank" rel="noreferrer">{p.key_url.replace('https://', '')} ↗</a>. {p.key_hint}.</div>
          {can && <div className="row wrap" style={{ gap: 8 }}>
            <input className="input" style={{ maxWidth: 360 }} type="password" autoComplete="new-password" placeholder={p.status ? 'Paste a new key to replace' : 'Paste your API key'} value={keys[p.id] || ''} onChange={(e) => setKeys({ ...keys, [p.id]: e.target.value })} />
            <button className="btn primary" disabled={!keys[p.id] || busy === p.id} onClick={() => save(p.id)}>{busy === p.id ? 'Checking with the provider…' : 'Save and test'}</button>
            {p.status && <button className="btn danger" onClick={async () => { if (window.confirm(`Disconnect ${p.label}?`)) { await api.del(`/api/integrations/ai/${p.id}`); load(); } }}>Disconnect</button>}</div>}
        </div>))}
      {can && (
        <div className="row wrap" style={{ gap: 18 }}>
          <label>Use first: <select className="input" style={{ display: 'inline-block', width: 'auto' }} value={d.default || ''} onChange={(e) => settings({ default: e.target.value })}><option value="">Whichever is connected</option>{d.providers.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</select></label>
          <label><input type="checkbox" checked={d.share_names} onChange={(e) => settings({ share_names: e.target.checked })} /> Let the AI see customer names (off by default)</label>
        </div>)}
      <p className="muted" style={{ marginTop: 10 }}>Speech-to-text for recordings uses an OpenAI or Gemini key. Claude, ChatGPT and Gemini write scripts and answer questions; none of them makes video, so videos are built from your listing photos.</p>
    </>
  );
}

const SUGGESTIONS = ['How did sales do this month compared with last month?', 'Which lead stages are stuck the longest?', 'How many calls did we make this week and how many connected?', 'Which listings have been on the market longest?'];

function Ask() {
  const toast = useToast();
  const [d, setD] = useState(null);
  const [msgs, setMsgs] = useState([]);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const end = useRef(null);
  useEffect(() => { api.get('/api/integrations/ai').then(setD); }, []);
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [msgs, busy]);
  if (!d) return <Loading />;
  if (!d.active) return <div className="alert warn">Connect Claude, ChatGPT or Gemini on the <b>Connect</b> tab to ask questions about your data.</div>;
  const ask = async (text) => {
    const question = (text ?? q).trim(); if (!question || busy) return;
    const history = msgs.map((m) => ({ role: m.role, content: m.text }));
    setMsgs([...msgs, { role: 'user', text: question }]); setQ(''); setBusy(true);
    try { const r = await api.post('/api/integrations/ai/ask', { question, history }); setMsgs((m) => [...m, { role: 'assistant', text: r.answer, tools: r.tools_used }]); } catch (e) { toast(e.message, 'err'); } finally { setBusy(false); }
  };
  return (
    <Card title={`Ask ${{ anthropic: 'Claude', openai: 'ChatGPT', gemini: 'Gemini' }[d.active]} about your business`}>
      <div style={{ minHeight: 220, maxHeight: 460, overflow: 'auto', display: 'grid', gap: 10, alignContent: 'start' }}>
        {!msgs.length && <div className="row wrap" style={{ gap: 8 }}>{SUGGESTIONS.map((s) => <button key={s} className="btn sm" onClick={() => ask(s)}>{s}</button>)}</div>}
        {msgs.map((m, i) => <div key={i} style={{ justifySelf: m.role === 'user' ? 'end' : 'start', maxWidth: '85%', background: m.role === 'user' ? 'var(--primary, #0f766e)' : 'var(--surface-2, #f1f5f9)', color: m.role === 'user' ? '#fff' : 'inherit', padding: '8px 12px', borderRadius: 12, whiteSpace: 'pre-wrap' }}>{m.text}{m.tools?.length > 0 && <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>Looked at: {[...new Set(m.tools.map((t) => t.name || t))].join(', ').replace(/_/g, ' ')}</div>}</div>)}
        {busy && <div className="muted">Thinking…</div>}
        <div ref={end} />
      </div>
      <form className="row" style={{ marginTop: 10 }} onSubmit={(e) => { e.preventDefault(); ask(); }}>
        <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask about sales, leads, calls or listings" maxLength={600} />
        <button className="btn primary" disabled={!q.trim() || busy}>Ask</button>
      </form>
    </Card>);
}

// ---- promotional video: scenes drawn on a canvas and recorded in the browser
const loadImg = (src) => new Promise((res, rej) => { const i = new Image(); i.crossOrigin = 'anonymous'; i.onload = () => res(i); i.onerror = () => rej(new Error('A photo could not be loaded.')); i.src = src; });
async function renderVideo({ plan, photos, vertical, onProgress }) {
  const W = vertical ? 720 : 1280, H = vertical ? 1280 : 720;
  const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  const imgs = await Promise.all(photos.map(loadImg));
  const stream = canvas.captureStream(30);
  const mime = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find((t) => MediaRecorder.isTypeSupported(t));
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 3_000_000 });
  const chunks = []; rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const scenes = [...plan.scenes.map((s) => ({ ...s, img: imgs[Math.min(s.photo, imgs.length - 1)] })), { caption: plan.call_to_action || '', seconds: 3, end: true, img: imgs[0] }];
  const total = scenes.reduce((a, s) => a + s.seconds, 0);
  const wrap = (text, maxW, font) => { ctx.font = font; const words = text.split(/\s+/); const lines = []; let cur = ''; for (const w of words) { const t = cur ? `${cur} ${w}` : w; if (ctx.measureText(t).width > maxW && cur) { lines.push(cur); cur = w; } else cur = t; } if (cur) lines.push(cur); return lines; };
  const draw = (s, p) => {
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
    if (s.img) { const zoom = 1 + 0.08 * p, r = Math.max(W / s.img.width, H / s.img.height) * zoom, w = s.img.width * r, h = s.img.height * r; ctx.drawImage(s.img, (W - w) / 2, (H - h) / 2, w, h); }
    const g = ctx.createLinearGradient(0, H * 0.55, 0, H); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.78)'); ctx.fillStyle = g; ctx.fillRect(0, H * 0.55, W, H * 0.45);
    if (s.end) { ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.fillRect(0, 0, W, H); }
    const size = vertical ? 44 : 48, font = `700 ${size}px system-ui, sans-serif`;
    const lines = wrap(s.caption, W - 100, font); ctx.font = font; ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.globalAlpha = Math.min(1, p * 5);
    const y0 = s.end ? H / 2 - (lines.length * size * 1.25) / 2 : H - 60 - lines.length * size * 1.25;
    lines.forEach((ln, i) => ctx.fillText(ln, W / 2, y0 + (i + 1) * size * 1.25)); ctx.globalAlpha = 1;
  };
  rec.start(500);
  let elapsed = 0;
  for (const s of scenes) {
    const t0 = performance.now();
    await new Promise((resolve) => { const tick = () => { const p = Math.min(1, (performance.now() - t0) / (s.seconds * 1000)); draw(s, p); onProgress?.((elapsed + p * s.seconds) / total); if (p < 1) requestAnimationFrame(tick); else resolve(); }; tick(); });
    elapsed += s.seconds;
  }
  await new Promise((r) => { rec.onstop = r; rec.stop(); });
  return { blob: new Blob(chunks, { type: mime || 'video/webm' }), seconds: total };
}

function Promo() {
  const toast = useToast();
  const { can } = useAuth();
  const [props, setProps] = useState([]);
  const [pid, setPid] = useState('');
  const [style, setStyle] = useState('friendly');
  const [language, setLanguage] = useState('en');
  const [vertical, setVertical] = useState(false);
  const [plan, setPlan] = useState(null);
  const [photos, setPhotos] = useState([]);
  const [busy, setBusy] = useState('');
  const [prog, setProg] = useState(0);
  const [videos, setVideos] = useState(null);
  const [ai, setAi] = useState(null);
  const [err, setErr] = useState('');
  const loadVideos = useCallback(() => api.get('/api/integrations/ai/promo-videos').then(setVideos).catch(() => setVideos([])), []);
  useEffect(() => { api.get('/api/properties?limit=200').then((r) => setProps(r.rows || [])); loadVideos(); api.get('/api/integrations/ai').then(setAi); }, [loadVideos]);
  const write = async () => {
    setBusy('script'); setErr(''); setPlan(null);
    try {
      const [p, d] = await Promise.all([api.post('/api/integrations/ai/promo-script', { property_id: Number(pid), style, language }), api.get(`/api/properties/${pid}`)]);
      const list = (d.property.media || []).filter((m) => ['cover', 'gallery'].includes(m.kind) && !/\.pdf$/i.test(m.path));
      setPhotos(list.map((m) => `/uploads/${m.path}`)); setPlan(p);
      if (!list.length) setErr('This property has no photos yet. Add pictures on the property page, then write the script again.');
    } catch (e) { setErr(e.message); } finally { setBusy(''); }
  };
  const make = async () => {
    setBusy('video'); setProg(0); setErr('');
    try {
      const { blob, seconds } = await renderVideo({ plan, photos, vertical, onProgress: setProg });
      const r = await fetch(`/api/integrations/ai/promo-videos?property_id=${pid}&title=${encodeURIComponent(plan.title)}&duration=${seconds}&script=${encodeURIComponent(plan.voiceover)}`, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': blob.type.split(';')[0], 'X-Requested-With': 'ERP' }, body: blob });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'The video could not be saved.');
      toast('Video saved'); loadVideos();
    } catch (e) { setErr(e.message); } finally { setBusy(''); }
  };
  const upd = (i, k, v) => setPlan({ ...plan, scenes: plan.scenes.map((s, j) => (j === i ? { ...s, [k]: v } : s)) });
  if (ai && !ai.active) return <div className="alert warn">Connect Claude, ChatGPT or Gemini on the <b>Connect</b> tab first. They write the script and captions for your video.</div>;
  return (
    <>
      <Card title="Make a promotional video">
        <ErrorBox error={err} />
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 12 }}>
          <Field label="Property"><select className="input" value={pid} onChange={(e) => { setPid(e.target.value); setPlan(null); }}><option value="">Choose a property…</option>{props.map((p) => <option key={p.id} value={p.id}>{p.title || p.code}</option>)}</select></Field>
          <Field label="Tone"><select className="input" value={style} onChange={(e) => setStyle(e.target.value)}>{[['friendly', 'Friendly'], ['luxury', 'Luxury'], ['family', 'Family'], ['urgent', 'Act now']].map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
          <Field label="Language"><select className="input" value={language} onChange={(e) => setLanguage(e.target.value)}>{[['en', 'English'], ['ur', 'Urdu'], ['ar', 'Arabic'], ['fr', 'French']].map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
          <Field label="Shape"><select className="input" value={vertical ? 'v' : 'h'} onChange={(e) => setVertical(e.target.value === 'v')}><option value="h">Wide (YouTube, website)</option><option value="v">Tall (Reels, TikTok, Stories)</option></select></Field>
        </div>
        <button className="btn primary" disabled={!pid || !!busy || !can('content', 'edit')} onClick={write}>{busy === 'script' ? 'Writing the script…' : plan ? 'Write it again' : 'Write the script'}</button>
        {!can('content', 'edit') && <span className="muted"> You need permission to edit content.</span>}
      </Card>
      {plan && (
        <Card title={plan.title}>
          <p className="muted">Check and edit the captions. Only facts from the listing are used. Review it before you post.</p>
          <div className="table-wrap"><table className="t"><thead><tr><th>#</th><th>Caption</th><th>Seconds</th><th>Photo</th></tr></thead><tbody>
            {plan.scenes.map((s, i) => <tr key={i}><td>{i + 1}</td><td><input className="input" value={s.caption} maxLength={90} onChange={(e) => upd(i, 'caption', e.target.value)} /></td><td><input className="input" type="number" min="2" max="6" style={{ width: 70 }} value={s.seconds} onChange={(e) => upd(i, 'seconds', Math.min(6, Math.max(2, Number(e.target.value) || 3)))} /></td>
              <td>{photos[s.photo] && <img src={photos[s.photo]} alt="" style={{ width: 64, height: 40, objectFit: 'cover', borderRadius: 4 }} />}</td></tr>)}
          </tbody></table></div>
          <Field label="Call to action (last screen)"><input className="input" value={plan.call_to_action} onChange={(e) => setPlan({ ...plan, call_to_action: e.target.value })} /></Field>
          <Field label="Voice-over text for you or a presenter to read"><textarea className="input" rows={3} value={plan.voiceover} onChange={(e) => setPlan({ ...plan, voiceover: e.target.value })} /></Field>
          {plan.hashtags?.length > 0 && <p className="muted">{plan.hashtags.map((h) => (h.startsWith('#') ? h : `#${h}`)).join(' ')}</p>}
          <div className="row"><button className="btn primary" disabled={!!busy || !photos.length} onClick={make}>{busy === 'video' ? `Making the video… ${Math.round(prog * 100)}%` : 'Make the video'}</button>{busy === 'video' && <span className="muted">Keep this tab open until it finishes.</span>}</div>
        </Card>)}
      <Card title="Your videos" flush>
        {!videos ? <Loading /> : !videos.length ? <Empty icon="file" title="No videos yet" hint="Videos you make are saved here. Download them or paste their address into a social post." /> : (
          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(260px,1fr))', gap: 12, padding: 12 }}>
            {videos.map((v) => <div key={v.id} className="card" style={{ padding: 8 }}><video controls preload="metadata" src={v.url} style={{ width: '100%', borderRadius: 6, background: '#000' }} /><div style={{ margin: '6px 0' }}><b>{v.title}</b><div className="muted">{dateTime(v.created_at)}{v.duration ? ` · ${Math.round(v.duration)}s` : ''}</div></div>
              <div className="row wrap" style={{ gap: 6 }}><a className="btn sm" href={v.url} download>Download</a><button className="btn sm" onClick={() => { navigator.clipboard?.writeText(`${window.location.origin}${v.url}`); toast('Address copied'); }}>Copy address</button>{can('content', 'edit') && <button className="btn sm danger" onClick={async () => { if (window.confirm('Delete this video?')) { await api.del(`/api/integrations/ai/promo-videos/${v.id}`); loadVideos(); } }}>Delete</button>}</div></div>)}
          </div>)}
      </Card>
      <p className="muted">To post a video, copy its address and paste it into a post under <Link to="/settings/integrations">Integrations → Social media</Link>. Facebook and LinkedIn accept it directly.</p>
    </>);
}

export default function AIStudio() {
  const { can } = useAuth();
  const [tab, setTab] = useState('ask');
  return (
    <>
      <PageHead title="AI Studio" sub="Ask Claude, ChatGPT or Gemini about your numbers, and turn a listing into a short promotional video." />
      <Tabs tabs={[{ key: 'ask', label: 'Ask your data' }, { key: 'promo', label: 'Promo videos' }, { key: 'connect', label: 'Connect' }]} value={tab} onChange={setTab} />
      {tab === 'ask' && <Ask />}
      {tab === 'promo' && <Promo />}
      {tab === 'connect' && <Card title="Claude, ChatGPT and Gemini"><AiConnect can={can('settings', 'edit')} /></Card>}
    </>);
}
