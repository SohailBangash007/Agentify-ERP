// Mortgage maths on integer minor units (cents). Rates are annual percentages in basis points (6.25% = 625).
// Only the periodic rate uses floating point; every amount that is returned or stored is rounded half away from zero to a
// whole minor unit, and the schedule's last payment absorbs rounding so the balance ends at exactly zero.
import { roundHalfAway } from './money.js';

/** Periodic (monthly) rate. Canadian fixed-rate mortgages compound semi-annually, most others monthly. */
export function monthlyRate(annual_bp, compounding = 'monthly') {
  const a = annual_bp / 10000;
  if (compounding === 'semiannual') return (1 + a / 2) ** (1 / 6) - 1;
  return a / 12;
}

/** Level monthly payment for a principal, rate and term. */
export function payment({ principal, annual_bp, term_months, compounding = 'monthly' }) {
  if (!(principal > 0) || !(term_months > 0)) return 0;
  const r = monthlyRate(annual_bp, compounding);
  if (r === 0) return roundHalfAway(principal / term_months);
  return roundHalfAway((principal * r) / (1 - (1 + r) ** -term_months));
}

/** Full amortisation schedule: [{ n, payment, interest, principal, balance }]. Ends at balance 0. */
export function schedule({ principal, annual_bp, term_months, compounding = 'monthly', extra_monthly = 0 }) {
  const r = monthlyRate(annual_bp, compounding);
  const level = payment({ principal, annual_bp, term_months, compounding });
  const rows = [];
  let balance = principal;
  for (let n = 1; n <= term_months && balance > 0; n += 1) {
    const interest = roundHalfAway(balance * r);
    let pay = Math.min(level + extra_monthly, balance + interest);
    if (n === term_months) pay = balance + interest; // last payment clears rounding
    const princ = pay - interest;
    balance -= princ;
    rows.push({ n, payment: pay, interest, principal: princ, balance });
  }
  return rows;
}

export function totals(rows) {
  return rows.reduce((t, r) => ({ paid: t.paid + r.payment, interest: t.interest + r.interest, months: t.months + 1 }), { paid: 0, interest: 0, months: 0 });
}

/** Loan size from price, down payment (amount) — loan-to-value in basis points. */
export function loanToValue({ price, down }) {
  if (!(price > 0)) return 0;
  return Math.round(((price - down) / price) * 10000);
}

/**
 * Affordability by debt-to-income. gross_monthly_income and monthly_debts are minor units; max_dti_bp is the front/back limit
 * the lender uses (e.g. 4300 = 43%). This is an estimate for conversations, not a lending decision.
 */
export function affordability({ gross_monthly_income, monthly_debts = 0, max_dti_bp = 4300, annual_bp, term_months, compounding = 'monthly', down = 0, monthly_other_costs = 0 }) {
  const room = roundHalfAway((gross_monthly_income * max_dti_bp) / 10000) - monthly_debts - monthly_other_costs;
  if (room <= 0) return { max_payment: 0, max_loan: 0, max_price: down };
  const r = monthlyRate(annual_bp, compounding);
  const max_loan = r === 0 ? room * term_months : roundHalfAway((room * (1 - (1 + r) ** -term_months)) / r);
  return { max_payment: room, max_loan, max_price: max_loan + down };
}

/** Pipeline stages every region starts from; a region pack may rename or add stages. */
export const MORTGAGE_STAGES = ['enquiry', 'pre_qualified', 'documents', 'submitted', 'approved', 'funded', 'declined', 'withdrawn'];
const NEXT = { enquiry: ['pre_qualified', 'withdrawn'], pre_qualified: ['documents', 'declined', 'withdrawn'], documents: ['submitted', 'withdrawn'], submitted: ['approved', 'declined', 'withdrawn'], approved: ['funded', 'withdrawn'], funded: [], declined: ['enquiry'], withdrawn: ['enquiry'] };
export const canMove = (from, to) => (NEXT[from] || []).includes(to);
