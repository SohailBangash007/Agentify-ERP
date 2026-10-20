// Sign in with Google, Google Calendar appointments, and social posting, with every provider mocked.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'erp-oauth-'));
process.env.ERP_DATA_DIR = dir;
process.env.ERP_UPLOAD_DIR = path.join(dir, 'uploads');
process.env.ERP_DB = path.join(dir, 'legacy.db');
process.env.ERP_PLATFORM_DB = path.join(dir, 'platform.db');
process.env.ERP_BASE_DOMAIN = 'erp.test';
process.env.ERP_DEMO = '0';
process.env.ADMIN_EMAIL = 'owner@legacy.test';
process.env.ADMIN_PASSWORD = 'Legacy@12345';
process.env.LOGIN_LIMIT = '1000';
process.env.SIGNUP_LIMIT = '1000';

const { createApp } = await import('../src/index.js');
const { platformDb } = await import('../src/platform.js');
const { setRegionStatus } = await import('../src/regions/admin.js');
const oauth = await import('../src/services/oauthApps.js');
let server, port;
const realFetch = globalThis.fetch;
const seen = [];
let googleEmail = { email: 'owner@sso.test', email_verified: true };
let tokenError = null;
const J = (o, status = 200, headers = {}) => new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json', ...headers } });
before(() => new Promise((res) => {
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    if (u.includes('127.0.0.1')) return realFetch(url, opts);
    seen.push({ url: u, method: opts.method || 'GET', body: typeof opts.body === 'string' ? opts.body : opts.body ? String(opts.body) : null, auth: opts.headers?.Authorization });
    if (u.startsWith('https://oauth2.googleapis.com/token')) return tokenError ? J({ error: tokenError }, 400) : J({ access_token: 'g-access', refresh_token: 'g-refresh', expires_in: 3600 });
    if (u.startsWith('https://openidconnect.googleapis.com')) return J(googleEmail);
    if (u.startsWith('https://www.googleapis.com/calendar/v3')) {
      if ((opts.method || 'GET') === 'DELETE') return new Response(null, { status: 204 });
      return J({ id: 'ev-1' });
    }
    if (u.startsWith('https://graph.facebook.com/v19.0/oauth/access_token')) return J({ access_token: 'meta-user-token', expires_in: 5000 });
    if (u.includes('graph.facebook.com/v19.0/me/accounts')) return J({ data: [{ id: 'P1', name: 'Lone Star Page', access_token: 'page-token', instagram_business_account: { id: 'IG1', username: 'lonestar' } }] });
    if (u.endsWith('/P1/feed')) return J({ id: 'P1_100' });
    if (u.includes('/P1_100?fields=')) return J({ likes: { summary: { total_count: 7 } }, comments: { summary: { total_count: 2 } }, shares: { count: 1 } });
    if (u.includes('/P1_100/insights')) return J({ data: [{ name: 'post_impressions', values: [{ value: 340 }] }, { name: 'post_impressions_unique', values: [{ value: 280 }] }] });
    return J({ error: { message: 'unmocked ' + u } }, 404);
  };
  server = createApp().listen(0, () => { port = server.address().port; res(); });
}));
after(async () => { globalThis.fetch = realFetch; server.close(); const { closeDbs } = await import('../src/db.js'); closeDbs(); });

const call = (host, method, url, body, headers = {}, form = false) => new Promise((resolve, reject) => {
  const data = body ? (form ? new URLSearchParams(body).toString() : JSON.stringify(body)) : null;
  const req = http.request({ host: '127.0.0.1', port, path: url, method, headers: { Host: host, 'Content-Type': form ? 'application/x-www-form-urlencoded' : 'application/json', 'X-Requested-With': 'ERP', ...headers, ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}) } }, (res) => {
    let t = ''; res.on('data', (c) => { t += c; });
    res.on('end', () => { let d; try { d = JSON.parse(t); } catch { d = t; } resolve({ status: res.statusCode, data: d, location: res.headers.location, cookie: (res.headers['set-cookie'] || [])[0]?.split(';')[0] }); });
  });
  req.on('error', reject); if (data) req.write(data); req.end();
});
const HOST = 'sso.erp.test';
const stateOf = (location) => new URL(location).searchParams.get('state');

test('Google sign-in: only existing staff, verified email, one-time code, signed state', async () => {
  setRegionStatus(platformDb(), 'US', 'active', 'tester');
  const su = await call('erp.test', 'POST', '/api/platform/signup', { accept_terms: true, slug: 'sso', company_name: 'Sso Realty', admin_name: 'Owner', admin_email: 'owner@sso.test', admin_password: 'Tenant@12345', region: 'US', sub_region: 'Texas' });
  assert.equal(su.status, 201, JSON.stringify(su.data));

  assert.deepEqual((await call(HOST, 'GET', '/api/auth/brand')).data.sso, [], 'no buttons until the platform app is set up');
  assert.equal((await call(HOST, 'GET', '/api/auth/sso/google/start')).status, 400);
  oauth.saveAppCreds('google', { client_id: 'cid.apps.googleusercontent.com', client_secret: 'csecret' }, 'tester');
  assert.deepEqual((await call(HOST, 'GET', '/api/auth/brand')).data.sso, ['google']);

  const start = await call(HOST, 'GET', '/api/auth/sso/google/start');
  assert.equal(start.status, 303);
  const au = new URL(start.location);
  assert.equal(au.origin + au.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
  assert.equal(au.searchParams.get('client_id'), 'cid.apps.googleusercontent.com');
  assert.equal(au.searchParams.get('redirect_uri'), 'http://erp.test/api/platform/oauth/google/callback', 'one registered address on the main domain');
  assert.match(au.searchParams.get('scope'), /email/);
  const state = au.searchParams.get('state');

  // a forged or altered state is refused
  assert.equal((await call('erp.test', 'GET', `/api/platform/oauth/google/callback?code=x&state=${state.slice(0, -2)}zz`)).status, 400);

  // unknown email: back to the workspace with a message, no account created
  googleEmail = { email: 'stranger@example.com', email_verified: true };
  let cb = await call('erp.test', 'GET', `/api/platform/oauth/google/callback?code=abc&state=${state}`);
  assert.equal(cb.status, 303); assert.match(cb.location, /^http:\/\/sso\.erp\.test\/login\?oauth_error=no_account/);
  googleEmail = { email: 'owner@sso.test', email_verified: false };
  cb = await call('erp.test', 'GET', `/api/platform/oauth/google/callback?code=abc&state=${state}`);
  assert.match(cb.location, /oauth_error=email_not_verified/);

  // the owner: a one-time code is issued and exchanged for a session
  googleEmail = { email: 'Owner@Sso.test', email_verified: true };
  cb = await call('erp.test', 'GET', `/api/platform/oauth/google/callback?code=abc&state=${state}`);
  assert.match(cb.location, /^http:\/\/sso\.erp\.test\/login\?sso=/);
  const code = new URL(cb.location).searchParams.get('sso');
  assert.equal((await call('other.erp.test', 'POST', '/api/auth/sso/exchange', { code })).status, 404, 'another workspace cannot use it');
  const ex = await call(HOST, 'POST', '/api/auth/sso/exchange', { code });
  assert.equal(ex.status, 200, JSON.stringify(ex.data)); assert.ok(ex.cookie);
  assert.equal((await call(HOST, 'GET', '/api/auth/me', null, { cookie: ex.cookie })).status, 200);
  assert.equal((await call(HOST, 'POST', '/api/auth/sso/exchange', { code })).status, 401, 'a code works once');
  const tokenCall = seen.find((x) => x.url.startsWith('https://oauth2.googleapis.com/token'));
  assert.match(tokenCall.body, /client_secret=csecret/);
});

test('console check of the saved app credentials tells a wrong client from a right one', async () => {
  tokenError = 'invalid_grant';
  assert.match(await oauth.testAppCreds('google'), /recognised/);
  tokenError = 'invalid_client';
  await assert.rejects(() => oauth.testAppCreds('google'), /rejected the client/);
  tokenError = null;
});

test('Google Calendar: connect once, appointments follow to the calendar and back out when canceled', async () => {
  const l = await call(HOST, 'POST', '/api/auth/login', { identifier: 'owner@sso.test', password: 'Tenant@12345' });
  const c = l.cookie;
  const get = (u) => call(HOST, 'GET', u, null, { cookie: c });
  const post = (u, b) => call(HOST, 'POST', u, b || {}, { cookie: c });
  const put = (u, b) => call(HOST, 'PUT', u, b || {}, { cookie: c });

  assert.equal((await get('/api/integrations/oauth-status')).data.google_calendar, null);
  const early = await post('/api/appointments', { title: 'Viewing at Maple', starts_at: '2026-11-02T15:00', location: '12 Maple St' });
  assert.equal(early.status, 201); assert.equal(early.data.google_event_id, null, 'saved even without a calendar');

  const start = (await get('/api/integrations/oauth/google/start')).data;
  const au = new URL(start.url);
  assert.match(au.searchParams.get('scope'), /calendar\.events/); assert.equal(au.searchParams.get('access_type'), 'offline');
  const cb = await call('erp.test', 'GET', `/api/platform/oauth/google/callback?code=zzz&state=${au.searchParams.get('state')}`);
  assert.match(cb.location, /^http:\/\/sso\.erp\.test\/settings\/integrations\?connected=google_calendar/);
  const st = (await get('/api/integrations/oauth-status')).data;
  assert.equal(st.google_calendar.status, 'connected'); assert.equal(JSON.stringify(st).includes('g-refresh'), false, 'tokens are never sent to the browser');

  assert.equal((await post('/api/appointments', { title: 'Bad', starts_at: 'tomorrow' })).status, 400);
  assert.equal((await post('/api/appointments', { title: 'Backwards', starts_at: '2026-11-02T16:00', ends_at: '2026-11-02T15:00' })).status, 400);
  const made = await post('/api/appointments', { title: 'Open house walk-through', kind: 'viewing', starts_at: '2026-11-03T10:00', ends_at: '2026-11-03T11:30', location: '88 Congress Ave' });
  assert.equal(made.status, 201, JSON.stringify(made.data)); assert.equal(made.data.google_event_id, 'ev-1');
  const ins = seen.filter((x) => x.url.startsWith('https://www.googleapis.com/calendar')).at(-1);
  assert.equal(ins.method, 'POST'); assert.equal(ins.auth, 'Bearer g-access');
  const ev = JSON.parse(ins.body);
  assert.equal(ev.summary, 'Open house walk-through'); assert.equal(ev.start.dateTime, '2026-11-03T10:00:00'); assert.equal(ev.start.timeZone, 'America/New_York');

  const moved = await put(`/api/appointments/${made.data.id}`, { starts_at: '2026-11-03T12:00', ends_at: '2026-11-03T13:00' });
  assert.equal(moved.status, 200);
  assert.equal(seen.filter((x) => x.url.startsWith('https://www.googleapis.com/calendar')).at(-1).method, 'PATCH');
  const cancel = await post(`/api/appointments/${made.data.id}/cancel`);
  assert.equal(cancel.data.status, 'canceled'); assert.equal(cancel.data.google_event_id, null);
  assert.equal(seen.filter((x) => x.url.startsWith('https://www.googleapis.com/calendar')).at(-1).method, 'DELETE');
  const list = (await get('/api/appointments')).data;
  assert.equal(list.calendar_connected, true); assert.ok(list.items.length >= 2);
});

test('social: connect Meta, post now, schedule, see failures and a report', async () => {
  const l = await call(HOST, 'POST', '/api/auth/login', { identifier: 'owner@sso.test', password: 'Tenant@12345' });
  const c = l.cookie;
  const get = (u) => call(HOST, 'GET', u, null, { cookie: c });
  const post = (u, b) => call(HOST, 'POST', u, b || {}, { cookie: c });
  const del = (u) => call(HOST, 'DELETE', u, null, { cookie: c });

  assert.equal((await get('/api/integrations/oauth/meta/start')).status, 400, 'platform app not set up yet');
  oauth.saveAppCreds('meta', { client_id: 'APPID', client_secret: 'APPSECRET' }, 'tester');
  const start = (await get('/api/integrations/oauth/meta/start')).data;
  assert.match(start.url, /facebook\.com\/v19\.0\/dialog\/oauth/); assert.match(decodeURIComponent(start.url), /pages_manage_posts/);
  const cb = await call('erp.test', 'GET', `/api/platform/oauth/meta/callback?code=mcode&state=${new URL(start.url).searchParams.get('state')}`);
  assert.match(cb.location, /connected=meta/);

  const accounts = (await get('/api/integrations/social/accounts')).data;
  assert.deepEqual(accounts.map((a) => a.provider).sort(), ['facebook', 'instagram']);
  assert.equal(JSON.stringify(accounts).includes('page-token'), false);
  const fb = accounts.find((a) => a.provider === 'facebook'), ig = accounts.find((a) => a.provider === 'instagram');

  assert.equal((await post('/api/integrations/social/posts', { account_id: fb.id, message: '' })).status, 400);
  const now = await post('/api/integrations/social/posts', { account_id: fb.id, message: 'New listing: 12 Maple St, $425,000', link: 'https://example.com/p/1' });
  assert.equal(now.status, 201, JSON.stringify(now.data)); assert.equal(now.data.status, 'published'); assert.equal(now.data.external_post_id, 'P1_100');
  const feed = seen.find((x) => x.url.endsWith('/P1/feed'));
  assert.match(feed.body, /access_token=page-token/); assert.match(decodeURIComponent(feed.body), /message=New\+listing|message=New listing/);

  const later = await post('/api/integrations/social/posts', { account_id: fb.id, message: 'Open house Saturday', scheduled_at: '2099-01-01T10:00' });
  assert.equal(later.data.status, 'scheduled');
  const noPic = await post('/api/integrations/social/posts', { account_id: ig.id, message: 'No picture' });
  assert.equal(noPic.data.status, 'failed'); assert.match(noPic.data.error, /need a picture/);

  const rep = (await get('/api/integrations/social/report?refresh=1')).data;
  assert.equal(rep.totals.published, 1); assert.equal(rep.totals.scheduled, 1); assert.equal(rep.totals.failed, 1);
  assert.equal(rep.totals.likes, 7); assert.equal(rep.totals.impressions, 340); assert.equal(rep.totals.reach, 280);

  assert.equal((await post(`/api/integrations/social/posts/${later.data.id}/cancel`)).status, 200);
  assert.equal((await del(`/api/integrations/social/accounts/${ig.id}`)).status, 200);
  assert.equal((await get('/api/integrations/social/accounts')).data.length, 1);
});
