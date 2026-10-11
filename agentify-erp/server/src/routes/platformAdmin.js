// Platform admin console API (mounted at /api/platform/admin). Sign-in, payment settings (Stripe keys, local payment accounts).
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { asyncH, bad, HttpError } from '../util.js';
import { platformDb, BASE_DOMAIN, isMultiTenant } from '../platform.js';
import { COOKIE, login, loginMfa, changePassword, requireOperator, onPlatformHost, twofaStatus, twofaSetup, twofaEnable, twofaDisable,
  loginMeta, endSession, listSessions, revokeSession, revokeAllFor, loginHistory, mfaRequired } from '../services/platformAuth.js';
import { ROLES, PERMISSIONS, permsOf, can, need, auditContext, onDenied } from '../services/platformAccess.js';
import { getMaintenance, setMaintenance, recentErrors } from '../services/maintenance.js';
import { reportList, runReport, exportReport, savedViews, saveView, deleteView, reconcile } from '../services/platformReports.js';
import { stripeView, saveStripe, stripeConfig, STRIPE_MODES, audit } from '../services/platformConfig.js';
import { testConnection } from '../services/stripe.js';
import { LOCAL_METHODS } from '../services/billing.js';
import { runBackup, listBackups, backupDir } from '../services/backup.js';
import { dashboard, health, listNotifications, markRead, search, generateNotifications } from '../services/platformMetrics.js';
import { overview, tenantSummaries, tenantDetail, createWorkspace, extendTrial, extendGrace, remindOwner, setOwner, userAction, setupChecklist, listAdmins, addAdmin, removeAdmin,
  updateAdmin, changeStatus, updateProfile, setEntitlements, listNotes, addNote, recordManualPayment, resendOnboarding, transactions } from '../services/platformTenants.js';
import { listPlans, savePlan, savePlanSettings } from '../services/plansStore.js';
import { PLAN_SETTINGS, MODULES } from '../services/plans.js';
import { setSubscription } from '../services/billing.js';
import { subscriptionHistory } from '../services/subscriptions.js';

const r = Router();
// every console request gets a request id and its IP / browser recorded with any audit row it writes
r.use(auditContext);
onDenied((op, perm, req) => audit(op?.email || 'unknown', 'permission-denied', { permission: perm, path: `${req.method} ${req.baseUrl}${req.path}` }, { outcome: 'denied' }));
const limiter = rateLimit({ windowMs: 60_000, limit: Number(process.env.LOGIN_LIMIT) || 10, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many attempts. Try again in a minute.' } });
const cookieOpts = { httpOnly: true, sameSite: 'strict', secure: process.env.NODE_ENV === 'production', maxAge: 8 * 3600 * 1000 };

r.post('/login', limiter, asyncH((req, res) => {
  if (!onPlatformHost(req)) throw new HttpError(404, 'Not found');
  if (req.headers['x-requested-with'] !== 'ERP') throw new HttpError(403, 'CSRF check failed');
  const out = login(req.body?.email, req.body?.password, loginMeta(req));
  if (out.mfa_token) return res.json({ mfa_required: true, mfa_token: out.mfa_token });
  res.cookie(COOKIE, out.token, cookieOpts);
  audit(out.admin.email, 'login');
  res.json(out.admin);
}));
r.post('/login/mfa', limiter, asyncH((req, res) => {
  if (!onPlatformHost(req)) throw new HttpError(404, 'Not found');
  if (req.headers['x-requested-with'] !== 'ERP') throw new HttpError(403, 'CSRF check failed');
  const { admin, token } = loginMfa(req.body?.mfa_token, req.body?.code, loginMeta(req));
  res.cookie(COOKIE, token, cookieOpts);
  audit(admin.email, 'login (2fa)');
  res.json(admin);
}));
const adminOnly = (req) => { if (req.operator.via !== 'session') throw bad('Sign in as an admin to manage two-factor sign-in'); };
r.get('/2fa', requireOperator, need('self'), (req, res) => { adminOnly(req); res.json(twofaStatus(req.operator.id)); });
r.post('/2fa/setup', requireOperator, need('self'), limiter, asyncH(async (req, res) => { adminOnly(req); res.json(await twofaSetup(req.operator)); }));
r.post('/2fa/enable', requireOperator, need('self'), limiter, asyncH((req, res) => { adminOnly(req); const codes = twofaEnable(req.operator.id, req.body?.code); audit(req.operator.email, '2fa-enabled'); res.json({ ok: true, recovery_codes: codes }); }));
r.post('/2fa/disable', requireOperator, need('self'), limiter, asyncH((req, res) => { adminOnly(req); twofaDisable(req.operator.id, req.body?.password, req.body?.code); audit(req.operator.email, '2fa-disabled'); res.json({ ok: true }); }));
r.post('/logout', requireOperator, need('self'), (req, res) => { endSession(req.operator.sid); audit(req.operator.email, 'logout'); res.clearCookie(COOKIE); res.json({ ok: true }); });
r.get('/me', requireOperator, need('self'), (req, res) => {
  const role = req.operator.via === 'token' ? 'super_admin' : req.operator.role;
  res.json({ id: req.operator.id ?? null, email: req.operator.email, name: req.operator.name || null, via: req.operator.via, base_domain: BASE_DOMAIN || null, multi_tenant: isMultiTenant(),
    role, role_label: ROLES[role]?.label || role, permissions: permsOf(role), totp_enabled: !!req.operator.totp_enabled, mfa_required: mfaRequired(),
    mfa_setup_needed: req.operator.via === 'session' && mfaRequired() && !req.operator.totp_enabled, maintenance: getMaintenance().on });
});
r.post('/change-password', requireOperator, need('self'), limiter, asyncH((req, res) => {
  if (req.operator.via !== 'session') throw bad('Sign in as an admin to change a password');
  const { token } = changePassword(req.operator.id, req.body?.current, req.body?.next, loginMeta(req));
  res.cookie(COOKIE, token, cookieOpts); audit(req.operator.email, 'password-changed'); res.json({ ok: true });
}));

// ---- Stripe
const webhookUrl = (req) => `${req.protocol}://${req.get('host')}/api/platform/billing/webhook/stripe`;
r.get('/settings/stripe', requireOperator, need('billing.configure'), (req, res) => res.json({ ...stripeView(), webhook_url: webhookUrl(req) }));
r.put('/settings/stripe', requireOperator, need('billing.configure'), asyncH((req, res) => {
  const out = saveStripe(req.body || {}, req.operator.email);
  if (out.errors.length) throw bad(out.errors.join('. '), { errors: out.errors });
  res.json({ ...stripeView(), webhook_url: webhookUrl(req) });
}));
/** Read-only call to Stripe with the saved secret key for that mode, so a wrong key is found before a customer pays. */
r.post('/settings/stripe/test', requireOperator, need('billing.configure'), asyncH(async (req, res) => {
  const mode = STRIPE_MODES.includes(req.body?.mode) ? req.body.mode : stripeConfig().mode;
  const out = await testConnection(stripeConfig().modes[mode].secret_key);
  if (out.ok && out.livemode !== (mode === 'live')) return res.json({ ok: false, error: `This key is a ${out.livemode ? 'live' : 'test'} key but is saved as ${mode}` });
  res.json({ mode, ...out });
}));

// ---- Local payment accounts (Raast, Easypaisa, JazzCash, SadaPay, NayaPay, bank)
const accountView = (a) => ({ id: a.id, method: a.method, label: LOCAL_METHODS[a.method] || a.method, account: a.account, account_name: a.account_name, note: a.note, active: !!a.active, sort_order: a.sort_order });
const cleanAccount = (b, partial = false) => {
  const out = {};
  if (!partial || b.method !== undefined) { if (!LOCAL_METHODS[b.method]) throw bad(`Method must be one of: ${Object.keys(LOCAL_METHODS).join(', ')}`); out.method = b.method; }
  if (!partial || b.account !== undefined) { const a = String(b.account || '').trim(); if (a.length < 3 || a.length > 60) throw bad('Account number / ID is required (3 to 60 characters)'); out.account = a; }
  if (b.account_name !== undefined) out.account_name = String(b.account_name || '').trim().slice(0, 80) || null;
  if (b.note !== undefined) out.note = String(b.note || '').trim().slice(0, 200) || null;
  if (b.active !== undefined) out.active = b.active ? 1 : 0;
  if (b.sort_order !== undefined) out.sort_order = Math.trunc(Number(b.sort_order)) || 0;
  return out;
};
r.get('/payment-accounts', requireOperator, need('billing.view'), (_req, res) => res.json({ methods: LOCAL_METHODS, accounts: platformDb().prepare('SELECT * FROM payment_accounts ORDER BY sort_order, id').all().map(accountView) }));
r.post('/payment-accounts', requireOperator, need('billing.configure'), asyncH((req, res) => {
  const c = cleanAccount(req.body || {});
  const id = Number(platformDb().prepare('INSERT INTO payment_accounts(method,account,account_name,note,active,sort_order) VALUES(?,?,?,?,?,?)').run(c.method, c.account, c.account_name ?? null, c.note ?? null, c.active ?? 1, c.sort_order ?? 0).lastInsertRowid);
  audit(req.operator.email, 'payment-account-added', { id, method: c.method });
  res.status(201).json(accountView(platformDb().prepare('SELECT * FROM payment_accounts WHERE id=?').get(id)));
}));
r.put('/payment-accounts/:id', requireOperator, need('billing.configure'), asyncH((req, res) => {
  const cur = platformDb().prepare('SELECT * FROM payment_accounts WHERE id=?').get(Number(req.params.id));
  if (!cur) throw new HttpError(404, 'Account not found');
  const c = cleanAccount(req.body || {}, true);
  const keys = Object.keys(c);
  if (keys.length) platformDb().prepare(`UPDATE payment_accounts SET ${keys.map((k) => `${k}=?`).join(',')}, updated_at=datetime('now') WHERE id=?`).run(...keys.map((k) => c[k]), cur.id);
  audit(req.operator.email, 'payment-account-edited', { id: cur.id, fields: keys });
  res.json(accountView(platformDb().prepare('SELECT * FROM payment_accounts WHERE id=?').get(cur.id)));
}));
r.delete('/payment-accounts/:id', requireOperator, need('billing.configure'), asyncH((req, res) => {
  const n = platformDb().prepare('DELETE FROM payment_accounts WHERE id=?').run(Number(req.params.id)).changes;
  if (!n) throw new HttpError(404, 'Account not found');
  audit(req.operator.email, 'payment-account-deleted', { id: Number(req.params.id) });
  res.json({ ok: true });
}));

// ---- Backups
r.get('/backups', requireOperator, need('system.view'), (_req, res) => res.json({ dir: backupDir(), backups: listBackups(), keep: Number(process.env.BACKUP_KEEP) || 14, every_hours: Number(process.env.BACKUP_EVERY_HOURS) || 24, enabled: process.env.BACKUP_ENABLED !== '0', uploads: process.env.BACKUP_UPLOADS === '1' }));
r.post('/backups/run', requireOperator, need('system.manage'), limiter, asyncH((req, res) => { const out = runBackup(); audit(req.operator.email, 'backup-run', { name: out.name }); res.json(out); }));
r.get('/audit', requireOperator, need('audit.view'), (_req, res) => res.json(platformDb().prepare('SELECT * FROM platform_audit ORDER BY id DESC LIMIT 100').all()));

// ---- Super admin: overview, workspace progress, expiry and sign-in help
r.get('/overview', requireOperator, need('dashboard.view'), (req, res) => res.json(overview(req, req.operator)));
r.get('/workspaces', requireOperator, need('workspaces.view'), (req, res) => res.json(tenantSummaries(req)));
r.post('/workspaces', requireOperator, need('workspaces.create'), asyncH((req, res) => {
  const t = createWorkspace(req.body || {}, req);
  audit(req.operator.email, 'workspace-created', { slug: t.slug });
  res.status(201).json(t);
}));
r.get('/workspaces/:id', requireOperator, need('workspaces.view'), asyncH((req, res) => res.json(tenantDetail(req.params.id, req))));
r.post('/workspaces/:id/trial', requireOperator, need('workspaces.edit'), asyncH((req, res) => {
  const t = extendTrial(req.params.id, req.body || {}, req.operator.email);
  audit(req.operator.email, 'trial-extended', { slug: t.slug, until: t.trial_ends_at, reason: req.body?.reason });
  res.json(tenantDetail(t.id, req));
}));
r.post('/workspaces/:id/grace', requireOperator, need('billing.manage'), asyncH((req, res) => {
  const t = extendGrace(req.params.id, req.body || {}, req.operator.email);
  audit(req.operator.email, 'grace-extended', { slug: t.slug, until: t.grace_until, reason: req.body?.reason });
  res.json(tenantDetail(t.id, req));
}));
r.post('/workspaces/:id/remind', requireOperator, need('workspaces.edit'), limiter, asyncH(async (req, res) => {
  const out = await remindOwner(req.params.id, req);
  audit(req.operator.email, 'reminder-sent', { tenant: Number(req.params.id) });
  res.json(out);
}));
r.post('/workspaces/:id/owner', requireOperator, need('workspaces.edit'), asyncH((req, res) => {
  const t = setOwner(req.params.id, req.body?.email);
  audit(req.operator.email, 'owner-changed', { slug: t.slug, owner: t.owner_email });
  res.json(tenantDetail(t.id, req));
}));
r.post('/workspaces/:id/users/:uid/:action', requireOperator, need('workspaces.support'), limiter, asyncH(async (req, res) => {
  const out = await userAction(req.params.id, req.params.uid, req.params.action, req.body || {}, req);
  // the reset link itself is never written to the audit log
  audit(req.operator.email, `support:${req.params.action}`, { tenant: Number(req.params.id), user: Number(req.params.uid) });
  res.json(out);
}));
// ---- Workspace lifecycle, profile, limits, notes and payments
r.post('/workspaces/:id/status', requireOperator, need('workspaces.suspend'), asyncH((req, res) => {
  const t = changeStatus(req.params.id, req.body || {}, req.operator.email);
  audit(req.operator.email, `workspace-${t.status}`, { slug: t.slug, reason: req.body?.reason || null });
  res.json(tenantDetail(t.id, req));
}));
r.post('/workspaces/:id/subscription', requireOperator, need('billing.manage'), asyncH((req, res) => {
  const reason = String(req.body?.reason || '').trim();
  if (reason.length < 3) throw bad('A reason is required for changing a subscription by hand');
  const before = tenantDetail(req.params.id, req);
  const t = setSubscription(Number(req.params.id), req.body || {}, { actor: req.operator.email, reason });
  audit(req.operator.email, 'subscription-set', { slug: t.slug, from: { plan: before.plan, status: before.subscription_status, period_end: before.current_period_end }, to: { plan: t.plan, status: t.subscription_status, period_end: t.current_period_end }, reason });
  res.json(tenantDetail(t.id, req));
}));
r.patch('/workspaces/:id', requireOperator, need('workspaces.edit'), asyncH((req, res) => {
  const { tenant, changed } = updateProfile(req.params.id, req.body || {});
  if (changed.length) audit(req.operator.email, 'workspace-edited', { slug: tenant.slug, fields: changed });
  res.json(tenantDetail(tenant.id, req));
}));
r.put('/workspaces/:id/entitlements', requireOperator, need('billing.manage'), asyncH((req, res) => {
  const t = setEntitlements(req.params.id, req.body || {}, req.operator.email);
  audit(req.operator.email, 'entitlements-set', { slug: t.slug, to: t.entitlements ? JSON.parse(t.entitlements) : null, reason: req.body?.reason });
  res.json(tenantDetail(t.id, req));
}));
r.get('/workspaces/:id/notes', requireOperator, need('workspaces.view'), asyncH((req, res) => res.json(listNotes(req.params.id))));
r.post('/workspaces/:id/notes', requireOperator, need('workspaces.edit'), asyncH((req, res) => {
  const out = addNote(req.params.id, req.body?.body, req.operator.email, !!req.body?.pinned);
  audit(req.operator.email, 'note-added', { tenant: Number(req.params.id) });
  res.status(201).json(out);
}));
r.post('/workspaces/:id/payments', requireOperator, need('billing.manage'), limiter, asyncH(async (req, res) => {
  const out = await recordManualPayment(req.params.id, req.body || {}, req.operator.email);
  audit(req.operator.email, 'payment-recorded', { tenant: Number(req.params.id), payment: out.id, amount: req.body?.amount, currency: req.body?.currency, method: req.body?.method });
  res.status(201).json(tenantDetail(out.tenant.id, req));
}));
r.post('/workspaces/:id/onboarding-email', requireOperator, need('workspaces.support'), limiter, asyncH(async (req, res) => {
  const out = await resendOnboarding(req.params.id, req);
  audit(req.operator.email, 'onboarding-email', { tenant: Number(req.params.id) });
  res.json(out);
}));

// ---- Plans, subscriptions and money
r.get('/plans', requireOperator, need('billing.view'), (_req, res) => res.json({ plans: listPlans(), settings: { ...PLAN_SETTINGS }, modules: MODULES }));
r.put('/plans/:id', requireOperator, need('billing.configure'), asyncH((req, res) => {
  const out = savePlan(req.params.id, req.body || {}, req.operator.email);
  audit(req.operator.email, out.changes.created ? 'plan-created' : 'plan-edited', { plan: out.plan.id, ...out.changes });
  res.json(out.plan);
}));
r.put('/plan-settings', requireOperator, need('billing.configure'), asyncH((req, res) => {
  const out = savePlanSettings(req.body || {}, req.operator.email);
  audit(req.operator.email, 'plan-settings', out);
  res.json(out);
}));
r.get('/subscriptions/history', requireOperator, need('billing.view'), (req, res) => res.json(subscriptionHistory({ tenantId: req.query.tenant, limit: Number(req.query.per) || 100, offset: (Number(req.query.page) || 0) * (Number(req.query.per) || 100) })));
r.get('/transactions', requireOperator, need('billing.view'), (req, res) => res.json(transactions(req.query)));

r.get('/setup', requireOperator, need('system.view'), (req, res) => res.json(setupChecklist(req.operator)));

// ---- Dashboard, health, notifications, search
r.get('/dashboard', requireOperator, need('dashboard.view'), asyncH((req, res) => res.json(dashboard(req.query, req))));
r.get('/health', requireOperator, need('system.view'), (_req, res) => res.json(health()));
r.get('/notifications', requireOperator, need('dashboard.view'), asyncH((req, res) => { generateNotifications(req); res.json(listNotifications(req.operator.id, { all: req.query.all === '1' })); }));
r.post('/notifications/read', requireOperator, need('dashboard.view'), asyncH((req, res) => res.json({ marked: markRead(req.operator.id, req.body?.ids) })));
r.get('/search', requireOperator, need('dashboard.view'), (req, res) => res.json(search(req.query.q)));

// ---- Audit log search (append-only; this API can only read it)
r.get('/audit/search', requireOperator, need('audit.view'), (req, res) => {
  const q = req.query, where = [], args = [];
  if (q.admin) { where.push('admin LIKE ?'); args.push(`%${q.admin}%`); }
  if (q.action) { where.push('action LIKE ?'); args.push(`%${q.action}%`); }
  if (q.target) { where.push('target LIKE ?'); args.push(`%${q.target}%`); }
  if (q.outcome) { where.push('outcome=?'); args.push(String(q.outcome)); }
  if (/^\d{4}-\d{2}-\d{2}$/.test(q.from || '')) { where.push('created_at>=?'); args.push(`${q.from} 00:00:00`); }
  if (/^\d{4}-\d{2}-\d{2}$/.test(q.to || '')) { where.push('created_at<=?'); args.push(`${q.to} 23:59:59`); }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const per = Math.min(500, Math.max(1, Number(q.per) || 50)), page = Math.max(0, Number(q.page) || 0);
  const db = platformDb();
  res.json({ total: db.prepare(`SELECT COUNT(*) n FROM platform_audit ${w}`).get(...args).n, page, per, rows: db.prepare(`SELECT * FROM platform_audit ${w} ORDER BY id DESC LIMIT ? OFFSET ?`).all(...args, per, page * per) });
});

// ---- Sessions and sign-in history
r.get('/sessions', requireOperator, need('self'), (req, res) => {
  const all = req.query.all === '1' && can(req.operator, 'admins.manage');
  const rows = listSessions(all ? null : req.operator.id).map((s) => ({ ...s, current: !!req.operator.sid && req.operator.sid.startsWith(s.ref) }));
  res.json({ all, rows });
});
r.delete('/sessions/:ref', requireOperator, need('self'), asyncH((req, res) => {
  const any = can(req.operator, 'admins.manage');
  const n = revokeSession(req.params.ref, { adminId: any ? null : req.operator.id, by: req.operator.email });
  if (!n) throw new HttpError(404, 'Session not found');
  audit(req.operator.email, 'session-revoked', { session: req.params.ref.slice(0, 8) });
  res.json({ ok: true });
}));
r.post('/sessions/revoke-others', requireOperator, need('self'), asyncH((req, res) => {
  const n = revokeAllFor(req.operator.id, { exceptSid: req.operator.sid, by: req.operator.email });
  audit(req.operator.email, 'sessions-revoked', { count: n });
  res.json({ revoked: n });
}));
r.get('/logins', requireOperator, need('audit.view'), (req, res) => res.json(loginHistory(req.query)));
r.get('/security-settings', requireOperator, need('admins.manage'), (_req, res) => res.json({ require_2fa: mfaRequired() }));
r.put('/security-settings', requireOperator, need('admins.manage'), asyncH((req, res) => {
  const on = !!req.body?.require_2fa;
  if (on && req.operator.via === 'session' && !req.operator.totp_enabled) throw bad('Turn on two-factor sign-in for your own account first');
  platformDb().prepare("INSERT INTO platform_settings(key,value,updated_by,updated_at) VALUES('require_2fa',?,?,datetime('now')) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_by=excluded.updated_by, updated_at=excluded.updated_at").run(on ? '1' : '0', req.operator.email);
  audit(req.operator.email, on ? 'require-2fa-on' : 'require-2fa-off');
  res.json({ require_2fa: mfaRequired() });
}));

// ---- Maintenance mode and recent errors
r.get('/maintenance', requireOperator, need('system.view'), (_req, res) => res.json(getMaintenance()));
r.put('/maintenance', requireOperator, need('system.manage'), asyncH((req, res) => {
  const out = setMaintenance(req.body || {}, req.operator.email);
  audit(req.operator.email, out.on ? 'maintenance-on' : 'maintenance-off', { reason: req.body?.reason || null });
  res.json(out);
}));
r.get('/errors', requireOperator, need('system.view'), (_req, res) => res.json(recentErrors()));

// ---- Reports, exports and reconciliation
const canFn = (req) => (perm) => can(req.operator, perm);
r.get('/reports', requireOperator, need('self'), (req, res) => res.json({ reports: reportList(canFn(req)), can_export: can(req.operator, 'workspaces.export') }));
r.get('/reports/views', requireOperator, need('self'), (req, res) => res.json(savedViews(req.operator.id)));
r.post('/reports/views', requireOperator, need('self'), asyncH((req, res) => res.json(saveView(req.operator.id, req.body || {}))));
r.delete('/reports/views/:name', requireOperator, need('self'), (req, res) => res.json(deleteView(req.operator.id, req.params.name)));
r.get('/reports/:id', requireOperator, need('self'), asyncH((req, res) => res.json(runReport(req.params.id, req.query, req, canFn(req)))));
r.get('/reports/:id/export', requireOperator, need('workspaces.export'), asyncH(async (req, res) => {
  const rep = runReport(req.params.id, req.query, req, canFn(req));
  const file = await exportReport(rep, String(req.query.format || 'csv'));
  audit(req.operator.email, 'report-exported', { report: rep.id, format: req.query.format || 'csv', rows: rep.rows.length, from: rep.range.from, to: rep.range.to });
  res.setHeader('Content-Type', file.type);
  res.setHeader('Content-Disposition', `attachment; filename="${file.name}"`);
  res.setHeader('Cache-Control', 'no-store');
  res.send(file.body);
}));
r.get('/reconciliation', requireOperator, need('billing.view'), (_req, res) => res.json(reconcile()));

// ---- Super admin accounts
r.get('/admins', requireOperator, need('admins.manage'), (req, res) => res.json({ me: req.operator.id ?? null, admins: listAdmins(), roles: Object.fromEntries(Object.entries(ROLES).map(([k, v]) => [k, { label: v.label, perms: v.perms }])), permissions: PERMISSIONS }));
r.patch('/admins/:id', requireOperator, need('admins.manage'), asyncH((req, res) => {
  adminOnly(req);
  const out = updateAdmin(req.params.id, req.body || {}, req.operator.id);
  if (out.changed.length) audit(req.operator.email, 'admin-changed', { email: out.admin.email, from: out.before, to: { role: out.admin.role, active: out.admin.active }, reason: req.body?.reason });
  res.json(out.admin);
}));
r.post('/admins', requireOperator, need('admins.manage'), limiter, asyncH((req, res) => {
  adminOnly(req);
  const a = addAdmin(req.body || {});
  audit(req.operator.email, 'admin-added', { email: a.email, role: a.role });
  res.status(201).json(a);
}));
r.delete('/admins/:id', requireOperator, need('admins.manage'), asyncH((req, res) => {
  adminOnly(req);
  const gone = removeAdmin(req.params.id, req.operator.id);
  audit(req.operator.email, 'admin-removed', { email: gone.email, id: gone.id });
  res.json({ ok: true });
}));

export default r;
