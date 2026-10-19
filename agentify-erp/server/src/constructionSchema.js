// Construction Management product: tables in each workspace's own database (created on start-up, additive only).
// They build on the shared tables: projects (a construction project is a project of kind 'construction'), vendors
// (suppliers and subcontractors), contacts (clients), expense_vouchers (actual cost, through the normal approval and
// accounting flow), project_tasks (the schedule), documents (files and photos) and sales of kind 'construction'
// (client contracts with their payment schedule and receipts).
export const CONSTRUCTION_SCHEMA = `
CREATE TABLE IF NOT EXISTS con_sites(
  id INTEGER PRIMARY KEY, project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE, name TEXT NOT NULL, address TEXT,
  supervisor_id INTEGER REFERENCES users(id), status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','on_hold','closed')), start_date TEXT, notes TEXT,
  created_by INTEGER, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_con_sites_project ON con_sites(project_id);
CREATE TABLE IF NOT EXISTS con_phases(
  id INTEGER PRIMARY KEY, project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE, name TEXT NOT NULL, planned_start TEXT, planned_end TEXT,
  status TEXT NOT NULL DEFAULT 'planned' CHECK(status IN ('planned','in_progress','completed')), sort_order INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_con_phases_project ON con_phases(project_id);
CREATE TABLE IF NOT EXISTS con_milestones(
  id INTEGER PRIMARY KEY, project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE, phase_id INTEGER REFERENCES con_phases(id) ON DELETE SET NULL,
  name TEXT NOT NULL, due_date TEXT, achieved_at TEXT, installment_id INTEGER, client_visible INTEGER NOT NULL DEFAULT 1, notes TEXT, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_con_ms_project ON con_milestones(project_id);
CREATE TABLE IF NOT EXISTS con_boq_items(
  id INTEGER PRIMARY KEY, project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE, code TEXT, category TEXT NOT NULL DEFAULT 'General', description TEXT NOT NULL,
  unit TEXT NOT NULL DEFAULT 'nos', qty REAL NOT NULL CHECK(qty >= 0), rate INTEGER NOT NULL CHECK(rate >= 0), completed_qty REAL NOT NULL DEFAULT 0 CHECK(completed_qty >= 0),
  phase_id INTEGER REFERENCES con_phases(id) ON DELETE SET NULL, source_estimate_id INTEGER, sort_order INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT);
CREATE INDEX IF NOT EXISTS idx_con_boq_project ON con_boq_items(project_id);
CREATE TABLE IF NOT EXISTS con_estimates(
  id INTEGER PRIMARY KEY, estimate_no TEXT UNIQUE NOT NULL, title TEXT NOT NULL, contact_id INTEGER REFERENCES contacts(id), project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','sent','accepted','rejected')), valid_until TEXT, markup_pct REAL NOT NULL DEFAULT 0 CHECK(markup_pct >= 0 AND markup_pct <= 500),
  notes TEXT, created_by INTEGER, created_at TEXT NOT NULL, decided_at TEXT, converted_at TEXT);
CREATE TABLE IF NOT EXISTS con_estimate_lines(
  id INTEGER PRIMARY KEY, estimate_id INTEGER NOT NULL REFERENCES con_estimates(id) ON DELETE CASCADE, category TEXT NOT NULL DEFAULT 'General', description TEXT NOT NULL,
  unit TEXT NOT NULL DEFAULT 'nos', qty REAL NOT NULL CHECK(qty >= 0), rate INTEGER NOT NULL CHECK(rate >= 0), sort_order INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS con_change_orders(
  id INTEGER PRIMARY KEY, co_no TEXT UNIQUE NOT NULL, project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE, title TEXT NOT NULL, description TEXT,
  amount INTEGER NOT NULL, days_impact INTEGER NOT NULL DEFAULT 0, origin TEXT NOT NULL DEFAULT 'client' CHECK(origin IN ('client','internal','site')),
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','submitted','approved','rejected')), client_visible INTEGER NOT NULL DEFAULT 1,
  decided_by INTEGER, decided_at TEXT, decision_note TEXT, created_by INTEGER, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_con_co_project ON con_change_orders(project_id);
CREATE TABLE IF NOT EXISTS con_materials(
  id INTEGER PRIMARY KEY, code TEXT UNIQUE, name TEXT NOT NULL, unit TEXT NOT NULL DEFAULT 'nos', category TEXT, reorder_level REAL, active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS con_purchase_orders(
  id INTEGER PRIMARY KEY, po_no TEXT UNIQUE NOT NULL, project_id INTEGER NOT NULL REFERENCES projects(id), site_id INTEGER REFERENCES con_sites(id), vendor_id INTEGER NOT NULL REFERENCES vendors(id),
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','approved','partially_received','received','closed','cancelled')),
  order_date TEXT NOT NULL, expected_date TEXT, notes TEXT, total INTEGER NOT NULL DEFAULT 0, billed INTEGER NOT NULL DEFAULT 0,
  approved_by INTEGER, approved_at TEXT, created_by INTEGER, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_con_po_project ON con_purchase_orders(project_id);
CREATE TABLE IF NOT EXISTS con_po_lines(
  id INTEGER PRIMARY KEY, po_id INTEGER NOT NULL REFERENCES con_purchase_orders(id) ON DELETE CASCADE, material_id INTEGER REFERENCES con_materials(id), description TEXT NOT NULL,
  unit TEXT NOT NULL DEFAULT 'nos', qty REAL NOT NULL CHECK(qty > 0), rate INTEGER NOT NULL CHECK(rate >= 0), received_qty REAL NOT NULL DEFAULT 0, boq_item_id INTEGER REFERENCES con_boq_items(id) ON DELETE SET NULL);
CREATE TABLE IF NOT EXISTS con_po_bills(id INTEGER PRIMARY KEY, po_id INTEGER NOT NULL REFERENCES con_purchase_orders(id), voucher_id INTEGER NOT NULL REFERENCES expense_vouchers(id), amount INTEGER NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS con_stock_moves(
  id INTEGER PRIMARY KEY, material_id INTEGER NOT NULL REFERENCES con_materials(id), site_id INTEGER NOT NULL REFERENCES con_sites(id), project_id INTEGER NOT NULL REFERENCES projects(id),
  kind TEXT NOT NULL CHECK(kind IN ('receive','issue','transfer_in','transfer_out','adjust_in','adjust_out','return')), qty REAL NOT NULL CHECK(qty > 0), unit_cost INTEGER NOT NULL DEFAULT 0,
  ref_type TEXT, ref_id INTEGER, boq_item_id INTEGER REFERENCES con_boq_items(id) ON DELETE SET NULL, note TEXT, date TEXT NOT NULL, created_by INTEGER, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_con_stock ON con_stock_moves(site_id, material_id);
CREATE TABLE IF NOT EXISTS con_subcontracts(
  id INTEGER PRIMARY KEY, sc_no TEXT UNIQUE NOT NULL, project_id INTEGER NOT NULL REFERENCES projects(id), vendor_id INTEGER NOT NULL REFERENCES vendors(id), title TEXT NOT NULL, scope TEXT,
  value INTEGER NOT NULL CHECK(value > 0), retention_pct REAL NOT NULL DEFAULT 0 CHECK(retention_pct >= 0 AND retention_pct <= 20), status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','active','completed','terminated')),
  start_date TEXT, end_date TEXT, created_by INTEGER, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_con_sc_project ON con_subcontracts(project_id);
CREATE TABLE IF NOT EXISTS con_certificates(
  id INTEGER PRIMARY KEY, ipc_no TEXT UNIQUE NOT NULL, subcontract_id INTEGER NOT NULL REFERENCES con_subcontracts(id), project_id INTEGER NOT NULL REFERENCES projects(id),
  period_to TEXT NOT NULL, work_done_to_date INTEGER NOT NULL CHECK(work_done_to_date >= 0), previous_certified INTEGER NOT NULL, this_period INTEGER NOT NULL,
  retention_amount INTEGER NOT NULL, deductions INTEGER NOT NULL DEFAULT 0, net_payable INTEGER NOT NULL, kind TEXT NOT NULL DEFAULT 'progress' CHECK(kind IN ('progress','retention_release')),
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','approved','cancelled')), voucher_id INTEGER REFERENCES expense_vouchers(id), notes TEXT,
  approved_by INTEGER, approved_at TEXT, created_by INTEGER, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_con_ipc_sc ON con_certificates(subcontract_id);
CREATE TABLE IF NOT EXISTS con_labour_logs(
  id INTEGER PRIMARY KEY, project_id INTEGER NOT NULL REFERENCES projects(id), site_id INTEGER REFERENCES con_sites(id), date TEXT NOT NULL, trade TEXT NOT NULL,
  vendor_id INTEGER REFERENCES vendors(id), workers INTEGER NOT NULL CHECK(workers > 0), days REAL NOT NULL DEFAULT 1 CHECK(days > 0), rate INTEGER NOT NULL CHECK(rate >= 0), amount INTEGER NOT NULL,
  boq_item_id INTEGER REFERENCES con_boq_items(id) ON DELETE SET NULL, notes TEXT, voucher_id INTEGER REFERENCES expense_vouchers(id), created_by INTEGER, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_con_labour ON con_labour_logs(project_id, date);
CREATE TABLE IF NOT EXISTS con_daily_reports(
  id INTEGER PRIMARY KEY, project_id INTEGER NOT NULL REFERENCES projects(id), site_id INTEGER REFERENCES con_sites(id), date TEXT NOT NULL, weather TEXT, workers_on_site INTEGER,
  work_done TEXT NOT NULL, issues TEXT, safety TEXT, client_visible INTEGER NOT NULL DEFAULT 0, created_by INTEGER, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_con_reports ON con_daily_reports(project_id, date);
CREATE TABLE IF NOT EXISTS con_progress(
  id INTEGER PRIMARY KEY, report_id INTEGER REFERENCES con_daily_reports(id) ON DELETE CASCADE, boq_item_id INTEGER NOT NULL REFERENCES con_boq_items(id) ON DELETE CASCADE,
  qty REAL NOT NULL, note TEXT, date TEXT NOT NULL, created_by INTEGER, created_at TEXT NOT NULL);
`;
