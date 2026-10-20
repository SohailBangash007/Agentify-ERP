// Money as integers in minor units of the workspace currency. `scale` is the number of decimal digits the integer
// carries: Pakistan keeps scale 0 (whole rupees, exactly as stored today); US/CA/UK/AE use scale 2 (cents, pence, fils).
// No floating point is used for money arithmetic: add/sub are integer operations, mul/pct round half away from zero,
// split distributes the remainder so the parts always add up to the whole.
// Isomorphic: used by the server and the browser bundle.

const DASH = '—';
export const roundHalfAway = (x) => (x < 0 ? -Math.round(-x) : Math.round(x));

export function createMoney({ currency = 'PKR', scale = 0, locale = 'en-PK', style = 'code_prefix' } = {}) {
  if (!Number.isInteger(scale) || scale < 0 || scale > 4) throw new RangeError('money scale must be 0..4');
  const unit = 10 ** scale;
  const group = (abs) => (scale === 0 ? abs.toLocaleString(locale) : (abs / unit).toLocaleString(locale, { minimumFractionDigits: scale, maximumFractionDigits: scale }));
  let intl = null;
  const intlFmt = () => (intl ||= new Intl.NumberFormat(locale, { style: 'currency', currency, minimumFractionDigits: scale, maximumFractionDigits: scale }));
  const blank = (n) => n === null || n === undefined || n === '';

  const api = {
    currency, scale, locale, style,
    isInt: (n) => Number.isSafeInteger(n),
    /** Whole major units (display, charts). Never feed the result back into stored amounts. */
    toMajor: (minor) => Number(minor || 0) / unit,
    /** From a user-entered major amount ("1,234.56", 1234.56) to minor units, without float drift. */
    fromMajor(input) {
      if (blank(input)) return null;
      const s = String(input).trim().replace(/[\s ]/g, '');
      const neg = /^-|^\(/.test(s);
      const decimal = (new Intl.NumberFormat(locale).formatToParts(1.1).find((p) => p.type === 'decimal') || { value: '.' }).value;
      const cleaned = s.replace(new RegExp(`[^0-9${decimal === '.' ? '\\.' : decimal}]`, 'g'), '').replace(decimal, '.');
      if (!/^\d*\.?\d*$/.test(cleaned) || cleaned === '' || cleaned === '.') return NaN;
      const [whole, frac = ''] = cleaned.split('.');
      let minor = Number(whole || '0') * unit + Number((frac + '0'.repeat(scale)).slice(0, scale) || '0');
      if (frac.length > scale && Number(frac[scale]) >= 5) minor += 1; // round half up on the first dropped digit
      return neg ? -minor : minor;
    },
    /** "PKR 1,234" (legacy code-prefix style) or the locale's own currency format. null -> an em dash. */
    format(n, { sign = false } = {}) {
      if (blank(n)) return DASH;
      const v = scale === 0 ? Math.round(Number(n)) : Number(n);
      if (style === 'intl') { const t = intlFmt().format(v / unit); return sign && v > 0 ? `+${t}` : t; }
      return `${v < 0 ? '-' : sign && v > 0 ? '+' : ''}${currency} ${group(Math.abs(v))}`;
    },
    /** Same text as the old inline `PKR ${n.toLocaleString('en-PK')}` (no rounding, sign after the code). */
    text(n) { return `${currency} ${scale === 0 ? Number(n || 0).toLocaleString(locale) : group(Number(n || 0))}`; },
    /** Number without the currency: "1,234" / "1,234.56". */
    number: (n) => (blank(n) ? DASH : group(Number(n))),
    /** 1.2M, 450K (compact, major units). */
    short(n) {
      const v = Number(n || 0) / unit, a = Math.abs(v);
      const t = a >= 1e9 ? `${(a / 1e9).toFixed(a >= 1e10 ? 0 : 1)}B` : a >= 1e6 ? `${(a / 1e6).toFixed(a >= 1e7 ? 0 : 1)}M` : a >= 1e3 ? `${(a / 1e3).toFixed(0)}K` : String(Math.round(a * (scale ? 100 : 1)) / (scale ? 100 : 1));
      return `${v < 0 ? '-' : ''}${t}`;
    },
    add: (...xs) => xs.reduce((s, x) => s + (Number(x) || 0), 0),
    sub: (a, b) => (Number(a) || 0) - (Number(b) || 0),
    /** minor * rate, rounded half away from zero (rate may be fractional, e.g. an FX rate or 0.075). */
    mul: (minor, rate) => roundHalfAway(Number(minor) * Number(rate)),
    /** percent of an amount ("2.5" -> 2.5%), computed from basis points to avoid float noise. */
    pct(minor, percent) { return roundHalfAway((Number(minor) * Math.round(Number(percent) * 100)) / 10000); },
    /** Split an amount by weights; the parts always add up to the total (largest remainder first). */
    split(total, weights) {
      const w = weights.map(Number);
      const sum = w.reduce((a, b) => a + b, 0);
      if (!(sum > 0)) throw new RangeError('weights must add up to more than zero');
      const raw = w.map((x) => (total * x) / sum);
      const parts = raw.map((x) => Math.floor(x));
      let left = total - parts.reduce((a, b) => a + b, 0);
      raw.map((x, i) => [x - Math.floor(x), i]).sort((a, b) => b[0] - a[0] || a[1] - b[1]).forEach(([, i]) => { if (left > 0) { parts[i] += 1; left -= 1; } });
      return parts;
    },
    /** Convert between currencies with a rate quote->base, keeping each side's own scale. */
    convert: (minor, rate, toScale) => roundHalfAway(Number(minor) * Number(rate) * 10 ** (toScale - scale)),
  };
  return api;
}
