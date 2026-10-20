// Tenant-database tables for document templates and compliance checklists (see documents.js).
export const DOCUMENTS_SCHEMA = `
CREATE TABLE IF NOT EXISTS doc_templates(
  id INTEGER PRIMARY KEY, tkey TEXT NOT NULL, region TEXT NOT NULL, kind TEXT NOT NULL, name TEXT NOT NULL, language TEXT NOT NULL DEFAULT 'en',
  body TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1, active INTEGER NOT NULL DEFAULT 1, needs_legal_review INTEGER NOT NULL DEFAULT 1,
  source TEXT NOT NULL DEFAULT 'custom', created_by INTEGER, created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE INDEX IF NOT EXISTS idx_doc_templates_key ON doc_templates(tkey, version);
CREATE TABLE IF NOT EXISTS checklist_templates(
  ckey TEXT PRIMARY KEY, region TEXT NOT NULL, name TEXT NOT NULL, applies_to TEXT NOT NULL DEFAULT 'sale', items TEXT NOT NULL,
  needs_legal_review INTEGER NOT NULL DEFAULT 1, active INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS checklist_runs(
  id INTEGER PRIMARY KEY, ckey TEXT NOT NULL, entity TEXT NOT NULL, entity_id INTEGER NOT NULL, state TEXT NOT NULL DEFAULT '{}',
  completed_at TEXT, completed_by INTEGER, updated_at TEXT, UNIQUE(ckey, entity, entity_id));
`;
