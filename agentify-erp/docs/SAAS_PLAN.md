# Agentify ERP SaaS conversion: audit and plan

## 1. Audit (October 2026)

| Area | Finding |
|---|---|
| Stack | Node 22+ (`node:sqlite`), Express, React 18 + Vite, recharts, pdfkit/exceljs. No ORM, no TypeScript, no linter. Tests: `node --test` against a real server and temp databases (122 tests). |
| Tenancy | Control-plane `platform.db` (tenants, billing, console) plus **one SQLite database and one upload folder per tenant**, selected from the host name (`<slug>.<ERP_BASE_DOMAIN>` or custom domain) and bound per request with `AsyncLocalStorage`. Tokens carry the tenant id. The original single-company install is tenant #1 (`is_legacy`). `test/tenancy.test.js` covers cross-tenant access. |
| Auth | Workspace users: bcrypt, JWT httpOnly cookie, CSRF header, TOTP 2FA, invitations, email verification, password reset. Console users: separate table, tracked sessions, sign-in history, 7 fixed roles. |
| Plans/billing | Plans and versioned prices in `platform.db`, editable in the console. States trialing/active/past_due/canceled with read-only lock (never deletes). Stripe (hosted checkout, signed webhooks, idempotent events), generic signed webhook, local PK methods with operator approval, manual payments with reasons and history. |
| Console | `/platform/*`: dashboard KPIs (MRR/ARR, payments, conversion, churn), workspaces, plans, payments, reports/exports, audit, sessions, backups, maintenance. |
| ERP | Real-estate ERP (CRM, properties, sales, installments, receipts, double-entry accounting, commissions, HRM, vendors, tenders/BOQ bids, customer and vendor portals, website builder). Construction pieces already exist: construction contracts (sales of kind `construction`), project schedules, expense vouchers by project, tenders with BOQ. |
| Deployment | GitHub Actions → SSH → PM2 + nginx (deploys `main` only). |

### Gaps against the brief
1. No product families: plans and tenants know nothing about Real Estate vs Construction; no product-level entitlements.
2. Trial is 14 days, date-only; no reminders; trial end not persisted as a state change; no abuse controls; no "pending/expired" states.
3. No property/storage/API limits, setup fees, add-ons, coupons, refunds.
4. First console admin comes from env vars (operator-chosen password); console users are created with a password typed by another admin instead of an invitation; roles lack Platform Owner / Billing / Support / Analytics.
5. MRR mixes annual normalisation implicitly; refunds/net collections are not reported.
6. No website analytics, consent, demo requests, product pages, legal pages, SEO for marketing routes.
7. No announcements/release notes, no integration registry, no version metadata.
8. No construction-specific data models (BOQ, budgets, estimates, materials/stock, purchase orders, subcontracts, labour, change orders, payment certificates, site diaries).

## 2. Decisions

* **Keep database-per-tenant.** It is the strongest isolation available on SQLite (a tenant's queries physically cannot reach another file). Every new tenant table lives in the tenant DB; every platform table lives in `platform.db`.
* **Products** = `real_estate`, `construction`, `bundle` (both). `plans.product` places a plan in a family; `tenants.product` records what the customer chose at signup. Product modules are enforced in `billingGuard` (server), the client only hides menus.
* **Existing data**: the legacy tenant gets `bundle` (keeps everything, gains construction). Other existing tenants and plans become `real_estate`. New construction plans are seeded (Starter / Professional / Enterprise) with the same placeholder prices as the existing real-estate tiers; the owner edits them in the console before launch.
* **Trial**: default 7 days for new sign-ups (an explicit console setting still wins), stored as UTC timestamps; one trial per owner email.
* **Lifecycle job** (hourly, idempotent) moves trials to `expired`, sends reminders, moves manual subscriptions whose period ended to `past_due` with grace, and records every transition in subscription history.
* **Payment provider**: Stripe stays the card provider (already integrated, provider-hosted checkout); local PK methods and manual payments remain. Live billing needs the owner's Stripe keys.
* **Analytics**: first-party, opt-in by consent (Do Not Track / GPC honoured), no IPs stored; GA4 optional when an ID is configured.

## 3. Phases

| Phase | Scope |
|---|---|
| 1 | This audit/plan; fix the date-dependent test |
| 2 | Platform roles (Owner, Billing, Support, Analytics), console invitations, one-time owner bootstrap (CLI + setup token), cross-tenant tests for new endpoints |
| 3 | Product families, product entitlements, property/storage/API limits, 7-day UTC trials, reminders, lifecycle job, pending/expired states, trial controls, add-ons, coupons, setup fees, refunds |
| 4 | Console: product/plan filters, financial metrics (MRR by currency, collected vs invoiced, refunds/net), trial controls UI, staff invitations |
| 5 | Marketing site: product pages, pricing per product, legal templates, demo form, SEO (meta, sitemap, robots), signup with product choice |
| 6 | Analytics + consent, announcements/releases, integration registry, version metadata |
| 7 | Construction module (tenant DB) + client portal progress, product-based navigation |
| 8 | Hardening, migration checks, docs, final report |

## 4. Migration and rollback

All schema changes are additive (`CREATE TABLE IF NOT EXISTS`, `ALTER TABLE ADD COLUMN`) and run on start-up; no table is dropped or rewritten, no ids change. Before upgrading production: stop the service, copy `server/data/` (platform.db and `tenants/*/erp.db`) and `ERP_SECRETS_KEY`/`data/.secrets-key`. Rollback = stop, restore the copied files, deploy the previous commit. Older code ignores the added columns and tables.
