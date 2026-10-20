import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'erp-region-'));
process.env.ERP_DATA_DIR = dir;
process.env.ERP_UPLOAD_DIR = path.join(dir, 'uploads');
process.env.ERP_DB = path.join(dir, 'r.db');
delete process.env.ERP_BASE_DOMAIN;

const { platformDb } = await import('../src/platform.js');
const admin = await import('../src/regions/admin.js');
const { selectableRegions } = await import('../src/regions/index.js');
const { regionFor } = await import('../src/regions/runtime.js');
const { openDb, run, get } = await import('../src/db.js');
const { als } = await import('../src/context.js');
const identity = await import('../src/regions/identity.js');

test('only Pakistan is selectable until another region is switched on', () => {
  const pdb = platformDb();
  assert.deepEqual([...selectableRegions(pdb).keys()], ['PK']);
  admin.setRegionStatus(pdb, 'US', 'active', 'tester');
  assert.deepEqual([...selectableRegions(pdb).keys()].sort(), ['PK', 'US']);
  assert.equal(regionFor({ region: 'US', money_scale: 2 }).config.pack_version, 1);
  admin.setRegionStatus(pdb, 'US', 'draft', 'tester');
  assert.deepEqual([...selectableRegions(pdb).keys()], ['PK']);
  assert.throws(() => admin.setRegionStatus(pdb, 'PK', 'draft', 'tester'), /stays active/);
});

test('flags change what a workspace sees and are audited', () => {
  const pdb = platformDb();
  admin.setRegionFlag(pdb, 'US', 'mortgage', true, 'tester');
  assert.equal(regionFor({ region: 'US', money_scale: 2 }).config.flags.mortgage, true);
  assert.equal(regionFor({ region: 'US', money_scale: 2, flags: JSON.stringify({ mortgage: false }) }).config.flags.mortgage, false);
  const row = pdb.prepare("SELECT action FROM region_rule_audit WHERE action='flag:mortgage'").get();
  assert.ok(row);
  assert.throws(() => admin.setRegionFlag(pdb, 'US', 'Bad Flag!', true, 'tester'), /Invalid flag/);
});

test('rules are versioned, start unreviewed, and reviewing is recorded', () => {
  const pdb = platformDb();
  const a = admin.saveRule(pdb, { region: 'US', kind: 'fee', key: 'transfer', effective_from: '2026-01-01', value: { rate_bp: 100 } }, 'tester');
  const b = admin.saveRule(pdb, { region: 'US', kind: 'fee', key: 'transfer', effective_from: '2027-01-01', value: { rate_bp: 120 } }, 'tester');
  const rows = admin.listRules(pdb, 'US');
  assert.deepEqual(rows.map((r) => r.version), [2, 1]);
  assert.ok(rows.every((r) => r.needs_legal_review === 1));
  admin.reviewRule(pdb, a, 'lawyer');
  assert.equal(admin.listRules(pdb, 'US').find((r) => r.id === a).needs_legal_review, 0);
  assert.equal(admin.listRules(pdb, 'US').find((r) => r.id === b).needs_legal_review, 1);
  assert.throws(() => admin.saveRule(pdb, { region: 'US', kind: 'fee', key: 'x', effective_from: 'soon', value: 1 }, 't'), /YYYY-MM-DD/);
  assert.ok(admin.ruleAudit(pdb, 'US').length >= 3);
});

test('exchange rates are stored as integers', () => {
  const pdb = platformDb();
  admin.saveFx(pdb, { base: 'USD', quote: 'PKR', rate: 278.4567, as_of: '2026-06-15' }, 'tester');
  const fx = admin.listFx(pdb).find((x) => x.quote === 'PKR');
  assert.equal(fx.rate_ppm, 278456700);
  assert.throws(() => admin.saveFx(pdb, { base: 'USD', quote: 'USD', rate: 1 }, 't'), /different/);
});

test('identity numbers are encrypted, masked, validated by region, and reveals are audited', async () => {
  const db = openDb(path.join(dir, 'tenant.db'));
  const tenant = { id: 99, slug: 'us-test', region: 'US', money_scale: 2, timezone: 'America/New_York', currency: 'USD' };
  const req = { user: { id: 1, name: 'Admin', role: 'admin' }, ip: '127.0.0.1' };
  als.run({ tenant, db }, () => {
    assert.throws(() => identity.saveIdentity(req, 1, '12345'), /valid/);
    const out = identity.saveIdentity(req, 1, '123-45-6789');
    assert.equal(out.masked, '•••• 6789');
    const raw = get('SELECT number_enc FROM identity_documents WHERE contact_id=1').number_enc;
    assert.ok(!raw.includes('123456789'));
    assert.equal(identity.maskedIdentity(1).masked, '•••• 6789');
    assert.equal(identity.revealIdentity(req, 1), '123456789');
    assert.ok(get("SELECT 1 FROM audit_log WHERE action='Revealed identity number'"));
  });
});
