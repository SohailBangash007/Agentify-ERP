import { all, get } from '../db.js';
import { bad, today as todayPK } from '../util.js';

export const TENDER_STATUS = ['draft', 'open', 'closed', 'awarded', 'cancelled'];
export const BID_STATUS = ['submitted', 'shortlisted', 'awarded', 'rejected', 'withdrawn'];

/** A tender is only "open" until its closing date has passed — no cron job needed. */
export const effectiveStatus = (t, today = todayPK()) => (t.status === 'open' && t.closes_on < today ? 'closed' : t.status);

/** Tenders can be addressed to every vendor or only to vendors of the same category. */
export const visibleTo = (t, vendor) => t.visibility !== 'category' || !t.category || String(vendor.category || '').toLowerCase() === String(t.category).toLowerCase();

/** Bill of quantities: [{no, description, unit, qty}] with sensible limits. */
export function cleanBoq(input) {
  const rows = Array.isArray(input) ? input : [];
  if (rows.length > 300) throw bad('A BOQ can have at most 300 lines');
  return rows.map((r, i) => {
    const description = String(r.description ?? '').trim();
    const qty = Number(r.qty);
    if (!description) throw bad(`BOQ line ${i + 1} needs a description`);
    if (!(qty > 0) || qty > 1e9) throw bad(`BOQ line ${i + 1} needs a quantity above zero`);
    return { no: i + 1, description: description.slice(0, 240), unit: String(r.unit ?? '').trim().slice(0, 20), qty };
  });
}

/** Price a bid: with a BOQ every line needs a rate and the total is computed; without one the vendor gives a lump sum. */
export function priceBid(boq, input) {
  if (boq.length) {
    const byNo = new Map((Array.isArray(input.boq_rates) ? input.boq_rates : []).map((r) => [Number(r.no), Number(r.rate)]));
    const rates = boq.map((l) => {
      const rate = byNo.get(l.no);
      if (!Number.isFinite(rate) || rate <= 0) throw bad(`Enter a rate for BOQ line ${l.no} (${l.description.slice(0, 40)})`);
      return { no: l.no, rate: Math.round(rate) };
    });
    return { rates, total: boq.reduce((s, l, i) => s + Math.round(l.qty * rates[i].rate), 0) };
  }
  const total = Math.round(Number(input.total_amount));
  if (!(total > 0)) throw bad('Enter your total price');
  return { rates: [], total };
}

export const intIn = (v, lo, hi, name) => {
  if (v === undefined || v === null || v === '') return null;
  const n = Math.round(Number(v));
  if (!Number.isFinite(n) || n < lo || n > hi) throw bad(`${name} must be between ${lo} and ${hi}`);
  return n;
};

/** Active vendors who should hear about a tender. */
export function vendorsFor(tender) {
  return all('SELECT * FROM vendors WHERE active=1').filter((v) => visibleTo(tender, v));
}
export const tenderRow = (id) => get('SELECT * FROM tenders WHERE id=?', id);
