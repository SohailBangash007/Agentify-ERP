// Control-plane API (not tenant-scoped): self-serve signup and the platform operator's tenant administration.
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { asyncH, bad, HttpError } from '../util.js';
import { sendMail, layout } from '../services/mailer.js';
import { requireOperator, onPlatformHost } from '../services/platformAuth.js';
import { need, auditContext } from '../services/platformAccess.js';
import { audit } from '../services/platformConfig.js';
import { planCatalog, PLAN_SETTINGS, PRODUCTS, PLANS } from '../services/plans.js';
import { publicContent, publicLegal, createDemoRequest, marketingContent, termsVersion } from '../services/marketing.js';
import { recordServerEvent, collect } from '../services/analytics.js';
import { publicAnnouncements } from '../services/announcements.js';
import { listAddons } from '../services/commerce.js';
import { issueVerification } from '../services/accessLinks.js';
import { get, run } from '../db.js';
import adminRoutes from './platformAdmin.js';
import { verifySignature, applyBillingEvent, setSubscription, listSubmissions, approveSubmission, rejectSubmission, tenantByProviderIds } from '../services/billing.js';
import * as stripe from '../services/stripe.js';
import { stripeConfig, getSetting } from '../services/platformConfig.js';
import { BASE_DOMAIN, platformDb, withTenant, isMultiTenant, createTenant, validateSlug, listTenants, getTenant, setTenantStatus, RESERVED_SLUGS } from '../platform.js';

const r = Router();
r.use('/admin', adminRoutes);
r.use(auditContext);

const publicView = (t) => ({ id: t.id, slug: t.slug, name: t.name, product: t.product, trial_started_at: t.trial_started_at, trial_note: t.trial_note || null, owner_email: t.owner_email, is_legacy: !!t.is_legacy, billing_provider: t.billing_provider, billing_interval: t.billing_interval, status: t.status, plan: t.plan, subscription_status: t.subscription_status, current_period_end: t.current_period_end, trial_ends_at: t.trial_ends_at, timezone: t.timezone, currency: t.currency, custom_domain: t.custom_domain, created_at: t.created_at });
/** Workspace address. On localhost (development) keep the scheme and port the request came in on, e.g. http://acme.localhost:4000. */
const urlFor = (slug, req) => (!isMultiTenant() ? null : BASE_DOMAIN === 'localhost' && req ? `${req.protocol}://${slug}.${req.get('host')}` : `https://${slug}.${BASE_DOMAIN}`);

const signupLimiter = rateLimit({ windowMs: 60 * 60_000, limit: Number(process.env.SIGNUP_LIMIT) || 10, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many signups from this address. Try again later.' } });

/** Public: what the marketing page on the main domain shows. `landing` is false on workspace addresses and in single-company installs. */
r.get('/site', (req, res) => {
  const landing = isMultiTenant() && onPlatformHost(req);
  if (!landing) return res.json({ landing: false, multi_tenant: isMultiTenant() });
  const methods = [...new Set(platformDb().prepare('SELECT method FROM payment_accounts WHERE active=1 ORDER BY sort_order, id').all().map((a) => a.method))];
  res.json({ landing: true, base_domain: BASE_DOMAIN, trial_days: PLAN_SETTINGS.default_trial_days, plans: planCatalog(), products: PRODUCTS, addons: listAddons({ activeOnly: true }).map(({ id, name, description, product, price, entitlements }) => ({ id, name, description, product, price, entitlements })), local_methods: methods, cards: stripe.stripeConfigured() });
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
  if (b.accept_terms !== true) throw bad('Please accept the Terms of Service and Privacy Policy to create a workspace');
  const tenant = createTenant({
    slug: b.slug, name: b.company_name, adminName: String(b.admin_name || '').trim() || 'Admin', adminEmail: b.admin_email, adminPassword: b.admin_password,
    timezone: b.timezone || 'Asia/Karachi', currency: b.currency || 'PKR', demo: false, product: b.product || 'real_estate', trialPolicy: true,
  });
  // which version of the Terms the owner accepted (0 = the unpublished template) and when
  platformDb().prepare('UPDATE tenants SET terms_version=?, terms_accepted_at=? WHERE id=?').run(termsVersion(), new Date().toISOString(), tenant.id);
  const url = urlFor(tenant.slug, req);
  const origin = url || `${req.protocol}://${req.get('host')}`;
  // the owner confirms the address with the link in the welcome email; until then they cannot invite others (stops the form being used to mail strangers)
  const token = withTenant(tenant, () => {
    const owner = get('SELECT id FROM users WHERE lower(email)=lower(?)', tenant.owner_email);
    run('UPDATE users SET email_verified=0 WHERE id=?', owner.id);
    return issueVerification(owner.id);
  });
  const mail = layout({ heading: `Your ${tenant.name} workspace is ready`, lines: [`Confirm ${tenant.owner_email} with the button below, then sign in to start setting up your company.`, tenant.trial_ends_at ? `Your ${PLAN_SETTINGS.default_trial_days}-day free trial runs until ${tenant.trial_ends_at.slice(0, 10)} (UTC).` : tenant.trial_note ? `${tenant.trial_note}. Choose a plan in Settings > Plan & Billing to start.` : ''].filter(Boolean), button: { label: 'Confirm email and open workspace', url: `${origin}/verify-email/${token}` } });
  await sendMail({ to: tenant.owner_email, subject: `Welcome: ${tenant.name} is ready`, ...mail });
  recordServerEvent('signup_completed', { ...(b.analytics || {}), product: tenant.product, tenant_id: tenant.id });
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

// ---- Public marketing website (main domain only)
const publicLimiter = rateLimit({ windowMs: 60 * 60_000, limit: Number(process.env.PUBLIC_FORM_LIMIT) || 20, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many requests from this address. Try again later.' } });
const mainOnly = (req) => { if (!isMultiTenant() || !onPlatformHost(req)) throw new HttpError(404, 'Not found'); };
/** Everything the marketing pages show: editable content, plans by product, add-ons, trial terms and payment options. */
r.get('/marketing', asyncH((req, res) => {
  mainOnly(req);
  const methods = [...new Set(platformDb().prepare('SELECT method FROM payment_accounts WHERE active=1 ORDER BY sort_order, id').all().map((a) => a.method))];
  res.json({ content: publicContent(), base_domain: BASE_DOMAIN, trial_days: PLAN_SETTINGS.default_trial_days, one_trial_per_email: PLAN_SETTINGS.one_trial_per_email, products: PRODUCTS,
    plans: planCatalog().filter((p) => PLANS[p.id]?.visible), addons: listAddons({ activeOnly: true }).map(({ id, name, description, product, price, entitlements }) => ({ id, name, description, product, price, entitlements })),
    local_methods: methods, cards: stripe.stripeConfigured(), terms_version: termsVersion(), ga4_id: getSetting('ga4_measurement_id') || null });
}));
r.get('/announcements', asyncH((req, res) => { mainOnly(req); res.json(publicAnnouncements()); }));
r.get('/legal/:slug', asyncH((req, res) => { mainOnly(req); res.json(publicLegal(req.params.slug)); }));
/** Contact / demo request form. A hidden "website" field catches bots; nothing is sent to the visitor. */
r.post('/demo-request', publicLimiter, asyncH(async (req, res) => {
  mainOnly(req);
  const b = req.body || {};
  if (b.website) return res.status(201).json({ ok: true }); // honeypot: pretend success
  const out = createDemoRequest(b);
  const to = process.env.SALES_EMAIL || process.env.BILLING_OPERATOR_EMAIL || marketingContent().contact_email;
  if (to) await sendMail({ to, subject: `Demo request: ${out.name}`, ...layout({ heading: 'New demo request', lines: [`${out.name} <${out.email}>`, `Company: ${b.company || '—'} · Product: ${out.product || 'not chosen'} · Team: ${b.team_size || '—'}`, String(b.message || '').slice(0, 1000)] }) });
  recordServerEvent('demo_requested', { product: out.product, source: b.source, landing_page: b.landing_page, visitor_id: b.visitor_id, session_id: b.session_id, consent: b.consent });
  res.status(201).json({ ok: true });
}));
/** First-party website analytics (consent required; Do Not Track / GPC honoured). */
const analyticsLimiter = rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many events' } });
r.post('/analytics/collect', analyticsLimiter, asyncH((req, res) => {
  mainOnly(req);
  res.json(collect(req, req.body || {}, BASE_DOMAIN));
}));
/** "Which workspaces are mine?": emails the owner the addresses; the answer is the same whether or not any exist. */
r.post('/find-workspace', publicLimiter, asyncH(async (req, res) => {
  mainOnly(req);
  const e = String(req.body?.email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) throw bad('Please enter a valid email address');
  const list = listTenants().filter((t) => !t.is_legacy && t.owner_email === e && t.status !== 'cancelled');
  if (list.length) await sendMail({ to: e, subject: 'Your Agentify ERP workspaces', ...layout({ heading: 'Your workspaces', lines: list.map((t) => `${t.name}: ${urlFor(t.slug, req)}/login`) }) });
  res.json({ ok: true, message: 'If that email owns a workspace, we have emailed its address.' });
}));
r.use((_req, _res, next) => next(new HttpError(404, 'Endpoint not found')));

export default r;
