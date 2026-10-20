import { currentTenant } from './context.js';

/** Default timezone; each tenant can override it (tenants.timezone in the control plane). */
export const TZ = 'Asia/Karachi';
export const tenantTz = () => currentTenant()?.timezone || TZ;

const pad = (n) => String(n).padStart(2, '0');
const fmt = (d) => d.toISOString().slice(0, 10);

/** Current wall-clock in the tenant's timezone (PKT by default) as 'YYYY-MM-DD HH:MM:SS'. */
/** ERP_FIXED_NOW ('YYYY-MM-DD HH:MM:SS') freezes the wall clock. Used only by the regression snapshot tests. */
const FIXED_NOW = process.env.ERP_FIXED_NOW || null;
export function now() {
  if (FIXED_NOW) return FIXED_NOW;
  const s = new Date().toLocaleString('sv-SE', { timeZone: tenantTz() });
  return s.replace('T', ' ');
}
export const today = () => now().slice(0, 10);

export function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return fmt(d);
}
export function addMonths(dateStr, n) {
  const [y, m, day] = dateStr.split('-').map(Number);
  const total = m - 1 + n;
  const ny = y + Math.floor(total / 12);
  const nm = ((total % 12) + 12) % 12;
  const last = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate();
  return `${ny}-${pad(nm + 1)}-${pad(Math.min(day, last))}`;
}

/** Resolve a date preset (PKT) to {from,to} inclusive date strings. */
export function dateRange(preset, from, to) {
  const t = today();
  const d = new Date(t + 'T00:00:00Z');
  const y = d.getUTCFullYear(), m = d.getUTCMonth();
  const ymd = (yy, mm, dd) => fmt(new Date(Date.UTC(yy, mm, dd)));
  switch (preset) {
    case 'today': return { from: t, to: t };
    case 'yesterday': { const x = addDays(t, -1); return { from: x, to: x }; }
    case 'this_week': { const dow = (d.getUTCDay() + 6) % 7; return { from: addDays(t, -dow), to: addDays(t, 6 - dow) }; }
    case 'this_month': return { from: ymd(y, m, 1), to: ymd(y, m + 1, 0) };
    case 'last_month': return { from: ymd(y, m - 1, 1), to: ymd(y, m, 0) };
    case 'this_quarter': { const q = Math.floor(m / 3) * 3; return { from: ymd(y, q, 1), to: ymd(y, q + 3, 0) }; }
    case 'this_year': return { from: ymd(y, 0, 1), to: ymd(y, 11, 31) };
    case 'custom': return { from: from || '1900-01-01', to: to || '2999-12-31' };
    default: return { from: from || '1900-01-01', to: to || '2999-12-31' };
  }
}

export class HttpError extends Error {
  constructor(status, message, extra) { super(message); this.status = status; this.extra = extra; }
}
export const bad = (msg, extra) => new HttpError(400, msg, extra);
export const forbidden = (msg = 'Forbidden') => new HttpError(403, msg);
export const notFound = (msg = 'Not found') => new HttpError(404, msg);

export const int = (v, def = 0) => {
  if (v === '' || v === null || v === undefined) return def;
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? n : def;
};
export const num = (v, def = 0) => { const n = Number(v); return Number.isFinite(n) ? n : def; };
export const jparse = (s, def) => { try { return s ? JSON.parse(s) : def; } catch { return def; } };
export const asyncH = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
export const pkr = (n) => 'PKR ' + Number(n || 0).toLocaleString('en-PK');

export function required(obj, ...keys) {
  for (const k of keys) if (obj[k] === undefined || obj[k] === null || obj[k] === '') throw bad(`${k.replace(/_/g, ' ')} is required`);
}
