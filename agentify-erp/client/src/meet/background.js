// Camera background effects (blur or a plain colour) done on the person's own device with MediaPipe Selfie Segmentation.
// The model files are served from /mediapipe (copied from the Apache-2.0 npm package); nothing leaves the browser.
let loading = null;
function loadScript() {
  if (window.SelfieSegmentation) return Promise.resolve();
  return (loading ||= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = '/mediapipe/selfie_segmentation.js'; s.onload = resolve; s.onerror = () => reject(new Error('The background effect could not be loaded.'));
    document.head.appendChild(s);
  }));
}

/** mode: 'blur' | a CSS colour like '#0f766e'. Returns { track, stop } where track is the processed camera video. */
export async function applyBackground(cameraStream, mode, width = 640, height = 360) {
  await loadScript();
  const video = document.createElement('video');
  video.srcObject = new MediaStream(cameraStream.getVideoTracks()); video.muted = true; video.playsInline = true;
  await video.play();
  const w = video.videoWidth || width, h = video.videoHeight || height;
  const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  const seg = new window.SelfieSegmentation({ locateFile: (f) => `/mediapipe/${f}` });
  seg.setOptions({ modelSelection: 0 }); // the general model; only this model file ships in /mediapipe
  let current = mode, running = true, ready = false;
  seg.onResults((r) => {
    ready = true;
    ctx.save(); ctx.clearRect(0, 0, w, h);
    ctx.drawImage(r.segmentationMask, 0, 0, w, h);               // the person (white) on black
    ctx.globalCompositeOperation = 'source-in'; ctx.drawImage(r.image, 0, 0, w, h);
    ctx.globalCompositeOperation = 'destination-over';
    if (current === 'blur') { ctx.filter = 'blur(14px)'; ctx.drawImage(r.image, 0, 0, w, h); ctx.filter = 'none'; } else { ctx.fillStyle = current; ctx.fillRect(0, 0, w, h); }
    ctx.restore();
  });
  await seg.initialize();
  const loop = async () => { if (!running) return; try { if (video.readyState >= 2) await seg.send({ image: video }); } catch { /* skip a frame */ } (video.requestVideoFrameCallback ? video.requestVideoFrameCallback.bind(video) : requestAnimationFrame)(loop); };
  loop();
  const out = canvas.captureStream(24);
  return { track: out.getVideoTracks()[0], setMode: (m) => { current = m; }, isReady: () => ready, stop: () => { running = false; try { seg.close(); } catch { /* ignore */ } out.getTracks().forEach((t) => t.stop()); video.srcObject = null; } };
}
