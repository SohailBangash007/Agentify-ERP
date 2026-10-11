// Tenant-facing billing API (runs inside the workspace): plan, usage, checkout. Money events arrive on the platform webhook.
import { Router } from 'express';
import { asyncH, bad } from '../util.js';
import { requireStaff, can } from '../rbac.js';
import { billingState, planCatalog, usage, lockMessage } from '../services/plans.js';
import { startCardCheckout, openCardPortal, availableMethods, submitLocalPayment, submissionsFor, invoicesFor, providerName } from '../services/billing.js';
import { audit } from '../audit.js';

const r = Router();
r.use(requireStaff);

const summary = (req) => {
  const st = billingState(req.tenant);
  return { ...st, message: st.locked ? lockMessage(st.reason) : null, usage: usage(), plans: planCatalog(req.tenant.plan), provider: providerName(), methods: availableMethods(req.tenant), currency: req.tenant.currency, interval: req.tenant.billing_interval || null };
};

/** Any signed-in staff member: just enough to show the trial / read-only banner. */
r.get('/status', (req, res) => { const s = summary(req); res.json({ status: s.status, locked: s.locked, reason: s.reason || null, message: s.message, days_left: s.days_left ?? null, plan: s.plan, grace_until: s.grace_until || null, period_end: s.period_end || null }); });

r.get('/', can('settings', 'view'), (req, res) => res.json({ ...summary(req), invoices: req.tenant.is_legacy ? [] : invoicesFor(req.tenant.id), payments: req.tenant.is_legacy ? [] : submissionsFor(req.tenant.id), card_portal: req.tenant.billing_provider === 'stripe' }));

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
