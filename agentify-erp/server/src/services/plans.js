// Plans, limits and the billing state machine. Pure functions over a tenant row (no I/O) so they are easy to test.
//
// Plans live in the platform database (tables plans / plan_prices, see services/plansStore.js) and are edited in the
// super admin console. PLANS below is the in-memory copy every module reads; plansStore refreshes it in place, so
// `PLANS[plan].price.PKR.month` keeps working everywhere. DEFAULT_PLANS only seeds a brand-new platform database.
// A `null` limit means unlimited; `modules: null` means every module is included.
import { val } from '../db.js';
import { HttpError } from '../util.js';

export const DEFAULT_PLANS = {
  starter:    { name: 'Starter',    seats: 5,    projects: 3,    price: { USD: { month: 29, year: 290 },   PKR: { month: 8000, year: 80000 } } },
  growth:     { name: 'Growth',     seats: 25,   projects: 25,   price: { USD: { month: 79, year: 790 },   PKR: { month: 22000, year: 220000 } } },
  enterprise: { name: 'Enterprise', seats: null, projects: null, price: { USD: { month: 199, year: 1990 }, PKR: { month: 55000, year: 550000 } } },
};
export const PLANS = Object.fromEntries(Object.entries(DEFAULT_PLANS).map(([k, v]) => [k, { ...v, grace_days: 7, modules: null, visible: true, active: true }]));
/** Platform-wide plan settings, kept in sync by plansStore. */
export const PLAN_SETTINGS = { trial_plan: 'growth', default_trial_days: 14 };
/** Modules a plan can include, and the API prefixes (under /api) each one owns. Everything else is always available. */
export const MODULES = {
  accounting: { label: 'Accounting & finance', paths: ['/accounting'] },
  hrm: { label: 'HR & payroll', paths: ['/hrm'] },
  tenders: { label: 'Tenders & vendor portal', paths: ['/tenders', '/vendor'] },
  marketing: { label: 'Content & promotions', paths: ['/content', '/promos'] },
  website: { label: 'Website builder & SEO', paths: ['/site-admin', '/seo'] },
  assistant: { label: 'AI assistant', paths: ['/assistant'] },
  insights: { label: 'Insights & analytics', paths: ['/insights'] },
  portal: { label: 'Customer portal', paths: ['/portal'] },
};
export const trialLimits = () => { const p = PLANS[PLAN_SETTINGS.trial_plan]; return { name: 'Free trial', seats: p ? p.seats : null, projects: p ? p.projects : null, modules: p ? p.modules : null }; };
/** The original install is not metered. */
const LEGACY_LIMITS = { name: 'Unlimited', seats: null, projects: null, modules: null };
export const GRACE_DAYS = 7;
export const graceDays = (plan) => PLANS[plan]?.grace_days ?? GRACE_DAYS;

const day = (iso) => String(iso || '').slice(0, 10);
const todayUtc = () => new Date().toISOString().slice(0, 10);
const addDaysIso = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 864e5);

/** Plan limits with the workspace's own overrides (tenants.entitlements, set by a super admin) on top. */
export function effectiveLimits(tenant, base) {
  const out = { name: base.name, seats: base.seats ?? null, projects: base.projects ?? null, modules: base.modules ?? null };
  let o = null;
  try { o = tenant?.entitlements ? JSON.parse(tenant.entitlements) : null; } catch { o = null; }
  if (o) {
    for (const k of ['seats', 'projects']) if (o[k] !== undefined) out[k] = o[k];
    if (o.modules !== undefined) out.modules = o.modules;
    out.overridden = true;
  }
  return out;
}

/**
 * What a tenant may do right now.
 *  trialing  -> trial limits until trial_ends_at, then locked (read-only) until they subscribe
 *  active    -> their plan
 *  past_due  -> their plan for the plan's grace days after the failed payment, then locked
 *  canceled  -> their plan until the paid period ends, then locked
 * "Locked" means read-only: nothing is ever deleted for non-payment.
 */
export function billingState(tenant, today = todayUtc()) {
  if (!tenant) return { plan: null, status: 'none', locked: false, limits: LEGACY_LIMITS };
  if (tenant.is_legacy) return { plan: 'legacy', status: 'active', locked: false, limits: effectiveLimits(tenant, LEGACY_LIMITS) };
  const sub = tenant.subscription_status || 'trialing';
  const plan = PLANS[tenant.plan] ? tenant.plan : null;
  const limits = effectiveLimits(tenant, plan && sub !== 'trialing' ? PLANS[plan] : trialLimits());
  if (tenant.status === 'cancelled') return { plan, status: 'canceled', locked: true, reason: 'cancelled', limits };
  if (sub === 'active') return { plan, status: 'active', locked: false, limits, period_end: tenant.current_period_end || null };
  if (sub === 'past_due') {
    const until = tenant.grace_until ? day(tenant.grace_until) : addDaysIso(today, graceDays(plan));
    const locked = today > until;
    return { plan, status: 'past_due', locked, reason: locked ? 'payment_failed' : undefined, limits, grace_until: until, period_end: tenant.current_period_end || null };
  }
  if (sub === 'canceled') {
    const end = day(tenant.current_period_end);
    const locked = !end || today > end;
    return { plan, status: 'canceled', locked, reason: locked ? 'subscription_ended' : undefined, limits, period_end: end || null };
  }
  // trialing
  const end = day(tenant.trial_ends_at);
  const locked = !!end && today > end;
  return { plan: null, status: 'trialing', locked, reason: locked ? 'trial_ended' : undefined, limits, trial_ends_at: end || null, days_left: end ? Math.max(0, daysBetween(today, end)) : null };
}

/** Plans a customer can choose: visible and on sale, plus the plan they are already on. */
export const planCatalog = (current) => Object.entries(PLANS).filter(([id, p]) => (p.visible && p.active) || id === current)
  .map(([id, p]) => ({ id, name: p.name, description: p.description || null, seats: p.seats, projects: p.projects, modules: p.modules, price: p.price }));
/** A plan may be bought when it is on sale, or renewed when it is the workspace's current plan. */
export function assertSellable(plan, tenant) {
  const p = PLANS[plan];
  if (!p) throw new HttpError(400, 'Unknown plan');
  if (!p.active && tenant?.plan !== plan) throw new HttpError(400, 'This plan is no longer available');
}

export class PlanLimitError extends HttpError {
  constructor(message, code, extra = {}) { super(402, message, { code, ...extra }); }
}

/** Counts that plans limit: active staff logins (+ pending invitations, so you cannot invite past the limit) and projects. */
export function usage() {
  const seats = val('SELECT COUNT(*) FROM users u JOIN roles r ON r.id=u.role_id WHERE u.active=1 AND r.portal=0');
  const invited = val("SELECT COUNT(*) FROM auth_tokens WHERE kind='invite' AND used_at IS NULL AND expires_at>?", new Date().toISOString());
  return { seats, invited, projects: val('SELECT COUNT(*) FROM projects') };
}

export function assertSeatAvailable(tenant, { includeInvites = true, extra = 1 } = {}) {
  const st = billingState(tenant);
  if (st.limits.seats == null) return;
  const u = usage();
  if (u.seats + (includeInvites ? u.invited : 0) + extra > st.limits.seats) {
    throw new PlanLimitError(`Your ${st.limits.name} plan allows ${st.limits.seats} team members. Upgrade to add more.`, 'seat_limit', { limit: st.limits.seats });
  }
}

export function assertProjectAvailable(tenant) {
  const st = billingState(tenant);
  if (st.limits.projects == null) return;
  if (usage().projects + 1 > st.limits.projects) {
    throw new PlanLimitError(`Your ${st.limits.name} plan allows ${st.limits.projects} projects. Upgrade to add more.`, 'project_limit', { limit: st.limits.projects });
  }
}

const LOCK_MESSAGES = {
  trial_ended: 'Your free trial has ended. Your data is safe and read-only; choose a plan to keep editing.',
  payment_failed: 'Your last payment failed and the grace period has ended. Your data is safe and read-only; update your payment to continue.',
  subscription_ended: 'Your subscription has ended. Your data is safe and read-only; renew to continue.',
  cancelled: 'This workspace has been cancelled. Contact support to reactivate it.',
};
export const lockMessage = (reason) => LOCK_MESSAGES[reason] || 'This workspace is read-only until billing is up to date.';

/**
 * Express guard: while a workspace is locked, reads still work (people can see and export their data) but writes are
 * refused with 402. Sign-in, billing, and the public website's visitor forms stay open.
 */
export function billingGuard(req, _res, next) {
  const t = req.tenant;
  if (!t) return next();
  const st = billingState(t);
  const open = ['GET', 'HEAD', 'OPTIONS'].includes(req.method) || /^\/(auth|billing|site|public)(\/|$)/.test(req.path);
  if (st.locked && !open) return next(new HttpError(402, lockMessage(st.reason), { code: 'billing_locked', reason: st.reason }));
  if (Array.isArray(st.limits.modules)) {
    const mod = Object.entries(MODULES).find(([, m]) => m.paths.some((p) => req.path === p || req.path.startsWith(`${p}/`)));
    if (mod && !st.limits.modules.includes(mod[0])) return next(new HttpError(402, `${mod[1].label} is not included in your plan. Upgrade to use it.`, { code: 'module_not_in_plan', module: mod[0] }));
  }
  if (req.method === 'POST' && req.path === '/projects') { try { assertProjectAvailable(t); } catch (e) { return next(e); } }
  next();
}
