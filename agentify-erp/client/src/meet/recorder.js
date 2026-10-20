// Recording a meeting in the host's browser: the stage is drawn onto a canvas (the shared screen if someone is presenting,
// otherwise everyone's video), everyone's voice is mixed into one audio track, and the result is sent to the server in
// small pieces while the meeting runs, so a long meeting never has to fit in memory and nothing is lost if the tab closes.
export class MeetingRecorder {
  constructor({ code, auth, getSources, getAudioStreams, onState }) {
    this.code = code; this.auth = auth; this.getSources = getSources; this.getAudioStreams = getAudioStreams; this.onState = onState;
    this.seq = 0; this.queue = Promise.resolve(); this.startedAt = 0; this.error = null;
  }
  start() {
    const W = 1280, H = 720;
    const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');
    this.canvas = canvas;
    const draw = () => {
      if (this.stopped) return;
      ctx.fillStyle = '#0b1220'; ctx.fillRect(0, 0, W, H);
      const { screen, tiles, strokes } = this.getSources();
      const fit = (v, x, y, w, h) => { if (!v || !v.videoWidth) return; const s = Math.min(w / v.videoWidth, h / v.videoHeight); const dw = v.videoWidth * s, dh = v.videoHeight * s; ctx.drawImage(v, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh); return [x + (w - dw) / 2, y + (h - dh) / 2, dw, dh]; };
      if (screen) {
        const box = fit(screen, 0, 0, W, H);
        if (box && strokes) for (const s of strokes) { ctx.strokeStyle = s.color; ctx.lineWidth = 4; ctx.lineCap = 'round'; ctx.beginPath(); s.pts.forEach(([x, y], i) => (i ? ctx.lineTo(box[0] + x * box[2], box[1] + y * box[3]) : ctx.moveTo(box[0] + x * box[2], box[1] + y * box[3]))); ctx.stroke(); }
        tiles.slice(0, 4).forEach((v, i) => fit(v, W - 232, 12 + i * 138, 220, 130));
      } else {
        const n = Math.max(1, tiles.length), cols = Math.ceil(Math.sqrt(n)), rows = Math.ceil(n / cols);
        tiles.forEach((v, i) => fit(v, (i % cols) * (W / cols), Math.floor(i / cols) * (H / rows), W / cols - 6, H / rows - 6));
      }
      requestAnimationFrame(draw);
    };
    draw();
    // everyone's voice in one track
    const ac = new (window.AudioContext || window.webkitAudioContext)();
    const dest = ac.createMediaStreamDestination();
    const wired = new Set();
    this.mixTimer = setInterval(() => { for (const s of this.getAudioStreams()) if (s && s.getAudioTracks().length && !wired.has(s.id)) { wired.add(s.id); try { ac.createMediaStreamSource(s).connect(dest); } catch { /* not ready */ } } }, 1000);
    this.ac = ac;
    const mixed = new MediaStream([...canvas.captureStream(15).getVideoTracks(), ...dest.stream.getAudioTracks()]);
    const types = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
    this.mime = types.find((t) => MediaRecorder.isTypeSupported(t)) || '';
    this.rec = new MediaRecorder(mixed, { mimeType: this.mime || undefined, videoBitsPerSecond: 1_500_000 });
    this.rec.ondataavailable = (e) => { if (e.data?.size) this.upload(e.data); };
    this.rec.start(5000);
    this.startedAt = Date.now();
    this.onState?.('recording');
  }
  upload(blob) {
    const seq = this.seq++;
    this.queue = this.queue.then(() => fetch(`/api/meet/${this.code}/recording/chunk?pid=${this.auth.pid}&token=${this.auth.token}&seq=${seq}`, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/octet-stream', 'X-Requested-With': 'ERP' }, body: blob }).then((r) => { if (!r.ok) throw new Error('upload'); })).catch(() => { this.error = 'Part of the recording could not be saved.'; this.onState?.('error'); });
    return this.queue;
  }
  async stop() {
    if (this.stopped) return null;
    this.stopped = true;
    clearInterval(this.mixTimer);
    await new Promise((resolve) => { this.rec.onstop = resolve; try { this.rec.stop(); } catch { resolve(); } });
    await this.queue;
    try { this.ac.close(); } catch { /* ignore */ }
    const r = await fetch(`/api/meet/${this.code}/recording/finish?pid=${this.auth.pid}&token=${this.auth.token}`, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'ERP' }, body: JSON.stringify({ mime: this.mime || 'video/webm', duration: (Date.now() - this.startedAt) / 1000 }) });
    this.onState?.('saved');
    return r.ok ? r.json() : null;
  }
}
