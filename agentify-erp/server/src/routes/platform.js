// Control-plane API (not tenant-scoped): self-serve signup and the platform operator's tenant administration.
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { asyncH, bad, HttpError } from '../util.js';
import { sendMail, layout } from '../services/mailer.js';
import { requireOperator, onPlatformHost } from '../services/platformAuth.js';
import { need, auditContext } from '../services/platformAccess.js';
import { audit } from '../services/platformConfig.js';
import { planCatalog, PLAN_SETTINGS } from '../services/plans.js';
import { issueVerification } from '../services/accessLinks.js';
import { get, run } from '../db.js';
import adminRoutes from './platformAdmin.js';
import { verifySignature, applyBillingEvent, setSubscription, listSubmissions, approveSubmission, rejectSubmission, tenantByProviderIds } from '../services/billing.js';
import * as stripe from '../services/stripe.js';
import { stripeConfig } from '../services/platformConfig.js';
import { BASE_DOMAIN, platformDb, withTenant, isMultiTenant, createTenant, validateSlug, listTenants, getTenant, setTenantStatus, RESERVED_SLUGS } from '../platform.js';

const r = Router();
r.use('/admin', adminRoutes);
r.use(auditContext);

const publicView = (t) => ({ id: t.id, slug: t.slug, name: t.name, owner_email: t.owner_email, is_legacy: !!t.is_legacy, billing_provider: t.billing_provider, billing_interval: t.billing_interval, status: t.status, plan: t.plan, subscription_status: t.subscription_status, current_period_end: t.current_period_end, trial_ends_at: t.trial_ends_at, timezone: t.timezone, currency: t.currency, custom_domain: t.custom_domain, created_at: t.created_at });
/** Workspace address. On localhost (development) keep the scheme and port the request came in on, e.g. http://acme.localhost:4000. */
const urlFor = (slug, req) => (!isMultiTenant() ? null : BASE_DOMAIN === 'localhost' && req ? `${req.protocol}://${slug}.${req.get('host')}` : `https://${slug}.${BASE_DOMAIN}`);

const signupLimiter = rateLimit({ windowMs: 60 * 60_000, limit: Number(process.env.SIGNUP_LIMIT) || 10, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many signups from this address. Try again later.' } });

/** Public: what the marketing page on the main domain shows. `landing` is false on workspace addresses and in single-company installs. */
r.get('/site', (req, res) => {
  const landing = isMultiTenant() && onPlatformHost(req);
  if (!landing) return res.json({ landing: false, multi_tenant: isMultiTenant() });
  const methods = [...new Set(platformDb().prepare('SELECT method FROM payment_accounts WHERE active=1 ORDER BY sort_order, id').all().map((a) => a.method))];
  res.json({ landing: true, base_domain: BASE_DOMAIN, trial_days: PLAN_SETTINGS.default_trial_days, plans: planCatalog().map(({ id, name, description, seats, projects, price }) => ({ id, name, description, seats, projects, price })), local_methods: methods, cards: stripe.stripeConfigured() });
});

/** Is this workspace address free? (never reveals which tenants exist beyond availability) */
r.get('/slug-available/:slug', asyncH((req, res) => {
  try { validateSlug(req.params.slug); res.json({ available: true }); }
  catch (e) { if (e instanceof HttpError) return res.json({ available: false, reason: e.message }); throw e; }
}));

/** Self-serve signup: creates the workspace (own database + uploads), its base configuration and the first admin. */
r.post('/signup', signupLimiter, asyncH(async (req, res) => {
  if (!isMultiTenant()) throw new HttpError(404, 'Workspace signup is switched off: this server is running in single-company mode. Start it with ERP_BASE_DOMAIN=localhost (run-agentify-erp.bat does this).');
  const b = req.body || {};
  const tenant = createTenant({
    slug: b.slug, name: b.company_name, adminName: String(b.admin_name || '').trim() || 'Admin', adminEmail: b.admin_email, adminPassword: b.admin_password,
    timezone: b.timezone || 'Asia/Karachi', currency: b.currency || 'PKR', demo: false,
  });
  const url = urlFor(tenant.slug, req);
  const origin = url || `${req.protocol}://${req.get('host')}`;
  // the owner confirms the address with the link in the welcome email; until then they cannot invite others (stops the form being used to mail strangers)
  const token = withTenant(tenant, () => {
    const owner = get('SELECT id FROM users WHERE lower(email)=lower(?)', tenant.owner_email);
    run('UPDATE users SET email_verified=0 WHERE id=?', owner.id);
    return issueVerification(owner.id);
  });
  const mail = layout({ heading: `Your ${tenant.name} workspace is ready`, lines: [`Confirm ${tenant.owner_email} with the button below, then sign in to start setting up your company.`, tenant.trial_ends_at ? `Your free trial runs until ${tenant.trial_ends_at}.` : ''].filter(Boolean), button: { label: 'Confirm email and open workspace', url: `${origin}/verify-email/${token}` } });
  await sendMail({ to: tenant.owner_email, subject: `Welcome: ${tenant.name} is ready`, ...mail });
  res.status(201).json({ tenant: publicView(tenant), login_url: url });
}));

r.get('/tenants', requireOperator, need('workspaces.view'), (_req, res) => res.json(listTenants().map(publicView)));
r.post('/tenants/:id/status', requireOperator, need('workspaces.suspend'), asyncH((req, res) => {
  const t = getTenant(Number(req.params.id));
  if (!t) throw new HttpError(404, 'Tenant not found');
  if (t.is_legacy && req.body?.status !== 'active') throw bad('The original workspace cannot be suspended from here');
  const out = setTenantStatus(t.id, req.body?.status);
  audit(req.operator.email, `workspace-${out.status}`, { slug: out.slug, reason: req.body?.reason || null });
  res.json(publicView(out));
}));
/**
 * Payment-provider webhook (normalised JSON, see services/billing.js), signed with BILLING_WEBHOOK_SECRET.
 * Not tenant-scoped: the event names its tenant. Provider adapters translate their own payloads into this shape.
 */
/** Stripe: its own signature scheme; events we do not act on, or that name no known workspace, are acknowledged so Stripe stops retrying. */
r.post('/billing/webhook/stripe', asyncH((req, res) => {
  if (!stripe.verifyWebhook(req.rawBody, req.headers['stripe-signature'])) throw new HttpError(401, 'Invalid signature');
  // an event from the other mode (e.g. a test event while live is active) must not change real subscriptions
  if (typeof req.body?.livemode === 'boolean' && req.body.livemode !== (stripeConfig().mode === 'live')) return res.json({ ok: true, ignored: true });
  const ev = stripe.mapEvent(req.body, tenantByProviderIds);
  if (!ev || !ev.tenant_id) return res.json({ ok: true, ignored: true });
  try { res.json({ ok: true, applied: applyBillingEvent('stripe', ev).applied }); }
  catch (e) { if (e instanceof HttpError && e.status === 404) return res.json({ ok: true, ignored: true }); throw e; }
}));
r.post('/billing/webhook/:provider', asyncH((req, res) => {
  if (!verifySignature(req.rawBody, req.headers['x-signature'])) throw new HttpError(401, 'Invalid signature');
  const out = applyBillingEvent(req.params.provider, req.body);
  res.json({ ok: true, applied: out.applied });
}));
/** Manual billing for operators: record a bank transfer / invoice payment by setting the plan directly. */
r.post('/tenants/:id/subscription', requireOperator, need('billing.manage'), asyncH((req, res) => {
  res.json(publicView(setSubscription(Number(req.params.id), req.body || {}, { actor: req.operator.email, reason: req.body?.reason })));
}));
/** Local-method payments waiting for the operator to confirm the money arrived. */
r.get('/payments', requireOperator, need('billing.view'), (req, res) => res.json(listSubmissions(req.query.status)));
r.post('/payments/:id/approve', requireOperator, need('billing.manage'), asyncH(async (req, res) => {
  const t = await approveSubmission(Number(req.params.id), req.body?.note, req.operator.email);
  audit(req.operator.email, 'payment-approved', { slug: t.slug, payment: Number(req.params.id) });
  res.json(publicView(t));
}));
r.post('/payments/:id/reject', requireOperator, need('billing.manage'), asyncH(async (req, res) => {
  await rejectSubmission(Number(req.params.id), req.body?.note);
  audit(req.operator.email, 'payment-rejected', { payment: Number(req.params.id), reason: req.body?.note });
  res.json({ ok: true });
}));
r.get('/reserved', (_req, res) => res.json([...RESERVED_SLUGS]));
r.use((_req, _res, next) => next(new HttpError(404, 'Endpoint not found')));

export default r;
