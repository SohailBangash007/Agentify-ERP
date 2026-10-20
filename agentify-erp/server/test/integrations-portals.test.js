// Portal feeds and the UAE advertising-permit rule, in a UAE workspace.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'erp-portals-'));
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
const { platformDb, getTenantBySlug, withTenant } = await import('../src/platform.js');
const { setRegionStatus } = await import('../src/regions/admin.js');
const { run } = await import('../src/db.js');
let server, port;
before(() => new Promise((res) => { server = createApp().listen(0, () => { port = server.address().port; res(); }); }));
after(async () => { server.close(); const { closeDbs } = await import('../src/db.js'); closeDbs(); });

const call = (host, method, url, body, headers = {}) => new Promise((resolve, reject) => {
  const data = body ? JSON.stringify(body) : null;
  const req = http.request({ host: '127.0.0.1', port, path: url, method, headers: { Host: host, 'Content-Type': 'application/json', 'X-Requested-With': 'ERP', ...headers, ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}) } }, (res) => {
    let t = ''; res.on('data', (c) => { t += c; });
    res.on('end', () => { let d; try { d = JSON.parse(t); } catch { d = t; } resolve({ status: res.statusCode, data: d, cookie: (res.headers['set-cookie'] || [])[0]?.split(';')[0] }); });
  });
  req.on('error', reject); if (data) req.write(data); req.end();
});
const HOST = 'gulf.erp.test';

test('UAE listing needs a permit number; portals get a tokenised feed of ready, published listings', async () => {
  setRegionStatus(platformDb(), 'AE', 'active', 'tester');
  const su = await call('erp.test', 'POST', '/api/platform/signup', { accept_terms: true, slug: 'gulf', company_name: 'Gulf Homes', admin_name: 'Owner', admin_email: 'owner@gulf.test', admin_password: 'Tenant@12345', region: 'AE', sub_region: 'Dubai' });
  assert.equal(su.status, 201, JSON.stringify(su.data));
  const l = await call(HOST, 'POST', '/api/auth/login', { identifier: 'owner@gulf.test', password: 'Tenant@12345' });
  const c = l.cookie;
  const get = (u) => call(HOST, 'GET', u, null, { cookie: c });
  const post = (u, b) => call(HOST, 'POST', u, b || {}, { cookie: c });
  const put = (u, b) => call(HOST, 'PUT', u, b || {}, { cookie: c });

  const list = (await get('/api/integrations/portals')).data.portals.map((p) => p.id);
  assert.ok(list.includes('bayut') && list.includes('property_finder') && !list.includes('zillow') && !list.includes('rightmove'), 'only the UAE portals');

  const prop = await post('/api/properties', { title: 'Marina View 2BR', property_type: 'Apartment', city: 'Dubai', address: 'Dubai Marina, Tower 3', total_price: 120000000, features: { bedrooms: 2, bathrooms: 2 } });
  assert.equal(prop.status, 201, JSON.stringify(prop.data));
  const id = prop.data.id;

  // no permit: not publishable on the website
  const noPermit = await post(`/api/properties/${id}/publish`);
  assert.equal(noPermit.status, 400); assert.match(noPermit.data.error, /advertising permit number/);
  assert.equal((await put(`/api/region/ext/property/${id}`, { values: { rera_permit_no: '7123456789' } })).status, 200);
  assert.equal((await post(`/api/properties/${id}/publish`)).status, 200);

  // portal readiness: the photo is missing
  let ready = (await get(`/api/integrations/portals/readiness/${id}`)).data;
  assert.deepEqual(ready.find((x) => x.id === 'bayut').missing, ['at least one photo']);
  const early = await post('/api/integrations/portals/publish', { property_id: id, portals: ['bayut', 'zameen'] });
  assert.equal(early.data.results.find((x) => x.portal === 'bayut').ok, false);
  assert.match(early.data.results.find((x) => x.portal === 'bayut').error, /photo/);
  assert.equal(early.data.results.find((x) => x.portal === 'zameen').ok, false, 'Zameen is a Pakistan portal');

  withTenant(getTenantBySlug('gulf'), () => run("INSERT INTO media(entity_type, entity_id, kind, path, sort_order, created_at) VALUES('property', ?, 'image', 'media/marina.jpg', 0, datetime('now'))", id));
  ready = (await get(`/api/integrations/portals/readiness/${id}`)).data;
  assert.deepEqual(ready.find((x) => x.id === 'bayut').missing, []);
  const ok = await post('/api/integrations/portals/publish', { property_id: id, portals: ['bayut'] });
  assert.equal(ok.data.results[0].ok, true); assert.equal(ok.data.results[0].via, 'feed');

  // the feed: needs the token, shows only what is published to that portal
  const url = new URL((await get('/api/integrations/portals')).data.portals.find((p) => p.id === 'bayut').feed.xml);
  assert.equal((await call(HOST, 'GET', url.pathname)).status, 404, 'no token');
  assert.equal((await call(HOST, 'GET', `${url.pathname}?token=wrong`)).status, 404);
  const xml = (await call(HOST, 'GET', `${url.pathname}${url.search}`)).data;
  assert.match(xml, /<price currency="AED">1200000<\/price>/); assert.match(xml, /<permit_number>7123456789<\/permit_number>/); assert.match(xml, /<photo>http:\/\/gulf\.erp\.test\/uploads\/media\/marina\.jpg<\/photo>/);
  const other = new URL(`${url.origin}${url.pathname.replace('bayut', 'property_finder')}${url.search}`);
  assert.doesNotMatch((await call(HOST, 'GET', `${other.pathname}${other.search}`)).data, /Marina View/, 'not published to Property Finder');
  const json = (await call(HOST, 'GET', `${url.pathname.replace('.xml', '.json')}${url.search}`)).data;
  assert.equal(json.listings[0].reference.length > 0, true);

  // withdrawn listings leave the feed
  await post('/api/integrations/portals/unpublish', { property_id: id, portals: ['bayut'] });
  assert.doesNotMatch((await call(HOST, 'GET', `${url.pathname}${url.search}`)).data, /Marina View/);
});
