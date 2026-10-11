/**
 * Construction planning tools for the public website: cost calculator, material estimator and milestone payment plan.
 * Pure functions (no I/O) so the browser and the server use the same numbers. Every rate lives in the website config
 * (`calculators.tools`) so the company can change it from the Website Editor without a code change.
 */

export const DEFAULT_TOOLS = {
  sqft_per_marla_floor: 225,               // covered sqft per marla, per floor
  scopes: { grey: 'Grey Structure', semi: 'Semi-Finished', turnkey: 'Turnkey' },
  finishes: ['Standard', 'Premium', 'Luxury'],
  // PKR per covered sqft [scope][finish]
  rates: { grey: { Standard: 3200, Premium: 3300, Luxury: 3500 }, semi: { Standard: 6000, Premium: 6500, Luxury: 7200 }, turnkey: { Standard: 7800, Premium: 8500, Luxury: 9000 } },
  range_pct: { grey: [6, 6], semi: [8, 8], turnkey: [8, 9] },        // planning range below / above the estimate
  location_factor: { Islamabad: 1, Rawalpindi: 1, 'DHA / Bahria / Premium societies': 1 },
  single_storey_factor: 1.095,             // a single storey costs more per sqft (foundation and roof carry fewer floors)
  basement_area_factor: 1,                 // basement covered area as a share of one floor
  basement_months: [2, 4],
  months: { grey: [4, 6], semi: [5, 7], turnkey: [7, 9] },
  months_per_extra_floor: 1,
  breakdown: {
    grey: [['Structure & shell', 100]], semi: [['Structure & shell', 60], ['MEP & partial finishes', 28], ['Management & contingency', 12]],
    turnkey: [['Structure & shell', 45], ['MEP & finishes', 43], ['Management & contingency', 12]],
  },
  // material estimator (per covered sqft) and allowances
  materials: [
    { key: 'steel', label: 'Steel', unit: 'kg', per_sqft: 2.7, rate: 250 },
    { key: 'cement', label: 'Cement', unit: 'bags', per_sqft: 0.404, rate: 1500 },
    { key: 'bricks', label: 'Bricks', unit: 'nos', per_sqft: 21.275, rate: 26 },
    { key: 'sand', label: 'Sand', unit: 'cft', per_sqft: 2.6, rate: 95 },
    { key: 'crush', label: 'Crush', unit: 'cft', per_sqft: 1.95, rate: 98 },
  ],
  allowances: { grey: [['Grey labour', 550], ['Grey MEP', 325], ['Grey miscellaneous', 75]], semi: ['Semi finishing allowance', 900], turnkey: ['Turnkey finishing allowance', 1800] },
  finish_factor: { Standard: 1, Premium: 1.15, Luxury: 1.3 },
  contingency_pct: 8,
  concrete_cft_per_sqft: 1.32,
  // milestone payment plans: [phase, percent]
  plans: {
    grey: [{ label: 'Mobilization and advance', pct: 35 }, { label: 'Foundation / basement completion', pct: 10 }, { label: 'Ground floor RCC frame completion', pct: 10 }, { label: 'First floor RCC frame completion', pct: 10 }, { label: 'Mumty, parapet and boundary wall completion', pct: 10 }, { label: 'MEP internal work completion', pct: 10 }, { label: 'Indoor and outdoor plastering completion', pct: 10 }, { label: 'Final completion and handover', pct: 5 }],
    finishing: [{ label: 'Mobilization and advance', pct: 30 }, { label: 'Flooring and tiling completion', pct: 20 }, { label: 'Woodwork and doors completion', pct: 20 }, { label: 'Paint and fixtures completion', pct: 20 }, { label: 'Final completion and handover', pct: 10 }],
    semi: [{ label: 'Mobilization and advance', pct: 30 }, { label: 'Foundation and RCC frame completion', pct: 25 }, { label: 'Masonry, plaster and MEP completion', pct: 20 }, { label: 'Partial finishing completion', pct: 20 }, { label: 'Final completion and handover', pct: 5 }],
    turnkey: [{ label: 'Mobilization and advance', pct: 25 }, { label: 'Foundation and RCC frame completion', pct: 25 }, { label: 'Masonry, plaster and MEP completion', pct: 15 }, { label: 'Flooring, woodwork and paint completion', pct: 25 }, { label: 'Fixtures, fittings and handover', pct: 10 }],
  },
  note: 'Planning estimates only — not a quotation or Bill of Quantities. Actual cost depends on drawings, soil, specifications and market rates.',
};

const n = (v, d = 0) => (Number.isFinite(Number(v)) && v !== '' && v !== null ? Number(v) : d);
const r0 = (v) => Math.round(v);

/** Covered area from the plot (marla) and number of floors, plus an optional basement the size of one floor. */
export function coveredArea({ marla, floors = 2, basement = false }, t = DEFAULT_TOOLS) {
  const floor = Math.max(0, n(marla)) * n(t.sqft_per_marla_floor, 225);
  const above = floor * Math.max(1, n(floors, 1));
  const base = basement ? floor * n(t.basement_area_factor, 1) : 0;
  return { floor, above, basement: base, total: above + base };
}

/** Cost calculator: PKR range by scope and finish. */
export function estimateCost({ marla, floors = 2, scope = 'grey', finish = 'Premium', location, basement = false, area }, t = DEFAULT_TOOLS) {
  const a = area ? { floor: 0, above: n(area), basement: 0, total: n(area) } : coveredArea({ marla, floors, basement }, t);
  const rate = n(t.rates?.[scope]?.[finish] ?? t.rates?.[scope]?.[t.finishes?.[0]]);
  const loc = n(t.location_factor?.[location], 1);
  const single = n(floors, 2) <= 1 && !area ? n(t.single_storey_factor, 1) : 1;
  const perSqft = rate * loc * single;
  const mid = a.total * perSqft;
  const [lo, hi] = t.range_pct?.[scope] || [8, 8];
  const [m1, m2] = t.months?.[scope] || [6, 8];
  const extra = Math.max(0, n(floors, 2) - 2) * n(t.months_per_extra_floor, 1) + (basement ? 0 : 0);
  const bm = basement ? t.basement_months || [2, 4] : [0, 0];
  const parts = (t.breakdown?.[scope] || []).map(([label, pct]) => ({ label, pct, amount: r0((mid * pct) / 100) }));
  return { area: r0(a.total), perSqft: r0(perSqft), total: r0(mid), low: r0(mid * (1 - lo / 100)), high: r0(mid * (1 + hi / 100)), months: [m1 + extra + bm[0], m2 + extra + bm[1]], parts };
}

/** Material estimator: quantities and cost of steel, cement, bricks, sand and crush plus allowances and contingency. */
export function estimateMaterials({ sqft, scope = 'grey', finish = 'Standard', floors = 2 }, t = DEFAULT_TOOLS) {
  const area = Math.max(0, n(sqft));
  const single = n(floors, 2) <= 1 ? n(t.single_storey_factor, 1) : 1;
  const lines = (t.materials || []).map((m) => { const qty = r0(area * n(m.per_sqft)); return { ...m, qty, amount: r0(qty * n(m.rate)) }; });
  const allowances = (t.allowances?.grey || []).map(([label, perSqft]) => ({ label, amount: r0(area * n(perSqft)) }));
  const fin = t.allowances?.[scope];
  if (scope !== 'grey' && fin) allowances.push({ label: `${fin[0]} (${finish})`, amount: r0(area * n(fin[1]) * n(t.finish_factor?.[finish], 1)), finishing: true });
  const subtotal = lines.reduce((s, l) => s + l.amount, 0) + allowances.reduce((s, l) => s + l.amount, 0);
  const contingency = r0((subtotal * n(t.contingency_pct, 8)) / 100);
  const total = r0((subtotal + contingency) * single);
  return { lines, allowances, subtotal, contingency, total, perSqft: area ? r0(total / area) : 0, baseSqft: area ? r0((subtotal - allowances.filter((x) => x.finishing).reduce((q, x) => q + x.amount, 0)) / area) : 0, concrete: r0(area * n(t.concrete_cft_per_sqft, 1.32)) };
}

/** Payment plan: split a total across milestones. The last line absorbs the rounding so the plan always adds up exactly. */
export function paymentPlan({ total, plan = 'grey' }, t = DEFAULT_TOOLS) {
  const phases = t.plans?.[plan] || [];
  const amount = Math.max(0, r0(n(total)));
  let used = 0;
  const rows = phases.map(({ label, pct }, i) => {
    const a = i === phases.length - 1 ? amount - used : r0((amount * pct) / 100);
    used += a;
    return { label, pct, amount: a };
  });
  return { rows, total: amount, pctTotal: phases.reduce((s, p) => s + n(p.pct), 0) };
}

/** Validate the editable config for these tools; throws Error with a plain message. */
export function checkTools(t) {
  if (!t || typeof t !== 'object') return;
  const bad = (m) => { throw new Error(m); };
  const pos = (v, label, max = 10_000_000) => { const x = Number(v); if (v === '' || v == null || !Number.isFinite(x) || x < 0 || x > max) bad(`${label} must be a number between 0 and ${max.toLocaleString('en')}`); };
  for (const [scope, row] of Object.entries(t.rates || {})) for (const [f, v] of Object.entries(row || {})) pos(v, `The ${scope} rate for ${f}`, 1_000_000);
  for (const m of t.materials || []) { if (!String(m.label || '').trim()) bad('Every material needs a name'); pos(m.per_sqft, `Quantity per sq ft for ${m.label}`, 1000); pos(m.rate, `The rate for ${m.label}`, 10_000_000); }
  for (const [plan, rows] of Object.entries(t.plans || {})) {
    if (!Array.isArray(rows) || !rows.length) continue;
    let sum = 0;
    for (const row of rows) { if (!String(row.label || '').trim()) bad(`Every milestone in the ${plan} plan needs a name`); pos(row.pct, `The percentage for “${row.label}”`, 100); sum += Number(row.pct); }
    if (Math.abs(sum - 100) > 0.5) bad(`The ${plan} payment plan must add up to 100% (it adds up to ${Math.round(sum * 10) / 10}%)`);
  }
  if (t.contingency_pct !== undefined) pos(t.contingency_pct, 'Contingency', 100);
}
