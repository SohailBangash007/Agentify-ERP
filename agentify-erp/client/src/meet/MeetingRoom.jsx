// The video meeting room. Open to guests (with the link) and signed-in staff. See server/src/integrations/meetings.js.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { MeetingEngine } from './engine.js';
import { applyBackground } from './background.js';
import { MeetingRecorder } from './recorder.js';
import { getRegion } from '../format.js';
import './meet.css';

const jget = async (url) => { const r = await fetch(url, { credentials: 'same-origin' }); const d = await r.json().catch(() => ({})); if (!r.ok) throw Object.assign(new Error(d.error || 'Something went wrong'), { status: r.status }); return d; };
const jpost = async (url, body) => { const r = await fetch(url, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'ERP' }, body: JSON.stringify(body || {}) }); const d = await r.json().catch(() => ({})); if (!r.ok) throw Object.assign(new Error(d.error || 'Something went wrong'), { status: r.status }); return d; };
const mmss = (ms) => { const s = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const COLORS = ['#ef4444', '#f59e0b', '#22c55e', '#3b82f6', '#a855f7'];
const BACKGROUNDS = [['none', 'No effect'], ['blur', 'Blur'], ['#0f766e', 'Teal'], ['#1e3a8a', 'Navy'], ['#9a3412', 'Warm']];

function Video({ stream, muted, mirror, contain, onRef, className }) {
  const ref = useRef(null);
  useEffect(() => { if (ref.current && ref.current.srcObject !== stream) ref.current.srcObject = stream || null; }, [stream]);
  useEffect(() => { onRef?.(ref.current); }, [onRef]);
  return <video ref={ref} autoPlay playsInline muted={muted} className={className} style={{ transform: mirror ? 'scaleX(-1)' : undefined, objectFit: contain ? 'contain' : 'cover' }} />;
}

/** Pen and pointer drawn over the shared screen, in positions relative to the picture so every screen size lines up. */
function Annotate({ stream, tool, color, strokes, pointers, onPointer, onStroke, label }) {
  const wrap = useRef(null), vid = useRef(null), canvas = useRef(null);
  const [box, setBox] = useState({ x: 0, y: 0, w: 1, h: 1 });
  const drawing = useRef(null);
  const measure = useCallback(() => {
    const v = vid.current, w = wrap.current; if (!v || !w || !v.videoWidth) return;
    const s = Math.min(w.clientWidth / v.videoWidth, w.clientHeight / v.videoHeight), bw = v.videoWidth * s, bh = v.videoHeight * s;
    setBox({ x: (w.clientWidth - bw) / 2, y: (w.clientHeight - bh) / 2, w: bw, h: bh });
  }, []);
  useEffect(() => { measure(); const t = setInterval(measure, 700); window.addEventListener('resize', measure); return () => { clearInterval(t); window.removeEventListener('resize', measure); }; }, [measure, stream]);
  useEffect(() => {
    const c = canvas.current; if (!c) return;
    c.width = box.w; c.height = box.h;
    const ctx = c.getContext('2d'); ctx.clearRect(0, 0, c.width, c.height); ctx.lineWidth = 4; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (const s of strokes) { ctx.strokeStyle = s.color; ctx.beginPath(); s.pts.forEach(([x, y], i) => (i ? ctx.lineTo(x * c.width, y * c.height) : ctx.moveTo(x * c.width, y * c.height))); ctx.stroke(); }
  }, [strokes, box]);
  const pos = (e) => { const r = canvas.current.getBoundingClientRect(); return [Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))]; };
  const down = (e) => { if (tool !== 'pen') return; canvas.current.setPointerCapture(e.pointerId); drawing.current = { id: `${Date.now()}`, color, pts: [pos(e)] }; };
  const move = (e) => {
    if (tool === 'pointer') onPointer(pos(e));
    if (tool === 'pen' && drawing.current) { drawing.current.pts.push(pos(e)); onStroke({ ...drawing.current }, false); }
  };
  const up = () => { if (drawing.current) { onStroke({ ...drawing.current }, true); drawing.current = null; } };
  return (
    <div ref={wrap} className="meet-stage-media">
      <Video stream={stream} muted contain onRef={(el) => { vid.current = el; if (el) el.onloadedmetadata = measure; }} />
      <div className="meet-overlay" style={{ left: box.x, top: box.y, width: box.w, height: box.h }}>
        <canvas ref={canvas} className="meet-draw" style={{ pointerEvents: tool === 'none' ? 'none' : 'auto', cursor: tool === 'pen' ? 'crosshair' : tool === 'pointer' ? 'none' : 'default' }} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerLeave={up} />
        {pointers.map((p) => <div key={p.pid} className="meet-pointer" style={{ left: `${p.x * 100}%`, top: `${p.y * 100}%`, background: p.color }}><span>{p.name}</span></div>)}
      </div>
      {label && <div className="meet-label">{label}</div>}
    </div>
  );
}

export default function MeetingRoom() {
  const { code } = useParams();
  const [sp] = useSearchParams();
  const invite = sp.get('i') || '';
  const [phase, setPhase] = useState('loading'); // loading | closed | lobby | room | ended
  const [info, setInfo] = useState(null);
  const [err, setErr] = useState('');
  const [name, setName] = useState('');
  const [joining, setJoining] = useState(false);
  const [lobbyStream, setLobbyStream] = useState(null);
  const [mediaNote, setMediaNote] = useState('');
  const [me, setMe] = useState(null);
  const [peers, setPeers] = useState([]);
  const [remote, setRemote] = useState({}); // pid -> { camera, screen }
  const [localScreen, setLocalScreen] = useState(null);
  const [mic, setMic] = useState(true);
  const [cam, setCam] = useState(true);
  const [muted, setMuted] = useState({});   // pid -> { mic, cam }
  const [side, setSide] = useState('captions');
  const [lines, setLines] = useState([]);
  const [interim, setInterim] = useState(null);
  const [capsOn, setCapsOn] = useState(false);
  const [script, setScript] = useState(null);
  const [tool, setTool] = useState('none');
  const [color, setColor] = useState(COLORS[0]);
  const [strokes, setStrokes] = useState([]);
  const [pointers, setPointers] = useState([]);
  const [recState, setRecState] = useState('');
  const [bgMenu, setBgMenu] = useState(false);
  const [bg, setBg] = useState('none');
  const [left, setLeft] = useState(null);
  const [toast, setToast] = useState('');
  const [endedReason, setEndedReason] = useState('');
  const engine = useRef(null); const recorder = useRef(null); const bgProc = useRef(null); const recog = useRef(null); const cameraRaw = useRef(null);
  const videoEls = useRef({}); const hardStop = useRef(0);
  const say = (m) => { setToast(m); setTimeout(() => setToast(''), 4000); };

  // ---- before joining
  useEffect(() => { jget(`/api/meet/${code}/info${invite ? `?i=${encodeURIComponent(invite)}` : ''}`).then((d) => { setInfo(d); setName(d.name_hint || ''); setPhase(d.join_open ? 'lobby' : 'closed'); }).catch((e) => { setErr(e.message); setPhase('closed'); }); }, [code, invite]);
  useEffect(() => {
    if (phase !== 'lobby') return undefined;
    let dead = false;
    navigator.mediaDevices?.getUserMedia({ video: { width: 640, height: 360 }, audio: true }).then((s) => { if (dead) s.getTracks().forEach((t) => t.stop()); else setLobbyStream(s); }).catch(() => { setMediaNote('Your camera or microphone is blocked. You can still join and listen; allow access in your browser to be seen and heard.'); });
    return () => { dead = true; };
  }, [phase]);
  useEffect(() => { if (phase === 'closed' && info?.opens_at_ms) { const t = setInterval(() => { if (Date.now() >= info.opens_at_ms) { clearInterval(t); window.location.reload(); } }, 5000); return () => clearInterval(t); } return undefined; }, [phase, info]);

  // ---- joining
  const join = async () => {
    setJoining(true); setErr('');
    try {
      const j = await jpost(`/api/meet/${code}/join`, { name: name.trim(), i: invite });
      setMe(j); hardStop.current = j.hard_stop_ms;
      let cam0 = lobbyStream;
      if (!cam0) { try { cam0 = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 360 }, audio: true }); } catch { cam0 = null; } }
      cameraRaw.current = cam0;
      const eng = new MeetingEngine({ code, join: j, hooks: {
        onPeers: setPeers,
        onRemoteStream: (pid, stream, kind, ended) => setRemote((r) => { const cur = { ...(r[pid] || {}) }; if (kind === 'gone') { const n = { ...r }; delete n[pid]; return n; } if (ended) { if (cur[kind] === stream) delete cur[kind]; } else cur[kind] = stream; return { ...r, [pid]: cur }; }),
        onEvent: (e) => handleEvent(e),
        onEnded: (reason) => { setEndedReason(reason); setPhase('ended'); stopAll(); },
        onStatus: (t) => setToast(t),
      } });
      engine.current = eng;
      if (cam0) eng.setCamera(cam0);
      setPhase('room'); eng.start();
      if (j.role !== 'guest') jget(`/api/meet/${code}/script?pid=${j.pid}&token=${j.token}`).then(setScript).catch(() => {});
    } catch (e) { setErr(e.message); } finally { setJoining(false); }
  };
  const handleEvent = (e) => {
    if (e.type === 'caption') { if (e.data.final) { setLines((l) => [...l.slice(-199), { who: e.from_name, text: e.data.text }]); setInterim((i) => (i?.who === e.from_name ? null : i)); } else setInterim({ who: e.from_name, text: e.data.text }); }
    else if (e.type === 'pointer') { const p = { pid: e.from, name: e.from_name, x: e.data.x, y: e.data.y, color: e.data.color || '#ef4444', at: Date.now() }; setPointers((ps) => [...ps.filter((x) => x.pid !== e.from), p]); setTimeout(() => setPointers((ps) => ps.filter((x) => x.pid !== e.from || Date.now() - x.at < 1500)), 1600); }
    else if (e.type === 'stroke') setStrokes((s) => [...s.filter((x) => x.id !== `${e.from}:${e.data.id}`), { id: `${e.from}:${e.data.id}`, color: e.data.color, pts: e.data.pts }]);
    else if (e.type === 'clear-strokes') setStrokes([]);
    else if (e.type === 'mute-state') setMuted((m) => ({ ...m, [e.from]: { ...(m[e.from] || {}), ...e.data } }));
    else if (e.type === 'present' && !e.data.on) setStrokes([]);
    else if (e.type === 'warning') say(`This meeting ends in ${e.data?.minutes ?? e.minutes} minute${(e.data?.minutes ?? e.minutes) === 1 ? '' : 's'}.`);
    else if (e.type === 'local-screen') { setLocalScreen(e.stream); if (!e.stream) setStrokes([]); }
  };
  const stopAll = () => { try { recognitionStop(); } catch { /* ignore */ } bgProc.current?.stop(); };
  useEffect(() => () => { engine.current?.leave(); bgProc.current?.stop(); try { recog.current?.stop(); } catch { /* ignore */ } }, []);
  useEffect(() => { const t = setInterval(() => hardStop.current && setLeft(hardStop.current - Date.now()), 1000); return () => clearInterval(t); }, []);

  // ---- controls
  const toggleMic = () => { const n = !mic; setMic(n); engine.current?.setMicEnabled(n); };
  const toggleCam = () => { const n = !cam; setCam(n); engine.current?.setCamEnabled(n); };
  const share = async () => { try { if (localScreen) engine.current.stopScreen(); else await engine.current.shareScreen(); } catch (e) { if (e.name !== 'NotAllowedError') say('Screen sharing is not available in this browser.'); } };
  const pickBg = async (mode) => {
    setBgMenu(false);
    try {
      bgProc.current?.stop(); bgProc.current = null;
      if (mode === 'none') { const t = cameraRaw.current?.getVideoTracks()[0]; if (t) engine.current.replaceVideo(t); setBg('none'); setLobbyBgStream(null); return; }
      if (!cameraRaw.current?.getVideoTracks().length) { say('Turn on your camera first.'); return; }
      const proc = await applyBackground(cameraRaw.current, mode);
      bgProc.current = proc; engine.current.replaceVideo(proc.track); setBg(mode); setLobbyBgStream(new MediaStream([proc.track]));
    } catch (e) { say(e.message || 'The background effect could not start.'); }
  };
  const [lobbyBgStream, setLobbyBgStream] = useState(null);
  const sendPointer = useMemo(() => { let last = 0; return ([x, y]) => { const t = Date.now(); if (t - last < 40) return; last = t; engine.current?.broadcast('pointer', { x, y, color }); }; }, [color]);
  const sendStroke = (s, done) => { setStrokes((all) => [...all.filter((x) => x.id !== `me:${s.id}`), { id: `me:${s.id}`, color: s.color, pts: s.pts }]); if (done || s.pts.length % 6 === 0) engine.current?.broadcast('stroke', s); };
  const clearStrokes = () => { setStrokes([]); engine.current?.broadcast('clear-strokes', {}); };
  // live captions from this person's own voice (Chrome and Edge)
  const SR = typeof window !== 'undefined' ? (window.SpeechRecognition || window.webkitSpeechRecognition) : null;
  const recognitionStop = () => { if (recog.current) { recog.current.onend = null; try { recog.current.stop(); } catch { /* ignore */ } recog.current = null; } };
  const toggleCaps = () => {
    if (capsOn) { recognitionStop(); setCapsOn(false); return; }
    if (!SR) { say('Live captions need Chrome or Edge. The meeting recording can still be transcribed afterwards.'); return; }
    const r = new SR(); r.continuous = true; r.interimResults = true; r.lang = getRegion().config?.locale || navigator.language || 'en-US';
    let lastSent = 0;
    r.onresult = (ev) => { for (let i = ev.resultIndex; i < ev.results.length; i += 1) { const res = ev.results[i], text = res[0].transcript.trim(); if (!text) continue; if (res.isFinal) { engine.current?.caption(text, true); setLines((l) => [...l.slice(-199), { who: 'You', text }]); setInterim(null); } else if (Date.now() - lastSent > 900) { lastSent = Date.now(); engine.current?.caption(text, false); setInterim({ who: 'You', text }); } } };
    r.onend = () => { if (recog.current === r) { try { r.start(); } catch { /* restarts shortly */ } } };
    r.start(); recog.current = r; setCapsOn(true); setSide('captions');
  };
  const toggleRecord = async () => {
    if (recorder.current && recState === 'recording') { const out = await recorder.current.stop(); recorder.current = null; say(out ? 'Recording saved to Recordings.' : 'The recording could not be saved.'); return; }
    const rec = new MeetingRecorder({ code, auth: { pid: me.pid, token: me.token }, onState: setRecState,
      getSources: () => ({ screen: localScreen ? videoEls.current.localScreen : Object.keys(remote).map((p) => remote[p].screen && videoEls.current[`${p}:screen`]).find(Boolean) || null, tiles: [videoEls.current.local, ...peers.map((p) => videoEls.current[p.pid])].filter(Boolean), strokes }),
      getAudioStreams: () => [cameraRaw.current, ...Object.values(remote).map((r) => r.camera)] });
    recorder.current = rec; rec.start(); engine.current?.broadcast('chat', { text: 'Recording started' });
  };
  const leave = () => { engine.current?.leave(); window.location.href = me?.role === 'guest' ? '/' : '/meetings'; };
  const endForAll = async () => { if (!window.confirm('End the meeting for everyone?')) return; if (recorder.current) await recorder.current.stop(); await jpost(`/api/meet/${code}/end`, { pid: me.pid, token: me.token }); };
  const copyLink = () => { navigator.clipboard?.writeText(`${window.location.origin}/meet/${code}`); say('Meeting link copied.'); };

  // ---- screens
  if (phase === 'loading') return <div className="meet-center"><div className="meet-spinner" /></div>;
  if (phase === 'closed') return (
    <div className="meet-center"><div className="meet-card">
      <h1>{info?.title || 'Meeting'}</h1>
      <p>{err || info?.closed_reason}</p>
      {info?.starts_at && <p className="meet-muted">Scheduled for {info.starts_at.slice(0, 16)}{info.host_name ? ` · hosted by ${info.host_name}` : ''}</p>}
      {info?.opens_at_ms && <p className="meet-muted">This page opens the room automatically when it is time.</p>}
    </div></div>);
  if (phase === 'ended') return (
    <div className="meet-center"><div className="meet-card"><h1>The meeting has ended</h1><p>{endedReason === 'time' ? 'The time limit for this meeting was reached.' : endedReason === 'canceled' ? 'The host canceled this meeting.' : 'Thank you for joining.'}</p>
      {me && me.role !== 'guest' ? <a className="meet-btn primary" href="/meetings">Back to meetings</a> : <a className="meet-btn" href="/">Close</a>}</div></div>);
  if (phase === 'lobby') return (
    <div className="meet-center"><div className="meet-card wide">
      <h1>{info.title}</h1>
      <p className="meet-muted">{info.starts_at.slice(0, 16)} · up to {info.max_minutes} minutes{info.host_name ? ` · hosted by ${info.host_name}` : ''}</p>
      <div className="meet-preview">{lobbyStream ? <Video stream={lobbyStream} muted mirror /> : <div className="meet-nocam">{mediaNote || 'Starting your camera…'}</div>}</div>
      {info.record && <p className="meet-note">This meeting will be recorded.</p>}
      <label className="meet-field">Your name<input value={name} onChange={(e) => setName(e.target.value)} placeholder="Type your name" autoFocus onKeyDown={(e) => e.key === 'Enter' && name.trim() && join()} /></label>
      {err && <p className="meet-error" role="alert">{err}</p>}
      <button className="meet-btn primary big" disabled={!name.trim() || joining} onClick={join}>{joining ? 'Joining…' : info.is_host ? 'Start the meeting' : 'Join now'}</button>
    </div></div>);

  const presenterPid = Object.keys(remote).find((p) => remote[p].screen);
  const screenStream = localScreen || (presenterPid ? remote[presenterPid].screen : null);
  const presenterName = localScreen ? 'You are sharing your screen' : presenterPid ? `${peers.find((p) => p.pid === presenterPid)?.name || 'Someone'} is presenting` : '';
  const tiles = [{ pid: 'local', name: `${name || 'You'} (you)`, stream: bgProc.current && lobbyBgStream ? lobbyBgStream : cameraRaw.current, mirror: true, muted: true, cam, mic }, ...peers.map((p) => ({ pid: p.pid, name: p.name, stream: remote[p.pid]?.camera, cam: muted[p.pid]?.cam !== false, mic: muted[p.pid]?.mic !== false }))];
  const canDraw = !!screenStream;
  return (
    <div className="meet-room">
      <div className="meet-top">
        <b className="meet-title">{me.meeting.title}</b>
        <span className="meet-chip">{peers.length + 1} in the meeting</span>
        {recState === 'recording' && <span className="meet-chip rec">● Recording</span>}
        {left != null && <span className={`meet-chip ${left < 300000 ? 'warn' : ''}`} title="Time left in this meeting">⏱ {mmss(left)} left</span>}
        <span style={{ flex: 1 }} />
        {me.role !== 'guest' && <button className="meet-btn" onClick={copyLink}>Copy link</button>}
      </div>
      <div className="meet-main">
        <div className="meet-stage">
          {screenStream ? (
            <div className="meet-present">
              <Annotate stream={screenStream} tool={canDraw ? tool : 'none'} color={color} strokes={strokes} pointers={pointers} onPointer={sendPointer} onStroke={sendStroke} label={presenterName} />
              <div className="meet-strip">{tiles.map((t) => <Tile key={t.pid} t={t} small videoEls={videoEls} />)}</div>
            </div>
          ) : <div className={`meet-grid n${Math.min(tiles.length, 9)}`}>{tiles.map((t) => <Tile key={t.pid} t={t} videoEls={videoEls} />)}</div>}
          {localScreen && <video ref={(el) => { if (el) { videoEls.current.localScreen = el; el.srcObject = localScreen; el.muted = true; el.play().catch(() => {}); } }} style={{ display: 'none' }} />}
          {screenStream && !localScreen && presenterPid && <video ref={(el) => { if (el) { videoEls.current[`${presenterPid}:screen`] = el; el.srcObject = remote[presenterPid].screen; el.muted = true; el.play().catch(() => {}); } }} style={{ display: 'none' }} />}
          {toast && <div className="meet-toast" role="status">{toast}</div>}
        </div>
        <aside className="meet-side">
          <div className="meet-tabs">{['captions', ...(me.role !== 'guest' ? ['script'] : []), 'people'].map((t) => <button key={t} className={side === t ? 'on' : ''} onClick={() => setSide(t)}>{t === 'captions' ? 'Captions' : t === 'script' ? 'Script' : `People (${peers.length + 1})`}</button>)}</div>
          {side === 'captions' && <div className="meet-pane" aria-live="polite">
            {!lines.length && !interim && <p className="meet-muted">Press <b>Captions</b> to turn your speech into text for everyone. {me.meeting.transcribe ? 'The transcript is saved with the meeting.' : ''}</p>}
            {lines.map((l, i) => <p key={i}><b>{l.who}:</b> {l.text}</p>)}{interim && <p className="meet-muted"><b>{interim.who}:</b> {interim.text}</p>}
          </div>}
          {side === 'script' && <div className="meet-pane">{script ? <><h3>{script.name}</h3><pre className="meet-script">{script.text}</pre></> : <p className="meet-muted">No script was chosen for this meeting.</p>}</div>}
          {side === 'people' && <div className="meet-pane">{[{ pid: me.pid, name: `${name || me.name} (you)`, role: me.role }, ...peers].map((p) => <p key={p.pid}>{p.name} <span className="meet-muted">{p.role === 'host' ? 'host' : p.role === 'member' ? 'team' : 'guest'}</span></p>)}</div>}
        </aside>
      </div>
      <div className="meet-bar">
        <Ctl on={mic} label={mic ? 'Mute' : 'Unmute'} onClick={toggleMic} icon={mic ? '🎤' : '🔇'} />
        <Ctl on={cam} label={cam ? 'Camera off' : 'Camera on'} onClick={toggleCam} icon={cam ? '📷' : '🚫'} />
        <Ctl on={!!localScreen} label={localScreen ? 'Stop sharing' : 'Share screen'} onClick={share} icon="🖥️" accent />
        <div className="meet-menu-wrap"><Ctl label="Background" onClick={() => setBgMenu(!bgMenu)} icon="🌄" />{bgMenu && <div className="meet-menu">{BACKGROUNDS.map(([k, l]) => <button key={k} className={bg === k ? 'on' : ''} onClick={() => pickBg(k)}>{k !== 'none' && k !== 'blur' ? <i style={{ background: k }} /> : null}{l}</button>)}</div>}</div>
        <Ctl on={capsOn} label="Captions" onClick={toggleCaps} icon="💬" accent />
        {canDraw && <><Ctl on={tool === 'pointer'} label="Pointer" onClick={() => setTool(tool === 'pointer' ? 'none' : 'pointer')} icon="👆" accent /><Ctl on={tool === 'pen'} label="Pen" onClick={() => setTool(tool === 'pen' ? 'none' : 'pen')} icon="✏️" accent />
          {tool !== 'none' && <span className="meet-colors">{COLORS.map((c) => <button key={c} aria-label={`Colour ${c}`} className={color === c ? 'on' : ''} style={{ background: c }} onClick={() => setColor(c)} />)}<button className="meet-btn" onClick={clearStrokes}>Clear</button></span>}</>}
        {me.role === 'host' && me.meeting.record && <Ctl on={recState === 'recording'} label={recState === 'recording' ? 'Stop recording' : 'Record'} onClick={toggleRecord} icon="⏺️" danger />}
        <span style={{ flex: 1 }} />
        {me.role === 'host' && <button className="meet-btn danger" onClick={endForAll}>End for all</button>}
        <button className="meet-btn" onClick={leave}>Leave</button>
      </div>
    </div>
  );
}

function Tile({ t, small, videoEls }) {
  return (
    <div className={`meet-tile ${small ? 'small' : ''}`}>
      {t.stream && t.cam !== false ? <Video stream={t.stream} muted={t.muted} mirror={t.mirror} onRef={(el) => { if (el) videoEls.current[t.pid] = el; }} /> : <div className="meet-avatar"><span>{(t.name || '?').trim()[0]?.toUpperCase()}</span></div>}
      <div className="meet-name">{t.mic === false ? '🔇 ' : ''}{t.name}</div>
    </div>
  );
}
function Ctl({ icon, label, onClick, on, accent, danger }) {
  return <button className={`meet-ctl ${on === false && !accent && !danger ? 'off' : ''} ${accent && on ? 'active' : ''} ${danger && on ? 'danger' : ''}`} onClick={onClick} aria-label={label} aria-pressed={on === undefined ? undefined : !!on}><span aria-hidden>{icon}</span><small>{label}</small></button>;
}
