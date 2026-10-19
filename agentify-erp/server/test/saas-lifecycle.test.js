// Product families, 7-day trials, trial controls, the lifecycle job, plan limits, quotes (setup fee, add-ons, coupons) and refunds.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'erp-life-'));
Object.assign(process.env, { ERP_DATA_DIR: dir, ERP_UPLOAD_DIR: path.join(dir, 'uploads'), ERP_DB: path.join(dir, 'legacy.db'), ERP_PLATFORM_DB: path.join(dir, 'platform.db'),
  ERP_BASE_DOMAIN: 'erp.test', ERP_DEMO: '0', ADMIN_EMAIL: 'owner@legacy.test', ADMIN_PASSWORD: 'Legacy@12345', LOGIN_LIMIT: '1000', SIGNUP_LIMIT: '1000', ERP_MAIL_QUIET: '1',
  ERP_PLATFORM_ADMIN_TOKEN: 'operator-secret', BILLING_WEBHOOK_SECRET: 'whsec_test', BILLING_PROVIDER: 'manual', ERP_SECRETS_KEY: 'test-secrets-key-0123456789',
  PLATFORM_ADMIN_EMAIL: 'root@agentify.test', PLATFORM_ADMIN_PASSWORD: 'Console@12345' });
for (const k of ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'BILLING_PK_ACCOUNTS', 'RESEND_API_KEY']) delete process.env[k];

const { createApp } = await import('../src/index.js');
const { platformDb } = await import('../src/platform.js');
const { outbox } = await import('../src/services/mailer.js');
const { runLifecycle } = await import('../src/services/lifecycle.js');
let server, port;
before(() => new Promise((res) => { server = createApp().listen(0, () => { port = server.address().port; res(); }); }));
after(async () => { server.close(); (await import('../src/db.js')).closeDbs(); });

const call = (host, method, url, body, headers = {}, raw) => new Promise((resolve, reject) => {
  const data = raw ?? (body ? JSON.stringify(body) : null);
  const req = http.request({ host: '127.0.0.1', port, path: url, method, headers: { Host: host, 'Content-Type': 'application/json', 'X-Requested-With': 'ERP', ...headers, ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}) } }, (res) => {
    let t = ''; res.on('data', (c) => { t += c; });
    res.on('end', () => { let d; try { d = JSON.parse(t); } catch { d = t; } resolve({ status: res.statusCode, data: d, cookie: (res.headers['set-cookie'] || [])[0]?.split(';')[0] }); });
  });
  req.on('error', reject); if (data) req.write(data); req.end();
});
const PW = 'Tenant@12345';
const OP = { authorization: 'Bearer operator-secret' };
const op = (method, url, body) => call('erp.test', method, `/api/platform/admin${url}`, body, OP);
const row = (slug) => platformDb().prepare('SELECT * FROM tenants WHERE slug=?').get(slug);
const patch = (slug, fields) => platformDb().prepare(`UPDATE tenants SET ${Object.keys(fields).map((k) => `${k}=?`).join(',')} WHERE slug=?`).run(...Object.values(fields), slug);
const iso = (days) => new Date(Date.now() + days * 864e5).toISOString();
const date = (days) => iso(days).slice(0, 10);
const webhook = (ev) => { const raw = JSON.stringify(ev); return call('erp.test', 'POST', '/api/platform/billing/webhook/generic', null, { 'X-Signature': `sha256=${crypto.createHmac('sha256', 'whsec_test').update(raw).digest('hex')}` }, raw); };

async function signup(slug, product, email = `owner@${slug}.test`) {
  const r = await call('erp.test', 'POST', '/api/platform/signup', { accept_terms: true, slug, company_name: `${slug} Co`, admin_name: 'Owner', admin_email: email, admin_password: PW, product });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const host = `${slug}.erp.test`;
  const tok = outbox.filter((m) => m.to === email).pop().text.match(/verify-email\/(\S+)/)[1];
  assert.equal((await call(host, 'POST', '/api/auth/verify-email', { token: tok })).status, 200);
  const c = (await call(host, 'POST', '/api/auth/login', { identifier: email, password: PW })).cookie;
  return { host, id: r.data.tenant.id, tenant: r.data.tenant, get: (u) => call(host, 'GET', u, null, { cookie: c }), post: (u, b) => call(host, 'POST', u, b || {}, { cookie: c }) };
}

let re, con;
test('signup: the customer picks a product and gets a 7-day trial stored as UTC timestamps', async () => {
  con = await signup('buildco', 'construction');
  re = await signup('homesco', 'real_estate');
  const t = row('buildco');
  assert.equal(t.product, 'construction'); assert.equal(t.subscription_status, 'trialing');
  assert.match(t.trial_started_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  const hours = (Date.parse(t.trial_ends_at) - Date.parse(t.trial_started_at)) / 3600e3;
  assert.equal(hours, 7 * 24, 'exactly seven days');
  const st = (await con.get('/api/billing/status')).data;
  assert.deepEqual(st.products, ['construction']); assert.equal(st.status, 'trialing'); assert.ok(st.days_left === 7);
  const plans = (await con.get('/api/billing')).data.plans;
  assert.ok(plans.length >= 3 && plans.every((p) => p.product === 'construction' || p.product === 'bundle'), 'only plans of its own product are offered');
  assert.equal((await call('erp.test', 'POST', '/api/platform/signup', { accept_terms: true, slug: 'badprod', company_name: 'X', admin_email: 'x@x.test', admin_password: PW, product: 'farming' })).status, 400);
});

test('product separation is enforced by the API, not only the menu', async () => {
  const p = await con.get('/api/properties');
  assert.equal(p.status, 402); assert.equal(p.data.code, 'product_not_in_plan'); assert.equal(p.data.product, 'real_estate');
  assert.equal((await con.post('/api/properties', { title: 'Sneaky' })).status, 402, 'writes are refused too');
  const c = await re.get('/api/construction/boq');
  assert.equal(c.status, 402); assert.equal(c.data.code, 'product_not_in_plan');
  assert.notEqual((await re.get('/api/properties')).status, 402);
  // shared modules work for both
  assert.equal((await con.get('/api/contacts')).status, 200);
  // a super admin can add the other product to one workspace (entitlement override)
  assert.equal((await op('PUT', `/workspaces/${re.id}/entitlements`, { products: ['real_estate', 'construction'], reason: 'Pilot' })).status, 200);
  assert.notEqual((await re.get('/api/construction/boq')).status, 402);
  await op('PUT', `/workspaces/${re.id}/entitlements`, { clear: true, reason: 'Pilot over' });
});

test('one free trial per owner email: a second workspace starts pending and read-only', async () => {
  const again = await signup('homesco2', 'real_estate', 'owner@homesco.test');
  const t = row('homesco2');
  assert.equal(t.subscription_status, 'pending'); assert.equal(t.trial_ends_at, null); assert.match(t.trial_note, /already used/);
  const w = await again.post('/api/contacts', { full_name: 'Lead', phone: '03001234004' });
  assert.equal(w.status, 402); assert.equal(w.data.reason, 'payment_pending');
  assert.equal((await again.get('/api/contacts')).status, 200, 'reads still work');
});

test('trial controls: only trials.manage roles, a reason every time, history and audit written', async () => {
  const body = { action: 'extend', days: 5 };
  assert.equal((await op('POST', `/workspaces/${re.id}/trial`, body)).status, 400, 'reason required');
  const before = Date.parse(row('homesco').trial_ends_at);
  const ext = await op('POST', `/workspaces/${re.id}/trial`, { ...body, reason: 'Needs time to import data' });
  assert.equal(ext.status, 200, JSON.stringify(ext.data));
  assert.equal(Date.parse(row('homesco').trial_ends_at) - before, 5 * 864e5);
  assert.equal((await op('POST', `/workspaces/${re.id}/trial`, { action: 'shorten', days: 3, reason: 'Agreed shorter pilot' })).status, 200);
  assert.equal(Date.parse(row('homesco').trial_ends_at) - before, 2 * 864e5);
  // a console user without trials.manage cannot touch trials
  const root = (await call('erp.test', 'POST', '/api/platform/admin/login', { email: 'root@agentify.test', password: 'Console@12345' })).cookie;
  assert.equal((await call('erp.test', 'POST', '/api/platform/admin/admins', { email: 'ro@agentify.test', name: 'RO', role: 'read_only', password: 'Role@123456' }, { cookie: root })).status, 201);
  const ro = (await call('erp.test', 'POST', '/api/platform/admin/login', { email: 'ro@agentify.test', password: 'Role@123456' })).cookie;
  assert.equal((await call('erp.test', 'POST', `/api/platform/admin/workspaces/${re.id}/trial`, { action: 'extend', days: 30, reason: 'please' }, { cookie: ro })).status, 403);
  // a workspace admin cannot reach the console API from their workspace address at all
  assert.equal((await re.post(`/api/platform/admin/workspaces/${re.id}/trial`, { action: 'extend', days: 30, reason: 'self-service' })).status, 404);
  const hist = platformDb().prepare('SELECT * FROM subscription_history WHERE tenant_id=? ORDER BY id').all(re.id);
  assert.ok(hist.some((h) => /Trial extend: Needs time/.test(h.reason)) && hist.some((h) => /Trial shorten/.test(h.reason)));
  assert.ok(platformDb().prepare("SELECT 1 FROM platform_audit WHERE action='trial-shorten'").get());
  // grant a trial to the pending workspace
  const g = await op('POST', `/workspaces/${row('homesco2').id}/trial`, { action: 'grant', days: 7, reason: 'Second branch of an existing customer' });
  assert.equal(g.status, 200); assert.equal(row('homesco2').subscription_status, 'trialing');
});

test('lifecycle job: reminders once, expiry without anyone signing in, writes blocked, data kept', async () => {
  patch('homesco', { trial_ends_at: iso(2.5) });
  const sent = outbox.length;
  const r1 = await runLifecycle();
  assert.equal(r1.trial_reminders >= 1, true);
  const mine = outbox.slice(sent).filter((m) => m.to === 'owner@homesco.test');
  assert.equal(mine.length, 1); assert.match(mine[0].subject, /3 days left|2 days left/);
  await runLifecycle();
  assert.equal(outbox.slice(sent).filter((m) => m.to === 'owner@homesco.test').length, 1, 'never sent twice');
  // extending the trial re-arms the reminders for the new date
  await op('POST', `/workspaces/${re.id}/trial`, { action: 'extend', days: 10, reason: 'Sales call' });
  patch('homesco', { trial_ends_at: iso(-0.01) });
  const r2 = await runLifecycle();
  assert.ok(r2.expired_trials >= 1);
  const t = row('homesco');
  assert.equal(t.subscription_status, 'expired');
  assert.ok(platformDb().prepare("SELECT 1 FROM subscription_history WHERE tenant_id=? AND source='system' AND to_status='expired'").get(t.id));
  const w = await re.post('/api/contacts', { full_name: 'After expiry', phone: '03001234012' });
  assert.equal(w.status, 402); assert.equal(w.data.code, 'billing_locked'); assert.equal(w.data.reason, 'trial_ended');
  assert.equal((await re.get('/api/contacts')).status, 200, 'data still readable');
  // the browser cannot change its own status: there is no tenant endpoint for it and the platform API is closed to workspaces
  assert.equal((await re.post('/api/billing/status', { status: 'active' })).status, 404);
});

test('plan limits on the server: properties, storage and API access', async () => {
  const w = await signup('limits', 'real_estate');
  assert.equal((await op('PUT', `/workspaces/${w.id}/entitlements`, { properties: 1, api_access: false, reason: 'Limit test' })).status, 200);
  assert.equal((await w.post('/api/properties', { title: 'First plot' })).status, 201);
  const second = await w.post('/api/properties', { title: 'Second plot' });
  assert.equal(second.status, 402); assert.equal(second.data.code, 'property_limit');
  const api = await call(w.host, 'GET', '/api/public/properties', null, { 'X-API-Key': 'whatever' });
  assert.equal(api.status, 402); assert.equal(api.data.code, 'api_not_in_plan');
  assert.equal((await op('PUT', `/workspaces/${w.id}/entitlements`, { storage_mb: 1, reason: 'Storage test' })).status, 200);
  const upDir = path.join(dir, 'uploads', 'tenants', 'limits');
  fs.mkdirSync(upDir, { recursive: true });
  fs.writeFileSync(path.join(upDir, 'big.bin'), Buffer.alloc(1100 * 1024));
  (await import('../src/services/plans.js')).forgetStorage(upDir);
  const boundary = 'X';
  const raw = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="a.txt"\r\nContent-Type: text/plain\r\n\r\nhi\r\n--${boundary}--\r\n`;
  const cookie = (await call(w.host, 'POST', '/api/auth/login', { identifier: 'owner@limits.test', password: PW })).cookie;
  const up = await call(w.host, 'POST', '/api/documents', null, { cookie, 'Content-Type': `multipart/form-data; boundary=${boundary}` }, raw);
  assert.equal(up.status, 402); assert.equal(up.data.code, 'storage_limit');
});

test('quotes: setup fee on the first payment, add-ons, coupons; amounts computed on the server', async () => {
  assert.equal((await op('PUT', '/plans/con_professional', { setup_fee: { PKR: 5000 } })).status, 200);
  const addon = await op('PUT', '/addons/extra_users', { name: '5 extra users', product: 'any', price: { PKR: { month: 2000, year: 20000 } }, entitlements: { seats: 5 } });
  assert.equal(addon.status, 200, JSON.stringify(addon.data));
  assert.equal((await op('PUT', '/coupons/launch20', { percent_off: 20, products: ['construction'], max_redemptions: 1 })).status, 200);
  assert.equal((await op('PUT', '/coupons/BAD', { percent_off: 150 })).status, 400);
  const q = (await con.post('/api/billing/quote', { plan: 'con_professional', interval: 'month', coupon: 'LAUNCH20', addons: [{ id: 'extra_users', quantity: 2 }] })).data;
  // 22000 plan + 4000 add-ons = 26000 recurring; 20% off recurring = 5200; + 5000 setup fee
  assert.equal(q.list_amount, 26000); assert.equal(q.discount, 5200); assert.equal(q.setup_fee, 5000); assert.equal(q.total, 25800);
  assert.equal((await re.post('/api/billing/quote', { plan: 'con_professional', interval: 'month' })).status, 400, 'another product family');
  assert.equal((await re.post('/api/billing/quote', { plan: 'growth', interval: 'month', coupon: 'LAUNCH20' })).status, 400, 'coupon limited to construction');
  // pay by bank transfer: the submitted amount is the quote, whatever the browser says
  assert.equal((await op('POST', '/payment-accounts', { method: 'bank', account: 'PK00TEST0000000000000001', account_name: 'Agentify' })).status, 201);
  const sub = await con.post('/api/billing/manual-payment', { plan: 'con_professional', interval: 'month', method: 'bank', reference: 'TRX-1001-ABC', coupon: 'LAUNCH20', addons: [{ id: 'extra_users', quantity: 2 }], amount: 1 });
  assert.equal(sub.status, 201, JSON.stringify(sub.data)); assert.equal(sub.data.amount, 25800);
  assert.equal((await call('erp.test', 'POST', `/api/platform/payments/${sub.data.id}/approve`, { note: 'Received' }, OP)).status, 200);
  const t = row('buildco');
  assert.equal(t.subscription_status, 'active'); assert.equal(t.plan, 'con_professional');
  assert.equal(t.price_amount, 20800, 'recurring price excludes the setup fee and includes the coupon');
  const inv = platformDb().prepare('SELECT * FROM invoices WHERE tenant_id=?').get(t.id);
  assert.equal(inv.amount, 25800);
  const lim = (await con.get('/api/billing/status')).data.limits;
  assert.equal(lim.seats, 25 + 10, 'add-on seats added to the plan');
  assert.deepEqual((await con.get('/api/billing/status')).data.products, ['construction']);
  // coupon used up; setup fee not charged again
  const q2 = await con.post('/api/billing/quote', { plan: 'con_professional', interval: 'month', coupon: 'LAUNCH20' });
  assert.equal(q2.status, 400);
  assert.equal((await con.post('/api/billing/quote', { plan: 'con_professional', interval: 'month' })).data.setup_fee, 0);
});

test('refunds: recorded against the invoice, never more than was paid, provider refunds idempotent', async () => {
  const t = row('buildco');
  const inv = platformDb().prepare('SELECT * FROM invoices WHERE tenant_id=?').get(t.id);
  assert.equal((await op('POST', `/workspaces/${t.id}/refunds`, { invoice_id: inv.id, amount: 1000 })).status, 400, 'reason and reference required');
  const r = await op('POST', `/workspaces/${t.id}/refunds`, { invoice_id: inv.id, amount: 5000, reason: 'Setup fee waived after the fact', reference: 'REF-REFUND-1' });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.equal((await op('POST', `/workspaces/${t.id}/refunds`, { invoice_id: inv.id, amount: 30000, reason: 'Too much', reference: 'REF-X' })).status, 400);
  assert.equal(platformDb().prepare('SELECT status FROM invoices WHERE id=?').get(inv.id).status, 'paid', 'the collected invoice stays as it was');
  // a refund made at the provider arrives by webhook, once
  platformDb().prepare("INSERT INTO invoices(tenant_id,provider_invoice_id,amount,currency,status) VALUES(?,?,?,?,?)").run(t.id, 'in_web_1', 3000, 'PKR', 'paid');
  const ev = { id: 'evt_refund_1', type: 'payment.refunded', tenant_id: t.id, refund: { id: 're_1', amount: 3000, invoice: 'in_web_1' } };
  assert.equal((await webhook(ev)).status, 200);
  assert.equal((await webhook({ ...ev, id: 'evt_refund_1b' })).status, 200);
  assert.equal(platformDb().prepare('SELECT COUNT(*) n FROM refunds WHERE tenant_id=?').get(t.id).n, 2);
});

test('manual renewals: period end -> past due with grace -> expired; a late payment restores access', async () => {
  patch('buildco', { current_period_end: date(-1), billing_provider: 'bank' });
  const r = await runLifecycle();
  assert.ok(r.renewals_due >= 1);
  let t = row('buildco');
  assert.equal(t.subscription_status, 'past_due'); assert.ok(t.grace_until >= date(5));
  assert.equal((await con.post('/api/contacts', { full_name: 'Still allowed in grace', phone: '03001234022' })).status, 201);
  patch('buildco', { grace_until: date(-1) });
  await runLifecycle();
  t = row('buildco');
  assert.equal(t.subscription_status, 'expired');
  assert.equal((await con.post('/api/contacts', { full_name: 'Blocked', phone: '03001234007' })).status, 402);
  assert.equal((await webhook({ id: 'evt_late_pay', type: 'invoice.paid', tenant_id: t.id, invoice: { id: 'in_late', amount: 22000, currency: 'PKR', status: 'paid', period_end: date(30) } })).status, 200);
  assert.equal(row('buildco').subscription_status, 'active');
  assert.equal((await con.post('/api/contacts', { full_name: 'Back in business', phone: '03001234016' })).status, 201);
});
