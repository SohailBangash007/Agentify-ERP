// Tenant-facing billing API (runs inside the workspace): plan, usage, quotes, checkout. Money events arrive on the platform webhook.
import { Router } from 'express';
import { asyncH, bad } from '../util.js';
import { requireStaff, can } from '../rbac.js';
import { billingState, planCatalog, usage, lockMessage, PRODUCTS, MODULES } from '../services/plans.js';
import { startCardCheckout, openCardPortal, availableMethods, submitLocalPayment, submissionsFor, invoicesFor, providerName } from '../services/billing.js';
import { quote, listAddons, tenantAddons, refundsFor } from '../services/commerce.js';
import { audit } from '../audit.js';

const r = Router();
r.use(requireStaff);

/** Plans this workspace can buy: its own product family (and bundles), or everything for a combined workspace. */
const catalogFor = (t) => planCatalog(t.plan, t.product && t.product !== 'bundle' ? t.product : null);
const summary = (req) => {
  const st = billingState(req.tenant);
  return { ...st, message: st.locked ? lockMessage(st.reason) : null, usage: usage(), plans: catalogFor(req.tenant), provider: providerName(), methods: availableMethods(req.tenant), currency: req.tenant.currency, interval: req.tenant.billing_interval || null,
    product: req.tenant.product || 'real_estate', product_labels: PRODUCTS, modules: MODULES, trial_note: req.tenant.trial_note || null };
};

/** Any signed-in staff member: enough to show the trial / read-only banner and to hide what the subscription does not include. */
r.get('/status', (req, res) => {
  const s = summary(req);
  res.json({ status: s.status, locked: s.locked, reason: s.reason || null, message: s.message, days_left: s.days_left ?? null, trial_ends_at: s.trial_ends_at || null, plan: s.plan,
    grace_until: s.grace_until || null, period_end: s.period_end || null, products: s.products, product: s.product, modules: s.limits.modules, limits: s.limits, legacy: !!req.tenant.is_legacy });
});

r.get('/', can('settings', 'view'), (req, res) => res.json({ ...summary(req), invoices: req.tenant.is_legacy ? [] : invoicesFor(req.tenant.id), payments: req.tenant.is_legacy ? [] : submissionsFor(req.tenant.id),
  refunds: req.tenant.is_legacy ? [] : refundsFor(req.tenant.id), addons: listAddons({ activeOnly: true, product: req.tenant.product === 'bundle' ? null : req.tenant.product }),
  my_addons: req.tenant.is_legacy ? [] : tenantAddons(req.tenant.id), card_portal: req.tenant.billing_provider === 'stripe' }));

/** Price for a plan, interval, coupon and add-ons, computed on the server (the same figure the payment is checked against). */
r.post('/quote', can('settings', 'view'), asyncH((req, res) => {
  if (req.tenant.is_legacy) throw bad('This workspace is not billed');
  const b = req.body || {};
  res.json(quote(req.tenant, { plan: b.plan, interval: b.interval, currency: b.currency || 'PKR', coupon: b.coupon || null, addons: b.addons || [] }));
}));

/** Card checkout (Stripe when configured). Local methods use /manual-payment instead. */
r.post('/checkout', can('settings', 'edit'), asyncH(async (req, res) => {
  if (req.tenant.is_legacy) throw bad('This workspace is not billed');
  const out = await startCardCheckout(req, { plan: req.body?.plan, interval: req.body?.interval });
  audit(req, 'Started checkout', 'billing', null, `${req.body?.plan} / ${req.body?.interval || 'month'}`);
  res.json(out);
}));

/** "I paid by Raast / Easypaisa / JazzCash / SadaPay / NayaPay": recorded for the operator to confirm. */
r.post('/manual-payment', can('settings', 'edit'), asyncH(async (req, res) => {
  if (req.tenant.is_legacy) throw bad('This workspace is not billed');
  const out = await submitLocalPayment(req.tenant, req.user, req.body || {});
  audit(req, 'Submitted payment for confirmation', 'billing', out.id, `${req.body.method} ${req.body.plan}`);
  res.status(201).json(out);
}));

/** Stripe customer portal: update the card, change plan, cancel, download invoices. */
r.post('/portal', can('settings', 'edit'), asyncH(async (req, res) => res.json(await openCardPortal(req))));

export default r;
