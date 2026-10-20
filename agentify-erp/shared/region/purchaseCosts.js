// Purchase-cost calculators driven by data from the region pack's `fees` (never hard-coded here), so a rate change is a
// pack edit with an effective date. All amounts are integer minor units; rates are basis points. Results are estimates
// and carry the pack's `needs_legal_review` flag so screens can show "Estimate only".
import { roundHalfAway } from './money.js';

const bp = (amount, rate) => roundHalfAway((amount * rate) / 10000);

/** Marginal bands [{ from, to|null, rate_bp }] -> { total, lines }. */
export function bands(price, table) {
  let total = 0; const lines = [];
  for (const b of [...table].sort((x, y) => x.from - y.from)) {
    if (price <= b.from) break;
    const slice = Math.min(price, b.to ?? Infinity) - b.from;
    if (slice <= 0) continue;
    const tax = bp(slice, b.rate_bp);
    lines.push({ from: b.from, to: Math.min(price, b.to ?? price), rate_bp: b.rate_bp, tax });
    total += tax;
  }
  return { total, lines };
}

/** UK Stamp Duty Land Tax. buyer: standard | first_time | additional | non_resident (surcharges stack). */
export function sdlt(price, cfg, { buyer = 'standard', non_resident = false } = {}) {
  const first = buyer === 'first_time' && price <= cfg.first_time.max_price;
  const table = first ? cfg.first_time.bands : cfg.standard;
  const base = bands(price, table);
  const extra = [];
  if (buyer === 'additional') extra.push({ label: 'Additional property surcharge', rate_bp: cfg.surcharge_additional_bp, tax: bp(price, cfg.surcharge_additional_bp) });
  if (non_resident || buyer === 'non_resident') extra.push({ label: 'Non-UK resident surcharge', rate_bp: cfg.surcharge_non_resident_bp, tax: bp(price, cfg.surcharge_non_resident_bp) });
  const total = base.total + extra.reduce((s, e) => s + e.tax, 0);
  return { total, effective_bp: price ? Math.round((total / price) * 10000) : 0, lines: base.lines, surcharges: extra, first_time_relief: first };
}

/** Dubai Land Department fees for a purchase (and optionally a mortgage and an agent). */
export function dldFees(price, cfg, { loan = 0, with_agent = true } = {}) {
  const above = price > cfg.registration.threshold;
  const rows = [
    { label: 'DLD transfer fee', amount: bp(price, cfg.transfer_bp) },
    { label: 'DLD registration fee', amount: above ? cfg.registration.above : cfg.registration.at_or_below },
    { label: 'Trustee office fee', amount: above ? cfg.trustee.above : cfg.trustee.at_or_below },
  ];
  if (loan > 0) rows.push({ label: 'Mortgage registration', amount: bp(loan, cfg.mortgage_registration_bp) + cfg.mortgage_registration_fixed });
  if (with_agent) {
    const agent = bp(price, cfg.agent_bp);
    rows.push({ label: 'Agent commission', amount: agent }, { label: `VAT on commission (${cfg.vat_bp / 100}%)`, amount: bp(agent, cfg.vat_bp) });
  }
  return { rows, total: rows.reduce((s, r) => s + r.amount, 0) };
}

/** US closing costs: an editable percentage of the price (no national transfer-tax table). */
export function closingCosts(price, cfg, rate_bp = cfg.default_bp) {
  return { rate_bp, total: bp(price, rate_bp), low: bp(price, cfg.range_bp[0]), high: bp(price, cfg.range_bp[1]) };
}

/** Monthly extras shown beside principal and interest on the US calculator (annual figures in bp of price / minor units). */
export function monthlyExtras(price, down, cfg) {
  const pmi = down * 5 < price ? bp(price - down, cfg.pmi_bp) / 12 : 0; // PMI applies below 20% down
  return {
    property_tax: roundHalfAway(bp(price, cfg.property_tax_bp) / 12),
    insurance: roundHalfAway(cfg.insurance_annual / 12),
    hoa: cfg.hoa_monthly || 0,
    pmi: roundHalfAway(pmi),
  };
}
