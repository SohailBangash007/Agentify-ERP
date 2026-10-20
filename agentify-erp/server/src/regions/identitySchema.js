// Tenant-database table for encrypted identity numbers (see identity.js).
export const IDENTITY_SCHEMA = `
CREATE TABLE IF NOT EXISTS identity_documents(
  id INTEGER PRIMARY KEY, contact_id INTEGER NOT NULL, kind TEXT NOT NULL DEFAULT 'national_id', region TEXT NOT NULL,
  number_enc TEXT NOT NULL, last4 TEXT NOT NULL, created_by INTEGER, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT,
  UNIQUE(contact_id, kind));
`;
