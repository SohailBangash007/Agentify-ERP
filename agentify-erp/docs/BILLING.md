# Billing, subscriptions and revenue reporting

## Products and plans
* Two product families: **Real Estate Brokerage** (`real_estate`) and **Construction Management** (`construction`). A plan whose product is `bundle` gives both.
* Plans live in `platform.db` (`plans`, `plan_prices`) and are edited in the console: **Plans, add-ons & coupons**. Seeded tiers: `starter`, `growth`, `enterprise` (real estate) and `con_starter`, `con_professional`, `con_enterprise` (construction). **The seeded prices are placeholders: set real prices before launch.**
* Per plan: monthly and yearly price per currency (PKR, USD; the yearly price carries any annual discount), optional one-time setup fee per currency, users, projects, properties, storage (MB), website/partner API access, modules, features shown on the pricing page, grace days, "recommended", trial eligibility, on sale / visible.
* Price changes are versioned (new purchases and renewals only). Limit changes apply at once. A plan's product cannot change while workspaces subscribe to it.
* **Add-ons** add to a plan's limits (extra users, projects, properties, storage, API access). Bought with bank/wallet payments or switched on by a Billing Manager (reason required).
* **Coupons**: percent or fixed amount, limited by product, plan, interval, dates and number of uses, first-payment-only by default. Applied by the server to bank/wallet payments. For card checkout create matching promotion codes in Stripe (checkout accepts them).

## Where limits are enforced (server side)
`services/plans.js billingGuard` runs on every workspace API call:
* product modules (`/properties`, `/listings` need Real Estate; `/construction` needs Construction) → `402 product_not_in_plan`
* plan modules → `402 module_not_in_plan`
* projects, properties (on create), storage (on any upload) → `402 project_limit | property_limit | storage_limit`
* users (invitations and activations) → `402 seat_limit`
* read-only lock → writes `402 billing_locked` (reads and exports keep working)
* website/partner API (`/api/public`) without API access → `402 api_not_in_plan`

## Subscription states
| State | Meaning | Access |
|---|---|---|
| `trialing` | free trial running (UTC start/end in `trial_started_at` / `trial_ends_at`) | trial limits of the product's trial plan |
| `pending` | waiting for a first payment (no trial: trials off, plan not trial-eligible, or the owner email already had a trial) | read-only |
| `active` | paid | plan limits |
| `past_due` | payment failed or a manual renewal is unpaid | full access until `grace_until`, then read-only |
| `canceled` | will not renew | full access until `current_period_end` |
| `expired` | trial or paid period over (set by the lifecycle job) | read-only |
| `suspended` / workspace `cancelled` | platform action | no access / read-only |

Nothing is ever deleted for non-payment. Every change is written to the append-only `subscription_history` with source (admin, payment, webhook, system), actor and reason.

## Trials
* Default **7 days** (console setting; 0 = no trial). One trial per owner email (SHA-256 hash in `trial_claims`; can be switched off).
* Console **Trial controls** (permission `trials.manage`, reason always required): extend (days or until a date), shorten, end now, revoke (abuse), grant a new trial.
* Reminders at 3, 1 and 0 days before the end (configurable), by email and in-app, each sent once (`lifecycle_notices`).

## Lifecycle job (`services/lifecycle.js`)
Runs at start-up and hourly (`index.js`), or on demand: console *POST /api/platform/admin/lifecycle/run* or `npm run platform:lifecycle` on the server. Idempotent. Moves trials to `expired`, sends trial and renewal reminders, moves manual/bank subscriptions whose period ended to `past_due` with grace, expires past-due and cancelled subscriptions at the end of grace / paid period, and flags cancelled workspaces whose retention period is over. Card renewals are driven by Stripe webhooks.

## Payments
* **Stripe** (cards): hosted Checkout and customer portal; keys, price IDs (one per plan and interval, plus `<plan>_setup` for setup fees) and webhook secret in the console (encrypted). Webhook: `POST https://<main domain>/api/platform/billing/webhook/stripe` with events `checkout.session.completed`, `customer.subscription.created|updated|deleted`, `invoice.paid`, `invoice.payment_failed`, `charge.refunded`. Signatures verified (5-minute window), events de-duplicated. **Live billing needs your Stripe account and keys.**
* **Generic provider**: signed JSON webhook `POST /api/platform/billing/webhook/generic` (`X-Signature: sha256=<HMAC of the raw body with BILLING_WEBHOOK_SECRET>`), types `subscription.activated|renewed|canceled`, `payment.failed`, `invoice.paid`, `payment.refunded`.
* **Bank and wallets** (Raast, Easypaisa, JazzCash, SadaPay, NayaPay, bank transfer): the customer pays and enters the reference; the amount is computed by the server (quote); a Billing Manager confirms the money arrived, which activates the plan, creates the invoice, applies the coupon and add-ons, and emails a receipt. A reference can be used once.
* **Manual activation**: "Change plan" (reason required) is the authorised manual activation for exceptions; "Record payment" records money already received.
* **Refunds**: recorded against one paid invoice (manual with transfer reference and reason, or from provider webhooks, idempotent). The invoice stays as collected; refunds are separate records.
* Card numbers are never stored by the platform.

## Revenue formulas (`services/finance.js`, console **Revenue & subscriptions**)
All money is reported per currency; different currencies are never added together.

| Metric | Formula |
|---|---|
| MRR | Σ over `active` subscriptions of the recurring price they pay (`tenants.price_amount`, after coupons, without setup fees); yearly ÷ 12. Excludes trials, pending, cancelled, expired, suspended. |
| MRR at risk | same for `past_due` subscriptions (not in MRR) |
| ARR (run-rate) | MRR × 12. Forward-looking; **not** recognised revenue. |
| Invoiced | invoices raised in the period (any status) |
| Collected (gross) | paid invoices in the period (payment date), including setup fees |
| Refunds | refunds recorded in the period |
| Net collections | collected − refunds |
| Recognised revenue | each paid invoice spread evenly over its service period (`period_start`..`period_end`), the part inside the range; one-time amounts (setup fees) on the payment date; refunds deducted when made |
| Outstanding | bank/wallet payments waiting for confirmation + monthly value of past-due subscriptions |
| Failed payments | provider `payment.failed` events + rejected bank/wallet submissions |
| Trial conversion | of trials that ended in the period, the share whose workspace has a paid invoice |
| New / renewals / churn | first paid invoice in the period / later paid invoices / subscriptions that moved to cancelled or expired from a paid state |

Taxes: prices are treated as tax-inclusive; no tax is split out until a tax rule exists. Discounts reduce the price paid. Filters: period, product, plan, status, currency, workspace. Export: CSV/Excel (audited). Tests: `test/saas-finance.test.js`.
