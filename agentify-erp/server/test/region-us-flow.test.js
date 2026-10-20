// End to end in a US workspace: amounts are whole cents, a sale splits into an installment plan that adds up exactly,
// a payment is applied, and the receipt and statement text use dollars and US dates.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'erp-usflow-'));
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

test('a US workspace runs a sale and a payment in cents', async () => {
  setRegionStatus(platformDb(), 'US', 'active', 'tester');
  const host = 'lonestar.erp.test';
  const su = await call('erp.test', 'POST', '/api/platform/signup', { accept_terms: true, slug: 'lonestar', company_name: 'Lone Star Realty', admin_name: 'Owner', admin_email: 'owner@lonestar.test', admin_password: 'Tenant@12345', region: 'US', sub_region: 'Texas' });
  assert.equal(su.status, 201, JSON.stringify(su.data));

  const l = await call(host, 'POST', '/api/auth/login', { identifier: 'owner@lonestar.test', password: 'Tenant@12345' });
  assert.equal(l.status, 200, JSON.stringify(l.data));
  const c = l.cookie;
  const get = (u) => call(host, 'GET', u, null, { cookie: c });
  const post = (u, b) => call(host, 'POST', u, b || {}, { cookie: c });

  const reg = (await get('/api/auth/region')).data;
  assert.equal(reg.currency, 'USD'); assert.equal(reg.money_scale, 2); assert.equal(reg.date_style, 'MM/DD/YYYY'); assert.equal(reg.sub_region, 'Texas');

  const contact = await post('/api/contacts', { full_name: 'Jane Buyer', phone: '+1 415 555 0100', lead_source: 'Walk-in' });
  assert.equal(contact.status, 201, JSON.stringify(contact.data));
  const prop = await post('/api/properties', { title: '12 Elm Street', property_type: 'House', total_price: 25000000 });
  assert.equal(prop.status, 201, JSON.stringify(prop.data));
  const pid = prop.data.id;
  await post(`/api/properties/${pid}/publish`).catch(() => {});

  // $250,000.00 price, $50,000.00 booking, 3 installments: the plan must add up to the cent
  const preview = await post('/api/sales/preview', { sale_price: 25000001, discount: 0, booking_amount: 5000000, num_installments: 3, first_due: '2027-02-01' });
  assert.equal(preview.status, 200, JSON.stringify(preview.data));
  assert.equal(preview.data.rows.reduce((s, r) => s + r.amount, 0), 25000001);

  const sale = await post('/api/sales', { contact_id: contact.data.id, property_id: pid, sale_price: 25000001, discount: 0, booking_amount: 5000000, num_installments: 3, first_due: '2027-02-01' });
  assert.equal(sale.status, 201, JSON.stringify(sale.data));

  const accounts = (await get('/api/accounting/accounts')).data;
  const cash = (Array.isArray(accounts) ? accounts : accounts.accounts).find((a) => a.code === '1110');
  const pay = await post('/api/receipts', { contact_id: contact.data.id, sale_id: sale.data.id, amount: 5000000, payment_type: 'Booking Payment', method: 'Cash', account_id: cash.id });
  assert.equal(pay.status, 201, JSON.stringify(pay.data));

  const detail = (await get(`/api/sales/${sale.data.id}`)).data.sale;
  assert.equal(detail.paid_amount, 5000000);
  assert.equal(detail.net_price - detail.paid_amount, 20000001);
});

test('US workspace: region fields, identity number and non-Pakistani contact data', async () => {
  const host = 'lonestar.erp.test';
  const l = await call(host, 'POST', '/api/auth/login', { identifier: 'owner@lonestar.test', password: 'Tenant@12345' });
  const c = l.cookie;
  const get = (u) => call(host, 'GET', u, null, { cookie: c });
  const post = (u, b) => call(host, 'POST', u, b || {}, { cookie: c });
  const put = (u, b) => call(host, 'PUT', u, b || {}, { cookie: c });

  const contact = await post('/api/contacts', { full_name: 'Sam Seller', phone: '+1 212 555 0123', cnic: 'not-a-pk-number' });
  assert.equal(contact.status, 201, JSON.stringify(contact.data));
  const id = contact.data.id;

  const defs = (await get(`/api/region/ext/contact/${id}`)).data;
  assert.deepEqual(defs.fields.map((f) => f.key), ['residency_state']);
  assert.ok(defs.fields[0].options.includes('Texas'));
  assert.equal((await put(`/api/region/ext/contact/${id}`, { values: { residency_state: 'Atlantis' } })).status, 400);
  assert.equal((await put(`/api/region/ext/contact/${id}`, { values: { nope: 'x' } })).status, 400);
  const saved = await put(`/api/region/ext/contact/${id}`, { values: { residency_state: 'Texas' } });
  assert.equal(saved.data.values.residency_state, 'Texas');

  const prop = await get('/api/properties');
  const pid = (Array.isArray(prop.data) ? prop.data : prop.data.items || prop.data.rows)[0].id;
  assert.equal((await put(`/api/region/ext/property/${pid}`, { values: { hoa_monthly: 12550, year_built: 1998 } })).data.values.hoa_monthly, '12550');
  assert.equal((await put(`/api/region/ext/property/${pid}`, { values: { hoa_monthly: 12.5 } })).status, 400);

  assert.equal((await put(`/api/region/identity/${id}`, { number: '123' })).status, 400);
  const idr = await put(`/api/region/identity/${id}`, { number: '123-45-6789' });
  assert.equal(idr.data.masked, '•••• 6789');
  assert.equal(JSON.stringify((await get(`/api/region/identity/${id}`)).data).includes('123456789'), false);
  assert.equal((await post(`/api/region/identity/${id}/reveal`)).data.number, '123456789');
});
