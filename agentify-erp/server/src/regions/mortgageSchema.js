// Tenant-database tables for the mortgage module (see mortgage.js).
export const MORTGAGE_SCHEMA = `
CREATE TABLE IF NOT EXISTS lenders(
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'bank', contact_name TEXT, phone TEXT, email TEXT, notes TEXT,
  active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS mortgage_profiles(
  contact_id INTEGER PRIMARY KEY, gross_monthly_income INTEGER, monthly_debts INTEGER, down_payment INTEGER, employment TEXT, credit_band TEXT,
  first_time_buyer INTEGER NOT NULL DEFAULT 0, notes TEXT, updated_by INTEGER, updated_at TEXT);
CREATE TABLE IF NOT EXISTS mortgage_applications(
  id INTEGER PRIMARY KEY, contact_id INTEGER NOT NULL, property_id INTEGER, sale_id INTEGER, lender_id INTEGER, loan_type TEXT,
  price INTEGER NOT NULL, down_payment INTEGER NOT NULL DEFAULT 0, amount INTEGER NOT NULL, term_months INTEGER NOT NULL, rate_bp INTEGER NOT NULL,
  stage TEXT NOT NULL DEFAULT 'enquiry', referral_fee_type TEXT, referral_fee_value INTEGER, referral_fee_status TEXT NOT NULL DEFAULT 'none',
  referral_fee_disclosed INTEGER NOT NULL DEFAULT 0, notes TEXT, created_by INTEGER, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT);
CREATE INDEX IF NOT EXISTS idx_mortgage_contact ON mortgage_applications(contact_id);
`;
