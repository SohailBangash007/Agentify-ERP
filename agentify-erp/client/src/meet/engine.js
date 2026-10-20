// The browser side of a meeting: one WebRTC connection to every other person ("mesh", good for small meetings), introduced
// by the server over server-sent events and small POST requests. Uses the "perfect negotiation" pattern so that turning on
// screen sharing in the middle of a call renegotiates cleanly even if both people change something at once.
const jpost = (url, body) => fetch(url, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'ERP' }, body: JSON.stringify(body) });

export class MeetingEngine {
  /** hooks: onPeers(list), onRemoteStream(peerId, stream, kind), onEvent(event), onEnded(reason), onStatus(text) */
  constructor({ code, join, hooks }) {
    this.code = code; this.me = join; this.hooks = hooks;
    this.peers = new Map(); // pid -> { name, role, pc, polite, makingOffer, ignoreOffer, streams: {screen, camera}, senders: {} }
    this.local = { camera: null, screen: null };
    this.screenId = null;
    this.closed = false;
  }
  base = () => `/api/meet/${this.code}`;
  auth = () => ({ pid: this.me.pid, token: this.me.token });

  start() {
    this.es = new EventSource(`${this.base()}/events?pid=${this.me.pid}&token=${this.me.token}`);
    this.es.onmessage = (m) => { try { this.onEvent(JSON.parse(m.data)); } catch { /* ignore a bad frame */ } };
    this.es.onerror = () => this.hooks.onStatus?.('Reconnecting…');
    this.es.onopen = () => this.hooks.onStatus?.('');
    // we are the newcomer: introduce ourselves to everyone already here
    for (const p of this.me.peers) this.addPeer(p.pid, p.name, p.role, true);
    this.publish();
  }
  publish() { this.hooks.onPeers?.([...this.peers].map(([pid, p]) => ({ pid, name: p.name, role: p.role }))); }

  addPeer(pid, name, role, initiate) {
    if (this.peers.has(pid)) return this.peers.get(pid);
    const pc = new RTCPeerConnection({ iceServers: this.me.ice_servers });
    const peer = { pid, name, role, pc, polite: this.me.pid < pid, makingOffer: false, ignoreOffer: false, remoteScreenId: null, senders: {} };
    this.peers.set(pid, peer);
    pc.onicecandidate = (e) => { if (e.candidate) this.send(pid, 'candidate', e.candidate.toJSON()); };
    pc.ontrack = (e) => {
      const stream = e.streams[0] || new MediaStream([e.track]);
      const kind = peer.remoteScreenId && stream.id === peer.remoteScreenId ? 'screen' : 'camera';
      this.hooks.onRemoteStream?.(pid, stream, kind);
      e.track.onended = () => this.hooks.onRemoteStream?.(pid, stream, kind, true);
    };
    pc.onnegotiationneeded = async () => {
      try { peer.makingOffer = true; await pc.setLocalDescription(); this.send(pid, 'offer', pc.localDescription.toJSON()); } catch { /* retried on the next change */ } finally { peer.makingOffer = false; }
    };
    pc.onconnectionstatechange = () => { if (pc.connectionState === 'failed') { try { pc.restartIce(); } catch { /* ignore */ } } };
    this.attachLocal(peer);
    this.publish();
    return peer;
  }
  attachLocal(peer) {
    const add = (track, stream, key) => { if (track && !peer.senders[key]) peer.senders[key] = peer.pc.addTrack(track, stream); };
    if (this.local.camera) for (const t of this.local.camera.getTracks()) add(t, this.local.camera, t.kind);
    if (this.local.screen) { this.local.screen.getVideoTracks().forEach((t) => add(t, this.local.screen, 'screen')); this.send(peer.pid, 'stream-info', { screen: this.local.screen.id }); }
  }

  async onEvent(e) {
    switch (e.type) {
      case 'peer-joined': this.addPeer(e.peer.pid, e.peer.name, e.peer.role, false); break; // they will offer to us
      case 'peer-left': { const p = this.peers.get(e.pid); if (p) { p.pc.close(); this.peers.delete(e.pid); this.hooks.onRemoteStream?.(e.pid, null, 'gone', true); this.publish(); } break; }
      case 'offer': case 'answer': await this.onDescription(e); break;
      case 'candidate': { const p = this.peers.get(e.from); if (p && e.data) { try { await p.pc.addIceCandidate(e.data); } catch { if (!p.ignoreOffer) { /* a late candidate */ } } } break; }
      case 'stream-info': { const p = this.peers.get(e.from); if (p) { p.remoteScreenId = e.data?.screen || null; this.hooks.onEvent?.({ ...e, type: 'screen-info' }); } break; }
      case 'ended': this.closed = true; this.hooks.onEnded?.(e.reason); this.close(); break;
      default: this.hooks.onEvent?.(e);
    }
  }
  async onDescription(e) {
    let p = this.peers.get(e.from);
    if (!p) p = this.addPeer(e.from, e.from_name || 'Guest', 'guest', false);
    const pc = p.pc;
    const collision = e.type === 'offer' && (p.makingOffer || pc.signalingState !== 'stable');
    p.ignoreOffer = !p.polite && collision;
    if (p.ignoreOffer) return;
    try {
      await pc.setRemoteDescription(e.data);
      if (e.type === 'offer') { await pc.setLocalDescription(); this.send(p.pid, 'answer', pc.localDescription.toJSON()); }
    } catch { /* the next negotiation fixes it */ }
  }

  send(to, type, data) { return jpost(`${this.base()}/signal`, { ...this.auth(), to, type, data }).catch(() => {}); }
  broadcast(type, data) { return jpost(`${this.base()}/signal`, { ...this.auth(), type, data }).catch(() => {}); }
  caption(text, final) { return jpost(`${this.base()}/caption`, { ...this.auth(), text, final }).catch(() => {}); }

  // ---- local media
  setCamera(stream) {
    this.local.camera = stream;
    for (const p of this.peers.values()) this.attachLocal(p);
  }
  /** Swap the outgoing camera video (for background effects) without renegotiating. */
  replaceVideo(track) {
    for (const p of this.peers.values()) { const s = p.senders.video; if (s) s.replaceTrack(track).catch(() => {}); }
  }
  setMicEnabled(on) { this.local.camera?.getAudioTracks().forEach((t) => { t.enabled = on; }); this.broadcast('mute-state', { mic: on }); }
  setCamEnabled(on) { this.local.camera?.getVideoTracks().forEach((t) => { t.enabled = on; }); this.broadcast('mute-state', { cam: on }); }
  async shareScreen() {
    const s = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 15 }, audio: false });
    this.local.screen = s;
    s.getVideoTracks()[0].onended = () => this.stopScreen();
    for (const p of this.peers.values()) this.attachLocal(p);
    this.broadcast('present', { on: true });
    this.hooks.onEvent?.({ type: 'local-screen', stream: s });
    return s;
  }
  stopScreen() {
    const s = this.local.screen; if (!s) return;
    s.getTracks().forEach((t) => t.stop());
    for (const p of this.peers.values()) { const sender = p.senders.screen; if (sender) { try { p.pc.removeTrack(sender); } catch { /* gone */ } delete p.senders.screen; } this.send(p.pid, 'stream-info', { screen: null }); }
    this.local.screen = null;
    this.broadcast('present', { on: false });
    this.hooks.onEvent?.({ type: 'local-screen', stream: null });
  }
  leave() { this.closed = true; try { navigator.sendBeacon?.(`${this.base()}/leave`, new Blob([JSON.stringify({ pid: this.me.pid })], { type: 'application/json' })); } catch { /* ignore */ } this.close(); }
  close() {
    try { this.es?.close(); } catch { /* ignore */ }
    for (const p of this.peers.values()) { try { p.pc.close(); } catch { /* ignore */ } }
    this.peers.clear();
    this.local.screen?.getTracks().forEach((t) => t.stop());
    this.local.camera?.getTracks().forEach((t) => t.stop());
  }
}
