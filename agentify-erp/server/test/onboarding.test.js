import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'erp-onboard-'));
Object.assign(process.env, { ERP_DATA_DIR: dir, ERP_UPLOAD_DIR: path.join(dir, 'uploads'), ERP_DB: path.join(dir, 'legacy.db'), ERP_PLATFORM_DB: path.join(dir, 'platform.db'),
  ERP_BASE_DOMAIN: 'erp.test', ERP_DEMO: '0', ADMIN_EMAIL: 'owner@legacy.test', ADMIN_PASSWORD: 'Legacy@12345', LOGIN_LIMIT: '1000', SIGNUP_LIMIT: '1000', ERP_MAIL_QUIET: '1' });
delete process.env.RESEND_API_KEY;

const { createApp } = await import('../src/index.js');
const { outbox } = await import('../src/services/mailer.js');
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
const A = 'acme.erp.test', B = 'beta.erp.test';
const PW = 'Tenant@12345';
const tokenFrom = (msg, kind) => msg.text.match(new RegExp(`/${kind}/([\\w-]+)`))[1];
const lastMail = (to) => [...outbox].reverse().find((m) => m.to === to);

async function loginAs(host, identifier, password) {
  const l = await call(host, 'POST', '/api/auth/login', { identifier, password });
  assert.equal(l.status, 200, JSON.stringify(l.data));
  return { c: l.cookie, me: l.data, get: (u) => call(host, 'GET', u, null, { cookie: l.cookie }), post: (u, b) => call(host, 'POST', u, b || {}, { cookie: l.cookie }), del: (u) => call(host, 'DELETE', u, null, { cookie: l.cookie }) };
}

test('signup sends a welcome email to the new owner', async () => {
  const r = await call('erp.test', 'POST', '/api/platform/signup', { slug: 'acme', company_name: 'Acme Realty', admin_name: 'Amir', admin_email: 'amir@acme.test', admin_password: PW });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  await call('erp.test', 'POST', '/api/platform/signup', { slug: 'beta', company_name: 'Beta Homes', admin_name: 'Bilal', admin_email: 'bilal@beta.test', admin_password: PW });
  const m = lastMail('amir@acme.test');
  assert.match(m.subject, /Acme Realty is ready/);
  assert.match(m.text, /https:\/\/acme\.erp\.test/);
});

test('forgot password: same answer for unknown and known accounts; the link works once and signs everyone out', async () => {
  const before = outbox.length;
  const unknown = await call(A, 'POST', '/api/auth/forgot-password', { email: 'nobody@acme.test' });
  assert.equal(unknown.status, 200); assert.equal(outbox.length, before, 'no email for an unknown address');
  const admin = await loginAs(A, 'amir@acme.test', PW);
  const known = await call(A, 'POST', '/api/auth/forgot-password', { email: 'AMIR@acme.test' });
  assert.deepEqual(known.data, unknown.data, 'response must not reveal whether the account exists');
  const mail = lastMail('amir@acme.test');
  assert.match(mail.text, /acme\.erp\.test\/reset-password\//);
  const token = tokenFrom(mail, 'reset-password');
  assert.equal((await call(A, 'POST', '/api/auth/reset-password', { token, password: 'short' })).status, 400);
  assert.equal((await call(A, 'POST', '/api/auth/reset-password', { token: 'bogus', password: 'NewPass@12345' })).status, 400);
  assert.equal((await call(B, 'POST', '/api/auth/reset-password', { token, password: 'NewPass@12345' })).status, 400, 'a token from one workspace is useless on another');
  assert.equal((await call(A, 'POST', '/api/auth/reset-password', { token, password: 'NewPass@12345' })).status, 200);
  assert.equal((await call(A, 'POST', '/api/auth/reset-password', { token, password: 'Another@12345' })).status, 400, 'single use');
  assert.equal((await admin.get('/api/auth/me')).status, 401, 'old sessions are signed out');
  assert.equal((await call(A, 'POST', '/api/auth/login', { identifier: 'amir@acme.test', password: PW })).status, 401);
  assert.equal((await call(A, 'POST', '/api/auth/login', { identifier: 'amir@acme.test', password: 'NewPass@12345' })).status, 200);
});

test('invitations: admin invites, invitee sets a password and is signed in with the chosen role', async () => {
  const vt = outbox.find((m) => m.to === 'amir@acme.test' && /Welcome/.test(m.subject)).text.match(/verify-email\/(\S+)/)[1];
  assert.equal((await call(A, 'POST', '/api/auth/verify-email', { token: vt })).status, 200);
  const admin = await loginAs(A, 'amir@acme.test', 'NewPass@12345');
  const roles = (await admin.get('/api/settings/roles')).data;
  const agentRole = roles.find((r) => r.name === 'Sales Agent'), superRole = roles.find((r) => r.name === 'Super Admin'), adminRole = roles.find((r) => r.name === 'Admin');
  assert.equal((await admin.post('/api/settings/invites', { email: 'bad', role_id: agentRole.id })).status, 400);
  const inv = await admin.post('/api/settings/invites', { email: 'Sara@Acme.test', name: 'Sara', role_id: agentRole.id });
  assert.equal(inv.status, 201, JSON.stringify(inv.data));
  assert.match(inv.data.link, /^https?:\/\/acme\.erp\.test\/invite\//);
  assert.match(lastMail('sara@acme.test').text, /invite\//);
  assert.equal((await admin.get('/api/settings/invites')).data.length, 1);
  const token = inv.data.link.split('/invite/')[1];
  const info = await call(A, 'GET', `/api/auth/invite/${token}`);
  assert.equal(info.status, 200); assert.equal(info.data.role, 'Sales Agent'); assert.equal(info.data.email, 'sara@acme.test');
  assert.equal((await call(B, 'GET', `/api/auth/invite/${token}`)).status, 404, 'invitation is bound to its workspace');
  assert.equal((await call(A, 'POST', '/api/auth/invite/accept', { token, password: 'short' })).status, 400);
  const acc = await call(A, 'POST', '/api/auth/invite/accept', { token, password: 'Sara@12345', name: 'Sara Khan' });
  assert.equal(acc.status, 201, JSON.stringify(acc.data));
  assert.equal(acc.data.role, 'Sales Agent'); assert.equal(acc.data.name, 'Sara Khan'); assert.ok(acc.cookie);
  assert.equal((await call(A, 'GET', '/api/auth/me', null, { cookie: acc.cookie })).status, 200, 'signed in straight after accepting');
  assert.equal((await call(A, 'POST', '/api/auth/invite/accept', { token, password: 'Sara@12345' })).status, 404, 'single use');
  assert.equal((await admin.get('/api/settings/invites')).data.length, 0);
  // duplicates and privilege rules
  assert.equal((await admin.post('/api/settings/invites', { email: 'sara@acme.test', role_id: agentRole.id })).status, 400, 'already a user');
  // an Admin who is not a Super Admin cannot mint Super Admins
  const mid = await admin.post('/api/settings/invites', { email: 'omar@acme.test', role_id: adminRole.id });
  const omar = await call(A, 'POST', '/api/auth/invite/accept', { token: mid.data.link.split('/invite/')[1], password: 'Omar@12345' });
  const omarSession = { post: (u, b) => call(A, 'POST', u, b, { cookie: omar.cookie }) };
  assert.equal((await omarSession.post('/api/settings/invites', { email: 'x@acme.test', role_id: superRole.id })).status, 400);
  // an agent cannot invite anyone
  const sara = { post: (u, b) => call(A, 'POST', u, b, { cookie: acc.cookie }) };
  assert.equal((await sara.post('/api/settings/invites', { email: 'y@acme.test', role_id: agentRole.id })).status, 403);
});

test('revoked and expired invitations stop working', async () => {
  const admin = await loginAs(A, 'amir@acme.test', 'NewPass@12345');
  const agentRole = (await admin.get('/api/settings/roles')).data.find((r) => r.name === 'Sales Agent');
  const one = await admin.post('/api/settings/invites', { email: 'rev@acme.test', role_id: agentRole.id });
  const id = (await admin.get('/api/settings/invites')).data.find((i) => i.email === 'rev@acme.test').id;
  assert.equal((await admin.del(`/api/settings/invites/${id}`)).status, 200);
  assert.equal((await call(A, 'GET', `/api/auth/invite/${one.data.link.split('/invite/')[1]}`)).status, 404);
  const two = await admin.post('/api/settings/invites', { email: 'old@acme.test', role_id: agentRole.id });
  const { withTenant, getTenantBySlug } = await import('../src/platform.js');
  const { run } = await import('../src/db.js');
  withTenant(getTenantBySlug('acme'), () => run("UPDATE auth_tokens SET expires_at='2020-01-01T00:00:00.000Z' WHERE email='old@acme.test'"));
  assert.equal((await call(A, 'POST', '/api/auth/invite/accept', { token: two.data.link.split('/invite/')[1], password: 'Old@123456' })).status, 404);
  // a newer invite for the same address replaces the older link
  const a = await admin.post('/api/settings/invites', { email: 'twice@acme.test', role_id: agentRole.id });
  const b = await admin.post('/api/settings/invites', { email: 'twice@acme.test', role_id: agentRole.id });
  assert.equal((await call(A, 'GET', `/api/auth/invite/${a.data.link.split('/invite/')[1]}`)).status, 404);
  assert.equal((await call(A, 'GET', `/api/auth/invite/${b.data.link.split('/invite/')[1]}`)).status, 200);
});
