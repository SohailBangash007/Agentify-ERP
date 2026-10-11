import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'erp-hardening-'));
Object.assign(process.env, { ERP_DATA_DIR: dir, ERP_UPLOAD_DIR: path.join(dir, 'uploads'), ERP_DB: path.join(dir, 'legacy.db'), ERP_PLATFORM_DB: path.join(dir, 'platform.db'),
  ERP_BASE_DOMAIN: 'erp.test', ERP_DEMO: '0', ADMIN_EMAIL: 'owner@legacy.test', ADMIN_PASSWORD: 'Legacy@12345', LOGIN_LIMIT: '1000', SIGNUP_LIMIT: '1000', ERP_MAIL_QUIET: '1',
  ERP_SECRETS_KEY: 'test-secrets-key-0123456789', PLATFORM_ADMIN_EMAIL: 'Admin@Agentify.test', PLATFORM_ADMIN_PASSWORD: 'Console@12345', BILLING_PROVIDER: 'manual' });
for (const k of ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'BILLING_PK_ACCOUNTS', 'ERP_PLATFORM_ADMIN_TOKEN']) delete process.env[k];

const { createApp } = await import('../src/index.js');
const { platformDb } = await import('../src/platform.js');
const { outbox } = await import('../src/services/mailer.js');
const totp = await import('../src/services/totp.js');
const { DatabaseSync } = await import('node:sqlite');
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
const P = 'erp.test', H = 'hard.erp.test', PW = 'Tenant@12345';
const tok = (to, re) => outbox.filter((m) => m.to === to).reverse().map((m) => m.text.match(re)?.[1]).find(Boolean);
let owner, ownerCookie;
const as = (cookie) => ({ get: (u) => call(H, 'GET', u, null, { cookie }), post: (u, b) => call(H, 'POST', u, b || {}, { cookie }) });

test('email confirmation: the owner cannot invite until the link from the welcome email is used once', async () => {
  const r = await call(P, 'POST', '/api/platform/signup', { slug: 'hard', company_name: 'Hard Co', admin_name: 'Owner', admin_email: 'owner@hard.test', admin_password: PW });
  assert.equal(r.status, 201, r.text);
  const l = await call(H, 'POST', '/api/auth/login', { identifier: 'owner@hard.test', password: PW });
  ownerCookie = l.cookie; owner = as(l.cookie);
  assert.equal(l.data.email_verified, false);
  const roles = (await owner.get('/api/settings/roles')).data; const agent = roles.find((x) => x.name === 'Sales Agent').id;
  const blocked = await owner.post('/api/settings/invites', { email: 'x@hard.test', role_id: agent });
  assert.equal(blocked.status, 400); assert.match(blocked.data.error, /Confirm your own email/);
  const t = tok('owner@hard.test', /verify-email\/(\S+)/);
  assert.equal((await call('acme.erp.test', 'POST', '/api/auth/verify-email', { token: t })).status, 404, 'no such workspace');
  assert.equal((await call(H, 'POST', '/api/auth/verify-email', { token: 'bogus' })).status, 400);
  assert.equal((await call(H, 'POST', '/api/auth/verify-email', { token: t })).status, 200);
  assert.equal((await call(H, 'POST', '/api/auth/verify-email', { token: t })).status, 400, 'works once');
  assert.equal((await owner.get('/api/auth/me')).data.email_verified, true);
  assert.equal((await owner.post('/api/settings/invites', { email: 'x@hard.test', role_id: agent })).status, 201);
  // resending replaces the link
  assert.equal((await owner.post('/api/auth/resend-verification')).status, 200);
});

let secret, recovery;
test('2FA for staff: setup, enable with a real code, then sign-in needs the second step', async () => {
  const setup = await owner.post('/api/auth/2fa/setup');
  assert.equal(setup.status, 200); secret = setup.data.secret;
  assert.match(setup.data.qr, /^data:image\/png;base64,/); assert.match(setup.data.otpauth, /^otpauth:\/\/totp\//);
  assert.equal((await owner.post('/api/auth/2fa/enable', { code: '000000' })).status, 400);
  const en = await owner.post('/api/auth/2fa/enable', { code: totp.codeNow(secret) });
  assert.equal(en.status, 200, en.text); recovery = en.data.recovery_codes; assert.equal(recovery.length, 8);
  assert.equal((await owner.get('/api/auth/2fa')).data.enabled, true);

  const step1 = await call(H, 'POST', '/api/auth/login', { identifier: 'owner@hard.test', password: PW });
  assert.equal(step1.status, 200); assert.equal(step1.data.mfa_required, true); assert.equal(step1.cookie, undefined, 'no session before the code');
  assert.equal((await call(H, 'GET', '/api/auth/me', null, { cookie: 'erp_token=' + step1.data.mfa_token })).status, 401, 'the interim token is not a session');
  assert.equal((await call(H, 'POST', '/api/auth/login/mfa', { mfa_token: step1.data.mfa_token, code: '123456' })).status, 401);
  assert.equal((await call(H, 'POST', '/api/auth/login/mfa', { mfa_token: 'junk', code: totp.codeNow(secret) })).status, 401);
  const ok = await call(H, 'POST', '/api/auth/login/mfa', { mfa_token: step1.data.mfa_token, code: totp.codeNow(secret, Date.now() + 30000) });
  assert.equal(ok.status, 200, ok.text); assert.ok(ok.cookie); assert.equal(ok.data.totp_enabled, true);
  assert.equal((await call(H, 'GET', '/api/auth/me', null, { cookie: ok.cookie })).status, 200);
  // the same code cannot be replayed
  const again = await call(H, 'POST', '/api/auth/login', { identifier: 'owner@hard.test', password: PW });
  assert.equal((await call(H, 'POST', '/api/auth/login/mfa', { mfa_token: again.data.mfa_token, code: totp.codeNow(secret, Date.now() + 30000) })).status, 401, 'a used code is refused');
});

test('2FA recovery codes work once; an admin can reset a locked-out colleague; turning it off needs password and code', async () => {
  const s = await call(H, 'POST', '/api/auth/login', { identifier: 'owner@hard.test', password: PW });
  const rc = await call(H, 'POST', '/api/auth/login/mfa', { mfa_token: s.data.mfa_token, code: recovery[0] });
  assert.equal(rc.status, 200, rc.text);
  const s2 = await call(H, 'POST', '/api/auth/login', { identifier: 'owner@hard.test', password: PW });
  assert.equal((await call(H, 'POST', '/api/auth/login/mfa', { mfa_token: s2.data.mfa_token, code: recovery[0] })).status, 401, 'used recovery code');
  const sess = as(rc.cookie);
  assert.equal((await sess.get('/api/auth/2fa')).data.recovery_left, 7);
  assert.equal((await sess.post('/api/auth/2fa/disable', { password: 'wrong', code: recovery[1] })).status, 403);
  assert.equal((await sess.post('/api/auth/2fa/disable', { password: PW, code: '111111' })).status, 403);
  assert.equal((await sess.post('/api/auth/2fa/disable', { password: PW, code: recovery[1] })).status, 200);
  assert.equal((await call(H, 'POST', '/api/auth/login', { identifier: 'owner@hard.test', password: PW })).data.mfa_required, undefined);

  // admin reset of someone else's 2FA
  const roles = (await sess.get('/api/settings/roles')).data; const agent = roles.find((x) => x.name === 'Sales Agent').id;
  const made = await sess.post('/api/settings/users', { name: 'Agent', email: 'agent@hard.test', password: 'Passw0rd!x', role_id: agent });
  assert.equal(made.status, 201, made.text);
  const al = await call(H, 'POST', '/api/auth/login', { identifier: 'agent@hard.test', password: 'Passw0rd!x' });
  const ag = as(al.cookie); const sec = (await ag.post('/api/auth/2fa/setup')).data.secret;
  assert.equal((await ag.post('/api/auth/2fa/enable', { code: totp.codeNow(sec) })).status, 200);
  assert.equal((await ag.post('/api/settings/users/' + made.data.id + '/2fa/reset')).status, 403, 'an agent cannot reset 2FA');
  assert.equal((await sess.post(`/api/settings/users/${made.data.id}/2fa/reset`)).status, 200);
  assert.equal((await call(H, 'POST', '/api/auth/login', { identifier: 'agent@hard.test', password: 'Passw0rd!x' })).data.mfa_required, undefined);
});

test('platform admin 2FA: second step on the console sign-in', async () => {
  const body = { email: 'admin@agentify.test', password: 'Console@12345' };
  const l = await call(P, 'POST', '/api/platform/admin/login', body);
  const adm = (m, u, b) => call(P, m, `/api/platform/admin${u}`, b, { cookie: l.cookie });
  const setup = await adm('POST', '/2fa/setup'); assert.equal(setup.status, 200, setup.text);
  assert.equal((await adm('POST', '/2fa/enable', { code: '000000' })).status, 400);
  const en = await adm('POST', '/2fa/enable', { code: totp.codeNow(setup.data.secret) }); assert.equal(en.status, 200, en.text);
  const s1 = await call(P, 'POST', '/api/platform/admin/login', body);
  assert.equal(s1.data.mfa_required, true); assert.equal(s1.cookie, undefined);
  assert.equal((await call(P, 'POST', '/api/platform/admin/login/mfa', { mfa_token: s1.data.mfa_token, code: '123456' })).status, 401);
  const ok = await call(P, 'POST', '/api/platform/admin/login/mfa', { mfa_token: s1.data.mfa_token, code: totp.codeNow(setup.data.secret, Date.now() + 30000) });
  assert.equal(ok.status, 200, ok.text);
  assert.equal((await call(P, 'GET', '/api/platform/admin/me', null, { cookie: ok.cookie })).status, 200);
  // a recovery code also works, and turning it off restores plain sign-in
  const s2 = await call(P, 'POST', '/api/platform/admin/login', body);
  const rc = await call(P, 'POST', '/api/platform/admin/login/mfa', { mfa_token: s2.data.mfa_token, code: en.data.recovery_codes[0] });
  assert.equal(rc.status, 200);
  const off = await call(P, 'POST', '/api/platform/admin/2fa/disable', { password: body.password, code: en.data.recovery_codes[1] }, { cookie: rc.cookie });
  assert.equal(off.status, 200, off.text);
  assert.equal((await call(P, 'POST', '/api/platform/admin/login', body)).data.mfa_required, undefined);
});

test('backups: snapshots of the platform and every workspace, retention, and the Super Admin download', async () => {
  const bdir = path.join(dir, 'backups');
  process.env.BACKUP_DIR = bdir; process.env.BACKUP_KEEP = '2';
  const l = await call(P, 'POST', '/api/platform/admin/login', { email: 'admin@agentify.test', password: 'Console@12345' });
  const adm = (m, u, b) => call(P, m, `/api/platform/admin${u}`, b, { cookie: l.cookie });
  const run = await adm('POST', '/backups/run'); assert.equal(run.status, 200, run.text);
  assert.ok(run.data.tenants >= 2 && run.data.errors.length === 0, JSON.stringify(run.data));
  const f = path.join(bdir, run.data.name, 'tenants', 'hard.db');
  const copy = new DatabaseSync(f, { readOnly: true });
  assert.equal(copy.prepare("SELECT COUNT(*) n FROM users WHERE email='owner@hard.test'").get().n, 1, 'the snapshot holds the workspace data');
  copy.close();
  assert.ok(fs.existsSync(path.join(bdir, run.data.name, 'platform.db')));
  assert.equal((await adm('GET', '/backups')).data.backups.length, 1);
  // retention keeps the newest BACKUP_KEEP folders (fake two older ones)
  for (const n of ['20200101-0000', '20200102-0000']) fs.mkdirSync(path.join(bdir, n));
  await adm('POST', '/backups/run');
  assert.deepEqual(fs.readdirSync(bdir).filter((n) => /^\d{8}-\d{4}$/.test(n)).length, 2);
  // workspace Super Admin downloads their own database; other roles cannot
  const dl = (cookie) => new Promise((resolve) => { http.request({ host: '127.0.0.1', port, path: '/api/settings/backup', headers: { Host: H, cookie } }, (res) => { const chunks = []; res.on('data', (c) => chunks.push(c)); res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks) })); }).end(); });
  assert.equal((await dl('')).status, 401, 'needs a session');
  const mine = await dl(ownerCookie);
  assert.equal(mine.status, 200); assert.equal(mine.body.subarray(0, 15).toString(), 'SQLite format 3');
  const roles = (await owner.get('/api/settings/roles')).data;
  const mgr = await owner.post('/api/settings/users', { name: 'Fin', email: 'fin@hard.test', password: 'Passw0rd!x', role_id: roles.find((x) => x.name === 'Admin').id });
  assert.equal(mgr.status, 201, mgr.text);
  const fl = await call(H, 'POST', '/api/auth/login', { identifier: 'fin@hard.test', password: 'Passw0rd!x' });
  assert.equal((await dl(fl.cookie)).status, 400, 'only a Super Admin downloads the database');
});
