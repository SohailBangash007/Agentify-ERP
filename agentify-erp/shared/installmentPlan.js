/**
 * Installment plan generator — pure JS, imported by the website calculator (browser) and the PDF endpoint (server)
 * so a visitor always sees the same numbers they download.
 *
 * Input (all money in whole PKR, dates YYYY-MM-DD):
 *   price, booking, advance, installments (count), balloons (count), balloon_amount (each; blank → 5% of price),
 *   markup_pct (flat % per year on the amount financed), booking_date, advance_date, first_date,
 *   every_months (gap between installments, default 1), balloon_every (installments between balloons; blank → spread evenly)
 */
const pad = (n) => String(n).padStart(2, '0');
const iso = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
const parse = (s) => { const [y, m, d] = String(s).split('-').map(Number); return { y, m, d }; };
const dim = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();

export function addMonthsISO(s, n) {
  const { y, m, d } = parse(s);
  const t = y * 12 + (m - 1) + n;
  const ny = Math.floor(t / 12), nm = (t % 12) + 1;
  return iso(ny, nm, Math.min(d, dim(ny, nm)));
}
export function addDaysISO(s, n) {
  const { y, m, d } = parse(s);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return iso(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}
const int = (v) => { const n = Math.round(Number(v)); return Number.isFinite(n) && n > 0 ? n : 0; };

export function buildPlan(input) {
  const price = int(input.price), booking = int(input.booking), advance = int(input.advance);
  const n = int(input.installments), k = int(input.balloons);
  const every = Math.max(1, int(input.every_months) || 1);
  const errors = [];
  if (!price) errors.push('Enter the total price');
  if (!n) errors.push('Enter the number of installments');
  if (n > 360) errors.push('The longest plan supported is 360 installments');
  if (k > n) errors.push('There cannot be more balloon payments than installments');
  if (errors.length) return { ok: false, errors, rows: [], totals: null };

  const markupPct = Math.max(0, Number(input.markup_pct) || 0);
  const bookingDate = input.booking_date, advanceDate = input.advance_date || bookingDate;
  const firstDate = input.first_date || addMonthsISO(advanceDate, 1);
  const balloonAmt = k ? (int(input.balloon_amount) || Math.round(price * 0.05)) : 0;
  const balloonTotal = balloonAmt * k;
  const upfront = booking + advance;
  const financed = price - upfront;
  if (upfront + balloonTotal > price) errors.push('Booking + advance + balloon payments are more than the price');
  if (errors.length) return { ok: false, errors, rows: [], totals: null };
  const years = (n * every) / 12;
  const markup = Math.round(financed * (markupPct / 100) * years);
  const payable = price + markup;
  const regularTotal = payable - upfront - balloonTotal;
  const base = Math.floor(regularTotal / n);

  const rows = [];
  if (booking) rows.push({ type: 'booking', label: 'Booking amount', date: bookingDate, amount: booking });
  if (advance) rows.push({ type: 'advance', label: 'Advance payment', date: advanceDate, amount: advance });
  const gap = k ? (int(input.balloon_every) || Math.max(1, Math.floor(n / k))) : 0;
  const balloonAt = new Set();
  for (let i = 1; i <= k; i++) balloonAt.add(Math.min(n, i * gap));
  let b = 0;
  for (let i = 1; i <= n; i++) {
    const date = addMonthsISO(firstDate, (i - 1) * every);
    const amount = i === n ? regularTotal - base * (n - 1) : base;
    rows.push({ type: 'installment', label: `Installment ${i} of ${n}`, no: i, date, amount });
    if (balloonAt.has(i) && b < k) { b++; rows.push({ type: 'balloon', label: `Balloon payment ${b} of ${k}`, date, amount: balloonAmt }); }
  }
  // any balloons that collided on the same installment (very short plans) still count
  while (b < k) { b++; rows.push({ type: 'balloon', label: `Balloon payment ${b} of ${k}`, date: addMonthsISO(firstDate, (n - 1) * every), amount: balloonAmt }); }
  const order = { booking: 0, advance: 1, installment: 2, balloon: 3 };
  rows.sort((a, c) => a.date.localeCompare(c.date) || order[a.type] - order[c.type]);
  let paid = 0;
  for (const r of rows) { paid += r.amount; r.cumulative = paid; r.balance = payable - paid; }
  return {
    ok: true, errors: [], rows,
    totals: { price, booking, advance, markup, payable, installments: n, installment_amount: base, last_installment: regularTotal - base * (n - 1), balloons: k, balloon_amount: balloonAmt, balloon_total: balloonTotal,
      regular_total: regularTotal, upfront, first_date: firstDate, last_date: rows[rows.length - 1].date, months: Math.round(n * every) },
  };
}
