// Pakistan display formatting snapshot (client/src/format.js). Recorded before the multi-region refactor.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as f from '../../client/src/format.js';

const GOLDEN = new URL('./golden/format.json', import.meta.url);
const NUMS = [0, 1, 999, 1000, 12345, 1234567, 99999999, 1250000000, -5, -1234567, 0.4, 0.5, 1.5, 2.5, '12', '', null, undefined, 'abc'];
const DATES = ['2026-10-07', '2026-01-31 14:05:09', '2026-12-25T00:00:00', '2026-02-03T23:59', '', null, 'not-a-date'];

function build() {
  const out = {};
  for (const n of NUMS) {
    const k = String(n);
    out[`money(${k})`] = f.money(n);
    out[`money+(${k})`] = f.money(n, { sign: true });
    out[`num(${k})`] = f.num(n);
    out[`moneyShort(${k})`] = f.moneyShort(n);
  }
  for (const d of DATES) { out[`date(${d})`] = f.date(d); out[`dateTime(${d})`] = f.dateTime(d); out[`month(${d})`] = f.month(d); }
  out['titleCase'] = f.titleCase('partially_paid sale_kind');
  out['initials'] = f.initials('Ayesha Rehman Khan');
  return out;
}

test('Pakistan formatting is unchanged', () => {
  const got = build();
  if (process.env.UPDATE_GOLDEN === '1') { fs.writeFileSync(GOLDEN, JSON.stringify(got, null, 1)); return; }
  assert.deepEqual(got, JSON.parse(fs.readFileSync(GOLDEN, 'utf8')));
});
