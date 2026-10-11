// Backups: a consistent snapshot of platform.db and every workspace database (SQLite `VACUUM INTO`, safe while the server runs),
// kept in dated folders with simple retention. Uploaded files are copied too when BACKUP_UPLOADS=1.
// NOT included, on purpose: the encryption key (ERP_SECRETS_KEY or data/.secrets-key) and JWT secret. Keep those somewhere separate;
// a backup plus the key is a full copy of your customers' data and your Stripe keys.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { DATA_DIR, db } from '../db.js';
import { platformDb, listTenants, withTenant } from '../platform.js';

export const backupDir = () => path.resolve(process.env.BACKUP_DIR || path.join(DATA_DIR, 'backups'));
const keepCount = () => Math.max(1, Number(process.env.BACKUP_KEEP) || 14);
const stamp = (d = new Date()) => d.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 13); // 20261010-1030

const vacuumInto = (conn, file) => { fs.rmSync(file, { force: true }); conn.prepare('VACUUM INTO ?').run(file); };

/** One consistent copy of the current workspace's database in a temp file. The caller deletes it. */
export function snapshotCurrent() {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'erp-snap-')), 'workspace.db');
  vacuumInto(db, f);
  return f;
}

export function runBackup({ uploads = process.env.BACKUP_UPLOADS === '1' } = {}) {
  const name = stamp();
  const dir = path.join(backupDir(), name);
  fs.mkdirSync(path.join(dir, 'tenants'), { recursive: true });
  vacuumInto(platformDb(), path.join(dir, 'platform.db'));
  const errors = [];
  let tenants = 0;
  for (const t of listTenants()) {
    try {
      withTenant(t, () => vacuumInto(db, path.join(dir, 'tenants', `${t.slug}.db`)));
      if (uploads && fs.existsSync(t.upload_dir)) fs.cpSync(t.upload_dir, path.join(dir, 'uploads', t.slug), { recursive: true });
      tenants += 1;
    } catch (e) { errors.push(`${t.slug}: ${e.message}`); }
  }
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ created_at: new Date().toISOString(), tenants, uploads, errors }, null, 2));
  prune();
  return { name, tenants, uploads, errors, bytes: sizeOf(dir) };
}

const sizeOf = (p) => { const s = fs.statSync(p); return s.isDirectory() ? fs.readdirSync(p).reduce((n, f) => n + sizeOf(path.join(p, f)), 0) : s.size; };
const folders = () => (fs.existsSync(backupDir()) ? fs.readdirSync(backupDir()).filter((n) => /^\d{8}-\d{4}$/.test(n)).sort() : []);

export function listBackups() {
  return folders().reverse().map((name) => {
    let m = {}; try { m = JSON.parse(fs.readFileSync(path.join(backupDir(), name, 'manifest.json'), 'utf8')); } catch { /* unfinished */ }
    return { name, created_at: m.created_at || null, tenants: m.tenants ?? null, uploads: !!m.uploads, errors: m.errors || [], bytes: sizeOf(path.join(backupDir(), name)) };
  });
}

function prune() {
  const all = folders();
  for (const n of all.slice(0, Math.max(0, all.length - keepCount()))) fs.rmSync(path.join(backupDir(), n), { recursive: true, force: true });
}

/** Hourly check; takes a backup when the newest is older than BACKUP_EVERY_HOURS (default 24). BACKUP_ENABLED=0 turns it off. */
export function scheduleBackups() {
  if (process.env.BACKUP_ENABLED === '0') return;
  const every = (Number(process.env.BACKUP_EVERY_HOURS) || 24) * 3600e3;
  const check = () => {
    try {
      const last = listBackups()[0]?.created_at;
      if (!last || Date.now() - Date.parse(last) >= every) { const r = runBackup(); console.log(`Backup ${r.name}: ${r.tenants} workspace(s), ${r.errors.length} error(s)`); }
    } catch (e) { console.error('Backup failed:', e.message); }
  };
  setTimeout(check, 60_000).unref();
  setInterval(check, 3600e3).unref();
}
