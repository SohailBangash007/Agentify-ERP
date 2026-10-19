// Construction Management: BOQ, estimates, change orders, procurement and stock, subcontract certificates, labour,
// progress, project figures, client portal, permissions and isolation between workspaces.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'erp-con-'));
Object.assign(process.env, { ERP_DATA_DIR: dir, ERP_UPLOAD_DIR: path.join(dir, 'uploads'), ERP_DB: path.join(dir, 'legacy.db'), ERP_PLATFORM_DB: path.join(dir, 'platform.db'),
  ERP_BASE_DOMAIN: 'erp.test', ERP_DEMO: '0', ADMIN_EMAIL: 'owner@legacy.test', ADMIN_PASSWORD: 'Legacy@12345', LOGIN_LIMIT: '1000', SIGNUP_LIMIT: '1000', ERP_MAIL_QUIET: '1',
  ERP_SECRETS_KEY: 'test-secrets-key-0123456789', BILLING_PROVIDER: 'manual' });
for (const k of ['ERP_PLATFORM_ADMIN_TOKEN', 'RESEND_API_KEY', 'PLATFORM_ADMIN_EMAIL', 'PLATFORM_ADMIN_PASSWORD']) delete process.env[k];

const { createApp } = await import('../src/index.js');
const { createTenant, getTenantBySlug, withTenant } = await import('../src/platform.js');
const db = await import('../src/db.js');
let server, port;
before(() => new Promise((res) => { server = createApp().listen(0, () => { port = server.address().port; res(); }); }));
after(async () => { server.close(); db.closeDbs(); });
const call = (host, method, url, body, headers = {}) => new Promise((resolve, reject) => {
  const data = body ? JSON.stringify(body) : null;
  const req = http.request({ host: '127.0.0.1', port, path: url, method, headers: { Host: host, 'Content-Type': 'application/json', 'X-Requested-With': 'ERP', ...headers, ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}) } }, (res) => {
    let t = ''; res.on('data', (c) => { t += c; });
    res.on('end', () => { let d; try { d = JSON.parse(t); } catch { d = t; } resolve({ status: res.statusCode, data: d, text: t, cookie: (res.headers['set-cookie'] || [])[0]?.split(';')[0] }); });
  });
  req.on('error', reject); if (data) req.write(data); req.end();
});
const login = async (slug, email, password = 'Secret@123', portal = false) => {
  const c = (await call(`${slug}.erp.test`, 'POST', '/api/auth/login', { identifier: email, password, portal })).cookie;
  assert.ok(c, `login ${email}`);
  return (m, u, b) => call(`${slug}.erp.test`, m, u, b, { cookie: c });
};
const ok = (r, code = 200) => { assert.equal(r.status, code, JSON.stringify(r.data)); return r.data; };

let api, project, site, site2, vendor, sub, boq;
test('setup: a construction workspace with a project, sites and a supplier', async () => {
  createTenant({ slug: 'buildco', name: 'BuildCo', adminName: 'Owner', adminEmail: 'o@buildco.test', adminPassword: 'Secret@123', product: 'construction' });
  api = await login('buildco', 'o@buildco.test');
  project = ok(await api('POST', '/api/projects', { code: 'H-12', name: 'House 12, Phase 2', kind: 'construction', is_development: 0 }), 201);
  site = ok(await api('POST', '/api/construction/sites', { project_id: project.id, name: 'Plot 12 site' }), 201);
  site2 = ok(await api('POST', '/api/construction/sites', { project_id: project.id, name: 'Yard' }), 201);
  vendor = ok(await api('POST', '/api/accounting/vendors', { name: 'Steel Traders', category: 'Supplier' }), 201);
  sub = ok(await api('POST', '/api/accounting/vendors', { name: 'Masonry Contractors', category: 'Contractor' }), 201);
});

test('estimate -> accepted -> BOQ, with markup spread into the rates', async () => {
  const e = ok(await api('POST', '/api/construction/estimates', { title: 'Grey structure', markup_pct: 10, lines: [{ category: 'Structure', description: 'Brick masonry', unit: 'cft', qty: 1000, rate: 100 }, { category: 'Structure', description: 'RCC slab', unit: 'sft', qty: 500, rate: 400 }] }), 201);
  assert.equal(e.subtotal, 300000); assert.equal(e.total, 330000);
  assert.equal((await api('POST', `/api/construction/estimates/${e.id}/convert`, { project_id: project.id })).status, 400, 'only accepted estimates convert');
  ok(await api('POST', `/api/construction/estimates/${e.id}/status`, { status: 'accepted' }));
  ok(await api('POST', `/api/construction/estimates/${e.id}/convert`, { project_id: project.id }));
  assert.equal((await api('POST', `/api/construction/estimates/${e.id}/convert`, { project_id: project.id })).status, 400, 'not twice');
  boq = ok(await api('GET', `/api/construction/projects/${project.id}/boq`));
  assert.equal(boq.length, 2); assert.equal(boq.reduce((s, b) => s + b.amount, 0), 330000);
  const imp = ok(await api('POST', `/api/construction/projects/${project.id}/boq/import`, { rows: [{ category: 'Finishing', description: 'Plaster', unit: 'sft', qty: 2000, rate: 50 }] }), 201);
  assert.equal(imp.imported, 1);
  assert.equal((await api('POST', `/api/construction/projects/${project.id}/boq/import`, { rows: [{ description: '', qty: 1, rate: 1 }] })).status, 400);
  boq = ok(await api('GET', `/api/construction/projects/${project.id}/boq`));
  const csv = await api('GET', `/api/construction/projects/${project.id}/boq?format=csv`);
  assert.match(csv.text, /Brick masonry/);
});

test('change orders: only approved ones change the budget; approval needs approve rights', async () => {
  const co = ok(await api('POST', '/api/construction/change-orders', { project_id: project.id, title: 'Extra room', amount: 120000, days_impact: 10 }), 201);
  let f = ok(await api('GET', `/api/construction/projects/${project.id}/summary`)).figures;
  assert.equal(f.budget, 430000); assert.equal(f.change_orders_pending, 120000);
  ok(await api('POST', `/api/construction/change-orders/${co.id}/submit`));
  assert.equal((await api('POST', `/api/construction/change-orders/${co.id}/reject`, {})).status, 400, 'a reason is needed to reject');
  ok(await api('POST', `/api/construction/change-orders/${co.id}/approve`));
  f = ok(await api('GET', `/api/construction/projects/${project.id}/summary`)).figures;
  assert.equal(f.budget, 550000); assert.equal(f.schedule_days_added, 10);
});

let po, cement;
test('procurement: PO -> approve -> receive into site stock -> bill creates a voucher for approval', async () => {
  cement = ok(await api('POST', '/api/construction/materials', { code: 'CEM', name: 'Cement', unit: 'bag', reorder_level: 20 }), 201);
  po = ok(await api('POST', '/api/construction/purchase-orders', { project_id: project.id, site_id: site.id, vendor_id: vendor.id, lines: [{ material_id: cement.id, qty: 100, rate: 1500 }] }), 201);
  assert.equal(po.total, 150000);
  assert.equal((await api('POST', `/api/construction/purchase-orders/${po.id}/receive`, { lines: [{ line_id: po.lines[0].id, qty: 10 }] })).status, 400, 'draft cannot be received');
  ok(await api('POST', `/api/construction/purchase-orders/${po.id}/approve`));
  assert.equal(ok(await api('GET', `/api/construction/projects/${project.id}/summary`)).figures.committed, 150000);
  assert.equal((await api('POST', `/api/construction/purchase-orders/${po.id}/receive`, { lines: [{ line_id: po.lines[0].id, qty: 200 }] })).status, 400, 'no big over-receipt');
  po = ok(await api('POST', `/api/construction/purchase-orders/${po.id}/receive`, { lines: [{ line_id: po.lines[0].id, qty: 60 }] }));
  assert.equal(po.status, 'partially_received'); assert.equal(po.unbilled, 90000);
  const stock = ok(await api('GET', `/api/construction/stock?site_id=${site.id}`));
  assert.equal(stock[0].balance, 60);
  const bill = ok(await api('POST', `/api/construction/purchase-orders/${po.id}/bill`, {}), 201);
  const v = withTenant(getTenantBySlug('buildco'), () => db.get('SELECT * FROM expense_vouchers WHERE id=?', bill.voucher_id));
  assert.equal(v.amount, 90000); assert.equal(v.status, 'submitted'); assert.equal(v.project_id, project.id); assert.equal(v.vendor_id, vendor.id);
  assert.equal((await api('POST', `/api/construction/purchase-orders/${po.id}/bill`, {})).status, 400, 'nothing left to bill');
  assert.equal((await api('POST', `/api/construction/purchase-orders/${po.id}/cancel`)).status, 400, 'received goods: cannot cancel');
  // actual cost counts only after approval in accounting
  assert.equal(ok(await api('GET', `/api/construction/projects/${project.id}/summary`)).figures.actual_cost, 0);
  ok(await api('POST', `/api/accounting/expenses/${bill.voucher_id}/approve`));
  assert.equal(ok(await api('GET', `/api/construction/projects/${project.id}/summary`)).figures.actual_cost, 90000);
});

test('stock: issues and transfers never go below zero; adjustments need a reason', async () => {
  assert.equal((await api('POST', '/api/construction/stock/moves', { kind: 'issue', material_id: cement.id, site_id: site.id, qty: 61 })).status, 400);
  ok(await api('POST', '/api/construction/stock/moves', { kind: 'issue', material_id: cement.id, site_id: site.id, qty: 45, boq_item_id: boq[0].id }), 201);
  ok(await api('POST', '/api/construction/stock/moves', { kind: 'transfer', material_id: cement.id, site_id: site.id, to_site_id: site2.id, qty: 10 }), 201);
  assert.equal((await api('POST', '/api/construction/stock/moves', { kind: 'adjust_out', material_id: cement.id, site_id: site.id, qty: 1 })).status, 400);
  const s = Object.fromEntries(ok(await api('GET', `/api/construction/stock?project_id=${project.id}`)).map((x) => [x.site_name, x]));
  assert.equal(s['Plot 12 site'].balance, 5); assert.equal(s.Yard.balance, 10); assert.equal(s['Plot 12 site'].low, true);
});

test('subcontract certificates: cumulative valuation, retention, approval creates the voucher; retention release', async () => {
  const sc = ok(await api('POST', '/api/construction/subcontracts', { project_id: project.id, vendor_id: sub.id, title: 'Masonry works', value: 200000, retention_pct: 10 }), 201);
  assert.equal((await api('POST', `/api/construction/subcontracts/${sc.id}/certificates`, { percent: 25 })).status, 400, 'only active subcontracts');
  ok(await api('POST', `/api/construction/subcontracts/${sc.id}/status`, { status: 'active' }));
  let d = ok(await api('POST', `/api/construction/subcontracts/${sc.id}/certificates`, { percent: 25 }), 201);
  let c = d.certificates[0];
  assert.equal(c.this_period, 50000); assert.equal(c.retention_amount, 5000); assert.equal(c.net_payable, 45000);
  assert.equal((await api('POST', `/api/construction/subcontracts/${sc.id}/certificates`, { percent: 50 })).status, 400, 'approve the draft first');
  ok(await api('POST', `/api/construction/certificates/${c.id}/approve`));
  assert.equal((await api('POST', `/api/construction/subcontracts/${sc.id}/certificates`, { work_done_to_date: 40000 })).status, 400, 'cannot go backwards');
  d = ok(await api('POST', `/api/construction/subcontracts/${sc.id}/certificates`, { work_done_to_date: 200000, deductions: 1000 }), 201);
  c = d.certificates[1];
  assert.equal(c.this_period, 150000); assert.equal(c.retention_amount, 15000); assert.equal(c.net_payable, 134000);
  ok(await api('POST', `/api/construction/certificates/${c.id}/approve`));
  d = ok(await api('GET', `/api/construction/subcontracts/${sc.id}`));
  assert.equal(d.retention_held, 20000); assert.equal(d.remaining, 0);
  ok(await api('POST', `/api/construction/subcontracts/${sc.id}/status`, { status: 'completed' }));
  d = ok(await api('POST', `/api/construction/subcontracts/${sc.id}/certificates`, { kind: 'retention_release' }), 201);
  ok(await api('POST', `/api/construction/certificates/${d.certificates[2].id}/approve`));
  assert.equal(ok(await api('GET', `/api/construction/subcontracts/${sc.id}`)).retention_held, 0);
});

test('labour: recorded per day, posted once into one labour voucher', async () => {
  ok(await api('POST', '/api/construction/labour', { project_id: project.id, site_id: site.id, date: '2026-01-05', trade: 'Mason', workers: 4, days: 1, rate: 2500 }), 201);
  ok(await api('POST', '/api/construction/labour', { project_id: project.id, site_id: site.id, date: '2026-01-06', trade: 'Helper', workers: 6, days: 1, rate: 1500 }), 201);
  assert.equal((await api('POST', '/api/construction/labour', { project_id: project.id, trade: 'X', workers: 0, rate: 1 })).status, 400);
  const p = ok(await api('POST', `/api/construction/projects/${project.id}/labour/post`, { from: '2026-01-01', to: '2026-01-31' }), 201);
  assert.equal(p.amount, 19000); assert.equal(p.entries, 2);
  assert.equal((await api('POST', `/api/construction/projects/${project.id}/labour/post`, { from: '2026-01-01', to: '2026-01-31' })).status, 400, 'never posted twice');
  const logs = ok(await api('GET', `/api/construction/projects/${project.id}/labour`));
  assert.ok(logs.every((l) => l.voucher_no));
  assert.equal((await api('DELETE', `/api/construction/labour/${logs[0].id}`)).status, 400, 'posted entries are locked');
});

test('daily reports record measured progress; earned value and % complete follow; never beyond the BOQ', async () => {
  const masonry = boq.find((b) => b.description === 'Brick masonry');
  assert.equal((await api('POST', '/api/construction/reports', { project_id: project.id, work_done: 'Walls', progress: [{ boq_item_id: masonry.id, qty: 1001 }] })).status, 400);
  ok(await api('POST', '/api/construction/reports', { project_id: project.id, site_id: site.id, work_done: 'Ground floor walls', weather: 'Sunny', client_visible: true, progress: [{ boq_item_id: masonry.id, qty: 500 }] }), 201);
  const f = ok(await api('GET', `/api/construction/projects/${project.id}/summary`)).figures;
  assert.equal(f.earned_value, 55000); // 500 x rate 110
  assert.equal(f.percent_complete, Math.round((55000 / 430000) * 1000) / 10);
  assert.equal((await api('DELETE', `/api/construction/boq/${masonry.id}`)).status, 400, 'items with progress cannot be deleted');
});

test('client portal shows progress and visible reports, never costs', async () => {
  const t = getTenantBySlug('buildco');
  // a construction contract for a client with portal access
  const contact = ok(await api('POST', '/api/contacts', { full_name: 'Client Khan', phone: '03001112233', email: 'client@buildco.test' }), 201);
  const sale = await api('POST', '/api/sales', { kind: 'construction', title: 'House 12 construction', contact_id: contact.id, project_id: project.id, sale_price: 2000000, sale_date: '2026-01-01', num_installments: 4, first_due: '2026-02-01' });
  assert.equal(sale.status, 201, JSON.stringify(sale.data));
  const pa = await api('POST', `/api/customers/${contact.id}/portal-access`, { password: 'Client@12345' });
  assert.ok([200, 201].includes(pa.status), JSON.stringify(pa.data));
  const pwd = pa.data.password || 'Client@12345';
  const portal = await login('buildco', 'client@buildco.test', pwd, true);
  const p = ok(await portal('GET', '/api/portal/construction'));
  assert.equal(p.length, 1); assert.ok(p[0].percent_complete > 0); assert.equal(p[0].reports.length, 1);
  assert.equal(p[0].change_orders[0].title, 'Extra room');
  const text = JSON.stringify(p);
  for (const secret of ['Steel Traders', 'Masonry Contractors', 'budget', 'actual_cost', 'rate']) assert.ok(!text.includes(secret), `no ${secret}`);
  assert.equal((await portal('GET', `/api/construction/projects/${project.id}/summary`)).status, 403, 'portal users cannot reach the staff API');
  assert.ok(t);
});

test('permissions and product separation: sales staff cannot approve; real-estate workspaces cannot reach it; other workspaces cannot see ids', async () => {
  withTenant(getTenantBySlug('buildco'), () => {
    const rid = db.val("SELECT id FROM roles WHERE name='Sales Manager'");
    db.run('INSERT INTO users(name,email,password_hash,role_id,active,created_at) VALUES(?,?,?,?,1,datetime())', 'Sam', 'sm@buildco.test', db.get('SELECT password_hash FROM users WHERE email=?', 'o@buildco.test').password_hash, rid);
  });
  const sm = await login('buildco', 'sm@buildco.test');
  assert.equal((await sm('GET', `/api/construction/projects/${project.id}/summary`)).status, 200, 'view allowed');
  assert.equal((await sm('POST', '/api/construction/change-orders', { project_id: project.id, title: 'x', amount: 1 })).status, 403);
  createTenant({ slug: 'homes', name: 'Homes', adminName: 'O', adminEmail: 'o@homes.test', adminPassword: 'Secret@123', product: 'real_estate' });
  const re = await login('homes', 'o@homes.test');
  assert.equal((await re('GET', '/api/construction/overview')).status, 402);
  createTenant({ slug: 'otherbuild', name: 'Other', adminName: 'O', adminEmail: 'o@other.test', adminPassword: 'Secret@123', product: 'construction' });
  const other = await login('otherbuild', 'o@other.test');
  assert.equal((await other('GET', `/api/construction/projects/${project.id}/summary`)).status, 404, 'another workspace sees nothing');
  assert.equal((await other('GET', `/api/construction/purchase-orders/${po.id}`)).status, 404);
  assert.deepEqual(ok(await other('GET', '/api/construction/overview')).projects, []);
});
