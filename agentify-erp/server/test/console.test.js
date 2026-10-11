import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'erp-console-'));
Object.assign(process.env, { ERP_DATA_DIR: dir, ERP_UPLOAD_DIR: path.join(dir, 'uploads'), ERP_DB: path.join(dir, 'legacy.db'), ERP_PLATFORM_DB: path.join(dir, 'platform.db'),
  ERP_BASE_DOMAIN: 'erp.test', ERP_DEMO: '0', ADMIN_EMAIL: 'owner@legacy.test', ADMIN_PASSWORD: 'Legacy@12345', LOGIN_LIMIT: '1000', SIGNUP_LIMIT: '1000', ERP_MAIL_QUIET: '1',
  ERP_SECRETS_KEY: 'test-secrets-key-0123456789', PLATFORM_ADMIN_EMAIL: 'Admin@Agentify.test', PLATFORM_ADMIN_PASSWORD: 'Console@12345', BILLING_PROVIDER: 'manual' });
for (const k of ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'BILLING_PK_ACCOUNTS', 'ERP_PLATFORM_ADMIN_TOKEN']) delete process.env[k];

const { createApp } = await import('../src/index.js');
const stripe = await import('../src/services/stripe.js');
const { platformDb } = await import('../src/platform.js');
let server, port;
before(() => new Promise((res) => { server = createApp().listen(0, () => { port = server.address().port; res(); }); }));
after(async () => { server.close(); (await import('../src/db.js')).closeDbs(); });

const call = (host, method, url, body, headers = {}, raw) => new Promise((resolve, reject) => {
  const data = raw ?? (body ? JSON.stringify(body) : null);
  const req = http.request({ host: '127.0.0.1', port, path: url, method, headers: { Host: host, 'Content-Type': 'application/json', 'X-Requested-With': 'ERP', ...headers, ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}) } }, (res) => {
    let t = ''; res.on('data', (c) => { t += c; });
    res.on('end', () => { let d; try { d = JSON.parse(t); } catch { d = t; } resolve({ status: res.statusCode, data: d, text: t, cookie: (res.headers['set-cookie'] || [])[0]?.split(';')[0] }); });
  });
  req.on('error', reject); if (data) req.write(data); req.end();
});
const P = 'erp.test';
let cookie;
const adm = (method, url, body, extra = {}) => call(P, method, `/api/platform/admin${url}`, body, { cookie, ...extra });
const TEST_SK = 'sk_test_51AbCdEfGh1234', TEST_PK = 'pk_test_51AbCdEfGh5678', TEST_WH = 'whsec_testSecretValue123', LIVE_SK = 'sk_live_51ZyXwVuTs9876';

test('platform admin sign-in: only on the platform domain, with the right password, with the CSRF header', async () => {
  const body = { email: 'admin@agentify.test', password: 'Console@12345' };
  assert.equal((await call(P, 'POST', '/api/platform/admin/login', { ...body, password: 'wrong' })).status, 401);
  assert.equal((await call(P, 'POST', '/api/platform/admin/login', body, { 'X-Requested-With': 'x' })).status, 403, 'CSRF header required');
  assert.equal((await call('acme.erp.test', 'POST', '/api/platform/admin/login', body)).status, 404, 'not reachable from a workspace address');
  const ok = await call(P, 'POST', '/api/platform/admin/login', body);
  assert.equal(ok.status, 200, ok.text); cookie = ok.cookie; assert.ok(cookie);
  assert.equal((await adm('GET', '/me')).data.email, 'admin@agentify.test');
  assert.equal((await call(P, 'GET', '/api/platform/admin/settings/stripe')).status, 401, 'no cookie, no access');
  assert.equal((await call('acme.erp.test', 'GET', '/api/platform/admin/settings/stripe', null, { cookie })).status, 404, 'cookie is useless on a workspace host');
  assert.equal((await adm('PUT', '/settings/stripe', { mode: 'test' }, { 'X-Requested-With': 'x' })).status, 403, 'writes need the CSRF header');
});

test('Stripe keys: validated, stored encrypted, never returned in clear', async () => {
  const bad = async (b) => (await adm('PUT', '/settings/stripe', b)).status;
  assert.equal(await bad({ test: { secret_key: 'not-a-key' } }), 400);
  assert.equal(await bad({ test: { secret_key: LIVE_SK } }), 400, 'a live key cannot be saved in the test slot');
  assert.equal(await bad({ live: { publishable_key: TEST_PK } }), 400);
  assert.equal(await bad({ test: { webhook_secret: 'secret' } }), 400);
  assert.equal(await bad({ prices: { test: { growth_month: 'prod_123' } } }), 400, 'must be a price id, not a product id');
  assert.equal(await bad({ prices: { test: { platinum_month: 'price_1' } } }), 400);
  assert.equal(await bad({ mode: 'sandbox' }), 400);
  const saved = await adm('PUT', '/settings/stripe', { mode: 'test', test: { secret_key: TEST_SK, publishable_key: TEST_PK, webhook_secret: TEST_WH }, prices: { test: { growth_month: 'price_1GrowthM', starter_month: 'price_1StarterM' } } });
  assert.equal(saved.status, 200, saved.text);
  assert.ok(!saved.text.includes(TEST_SK) && !saved.text.includes(TEST_WH), 'secrets are never sent back');
  assert.deepEqual(saved.data.modes.test.secret_key, { set: true, hint: '…1234' });
  assert.equal(saved.data.modes.test.publishable_key, TEST_PK); assert.equal(saved.data.modes.test.prices.growth_month, 'price_1GrowthM');
  assert.equal(saved.data.modes.live.secret_key.set, false); assert.equal(saved.data.ready, true);
  assert.match(saved.data.webhook_url, /\/api\/platform\/billing\/webhook\/stripe$/);
  const raw = platformDb().prepare("SELECT value, secret FROM platform_settings WHERE key='stripe_test_secret_key'").get();
  assert.equal(raw.secret, 1); assert.ok(raw.value.startsWith('v1:') && !raw.value.includes('AbCdEf'), 'encrypted at rest');
  // blank keeps, null clears
  await adm('PUT', '/settings/stripe', { test: { secret_key: '' } });
  assert.equal((await adm('GET', '/settings/stripe')).data.modes.test.secret_key.set, true);
  await adm('PUT', '/settings/stripe', { live: { secret_key: LIVE_SK } });
  await adm('PUT', '/settings/stripe', { live: { secret_key: null } });
  assert.equal((await adm('GET', '/settings/stripe')).data.modes.live.secret_key.set, false);
  const log = (await adm('GET', '/audit')).text;
  assert.match(log, /stripe-settings/); assert.ok(!log.includes('AbCdEf') && !log.includes('ZyXw'), 'the audit log never holds key values');
});

test('Test connection reports a working key, a rejected key, and a key saved in the wrong mode', async () => {
  stripe.http.fetch = async (url, opts) => { assert.equal(url, 'https://api.stripe.com/v1/balance'); assert.equal(opts.headers.Authorization, `Bearer ${TEST_SK}`); return { ok: true, json: async () => ({ livemode: false }) }; };
  assert.deepEqual((await adm('POST', '/settings/stripe/test', { mode: 'test' })).data, { mode: 'test', ok: true, livemode: false });
  stripe.http.fetch = async () => ({ ok: false, status: 401, json: async () => ({ error: { message: 'Invalid API Key provided' } }) });
  const rej = (await adm('POST', '/settings/stripe/test', { mode: 'test' })).data; assert.equal(rej.ok, false); assert.match(rej.error, /Invalid API Key/);
  stripe.http.fetch = async () => ({ ok: true, json: async () => ({ livemode: true }) });
  assert.match((await adm('POST', '/settings/stripe/test', { mode: 'test' })).data.error, /live key/);
  assert.match((await adm('POST', '/settings/stripe/test', { mode: 'live' })).data.error, /No secret key/);
});

test('billing uses the keys saved in the console: checkout and signed webhooks, test mode and live mode kept apart', async () => {
  const r = await call(P, 'POST', '/api/platform/signup', { slug: 'conso', company_name: 'Conso Co', admin_name: 'O', admin_email: 'o@conso.test', admin_password: 'Tenant@12345' });
  const id = r.data.tenant.id; const host = 'conso.erp.test';
  const l = await call(host, 'POST', '/api/auth/login', { identifier: 'o@conso.test', password: 'Tenant@12345' });
  const seen = [];
  stripe.http.fetch = async (url, opts) => { seen.push({ url, auth: opts.headers.Authorization, body: new URLSearchParams(opts.body) }); return { ok: true, json: async () => ({ url: 'https://checkout.stripe.com/c/pay/cs_1' }) }; };
  const out = await call(host, 'POST', '/api/billing/checkout', { plan: 'growth', interval: 'month' }, { cookie: l.cookie });
  assert.equal(out.data.mode, 'redirect'); assert.equal(seen[0].auth, `Bearer ${TEST_SK}`); assert.equal(seen[0].body.get('line_items[0][price]'), 'price_1GrowthM');
  const hook = (ev, secret = TEST_WH) => { const raw = JSON.stringify(ev); const t = Math.floor(Date.now() / 1000); return call(P, 'POST', '/api/platform/billing/webhook/stripe', null, { 'Stripe-Signature': `t=${t},v1=${crypto.createHmac('sha256', secret).update(`${t}.${raw}`).digest('hex')}` }, raw); };
  const done = { id: 'evt_c1', type: 'checkout.session.completed', livemode: false, data: { object: { mode: 'subscription', client_reference_id: String(id), customer: 'cus_C', subscription: 'sub_C', metadata: { plan: 'growth', interval: 'month' } } } };
  assert.equal((await hook(done, 'whsec_wrongSecret')).status, 401);
  assert.deepEqual((await hook(done)).data, { ok: true, applied: true });
  // switch to live: a test-mode event must no longer change anything
  await adm('PUT', '/settings/stripe', { mode: 'live', live: { secret_key: LIVE_SK, webhook_secret: 'whsec_liveSecretValue456' }, prices: { live: { growth_month: 'price_1LiveG' } } });
  const testEv = { ...done, id: 'evt_c2', type: 'payment.failed' === 'x' ? '' : 'invoice.payment_failed', data: { object: { id: 'in_1', customer: 'cus_C', subscription: 'sub_C' } } };
  assert.equal((await hook(testEv)).data.ignored, true, 'test event ignored while live is active');
  assert.equal(platformDb().prepare('SELECT subscription_status s FROM tenants WHERE id=?').get(id).s, 'active');
  const liveEv = { ...testEv, id: 'evt_c3', livemode: true };
  assert.equal((await hook(liveEv, 'whsec_liveSecretValue456')).data.applied, true);
  assert.equal(platformDb().prepare('SELECT subscription_status s FROM tenants WHERE id=?').get(id).s, 'past_due');
  seen.length = 0;
  await call(host, 'POST', '/api/billing/checkout', { plan: 'growth', interval: 'month' }, { cookie: l.cookie });
  assert.equal(seen[0].auth, `Bearer ${LIVE_SK}`); assert.equal(seen[0].body.get('line_items[0][price]'), 'price_1LiveG');
  await adm('PUT', '/settings/stripe', { mode: 'test' });
});

test('local payment accounts: add, edit, hide, delete from the console; customers see only active ones', async () => {
  const tenant = async () => { const l = await call('conso.erp.test', 'POST', '/api/auth/login', { identifier: 'o@conso.test', password: 'Tenant@12345' }); return (await call('conso.erp.test', 'GET', '/api/billing', null, { cookie: l.cookie })).data.methods.map((m) => m.id); };
  assert.deepEqual((await tenant()).filter((m) => m !== 'card'), [], 'none configured yet');
  assert.equal((await adm('POST', '/payment-accounts', { method: 'paypal', account: '123456' })).status, 400);
  assert.equal((await adm('POST', '/payment-accounts', { method: 'raast', account: '1' })).status, 400);
  const a = await adm('POST', '/payment-accounts', { method: 'raast', account: '03001234567', account_name: 'Agentify Pvt Ltd', note: 'Raast ID' });
  assert.equal(a.status, 201, a.text); assert.equal(a.data.label, 'Raast');
  const b = await adm('POST', '/payment-accounts', { method: 'jazzcash', account: '03007654321', sort_order: 2 });
  assert.deepEqual((await tenant()).filter((m) => m !== 'card'), ['raast', 'jazzcash']);
  assert.equal((await adm('PUT', `/payment-accounts/${b.data.id}`, { active: false })).data.active, false);
  assert.deepEqual((await tenant()).filter((m) => m !== 'card'), ['raast'], 'hidden accounts are not offered');
  assert.equal((await adm('PUT', `/payment-accounts/${a.data.id}`, { account: '03009998888', note: '' })).data.account, '03009998888');
  assert.equal((await adm('GET', '/payment-accounts')).data.accounts.length, 2);
  assert.equal((await adm('DELETE', `/payment-accounts/${a.data.id}`)).status, 200);
  assert.equal((await adm('DELETE', `/payment-accounts/${a.data.id}`)).status, 404);
  assert.deepEqual((await tenant()).filter((m) => m !== 'card'), []);
});

test('admin password change signs out the old session; the bearer token and console both reach the operator API', async () => {
  const wk = await adm('GET', '/me'); assert.equal(wk.status, 200);
  assert.equal((await adm('POST', '/change-password', { current: 'Console@12345', next: 'short' })).status, 400);
  assert.equal((await adm('POST', '/change-password', { current: 'nope', next: 'NewConsole@999' })).status, 400);
  const old = cookie;
  const ch = await adm('POST', '/change-password', { current: 'Console@12345', next: 'NewConsole@999' });
  assert.equal(ch.status, 200);
  assert.equal((await call(P, 'GET', '/api/platform/admin/me', null, { cookie: old })).status, 401, 'old session is revoked');
  const fresh = await call(P, 'POST', '/api/platform/admin/login', { email: 'admin@agentify.test', password: 'NewConsole@999' });
  assert.equal(fresh.status, 200); cookie = fresh.cookie;
  const t = await call(P, 'GET', '/api/platform/tenants', null, { cookie });
  assert.equal(t.status, 200); assert.ok(t.data.some((x) => x.slug === 'conso' && x.owner_email === 'o@conso.test'));
  assert.equal((await call(P, 'POST', '/api/platform/admin/logout', {}, { cookie })).status, 200);
});

test('landing info: shown on the main domain only, with plans and live payment methods', async () => {
  const main = await call(P, 'GET', '/api/platform/site');
  assert.equal(main.data.landing, true);
  assert.deepEqual(main.data.plans.map((p) => p.id), ['starter', 'growth', 'enterprise']);
  assert.equal(main.data.base_domain, 'erp.test');
  assert.equal((await call('acme.erp.test', 'GET', '/api/platform/site')).data.landing, false);
});
