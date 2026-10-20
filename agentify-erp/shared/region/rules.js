// Rule helpers shared by the server and tests. Rates are integer basis points (1% = 100 bp) so tax arithmetic on integer
// minor units never touches floating point. A rule row is data (edited in the console, effective-dated); this file only
// knows how to pick the rows in force on a date and how to apply a bracket table.
import { roundHalfAway } from './money.js';

/** Rows in force on `onDate` ('YYYY-MM-DD'): effective_from <= date < effective_to; the latest version of each key wins. */
export function effective(rows, onDate) {
  const latest = new Map();
  for (const r of rows) {
    if (r.effective_from && r.effective_from > onDate) continue;
    if (r.effective_to && r.effective_to <= onDate) continue;
    const k = `${r.region}|${r.sub_region || ''}|${r.kind}|${r.key}`;
    const cur = latest.get(k);
    if (!cur || r.effective_from > cur.effective_from || (r.effective_from === cur.effective_from && r.id > cur.id)) latest.set(k, r);
  }
  return [...latest.values()];
}

/**
 * Marginal bracket tax. brackets: [{ from, to|null, rate_bp }] in minor units, sorted or not.
 * `flat_bp` applies one rate to the whole amount (used by flat fees). Returns { total, lines }.
 */
export function bracketTax(amount, brackets, { flat_bp = null } = {}) {
  const a = Math.max(0, Math.trunc(Number(amount) || 0));
  if (flat_bp != null) { const total = roundHalfAway((a * flat_bp) / 10000); return { total, lines: [{ from: 0, to: a, rate_bp: flat_bp, tax: total }] }; }
  const lines = [];
  let total = 0;
  for (const b of [...brackets].sort((x, y) => x.from - y.from)) {
    if (a <= b.from) break;
    const upper = b.to == null ? a : Math.min(a, b.to);
    const slice = upper - b.from;
    if (slice <= 0) continue;
    const tax = roundHalfAway((slice * b.rate_bp) / 10000);
    lines.push({ from: b.from, to: upper, rate_bp: b.rate_bp, tax });
    total += tax;
  }
  return { total, lines };
}
