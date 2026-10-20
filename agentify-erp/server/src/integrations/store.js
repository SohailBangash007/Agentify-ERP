// Per-workspace integration settings. Credentials are stored encrypted (AES-256-GCM, the platform secrets key) and are
// never sent back to the browser: the app only learns that a secret is set and its last 4 characters. A provider is
// shown as "connected" only after a real request to it succeeded (see each provider's test function).
import { run, get, all } from '../db.js';
import { encrypt, decrypt } from '../services/platformConfig.js';
import { now } from '../util.js';


export const mask = (v) => (v ? `••••${String(v).slice(-4)}` : '');

export function saveIntegration(provider, config, { publicInfo = null, status = 'configured', userId = null } = {}) {
  run(`INSERT INTO tenant_integrations(provider, status, config_enc, public_info, connected_by, connected_at) VALUES(?,?,?,?,?,?)
       ON CONFLICT(provider) DO UPDATE SET status=excluded.status, config_enc=excluded.config_enc, public_info=excluded.public_info, connected_by=excluded.connected_by, connected_at=excluded.connected_at, last_error=NULL`,
  provider, status, encrypt(JSON.stringify(config)), publicInfo ? JSON.stringify(publicInfo) : null, userId, now());
}
export function integrationConfig(provider) {
  const row = get('SELECT config_enc FROM tenant_integrations WHERE provider=?', provider);
  if (!row?.config_enc) return null;
  try { return JSON.parse(decrypt(row.config_enc)); } catch { return null; }
}
export const integrationRow = (provider) => get('SELECT provider, status, public_info, connected_at, last_test_at, last_error FROM tenant_integrations WHERE provider=?', provider) || null;
export const allIntegrations = () => all('SELECT provider, status, public_info, connected_at, last_test_at, last_error FROM tenant_integrations');
export function markTested(provider, ok, error = null) {
  run('UPDATE tenant_integrations SET status=?, last_test_at=?, last_error=? WHERE provider=?', ok ? 'connected' : 'error', now(), ok ? null : String(error || 'failed').slice(0, 300), provider);
}
export const removeIntegration = (provider) => run('DELETE FROM tenant_integrations WHERE provider=?', provider);
export function logIntegration(provider, action, outcome, detail = null, userId = null) {
  run('INSERT INTO integration_log(provider, action, outcome, detail, user_id, created_at) VALUES(?,?,?,?,?,?)', provider, action, outcome, detail ? String(detail).slice(0, 400) : null, userId, now());
}
