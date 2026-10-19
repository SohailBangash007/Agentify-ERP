// Revenue formulas: MRR/ARR per currency, invoiced vs collected, refunds and net, recognised revenue, filters, permissions.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'erp-fin-'));
Object.assign(process.env, { ERP_DATA_DIR: dir, ERP_UPLOAD_DIR: path.join(dir, 'uploads'), ERP_DB: path.join(dir, 'legacy.db'), ERP_PLATFORM_DB: path.join(dir, 'platform.db'),
  ERP_BASE_DOMAIN: 'erp.test', ERP_DEMO: '0', ADMIN_EMAIL: 'owner@legacy.test', ADMIN_PASSWORD: 'Legacy@12345', LOGIN_LIMIT: '1000', SIGNUP_LIMIT: '1000', ERP_MAIL_QUIET: '1',
  ERP_SECRETS_KEY: 'test-secrets-key-0123456789', PLATFORM_ADMIN_EMAIL: 'root@agentify.test', PLATFORM_ADMIN_PASSWORD: 'Console@12345', BILLING_PROVIDER: 'manual' });
for (const k of ['ERP_PLATFORM_ADMIN_TOKEN', 'STRIPE_SECRET_KEY', 'RESEND_API_KEY']) delete process.env[k];

const { createApp } = await import('../src/index.js');
const { platformDb, createTenant } = await import('../src/platform.js');
const { finance, recognisedIn } = await import('../src/services/finance.js');
let server, port;
before(() => new Promise((res) => { server = createApp().listen(0, () => { port = server.address().port; res(); }); }));
after(async () => { server.close(); (await import('../src/db.js')).closeDbs(); });
const call = (method, url, body, headers = {}) => new Promise((resolve, reject) => {
  const data = body ? JSON.stringify(body) : null;
  const req = http.request({ host: '127.0.0.1', port, path: url, method, headers: { Host: 'erp.test', 'Content-Type': 'application/json', 'X-Requested-With': 'ERP', ...headers, ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}) } }, (res) => {
    let t = ''; res.on('data', (c) => { t += c; });
    res.on('end', () => { let d; try { d = JSON.parse(t); } catch { d = t; } resolve({ status: res.statusCode, data: d, cookie: (res.headers['set-cookie'] || [])[0]?.split(';')[0], headers: res.headers }); });
  });
  req.on('error', reject); if (data) req.write(data); req.end();
});

const pdb = () => platformDb();
const mk = (slug, product, fields) => {
  const t = createTenant({ slug, name: slug, adminName: 'O', adminEmail: `o@${slug}.test`, adminPassword: 'Secret@123', product });
  const keys = Object.keys(fields);
  if (!keys.length) return t.id;
  pdb().prepare(`UPDATE tenants SET ${keys.map((k) => `${k}=?`).join(',')} WHERE id=?`).run(...Object.values(fields), t.id);
  return t.id;
};
const day = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const ts = (n) => new Date(Date.now() + n * 864e5).toISOString().replace('T', ' ').slice(0, 19);

let ids;
test('MRR and ARR: per currency, yearly / 12, coupons respected, trials, cancelled and past-due excluded', () => {
  ids = {
    pkrMonth: mk('fin-a', 'real_estate', { plan: 'growth', subscription_status: 'active', billing_interval: 'month', price_amount: 20000, price_currency: 'PKR', current_period_end: day(20) }),
    usdYear: mk('fin-b', 'construction', { plan: 'con_professional', subscription_status: 'active', billing_interval: 'year', price_amount: 1200, price_currency: 'USD', current_period_end: day(200) }),
    trial: mk('fin-c', 'construction', {}),
    pastDue: mk('fin-d', 'real_estate', { plan: 'starter', subscription_status: 'past_due', billing_interval: 'month', price_amount: 8000, price_currency: 'PKR', grace_until: day(3) }),
    canceled: mk('fin-e', 'real_estate', { plan: 'starter', subscription_status: 'canceled', billing_interval: 'month', price_amount: 8000, price_currency: 'PKR', current_period_end: day(10) }),
  };
  const f = finance({ range: '30d' });
  assert.deepEqual(f.money.mrr, { PKR: 20000, USD: 100 }, 'never adds PKR and USD together');
  assert.deepEqual(f.money.arr, { PKR: 240000, USD: 1200 });
  assert.deepEqual(f.money.mrr_at_risk, { PKR: 8000 });
  assert.equal(f.counts.trialing, 1); assert.equal(f.counts.active, 2); assert.equal(f.counts.past_due, 1); assert.equal(f.counts.canceled, 1);
  // filters
  assert.deepEqual(finance({ range: '30d', product: 'construction' }).money.mrr, { USD: 100 });
  assert.deepEqual(finance({ range: '30d', currency: 'PKR' }).money.mrr, { PKR: 20000 });
  assert.deepEqual(finance({ range: '30d', plan: 'growth' }).money.mrr, { PKR: 20000 });
  const prod = Object.fromEntries(finance({ range: '30d' }).by_product.map((p) => [p.product, p]));
  assert.equal(prod.construction.trialing, 1); assert.equal(prod.construction.paying, 1); assert.equal(prod.real_estate.paying, 1);
});

test('invoiced vs collected, setup fees, refunds and net collections', () => {
  const ins = pdb().prepare('INSERT INTO invoices(tenant_id,provider_invoice_id,amount,currency,status,period_start,period_end,one_time_amount,created_at) VALUES(?,?,?,?,?,?,?,?,?)');
  ins.run(ids.pkrMonth, 'f1', 25000, 'PKR', 'paid', day(-10), day(20), 5000, ts(-10)); // includes a 5000 setup fee
  ins.run(ids.pkrMonth, 'f2', 20000, 'PKR', 'open', day(20), day(50), 0, ts(-1));     // raised, not paid
  ins.run(ids.usdYear, 'f3', 1200, 'USD', 'paid', day(-5), day(360), 0, ts(-5));
  pdb().prepare("INSERT INTO refunds(tenant_id,invoice_id,amount,currency,reason,provider,created_at) VALUES(?,(SELECT id FROM invoices WHERE provider_invoice_id='f1'),?,?,?,?,?)").run(ids.pkrMonth, 3000, 'PKR', 'goodwill', 'manual', ts(-2));
  pdb().prepare("INSERT INTO payment_submissions(tenant_id,plan,interval,method,amount,currency,reference,status) VALUES(?,?,?,?,?,?,?,?)").run(ids.trial, 'con_starter', 'month', 'bank', 8000, 'PKR', 'PENDING-REF-1', 'pending');
  const f = finance({ range: '30d' });
  assert.deepEqual(f.money.invoiced, { PKR: 45000, USD: 1200 });
  assert.deepEqual(f.money.collected, { PKR: 25000, USD: 1200 });
  assert.deepEqual(f.money.setup_fees, { PKR: 5000 });
  assert.deepEqual(f.money.refunds, { PKR: 3000 });
  assert.deepEqual(f.money.net_collections, { PKR: 22000, USD: 1200 });
  assert.deepEqual(f.money.outstanding, { PKR: 8000 + 8000 }, 'pending submission + past-due monthly value');
});

test('recognised revenue spreads an invoice over its service period; setup fees on the payment date', () => {
  const inv = { amount: 3500, one_time_amount: 500, created_at: '2026-01-01 10:00:00', period_start: '2026-01-01', period_end: '2026-01-31' }; // 30 service days, 100/day
  assert.equal(recognisedIn(inv, '2026-01-01', '2026-01-10'), 500 + 1000);
  assert.equal(recognisedIn(inv, '2026-01-11', '2026-01-31'), 2000);
  assert.equal(recognisedIn(inv, '2026-02-01', '2026-02-28'), 0);
  assert.equal(recognisedIn(inv, '2025-12-01', '2026-03-01'), 3500, 'the whole invoice over a range covering it');
});

test('console: finance figures need finance.view; support staff see no money on the dashboard; export is audited', async () => {
  const root = (await call('POST', '/api/platform/admin/login', { email: 'root@agentify.test', password: 'Console@12345' })).cookie;
  const as = (c, m, u, b) => call(m, `/api/platform/admin${u}`, b, { cookie: c });
  assert.equal((await as(root, 'POST', '/admins', { email: 'sup@agentify.test', name: 'Sup', role: 'support_manager', password: 'Support@12345' })).status, 201);
  const sup = (await call('POST', '/api/platform/admin/login', { email: 'sup@agentify.test', password: 'Support@12345' })).cookie;
  assert.equal((await as(sup, 'GET', '/finance')).status, 403);
  const d = (await as(sup, 'GET', '/dashboard?range=30d')).data;
  assert.equal(d.kpis.mrr.hidden, true); assert.deepEqual(d.charts.revenue, []);
  const f = await as(root, 'GET', '/finance?range=30d&product=real_estate');
  assert.equal(f.status, 200); assert.deepEqual(f.data.money.mrr, { PKR: 20000 }); assert.ok(f.data.definitions.mrr);
  const csv = await as(root, 'GET', '/finance/export?range=30d&format=csv');
  assert.equal(csv.status, 200); assert.match(String(csv.data), /net_collections/);
  assert.ok(pdb().prepare("SELECT 1 FROM platform_audit WHERE action='report-exported' AND detail LIKE '%revenue-summary%'").get());
});
