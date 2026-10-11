export class ApiError extends Error {
  constructor(message, status, data) { super(message); this.status = status; this.data = data; }
}

// ---- offline queue: small field actions are kept on the phone and replayed when the signal returns ----
const QKEY = 'erp-offline-queue';
const QUEUEABLE = [['POST', /^\/api\/notes$/], ['POST', /^\/api\/contacts$/], ['POST', /^\/api\/tasks$/], ['PUT', /^\/api\/tasks\/\d+$/],
  ['POST', /^\/api\/hrm\/attendance(\/bulk)?$/], ['POST', /^\/api\/staff\/work-tasks$/], ['PUT', /^\/api\/staff\/work-tasks\/\d+$/]];
const canQueue = (method, url) => QUEUEABLE.some(([m, re]) => m === method && re.test(url));
export const readQueue = () => { try { return JSON.parse(localStorage.getItem(QKEY) || '[]'); } catch { return []; } };
const writeQueue = (q) => { try { localStorage.setItem(QKEY, JSON.stringify(q)); } catch { /* storage full or blocked */ } window.dispatchEvent(new Event('erp:queue')); };
let flushing = false;
/** Replay queued actions in order. Network failures stop the run (retry later); server rejections are dropped and reported. */
export async function flushQueue() {
  if (flushing || !readQueue().length) return { sent: 0, failed: [] };
  flushing = true;
  let sent = 0; const failed = [];
  try {
    for (const item of readQueue()) {
      try {
        const res = await fetch(item.url, { method: item.method, headers: { 'X-Requested-With': 'ERP', 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify(item.body) });
        if (res.status === 401) break;
        if (!res.ok) { let m = `Request failed (${res.status})`; try { m = (await res.json()).error || m; } catch { /* ignore */ } failed.push({ ...item, error: m }); }
        else sent += 1;
        writeQueue(readQueue().filter((x) => x.id !== item.id));
      } catch { break; } // still offline
    }
  } finally { flushing = false; }
  if (sent || failed.length) window.dispatchEvent(new CustomEvent('erp:synced', { detail: { sent, failed } }));
  return { sent, failed };
}
if (typeof window !== 'undefined') { window.addEventListener('online', () => flushQueue()); setTimeout(() => flushQueue(), 3000); }

async function request(method, url, body, isForm) {
  const headers = { 'X-Requested-With': 'ERP' };
  if (body && !isForm) headers['Content-Type'] = 'application/json';
  let res;
  try {
    res = await fetch(url, { method, headers, credentials: 'same-origin', keepalive: !isForm, body: body ? (isForm ? body : JSON.stringify(body)) : undefined });
  } catch (e) {
    // no connection: keep field actions for later instead of losing them
    if (!isForm && canQueue(method, url)) {
      writeQueue([...readQueue(), { id: Date.now() + Math.random(), method, url, body, at: new Date().toISOString() }]);
      return { queued: true, offline: true };
    }
    throw new ApiError('You appear to be offline. Check your connection and try again.', 0);
  }
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) {
    if (res.status === 401 && !url.includes('/auth/')) window.dispatchEvent(new Event('erp:unauthorized'));
    throw new ApiError((data && data.error) || `Request failed (${res.status})`, res.status, data);
  }
  return data;
}

/** Build a query string, skipping empty values. */
export function qs(params = {}) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    p.set(k, typeof v === 'object' ? JSON.stringify(v) : v);
  }
  const s = p.toString();
  return s ? `?${s}` : '';
}

export const api = {
  get: (url, params) => request('GET', url + qs(params)),
  post: (url, body = {}) => request('POST', url, body),
  put: (url, body = {}) => request('PUT', url, body),
  patch: (url, body = {}) => request('PATCH', url, body),
  del: (url) => request('DELETE', url),
  upload: (url, formData) => request('POST', url, formData, true),
};

/** Authenticated download of exports (xlsx/csv) — fetch as blob so cookies + CSRF header apply. */
export async function download(url, params, filename) {
  const res = await fetch(url + qs(params), { credentials: 'same-origin', headers: { 'X-Requested-With': 'ERP' } });
  if (!res.ok) {
    let msg = 'Export failed';
    try { msg = (await res.json()).error || msg; } catch { /* ignore */ }
    throw new ApiError(msg, res.status);
  }
  const blob = await res.blob();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

export const fileUrl = (path) => (path ? `/uploads/${path}` : null);

/** POST then save the response as a file (e.g. assistant PDF report). */
export async function downloadPost(url, body, filename) {
  const res = await fetch(url, { method: 'POST', credentials: 'same-origin', headers: { 'X-Requested-With': 'ERP', 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) {
    let msg = 'Download failed';
    try { msg = (await res.json()).error || msg; } catch { /* ignore */ }
    throw new ApiError(msg, res.status);
  }
  const blob = await res.blob();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
