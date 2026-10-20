// Dates and times from the region's date style. Stored values are always ISO text ('YYYY-MM-DD', 'YYYY-MM-DD HH:MM'),
// so this only changes how they are shown. 'DD-Mon-YYYY' with a 12-hour clock is the Pakistan style used until now.
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const DATE_STYLES = ['DD-Mon-YYYY', 'MM/DD/YYYY', 'DD/MM/YYYY', 'YYYY-MM-DD', 'DD Mon YYYY'];

export function createFormat({ date_style = 'DD-Mon-YYYY', time_style = '12h', timezone = 'Asia/Karachi' } = {}) {
  const show = (y, m, d) => {
    const mm = String(m).padStart(2, '0'), dd = String(d).padStart(2, '0');
    switch (date_style) {
      case 'MM/DD/YYYY': return `${mm}/${dd}/${y}`;
      case 'DD/MM/YYYY': return `${dd}/${mm}/${y}`;
      case 'YYYY-MM-DD': return `${y}-${mm}-${dd}`;
      case 'DD Mon YYYY': return `${dd} ${MONTHS[m - 1]} ${y}`;
      default: return `${dd}-${MONTHS[m - 1]}-${y}`;
    }
  };
  const date = (s) => {
    if (!s) return '—';
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
    return m ? show(m[1], Number(m[2]), m[3]) : s;
  };
  const time = (h, min) => (time_style === '24h' ? `${String(h).padStart(2, '0')}:${min}` : `${String(h % 12 || 12).padStart(2, '0')}:${min} ${h >= 12 ? 'PM' : 'AM'}`);
  const dateTime = (s) => {
    if (!s) return '—';
    const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(s);
    if (!m) return date(s);
    return `${show(m[1], Number(m[2]), m[3])} ${time(Number(m[4]), m[5])}`;
  };
  const month = (s) => { const m = /^(\d{4})-(\d{2})/.exec(s || ''); return m ? `${MONTHS[Number(m[2]) - 1]} ${m[1].slice(2)}` : s; };
  /** Today in the region's timezone as YYYY-MM-DD. */
  const today = () => new Date().toLocaleDateString('en-CA', { timeZone: timezone });
  return { date, dateTime, month, today, timezone, date_style, time_style };
}
