import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'erp-tenancy-'));
process.env.ERP_DATA_DIR = dir;
process.env.ERP_UPLOAD_DIR = path.join(dir, 'uploads');
process.env.ERP_DB = path.join(dir, 'legacy.db');
process.env.ERP_PLATFORM_DB = path.join(dir, 'platform.db');
process.env.ERP_BASE_DOMAIN = 'erp.test';
process.env.ERP_PLATFORM_ADMIN_TOKEN = 'operator-secret';
process.env.ERP_DEMO = '0';
process.env.ADMIN_EMAIL = 'owner@legacy.test';
process.env.ADMIN_PASSWORD = 'Legacy@12345';
process.env.LOGIN_LIMIT = '1000';
process.env.SIGNUP_LIMIT = '1000';

const { createApp } = await import('../src/index.js');
let server, port;
before(() => new Promise((res) => { server = createApp().listen(0, () => { port = server.address().port; res(); }); }));
after(async () => { server.close(); const { closeDbs } = await import('../src/db.js'); closeDbs(); });

/** HTTP call to a given host name (the test server is on localhost; the Host header picks the tenant). */
const call = (host, method, url, body, headers = {}) => new Promise((resolve, reject) => {
  const data = body ? JSON.stringify(body) : null;
  const req = http.request({ host: '127.0.0.1', port, path: url, method, headers: { Host: host, 'Content-Type': 'application/json', 'X-Requested-With': 'ERP', ...headers, ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}) } }, (res) => {
    let t = ''; res.on('data', (c) => { t += c; });
    res.on('end', () => { let d; try { d = JSON.parse(t); } catch { d = t; } resolve({ status: res.statusCode, data: d, cookie: (res.headers['set-cookie'] || [])[0]?.split(';')[0] }); });
  });
  req.on('error', reject); if (data) req.write(data); req.end();
});

async function login(host, identifier, password) {
  const l = await call(host, 'POST', '/api/auth/login', { identifier, password });
  assert.equal(l.status, 200, `login on ${host}: ${JSON.stringify(l.data)}`);
  const c = l.cookie;
  return { c, get: (u) => call(host, 'GET', u, null, { cookie: c }), post: (u, b) => call(host, 'POST', u, b || {}, { cookie: c }), me: l.data };
}

const signup = (slug, email, extra = {}) => call('erp.test', 'POST', '/api/platform/signup', { accept_terms: true, slug, company_name: `${slug} Realty`, admin_name: 'Owner', admin_email: email, admin_password: 'Tenant@12345', ...extra });

test('signup creates an isolated workspace with its own admin and base configuration', async () => {
  const r = await signup('acme', 'owner@acme.test', { currency: 'AED', timezone: 'Asia/Dubai' });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.equal(r.data.tenant.slug, 'acme');
  assert.equal(r.data.login_url, 'https://acme.erp.test');
  const a = await login('acme.erp.test', 'owner@acme.test', 'Tenant@12345');
  assert.equal(a.me.role, 'Super Admin');
  const s = await a.get('/api/settings/system');
  assert.equal(s.status, 200);
  assert.equal(JSON.stringify(s.data).includes('Expert Marketing'), false, 'a new workspace must not carry the original company name');
  assert.ok(fs.existsSync(path.join(dir, 'tenants', 'acme', 'erp.db')), 'tenant has its own database file');
});

test('signup rejects reserved, malformed and duplicate addresses', async () => {
  assert.equal((await signup('www', 'a@x.test')).status, 400);
  assert.equal((await signup('Bad Name!', 'a@x.test')).status, 400);
  assert.equal((await signup('acme', 'b@x.test')).status, 409);
  assert.equal((await signup('okslug', 'not-an-email')).status, 400);
  assert.equal((await signup('okslug', 'a@x.test', { admin_password: 'short' })).status, 400);
  assert.equal((await call('erp.test', 'GET', '/api/platform/slug-available/acme')).data.available, false);
  assert.equal((await call('erp.test', 'GET', '/api/platform/slug-available/fresh-one')).data.available, true);
});

test('data written in one workspace is invisible in another, even with the same email', async () => {
  assert.equal((await signup('beta', 'owner@beta.test')).status, 201);
  assert.equal((await signup('gamma', 'owner@acme.test')).status, 201, 'same email may own another workspace');
  const a = await login('acme.erp.test', 'owner@acme.test', 'Tenant@12345');
  const b = await login('beta.erp.test', 'owner@beta.test', 'Tenant@12345');
  const created = await a.post('/api/contacts', { full_name: 'Acme Only Lead', phone: '+92 300 1112223', lead_source: 'Walk-in' });
  assert.equal(created.status, 201, JSON.stringify(created.data));
  const inA = await a.get('/api/contacts?q=Acme%20Only');
  const inB = await b.get('/api/contacts?q=Acme%20Only');
  assert.equal(JSON.stringify(inA.data).includes('Acme Only Lead'), true);
  assert.equal(JSON.stringify(inB.data).includes('Acme Only Lead'), false, 'beta must not see acme data');
  // same document numbering restarts per workspace
  const b2 = await b.post('/api/contacts', { full_name: 'Beta Lead', phone: '+92 300 1112224', lead_source: 'Walk-in' });
  assert.equal(b2.status, 201);
});

test('a login cookie from one workspace is rejected on another', async () => {
  const a = await login('acme.erp.test', 'owner@acme.test', 'Tenant@12345');
  const stolen = await call('beta.erp.test', 'GET', '/api/auth/me', null, { cookie: a.c });
  assert.equal(stolen.status, 401, 'a token issued for acme must not authenticate on beta');
  const wrongHost = await call('beta.erp.test', 'POST', '/api/auth/login', { identifier: 'owner@acme.test', password: 'Tenant@12345' });
  assert.equal(wrongHost.status, 401, 'credentials are per workspace');
});

test('unknown, bare-domain and suspended hosts do not reach any tenant data', async () => {
  assert.equal((await call('nobody.erp.test', 'GET', '/api/auth/me')).status, 404);
  assert.equal((await call('erp.test', 'GET', '/api/auth/me')).status, 404);
  const tenants = await call('erp.test', 'GET', '/api/platform/tenants', null, { authorization: 'Bearer operator-secret' });
  assert.equal(tenants.status, 200);
  const beta = tenants.data.find((t) => t.slug === 'beta');
  assert.equal((await call('erp.test', 'GET', '/api/platform/tenants')).status, 401);
  assert.equal((await call('erp.test', 'GET', '/api/platform/tenants', null, { authorization: 'Bearer wrong' })).status, 401);
  const sus = await call('erp.test', 'POST', `/api/platform/tenants/${beta.id}/status`, { status: 'suspended' }, { authorization: 'Bearer operator-secret' });
  assert.equal(sus.data.status, 'suspended');
  assert.equal((await call('beta.erp.test', 'POST', '/api/auth/login', { identifier: 'owner@beta.test', password: 'Tenant@12345' })).status, 403);
  await call('erp.test', 'POST', `/api/platform/tenants/${beta.id}/status`, { status: 'active' }, { authorization: 'Bearer operator-secret' });
  assert.equal((await call('beta.erp.test', 'POST', '/api/auth/login', { identifier: 'owner@beta.test', password: 'Tenant@12345' })).status, 200);
});

test('the original install keeps working as the default workspace', async () => {
  const { legacyTenant } = await import('../src/platform.js');
  const t = legacyTenant();
  assert.equal(t.is_legacy, 1);
  assert.equal(path.resolve(t.db_path), path.resolve(process.env.ERP_DB));
  const l = await call('default.erp.test', 'POST', '/api/auth/login', { identifier: 'owner@legacy.test', password: 'Legacy@12345' });
  assert.equal(l.status, 200, 'the original company logs in under the default workspace address');
  assert.equal((await call('acme.erp.test', 'POST', '/api/auth/login', { identifier: 'owner@legacy.test', password: 'Legacy@12345' })).status, 401, 'and its credentials do not work elsewhere');
});

test('uploads land in the workspace folder and are served only to that workspace', async () => {
  const { withTenant, getTenantBySlug } = await import('../src/platform.js');
  const { uploadDir } = await import('../src/db.js');
  const acme = getTenantBySlug('acme'), beta = getTenantBySlug('beta');
  const dirA = withTenant(acme, () => uploadDir()), dirB = withTenant(beta, () => uploadDir());
  assert.notEqual(dirA, dirB);
  assert.ok(dirA.startsWith(path.join(dir, 'uploads', 'tenants', 'acme')));
  fs.mkdirSync(path.join(dirA, 'media'), { recursive: true });
  fs.writeFileSync(path.join(dirA, 'media', 'logo.txt'), 'acme-file');
  assert.equal((await call('acme.erp.test', 'GET', '/uploads/media/logo.txt')).status, 200);
  assert.equal((await call('beta.erp.test', 'GET', '/uploads/media/logo.txt')).status, 404);
});

test('background jobs run once per active tenant, each inside its own database', async () => {
  const { forEachTenant } = await import('../src/platform.js');
  const { val } = await import('../src/db.js');
  const seen = [];
  forEachTenant((t) => seen.push([t.slug, val("SELECT value FROM settings WHERE key='company_name'")]));
  const names = Object.fromEntries(seen);
  assert.equal(names.acme, 'acme Realty');
  assert.equal(names.beta, 'beta Realty');
  assert.equal(names.default, 'Expert Marketing & Developers');
});
