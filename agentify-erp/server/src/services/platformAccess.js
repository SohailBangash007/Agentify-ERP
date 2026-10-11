// Roles and permissions for super admin console users, and the request context the audit log records.
// Roles are fixed here (not editable in the UI) so a mistake in the console can never lock everyone out or widen access.
import crypto from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { HttpError } from '../util.js';

export const PERMISSIONS = {
  'dashboard.view': 'See the dashboard, alerts and search',
  'workspaces.view': 'See workspaces, their users and activity',
  'workspaces.create': 'Create workspaces',
  'workspaces.edit': 'Edit workspace profile, owner, notes, limits and trials',
  'workspaces.suspend': 'Suspend, cancel or reactivate workspaces',
  'workspaces.support': 'Help workspace users sign in (reset links, 2FA, confirmations)',
  'workspaces.export': 'Export workspace and transaction lists',
  'billing.view': 'See payments, invoices, plans and subscription history',
  'billing.manage': 'Approve or record payments and change subscriptions',
  'billing.configure': 'Edit plans, prices, Stripe keys and payment accounts',
  'system.view': 'See system health, setup, backups and errors',
  'system.manage': 'Run backups and switch maintenance mode',
  'audit.view': 'See the audit log, sign-in history and sessions',
  'admins.manage': 'Add, change and remove super admin users and security rules',
};
const ALL = Object.keys(PERMISSIONS);
const VIEW = ['dashboard.view', 'workspaces.view', 'billing.view', 'system.view'];
export const ROLES = {
  super_admin: { label: 'Super Admin', perms: ALL },
  platform_admin: { label: 'Platform Administrator', perms: ALL.filter((p) => p !== 'admins.manage') },
  finance_admin: { label: 'Finance Administrator', perms: [...VIEW, 'billing.manage', 'billing.configure', 'workspaces.export'] },
  customer_success: { label: 'Customer Success Manager', perms: [...VIEW, 'workspaces.create', 'workspaces.edit', 'workspaces.support', 'workspaces.export'] },
  technical_admin: { label: 'Technical Administrator', perms: [...VIEW, 'system.manage', 'workspaces.support', 'audit.view'] },
  security_auditor: { label: 'Security Auditor', perms: [...VIEW, 'audit.view', 'workspaces.export'] },
  read_only: { label: 'Read-Only Analyst', perms: VIEW },
};
export const permsOf = (role) => ROLES[role]?.perms || [];
export const can = (operator, perm) => operator?.via === 'token' || permsOf(operator?.role).includes(perm);

// ---------------------------------------------------------------- request context for the audit log
export const auditCtx = new AsyncLocalStorage();
/** Express middleware: gives every console request an id (also sent back as X-Request-Id) and remembers who/where for audit rows. */
export function auditContext(req, res, next) {
  const rid = crypto.randomBytes(8).toString('hex');
  res.setHeader('X-Request-Id', rid);
  auditCtx.run({ rid, ip: req.ip, ua: String(req.headers['user-agent'] || '').slice(0, 200), req }, next);
}

let mfaRequired = () => false;
/** platformAuth registers how to read the "require two-factor" rule (kept there to avoid an import cycle). */
export const setMfaRule = (fn) => { mfaRequired = fn; };
/** What an admin without two-factor may still do while two-factor is required: see themselves and set it up. */
const MFA_EXEMPT = new Set(['self']);

/** Route guard: the signed-in admin's role must include `perm`. Denials are written to the audit log. */
export const need = (perm) => (req, _res, next) => {
  const op = req.operator;
  if (op?.via === 'session' && !MFA_EXEMPT.has(perm) && mfaRequired() && !op.totp_enabled) {
    return next(new HttpError(403, 'Two-factor sign-in is required for console users. Set it up under Security first.', { code: 'mfa_required' }));
  }
  if (perm === 'self' || can(op, perm)) return next();
  denied(op, perm, req);
  next(new HttpError(403, 'Your role does not allow this', { code: 'forbidden', permission: perm }));
};
let deniedHook = () => {};
export const onDenied = (fn) => { deniedHook = fn; };
const denied = (op, perm, req) => { try { deniedHook(op, perm, req); } catch { /* never block the response on logging */ } };
