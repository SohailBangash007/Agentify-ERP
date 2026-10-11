// Subscription history: one append-only row for every change to a workspace's plan or billing state, whoever made it
// (super admin, payment provider webhook, approved payment, system). Callers pass the tenant row before and after.
import { platformDb } from '../platform.js';

const FIELDS = ['plan', 'subscription_status', 'current_period_end', 'trial_ends_at', 'grace_until', 'billing_interval', 'price_amount'];

/** Writes a row only when something actually changed. `db` lets callers record inside their own transaction. */
export function recordSubscriptionChange(before, after, { source, actor = null, reason = null } = {}, db = platformDb()) {
  if (!before || !after) return false;
  if (!FIELDS.some((f) => String(before[f] ?? '') !== String(after[f] ?? ''))) return false;
  db.prepare(`INSERT INTO subscription_history(tenant_id,source,actor,reason,from_plan,to_plan,from_status,to_status,from_period_end,to_period_end,trial_ends_at,grace_until,interval,price_amount,price_currency)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(after.id, source, actor, reason ? String(reason).slice(0, 500) : null, before.plan ?? null, after.plan ?? null,
    before.subscription_status ?? null, after.subscription_status ?? null, before.current_period_end ?? null, after.current_period_end ?? null,
    after.trial_ends_at ?? null, after.grace_until ?? null, after.billing_interval ?? null, after.price_amount ?? null, after.price_currency ?? null);
  return true;
}

export function subscriptionHistory({ tenantId, limit = 100, offset = 0 } = {}) {
  const where = tenantId ? 'WHERE h.tenant_id=?' : '';
  const args = tenantId ? [Number(tenantId)] : [];
  const rows = platformDb().prepare(`SELECT h.*, t.name tenant_name, t.slug FROM subscription_history h JOIN tenants t ON t.id=h.tenant_id ${where} ORDER BY h.id DESC LIMIT ? OFFSET ?`).all(...args, Math.min(500, limit), offset);
  const total = platformDb().prepare(`SELECT COUNT(*) n FROM subscription_history h ${where}`).get(...args).n;
  return { total, rows };
}
