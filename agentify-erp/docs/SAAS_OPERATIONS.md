# Agentify ERP SaaS: architecture and operations

See also: [BILLING.md](BILLING.md) (plans, subscriptions, payments, revenue formulas), [SAAS_PLAN.md](SAAS_PLAN.md) (audit and plan), [SUPER_ADMIN_HANDOVER.md](SUPER_ADMIN_HANDOVER.md) (console pages), [../ARCHITECTURE.md](../ARCHITECTURE.md) (ERP data model).

## 1. Architecture
```
main domain (ERP_BASE_DOMAIN)            <slug>.ERP_BASE_DOMAIN or custom domain
  /                public website           /            workspace app (staff), /portal, /vendor, /site (company website)
  /platform/*      platform console         /api/*       workspace API (tenant DB)
  /api/platform/*  signup, marketing, analytics, webhooks, console API (platform DB)
```
* **platform.db**: tenants, plans, prices, add-ons, coupons, subscriptions history, invoices, payments, refunds, console users/sessions/audit, analytics events, announcements, legal documents, demo requests, integration events, settings.
* **One SQLite database and one upload folder per workspace** (`data/tenants/<slug>/erp.db`, `uploads/tenants/<slug>/`). The original install is workspace #1 (`is_legacy`, keeps `data/erp.db` and `uploads/`, never billed, has both products).
* Node 22+, Express, `node:sqlite`, React 18 + Vite. No new runtime dependency was added for the SaaS conversion.

## 2. Tenant isolation
* The workspace is resolved from the host name on every request (`platform.js tenantContext`) and the whole request runs with that workspace's database connection (`AsyncLocalStorage`). A query cannot reach another workspace's file.
* Session tokens carry the workspace id and are refused on any other workspace; uploads, documents, exports, PDFs, background jobs (`forEachTenant`) and reminders are per workspace.
* The console API only answers on the main domain; workspace users cannot reach it.
* Ids from requests are looked up in the current workspace only; construction routes also check that each id belongs to the project it is used with.
* Tests: `test/tenancy.test.js`, `test/construction.test.js` (cross-workspace ids), `test/saas-lifecycle.test.js` (product separation), `test/hardening.test.js`.

## 3. Products and plan enforcement
Product modules and limits are enforced in `services/plans.js billingGuard` on the server (see BILLING.md). The sidebar only hides what the server already refuses, and shows an "Add Construction / Add Real Estate" entry for the product a workspace does not have.

## 4. Environment variables (`server/.env.example`)
| Variable | Purpose |
|---|---|
| `ERP_BASE_DOMAIN` | main domain; enables multi-tenant mode (`localhost` in development) |
| `ERP_DEFAULT_TENANT`, `ERP_DEFAULT_TENANT_NAME` | slug/name of the original install |
| `JWT_SECRET` | workspace session signing (set in production) |
| `ERP_SECRETS_KEY` | encrypts secrets saved in the console (Stripe, Resend, webhook URL). Back it up separately; it is not in backups |
| `RESEND_API_KEY`, `MAIL_FROM` | email (can also be set in the console, which wins) |
| `BILLING_PROVIDER`, `BILLING_WEBHOOK_SECRET`, `BILLING_CHECKOUT_URL_*` | generic provider (optional) |
| `STRIPE_*` | fallback for Stripe settings (prefer the console) |
| `BILLING_OPERATOR_EMAIL`, `SALES_EMAIL` | who is told about bank payments / demo requests |
| `PLATFORM_ADMIN_EMAIL`, `PLATFORM_ADMIN_PASSWORD` | legacy bootstrap only; prefer the setup token (below) and remove them afterwards |
| `ERP_PLATFORM_ADMIN_TOKEN` | bearer token for scripts (full access; leave empty unless needed) |
| `PLATFORM_TZ` | console reporting timezone (default Asia/Karachi) |
| `BACKUP_DIR`, `BACKUP_EVERY_HOURS`, `BACKUP_KEEP`, `BACKUP_UPLOADS`, `BACKUP_ENABLED` | backups |
| `SIGNUP_LIMIT`, `LOGIN_LIMIT`, `PUBLIC_FORM_LIMIT` | rate limits |

## 5. First platform owner (no default credentials)
1. Start the server with no console account. It creates a one-time setup token, stores only its hash, writes the token to `<ERP_DATA_DIR>/platform-setup-token.txt` (owner-only permissions) and logs the file location (never the token).
2. On the server: `cat server/data/platform-setup-token.txt` or `npm --prefix server run platform:setup-token` (prints a fresh token, valid 24 hours).
3. Open `https://<main domain>/platform/first-run`, enter the token, your email, name and a strong password. The account is a **Platform Owner**. The token file is deleted and the endpoint closes for good.
4. Sign in at `/platform`, turn on two-factor sign-in (Security), then switch on "Require two-factor for every console user".
5. Invite colleagues from **Console users & roles** (they set their own password through a 72-hour one-time link). Roles: Platform Owner, Super Admin, Platform Administrator, Billing Manager, Finance Administrator, Support Manager, Customer Success Manager, Technical Administrator, Security Auditor, Analytics Viewer, Read-Only Analyst. Only an owner can create or remove owners.
Existing deployments that used `PLATFORM_ADMIN_EMAIL/PASSWORD`: that account becomes the Platform Owner the first time only; remove the variables from the environment.

## 6. Launch checklist (platform owner)
1. Plans, add-ons & coupons: set real prices, limits, features and setup fees for both families; trial length (default 7 days) and reminder days.
2. Website & legal: brand texts, contact details, SEO texts; edit the four legal templates, have them reviewed, publish (reviewer name required).
3. Integrations: Resend API key + verified sender, Send test; Stripe keys, prices and webhook (Billing > Stripe), Send test; optional GA4 ID; alerts webhook.
4. Local payment accounts if you accept bank/wallet transfers.
5. Retention period for cancelled workspaces (default 90 days).

## 7. Website, analytics and consent
* Public pages: `/`, `/real-estate`, `/construction`, `/pricing`, `/contact`, `/legal/:doc`, `/signup`, `/login` (find workspace). Titles, descriptions, canonical URLs and Open Graph tags are rendered on the server; `/sitemap.xml` and `/robots.txt` on the main domain.
* Analytics are first-party and opt-in: nothing is collected until the visitor accepts; Do Not Track and Global Privacy Control are honoured; no IPs or user agents stored; query strings dropped. Events: page_view, product_page_view, pricing_view, signup_started, demo_form_view (browser) and signup_completed, demo_requested, checkout_started, subscription_activated (server). Console: **Website analytics**. GA4 receives the same events only after consent when an ID is configured.

## 8. Announcements and releases
Console **Announcements & releases**: draft, schedule, publish, retire; target products, plans (or trial), workspaces, roles; optionally on the website. Workspaces see unread notes at the top and dismiss them; seen/read counts are kept. The running version (package version, commit, deployment time) comes from `server/release.json` written by the deploy workflow, or the local git checkout.

## 9. Scheduled jobs (in-process, started by `src/index.js`)
| Job | Interval |
|---|---|
| reminders, goal nudges, content reminders (every workspace) | 30 min |
| metric snapshot, console alerts | hourly |
| subscription lifecycle (trials, reminders, renewals, expiry, retention flags) | hourly + at start |
| backups | checked hourly, every `BACKUP_EVERY_HOURS` |
Failures are visible under System health and sent to the alerts webhook when configured. Run one server process (PM2 single instance); the jobs are idempotent.

## 10. Data retention, export and deletion
* Workspaces can export every list/report (Excel/CSV/PDF) and the Super Admin can download the whole database (My Space > Security).
* An owner can ask to close the account (Plan & Billing); operators are alerted.
* Cancelled workspaces keep their data for the retention period, then are flagged for review. Deletion is manual (Platform Owner/Super Admin, address typed back, reason; earlier only on the customer's request), optionally with a final archive, and keeps billing records. Deleted workspaces cannot be reactivated.

## 11. Migrations and rollback
All schema changes are additive and run at start-up (`CREATE TABLE IF NOT EXISTS`, `ALTER TABLE ADD COLUMN`); nothing is dropped or renamed. One-time data steps (each guarded by a flag in settings):
* plans: product column (existing plans = Real Estate), new limits seeded for the known tiers, construction tiers added once;
* the original install becomes product `bundle`; other existing workspaces are `real_estate`;
* existing customer websites: values inherited from the original company's starter site are replaced with neutral ones (`site_scrub_v1`; only exact inherited values are touched);
* role permissions for the new `construction` module (`perm_upgrade_con1`).

Before upgrading production: stop the service, copy `server/data/` (platform.db and `tenants/*/erp.db`) and the secrets key. Rollback: stop, restore the copy, deploy the previous commit (older code ignores the new tables and columns).

## 12. Backups and recovery
Unchanged from before: scheduled `VACUUM INTO` snapshots of every database to `BACKUP_DIR`, newest `BACKUP_KEEP` kept, optional uploads. Copy them off the server. Restore: stop the server, put back `platform.db` and the workspace `erp.db` files, start. Keep `ERP_SECRETS_KEY` / `data/.secrets-key` and `JWT_SECRET` separately.

## 13. Testing
`npm test` in `server/` (157 tests, real HTTP server, temp databases). SaaS-specific: `saas-staff`, `saas-lifecycle`, `saas-finance`, `saas-site`, `saas-ops`, `construction`. The client is checked with `npm run build`; there is no automated browser test suite.

## 14. Deployment
`.github/workflows/deploy.yml` deploys `main` over SSH to PM2 behind nginx (unchanged), now also writing `server/release.json`. Production needs: HTTPS on the main domain and a wildcard certificate/DNS for `*.<main domain>`, `NODE_ENV=production`, `ERP_BASE_DOMAIN`, `JWT_SECRET`, `ERP_SECRETS_KEY`, then the setup token flow above.
