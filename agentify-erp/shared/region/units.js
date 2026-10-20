// Area and length units. Everything converts through square metres / metres. The marla is not a fixed size across
// Pakistan (272.25 sq ft is common, 225 sq ft is used in some Lahore schemes), so it is configured per pack/tenant.
const SQFT = 0.09290304;
export function createUnits({ marlaSqFt = 272.25 } = {}) {
  const area = {
    sqm: { label: 'sq m', factor: 1 }, sqft: { label: 'sq ft', factor: SQFT }, sqyd: { label: 'sq yd', factor: 0.83612736 },
    marla: { label: 'Marla', factor: marlaSqFt * SQFT }, kanal: { label: 'Kanal', factor: 20 * marlaSqFt * SQFT },
    acre: { label: 'acre', factor: 4046.8564224 }, hectare: { label: 'ha', factor: 10000 },
  };
  const length = { m: { label: 'm', factor: 1 }, ft: { label: 'ft', factor: 0.3048 }, in: { label: 'in', factor: 0.0254 }, yd: { label: 'yd', factor: 0.9144 }, km: { label: 'km', factor: 1000 }, mi: { label: 'mi', factor: 1609.344 } };
  const alias = { 'sq ft': 'sqft', 'sq.ft': 'sqft', sft: 'sqft', 'sq m': 'sqm', 'sq.m': 'sqm', m2: 'sqm', 'sq yd': 'sqyd', yd2: 'sqyd', marlas: 'marla', kanals: 'kanal', acres: 'acre', ha: 'hectare' };
  const key = (u) => { const k = String(u || '').trim().toLowerCase(); return alias[k] || k; };
  const conv = (table, label) => (v, from, to) => {
    const a = table[key(from)], b = table[key(to)];
    if (!a || !b) throw new RangeError(`unknown ${label} unit: ${!a ? from : to}`);
    return (Number(v) * a.factor) / b.factor;
  };
  return {
    area, length, key,
    convertArea: conv(area, 'area'), convertLength: conv(length, 'length'),
    /** Rounded for display (at most `digits` decimals, trailing zeros dropped). */
    round: (v, digits = 2) => Number(Number(v).toFixed(digits)),
    label: (u) => (area[key(u)] || length[key(u)] || { label: String(u || '') }).label,
  };
}
