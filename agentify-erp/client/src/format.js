// All display formatting lives here so dates/currency are consistent app-wide (PKR, Asia/Karachi).
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function money(n, { sign = false } = {}) {
  if (n === null || n === undefined || n === '') return '—';
  const v = Math.round(Number(n));
  const s = Math.abs(v).toLocaleString('en-PK');
  return `${v < 0 ? '-' : sign && v > 0 ? '+' : ''}PKR ${s}`;
}
export const num = (n) => (n === null || n === undefined ? '—' : Number(n).toLocaleString('en-PK'));

/** Compact money for tight spaces: 1.2M, 450K */
export function moneyShort(n) {
  const v = Number(n || 0), a = Math.abs(v);
  const t = a >= 1e9 ? `${(a / 1e9).toFixed(a >= 1e10 ? 0 : 1)}B` : a >= 1e6 ? `${(a / 1e6).toFixed(a >= 1e7 ? 0 : 1)}M` : a >= 1e3 ? `${(a / 1e3).toFixed(0)}K` : String(Math.round(a));
  return `${v < 0 ? '-' : ''}${t}`;
}

/** 'YYYY-MM-DD' (or timestamp) -> '07-Oct-2026' */
export function date(s) {
  if (!s) return '—';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  return m ? `${m[3]}-${MONTHS[Number(m[2]) - 1]}-${m[1]}` : s;
}
export function dateTime(s) {
  if (!s) return '—';
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(s);
  if (!m) return date(s);
  const h = Number(m[4]);
  return `${m[3]}-${MONTHS[Number(m[2]) - 1]}-${m[1]} ${String(h % 12 || 12).padStart(2, '0')}:${m[5]} ${h >= 12 ? 'PM' : 'AM'}`;
}
export const month = (s) => { const m = /^(\d{4})-(\d{2})/.exec(s || ''); return m ? `${MONTHS[Number(m[2]) - 1]} ${m[1].slice(2)}` : s; };

/** Today in Asia/Karachi as YYYY-MM-DD */
export const todayPK = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Karachi' });

export const titleCase = (s) => String(s || '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

export function ago(s) {
  if (!s) return '—';
  const t = new Date(s.replace(' ', 'T') + '+05:00').getTime();
  const d = (Date.now() - t) / 1000;
  if (d < 60) return 'just now';
  if (d < 3600) return `${Math.floor(d / 60)}m ago`;
  if (d < 86400) return `${Math.floor(d / 3600)}h ago`;
  if (d < 86400 * 30) return `${Math.floor(d / 86400)}d ago`;
  return date(s);
}

export const initials = (name = '') => name.split(/\s+/).filter(Boolean).slice(0, 2).map((x) => x[0]).join('').toUpperCase();

export const DATE_PRESETS = [
  ['today', 'Today'], ['yesterday', 'Yesterday'], ['this_week', 'This week'], ['this_month', 'This month'], ['last_month', 'Last month'],
  ['this_quarter', 'This quarter'], ['this_year', 'This year'], ['all', 'All time'], ['custom', 'Custom range'],
];
