// Identity numbers (SSN, SIN, NI number, Emirates ID, CNIC ...) are stored encrypted, shown masked, and every reveal is audited.
// The table lives in each workspace database; the encryption key is the platform secrets key.
import { run, get, all } from '../db.js';
import { encrypt, decrypt } from '../services/platformConfig.js';
import { audit } from '../audit.js';
import { bad } from '../util.js';
import { currentRegion } from './runtime.js';


const mask = (last4) => `•••• ${last4}`;
const clean = (v) => String(v || '').replace(/[\s-]/g, '');

/** Validates against the region's pattern for this kind of identity number. Returns the cleaned number. */
export function validateIdentity(number, kind = 'national_id') {
  const cfg = currentRegion().config.identity?.[kind];
  const n = String(number || '').trim();
  if (!n) throw bad('Identity number is required');
  if (cfg?.pattern && !new RegExp(cfg.pattern).test(n)) throw bad(`That does not look like a valid ${cfg.label || 'identity number'}`);
  return clean(n);
}

export function saveIdentity(req, contactId, number, kind = 'national_id') {
  const n = validateIdentity(number, kind);
  const region = currentRegion().config.region;
  run(`INSERT INTO identity_documents(contact_id, kind, region, number_enc, last4, created_by, updated_at) VALUES(?,?,?,?,?,?,datetime('now'))
       ON CONFLICT(contact_id, kind) DO UPDATE SET number_enc=excluded.number_enc, last4=excluded.last4, region=excluded.region, updated_at=excluded.updated_at`,
  contactId, kind, region, encrypt(n), n.slice(-4), req?.user?.id ?? null);
  audit(req, 'Saved identity number', 'contact', contactId, { kind });
  return { masked: mask(n.slice(-4)) };
}

export function maskedIdentity(contactId, kind = 'national_id') {
  const row = get('SELECT last4, region, updated_at FROM identity_documents WHERE contact_id=? AND kind=?', contactId, kind);
  return row ? { masked: mask(row.last4), region: row.region, updated_at: row.updated_at } : null;
}

/** Full number, for users who hold the permission; the access itself is written to the audit log. */
export function revealIdentity(req, contactId, kind = 'national_id') {
  const row = get('SELECT number_enc FROM identity_documents WHERE contact_id=? AND kind=?', contactId, kind);
  if (!row) return null;
  audit(req, 'Revealed identity number', 'contact', contactId, { kind });
  return decrypt(row.number_enc);
}

export const listIdentities = (contactId) => { return all('SELECT kind, last4, region, updated_at FROM identity_documents WHERE contact_id=?', contactId).map((r) => ({ ...r, masked: mask(r.last4) })); };
