// Listing price text for the public website, driven by the region's `price_style`:
//   south_asian  PKR 1.25 Crore / PKR 45 Lakh / PKR 85,000   (Pakistan only; amounts are whole rupees)
//   intl         $1.25M / $450,000 / £2,500 / month           (amounts are minor units: cents, pence, fils)
// The Pakistani branch reproduces the previous hard-coded text exactly.

const intlCurrency = (locale, currency, digits) => new Intl.NumberFormat(locale, { style: 'currency', currency, minimumFractionDigits: digits, maximumFractionDigits: digits });

export function createPrice({ price_style = 'south_asian', currency = 'PKR', locale = 'en-PK', money_scale = 0, rent_suffix = ' / month', on_request = 'Price on request' } = {}) {
  const unit = 10 ** money_scale;
  if (price_style === 'intl') {
    const nb = (f) => ({ format: (v) => f.format(v).replace(/ /g, ' '), formatToParts: (v) => f.formatToParts(v) });
    const fmt0 = nb(intlCurrency(locale, currency, 0));
    const fmt2 = nb(intlCurrency(locale, currency, 2));
    const major = (n) => Number(n || 0) / unit;
    const symbolOf = () => { const s = fmt0.formatToParts(0).find((p) => p.type === "currency")?.value || currency; return /^[A-Za-z]+$/.test(s) ? `${s} ` : s; };
    return {
      /** "$1.25M" for a million and over, otherwise the full amount "$450,000"; rent gets the suffix. */
      priceText(n, purpose) {
        const v = major(n);
        if (!v) return on_request;
        const t = v >= 1e6 ? `${symbolOf()}${+(v / 1e6).toFixed(2)}M` : fmt0.format(v);
        return `${t}${purpose === 'Rent' ? rent_suffix : ''}`;
      },
      /** The exact amount, with cents only when there are some. */
      fullPrice(n) { const v = major(n); return Number.isInteger(v) ? fmt0.format(v) : fmt2.format(v); },
      /** Whole-unit text for input hints ("2,000,000"). */
      grouped: (v) => Number(v || 0).toLocaleString(locale),
      unit,
    };
  }
  return {
    priceText(n, purpose) {
      const v = Number(n || 0);
      if (!v) return on_request;
      const t = v >= 1e7 ? `${+(v / 1e7).toFixed(2)} Crore` : v >= 1e5 ? `${+(v / 1e5).toFixed(2)} Lakh` : v.toLocaleString(locale);
      return `${currency} ${t}${purpose === 'Rent' ? rent_suffix : ''}`;
    },
    fullPrice: (n) => `${currency} ${Math.round(Number(n || 0)).toLocaleString(locale)}`,
    grouped: (v) => Number(v || 0).toLocaleString(locale),
    unit,
  };
}
