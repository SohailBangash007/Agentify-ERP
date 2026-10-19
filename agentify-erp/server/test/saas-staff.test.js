// First-run owner bootstrap, console invitations and the Platform Owner / least-privilege roles.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'erp-staff-'));
Object.assign(process.env, { ERP_DATA_DIR: dir, ERP_UPLOAD_DIR: path.join(dir, 'uploads'), ERP_DB: path.join(dir, 'legacy.db'), ERP_PLATFORM_DB: path.join(dir, 'platform.db'),
  ERP_BASE_DOMAIN: 'erp.test', ERP_DEMO: '0', ADMIN_EMAIL: 'owner@legacy.test', ADMIN_PASSWORD: 'Legacy@12345', LOGIN_LIMIT: '1000', SIGNUP_LIMIT: '1000', ERP_MAIL_QUIET: '1',
  ERP_SECRETS_KEY: 'test-secrets-key-0123456789', BILLING_PROVIDER: 'manual', NODE_ENV: 'test' });
// no PLATFORM_ADMIN_* : the platform starts with no console account and must be bootstrapped with the one-time token
for (const k of ['PLATFORM_ADMIN_EMAIL', 'PLATFORM_ADMIN_PASSWORD', 'ERP_PLATFORM_ADMIN_TOKEN', 'RESEND_API_KEY']) delete process.env[k];

const { createApp } = await import('../src/index.js');
const { platformDb } = await import('../src/platform.js');
const { SETUP_TOKEN_FILE } = await import('../src/services/platformStaff.js');
let server, port;
before(() => new Promise((res) => { server = createApp().listen(0, () => { port = server.address().port; res(); }); }));
after(async () => { server.close(); (await import('../src/db.js')).closeDbs(); });

const call = (host, method, url, body, headers = {}) => new Promise((resolve, reject) => {
  const data = body ? JSON.stringify(body) : null;
  const req = http.request({ host: '127.0.0.1', port, path: url, method, headers: { Host: host, 'Content-Type': 'application/json', 'X-Requested-With': 'ERP', ...headers, ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}) } }, (res) => {
    let t = ''; res.on('data', (c) => { t += c; });
    res.on('end', () => { let d; try { d = JSON.parse(t); } catch { d = t; } resolve({ status: res.statusCode, data: d, cookie: (res.headers['set-cookie'] || [])[0]?.split(';')[0] }); });
  });
  req.on('error', reject); if (data) req.write(data); req.end();
});
const P = 'erp.test';
const A = '/api/platform/admin';
const signIn = async (email, password) => (await call(P, 'POST', `${A}/login`, { email, password })).cookie;
let owner;
const as = (cookie, method, url, body) => call(P, method, `${A}${url}`, body, { cookie });

test('first run: no default account; the setup token creates the Platform Owner once', async () => {
  assert.equal(platformDb().prepare('SELECT COUNT(*) n FROM platform_admins').get().n, 0, 'no account exists by default');
  assert.equal((await call(P, 'GET', `${A}/setup/status`)).data.needed, true);
  assert.equal((await call('acme.erp.test', 'GET', `${A}/setup/status`)).status, 404, 'never on a workspace address');
  const token = fs.readFileSync(SETUP_TOKEN_FILE, 'utf8').trim();
  assert.ok(token.length > 20);
  assert.ok(!JSON.stringify(platformDb().prepare('SELECT * FROM platform_settings').all()).includes(token), 'only the hash is stored');
  const body = { email: 'Founder@Agentify.test', name: 'Founder', password: 'Kestrel#Moon2026' };
  assert.equal((await call(P, 'POST', `${A}/setup`, { ...body, token: 'wrong-token' })).status, 403);
  assert.equal((await call(P, 'POST', `${A}/setup`, { ...body, token, password: 'weakpassword' })).status, 400, 'weak passwords are refused');
  assert.equal((await call(P, 'POST', `${A}/setup`, { ...body, token }, { 'X-Requested-With': '' })).status, 403, 'CSRF header required');
  const ok = await call(P, 'POST', `${A}/setup`, { ...body, token });
  assert.equal(ok.status, 201, JSON.stringify(ok.data));
  assert.equal((await call(P, 'POST', `${A}/setup`, { ...body, token, email: 'second@agentify.test' })).status, 410, 'setup closes after first use');
  assert.equal((await call(P, 'GET', `${A}/setup/status`)).data.needed, false);
  assert.ok(!fs.existsSync(SETUP_TOKEN_FILE), 'token file removed');
  owner = await signIn('founder@agentify.test', 'Kestrel#Moon2026');
  const me = (await as(owner, 'GET', '/me')).data;
  assert.equal(me.role, 'platform_owner');
  assert.ok(me.permissions.includes('admins.manage'));
});

test('invitations: invitee sets their own password; links work once; pending invites cannot sign in', async () => {
  const inv = await as(owner, 'POST', '/admins', { email: 'billing@agentify.test', name: 'Bill', role: 'billing_manager' });
  assert.equal(inv.status, 201, JSON.stringify(inv.data));
  assert.equal(inv.data.emailed, false); assert.match(inv.data.link, /\/platform\/accept-invite\/[\w-]+$/);
  const token = inv.data.link.split('/').pop();
  const listed = (await as(owner, 'GET', '/admins')).data.admins.find((a) => a.email === 'billing@agentify.test');
  assert.equal(listed.status, 'invited');
  assert.equal((await call(P, 'POST', `${A}/login`, { email: 'billing@agentify.test', password: 'anything-at-all' })).status, 401);
  assert.equal((await call(P, 'GET', `${A}/invite/${token}`)).data.role, 'Billing Manager');
  assert.equal((await call(P, 'POST', `${A}/invite/accept`, { token, password: 'short' })).status, 400);
  assert.equal((await call(P, 'POST', `${A}/invite/accept`, { token, password: 'Harbor#Light2026' })).status, 200);
  assert.equal((await call(P, 'POST', `${A}/invite/accept`, { token, password: 'Another#Pass2026' })).status, 404, 'link works once');
  const bill = await signIn('billing@agentify.test', 'Harbor#Light2026');
  const me = (await as(bill, 'GET', '/me')).data;
  assert.equal(me.role, 'billing_manager');
  assert.ok(me.permissions.includes('billing.manage') && !me.permissions.includes('billing.configure') && !me.permissions.includes('admins.manage'));
  assert.equal((await as(bill, 'GET', '/admins')).status, 403);
  assert.equal((await as(bill, 'PUT', '/plans/growth', { name: 'X' })).status, 403, 'billing managers cannot edit the plan catalogue');
});

test('Platform Owner role: only an owner can grant or remove it; one top account always remains', async () => {
  const sup = await as(owner, 'POST', '/admins', { email: 'super@agentify.test', name: 'Sup', role: 'super_admin', password: 'Saffron#Tide2026' });
  assert.equal(sup.status, 201);
  const s = await signIn('super@agentify.test', 'Saffron#Tide2026');
  assert.equal((await as(s, 'POST', '/admins', { email: 'o2@agentify.test', role: 'platform_owner' })).status, 403, 'a super admin cannot create owners');
  const ownerId = (await as(owner, 'GET', '/me')).data.id;
  assert.equal((await as(s, 'PATCH', `/admins/${ownerId}`, { active: false })).status, 403, 'a super admin cannot switch an owner off');
  assert.equal((await as(s, 'DELETE', `/admins/${ownerId}`)).status, 403);
  // the owner can demote the super admin; the owner itself cannot be demoted by themselves
  assert.equal((await as(owner, 'PATCH', `/admins/${ownerId}`, { role: 'read_only' })).status, 400);
  assert.equal((await as(owner, 'PATCH', `/admins/${sup.data.id}`, { role: 'analytics_viewer' })).status, 200);
  const av = await signIn('super@agentify.test', 'Saffron#Tide2026');
  const me = (await as(av, 'GET', '/me')).data;
  assert.deepEqual(me.permissions.sort(), ['analytics.view', 'dashboard.view', 'finance.view']);
  assert.equal((await as(av, 'GET', '/workspaces')).status, 403, 'analytics viewers see no workspace records');
  const audit = platformDb().prepare("SELECT action FROM platform_audit WHERE action IN ('platform-owner-created','admin-invited','invitation-accepted','admin-changed')").all().map((r) => r.action);
  for (const a of ['platform-owner-created', 'admin-invited', 'invitation-accepted', 'admin-changed']) assert.ok(audit.includes(a), `audited: ${a}`);
});
