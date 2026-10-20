import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isRtl } from '../../shared/region/i18n.js';
import { buildRegion, createMoney, createPhone, createUnits, createT, createFormat, effective, bracketTax } from '../../shared/region/index.js';
import { regionFor, configFor, clientConfig, REGION_CODES, FILE_PACKS } from '../src/regions/runtime.js';

test('every shipped pack has the fields the runtime needs', () => {
  assert.deepEqual(REGION_CODES.sort(), ['AE', 'CA', 'PK', 'UK', 'US']);
  for (const p of Object.values(FILE_PACKS)) {
    for (const k of ['code', 'name', 'locale', 'currency', 'timezone', 'date_style', 'phone']) assert.ok(p[k], `${p.code} missing ${k}`);
    assert.ok(Number.isInteger(p.money_scale) && p.money_scale >= 0);
  }
  assert.equal(FILE_PACKS.PK.status, 'active');
});

test('a workspace with no region behaves as Pakistan', () => {
  const r = regionFor(null);
  assert.equal(r.money.format(1234567), 'PKR 1,234,567');
  assert.equal(r.fmt.date('2026-10-07'), '07-Oct-2026');
  assert.equal(clientConfig({}).region, 'PK');
});

test('US workspace uses cents, US dates and its own terms', () => {
  const t = { region: 'US', sub_region: 'Texas', money_scale: 2 };
  const r = regionFor(t);
  assert.equal(r.money.format(123456), '$1,234.56');
  assert.equal(r.fmt.date('2026-10-07'), '10/07/2026');
  assert.equal(r.term('agent', 'Agent'), 'Realtor');
  assert.equal(configFor(t).sub_region, 'Texas');
});

test('money arithmetic stays in integers and rounds half away from zero', () => {
  const m = createMoney({ currency: 'USD', scale: 2, locale: 'en-US', style: 'intl' });
  assert.equal(m.pct(10005, 2.5), 250); // 250.125 -> 250
  assert.equal(m.pct(-10010, 2.5), -250); // -250.25 -> -250
  assert.equal(m.mul(1, 0.5), 1);
  assert.equal(m.mul(-1, 0.5), -1);
  assert.equal(m.split(100, [1, 1, 1]).reduce((a, b) => a + b, 0), 100);
  assert.equal(m.fromMajor('12.345'), 1235);
  assert.equal(m.toMajor(1235), 12.35);
});

test('phone matching: Pakistan by last 10 digits, others by full international number', () => {
  const pk = createPhone({ calling_code: '92', trunk: '0', match_tail: 10, national_length: [10] });
  assert.ok(pk.same('0300-1234567', '+92 300 1234567'));
  const us = createPhone({ calling_code: '1', trunk: '1', match_tail: 0, national_length: [10] });
  assert.equal(us.e164('(415) 555-0100'), '+14155550100');
  assert.ok(!us.same('4155550100', '4155550101'));
});

test('units convert marla and square feet both ways', () => {
  const u = createUnits({ marlaSqFt: 272.25 });
  assert.equal(u.round(u.convertArea(1, 'marla', 'sqft')), 272.25);
  assert.equal(u.round(u.convertArea(20, 'marla', 'kanal')), 1);
});

test('translations fall back through the locale chain and know right-to-left', () => {
  const t = createT({ locale: 'fr-CA', fallback: 'en', messages: { en: { hi: 'Hello', only_en: 'English' }, fr: { hi: 'Bonjour' } } });
  assert.equal(t('hi'), 'Bonjour');
  assert.equal(t('only_en'), 'English');
  assert.equal(t('missing', 'Default'), 'Default');
  assert.equal(isRtl('ar-AE'), true);
  assert.equal(isRtl('en-US'), false);
});

test('rules are chosen by effective date and latest version', () => {
  const base = { region: 'US', kind: 'fee', key: 'rate' };
  const rows = [
    { ...base, id: 1, effective_from: '2020-01-01', effective_to: '2026-01-01', value: 1 },
    { ...base, id: 2, effective_from: '2026-01-01', effective_to: null, value: 2 },
  ];
  assert.equal(effective(rows, '2024-05-05')[0].value, 1);
  assert.equal(effective(rows, '2026-05-05')[0].value, 2);
  assert.equal(effective(rows, '2019-01-01').length, 0);
});

test('bracket tax is marginal and integer', () => {
  const r = bracketTax(150000, [{ from: 0, to: 100000, rate_bp: 100 }, { from: 100000, to: null, rate_bp: 200 }]);
  assert.equal(r.total, 1000 + 1000);
  assert.equal(bracketTax(1005, [], { flat_bp: 250 }).total, 25); // 25.125 -> 25
});

test('formatting honours the 24-hour style', () => {
  const f = createFormat({ date_style: 'DD/MM/YYYY', time_style: '24h', timezone: 'Europe/London' });
  assert.equal(f.dateTime('2026-10-07 15:04:00'), '07/10/2026 15:04');
  assert.ok(buildRegion({ region: 'UK', currency: 'GBP', money_scale: 2, currency_style: 'intl', locale: 'en-GB' }).money.format(100000).includes('1,000.00'));
});

import { payment, schedule, totals, affordability, loanToValue, canMove } from '../../shared/region/mortgage.js';
test('mortgage maths: known payment, schedule ends at zero, interest adds up', () => {
  // $300,000 at 6% for 30 years -> $1,798.65 per month
  assert.equal(payment({ principal: 30000000, annual_bp: 600, term_months: 360 }), 179865);
  const rows = schedule({ principal: 30000000, annual_bp: 600, term_months: 360 });
  assert.equal(rows.length, 360);
  assert.equal(rows.at(-1).balance, 0);
  const t = totals(rows);
  assert.equal(t.paid - t.interest, 30000000);
  assert.equal(payment({ principal: 120000, annual_bp: 0, term_months: 12 }), 10000);
  assert.ok(schedule({ principal: 30000000, annual_bp: 600, term_months: 360, extra_monthly: 50000 }).length < 360);
  assert.equal(loanToValue({ price: 40000000, down: 8000000 }), 8000);
  const a = affordability({ gross_monthly_income: 800000, monthly_debts: 100000, max_dti_bp: 4300, annual_bp: 600, term_months: 360, down: 4000000 });
  assert.equal(a.max_payment, 244000);
  assert.ok(Math.abs(payment({ principal: a.max_loan, annual_bp: 600, term_months: 360 }) - a.max_payment) <= 1);
  assert.ok(canMove('enquiry', 'pre_qualified')); assert.ok(!canMove('enquiry', 'funded'));
  // Canadian semi-annual compounding gives a slightly lower payment than monthly at the same quoted rate
  assert.ok(payment({ principal: 30000000, annual_bp: 600, term_months: 300, compounding: 'semiannual' }) < payment({ principal: 30000000, annual_bp: 600, term_months: 300 }));
});

import { render as renderTpl, placeholders, unknownVariables, checklistStatus } from '../../shared/region/templates.js';
test('templates fill placeholders safely and report what is missing', () => {
  const body = 'Hi {{client.name}}, pay {{amount|money}} by {{due|date}} {{nope}}';
  assert.deepEqual(placeholders(body), ['client.name', 'amount', 'due', 'nope']);
  const out = renderTpl(body, { client: { name: '<b>Ann</b>' }, amount: 123456, due: '2026-10-07' }, { fmt: { money: (v) => `$${v / 100}`, date: (v) => v } });
  assert.equal(out.text, 'Hi &lt;b&gt;Ann&lt;/b&gt;, pay $1234.56 by 2026-10-07 [nope]');
  assert.deepEqual(out.missing, ['nope']);
  assert.deepEqual(unknownVariables('receipt_note', 'x {{client.name}} {{evil}}'), ['evil']);
  const items = [{ key: 'a', required: true }, { key: 'b', required: false }];
  assert.equal(checklistStatus(items, {}).complete, false);
  assert.equal(checklistStatus(items, { a: { done: true } }).complete, true);
});
