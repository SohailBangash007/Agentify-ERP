// Maintenance mode and the recent-errors list for the super admin console.
//
// Maintenance mode closes every workspace (their API answers 503 with the message) while the platform console, sign-up
// page and payment webhooks keep working, so the operator can always switch it off again from /platform.
import { platformDb } from '../platform.js';
import { bad } from '../util.js';

let cache;
export function getMaintenance() {
  if (cache !== undefined) return cache;
  const v = platformDb().prepare("SELECT value FROM platform_settings WHERE key='maintenance'").get()?.value;
  try { cache = v ? JSON.parse(v) : { on: false }; } catch { cache = { on: false }; }
  return cache;
}
export function setMaintenance({ on, message, reason }, actor) {
  if (typeof on !== 'boolean') throw bad('Say whether maintenance mode is on or off');
  if (on && String(reason || '').trim().length < 3) throw bad('A reason is required to start maintenance');
  const msg = String(message || '').trim().slice(0, 300) || 'We are carrying out scheduled maintenance. Please try again shortly.';
  const v = on ? { on: true, message: msg, reason: String(reason).trim().slice(0, 300), since: new Date().toISOString(), by: actor } : { on: false, ended_at: new Date().toISOString(), by: actor };
  platformDb().prepare("INSERT INTO platform_settings(key,value,updated_by,updated_at) VALUES('maintenance',?,?,datetime('now')) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_by=excluded.updated_by, updated_at=excluded.updated_at").run(JSON.stringify(v), actor);
  cache = v;
  return v;
}
/** Express middleware for /api: during maintenance workspaces get 503; the platform console and webhooks are never blocked. */
export function maintenanceGate(req, res, next) {
  if (req.path.startsWith('/platform/') || req.path === '/platform') return next();
  const m = getMaintenance();
  if (!m.on) return next();
  res.setHeader('Retry-After', '600');
  return res.status(503).json({ error: m.message, code: 'maintenance' });
}

// ---------------------------------------------------------------- recent server errors (no stack traces, no request bodies)
const errors = [];
export function recordError(err, req) {
  errors.push({ at: new Date().toISOString(), method: req.method, path: String(req.path || '').slice(0, 200), host: req.hostname, message: String(err?.message || err).slice(0, 300) });
  if (errors.length > 100) errors.shift();
}
export const recentErrors = () => errors.slice().reverse();
