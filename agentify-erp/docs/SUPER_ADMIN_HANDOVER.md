# Super Admin Portal: handover

The super admin console lives at `/platform` on the main domain (for example `http://localhost:4000/platform`). Plan and audit notes: [SUPER_ADMIN_PLAN.md](SUPER_ADMIN_PLAN.md).

## 1. What was built

| Area | Pages (under /platform) | Notes |
|---|---|---|
| Layout | all | Dark collapsible left sidebar (remembered), drawer on phones, global search (Ctrl+K), alerts bell, quick actions, account menu. Menus and buttons follow the user's role. Every page has its own URL. |
| Dashboard | `/`, `/health`, `/notifications` | 12 KPIs with previous-period comparison and click-through, date ranges, revenue / registration / status / plan / funnel / payment / expiry charts, top workspaces, recent transactions and admin activity. Health shows only verified states ("Not checked" otherwise). Alerts are deduplicated and close themselves when fixed. |
| Workspaces | `/workspaces`, `/workspaces?status=…`, `/workspaces/:id`, `/expiry` | Search, filters, sorting, pagination, CSV export, create. Workspace panel with 8 tabs: overview & onboarding, company profile, users & sign-in help, subscription & history, invoices & payments, usage & limits (with per-workspace overrides and storage), activity, notes. Actions: change plan, record payment, extend trial / grace, reminders, resend onboarding email, change owner, suspend / cancel / reactivate (reasons required). |
| Plans & subscriptions | `/plans`, `/subscriptions/history` | Plan builder: prices (PKR / USD, monthly / yearly), user and project limits, modules, grace days, on sale / public switches. Versioned prices; existing subscribers keep their price until renewal. Trial length and trial limits. Append-only subscription history. |
| Billing | `/transactions`, `/payments`, `/billing/stripe`, `/billing/accounts`, `/reconciliation` | One list of payments and invoices with separate payment and invoice statuses; existing approval flow, Stripe and local accounts unchanged; reconciliation checks. |
| Reports | `/reports` | 11 reports (growth, revenue, MRR/ARR, outstanding, failures, revenue by plan and method, conversion, churn, usage, admin activity, reliability), saved views, server-side CSV and Excel export (audited, formula-safe). |
| Security | `/admins`, `/security`, `/security/sessions`, `/security/logins` | 7 fixed roles enforced on every endpoint, console users with access on/off, optional "require two-factor", tracked sessions with revoke, sign-in history with failed-attempt and new-IP alerts. |
| System | `/setup`, `/maintenance`, `/backups`, `/audit` | Setup checklist, maintenance mode (closes workspaces, never the console), recent server errors, backups (unchanged), append-only audit log with filters and CSV export. |

### Roles

| Role | Can |
|---|---|
| Super Admin | everything, including console users and security rules |
| Platform Administrator | everything except managing console users |
| Finance Administrator | view; payments, subscriptions, plans, Stripe and accounts; exports |
| Customer Success Manager | view; create and edit workspaces, sign-in help, exports |
| Technical Administrator | view; backups, maintenance, sign-in help, audit log |
| Security Auditor | view; audit log, sign-in history; exports |
| Read-Only Analyst | view dashboard, workspaces, billing and system pages |

The full matrix is in the console (Console users & roles → What each role can do) and in `server/src/services/platformAccess.js`.

## 2. Files

New:
- `server/src/services/platformTenants.js`: workspace summaries, detail, lifecycle, profile, limits, notes, manual payments, transactions, console users
- `server/src/services/platformMetrics.js`: dashboard KPIs and charts, daily snapshots, health checks, alerts, search
- `server/src/services/plansStore.js`: plans and versioned prices in the database
- `server/src/services/subscriptions.js`: subscription history
- `server/src/services/platformAccess.js`: roles, permissions, audit request context
- `server/src/services/maintenance.js`: maintenance mode, recent errors
- `server/src/services/platformReports.js`: reports, exports, saved views, reconciliation
- `server/test/superadmin.test.js`: 19 tests for all of the above
- `client/src/pages/SuperAdmin.jsx`: workspace list, workspace panel, expiry page
- `client/src/pages/platform/AdminShell.jsx`, `Dashboard.jsx`, `Billing.jsx`, `Security.jsx`, `Reports.jsx`, `admin.css`

Changed (additions only, existing behaviour kept):
- `server/src/platform.js` (new tables / columns, plan loading, trial length from settings)
- `server/src/index.js` (maintenance gate, error log, platform background job)
- `server/src/routes/platformAdmin.js`, `server/src/routes/platform.js` (new endpoints; permission check on every operator route)
- `server/src/routes/billing.js` (plan list from the database)
- `server/src/services/plans.js` (plans from the database, per-workspace overrides, module access)
- `server/src/services/billing.js` (subscription history, price kept per workspace, plan availability check)
- `server/src/services/platformAuth.js` (tracked sessions, sign-in history, alerts, inactive users, roles)
- `server/src/services/platformConfig.js` (richer audit rows; Stripe price slots follow the plans)
- `server/src/services/accessLinks.js` (support-created reset links)
- `client/src/App.jsx` (`/platform/*` routes), `client/src/api.js` (`patch`), `client/src/pages/PlatformConsole.jsx` (shell and routes)

## 3. Database changes (platform.db)

All are applied automatically on start-up and only add things; nothing is dropped or rewritten. Each workspace's own database is untouched.

- New tables: `plans`, `plan_prices`, `subscription_history` (append-only trigger), `tenant_notes`, `platform_metrics_daily`, `platform_notifications`, `platform_notification_reads`, `platform_logins`, `platform_sessions`
- New columns: `tenants.entitlements, price_amount, price_currency, owner_name, owner_phone, account_manager`; `platform_admins.role, active`; `platform_audit.actor_role, target, reason, outcome, ip, user_agent, request_id`
- New triggers: `platform_audit` can no longer be updated or deleted
- New indexes on invoices, billing events, tenant events, audit, sign-ins and sessions
- Seed: the three existing plans and their prices are copied into `plans` / `plan_prices` the first time. Existing platform admins become Super Admins.
- Existing console sessions end once after upgrading (sessions are now tracked); everyone signs in again.

## 4. Settings

New environment variable:
- `PLATFORM_TZ` (optional, default `Asia/Karachi`): timezone for dashboard and report dates.

Existing variables that the setup checklist and health page look at: `ERP_BASE_DOMAIN`, `RESEND_API_KEY`, `MAIL_FROM`, `BILLING_OPERATOR_EMAIL`, `ERP_SECRETS_KEY`, `BACKUP_ENABLED`, `BACKUP_EVERY_HOURS`. No secret values are shown in the console.

New console settings (stored in `platform_settings`): trial length, trial plan, require two-factor, maintenance mode, saved report views.

## 5. Tests

`npm test` in `server/`: 122 tests, all passing (103 existing + 19 new). The new tests cover: sign-in and host restrictions, workspace creation, expiry actions, sign-in help, console users, dashboard totals against invoice records, alerts and deduplication, search escaping, plan versioning and MRR, module access, manual payments and duplicate refusal, reasons on sensitive actions, every role's access, append-only audit, sessions and sign-in history, required two-factor, maintenance mode, reports agreeing with the dashboard, export permission and formula safety, reconciliation.

The UI was checked by hand in the browser at desktop and phone widths. There are no automated browser (end-to-end) tests.

## 6. Not built, and why

| Item from the brief | Status |
|---|---|
| Support access / workspace impersonation | Not built. Needs a decision on scope and customer consent. Sign-in help (reset links etc.) covers the common cases without seeing customer passwords. |
| IP allowlisting, SMS providers, webhooks UI, feature flags, API docs page | Not built. Each needs an external service or a product decision. |
| Discounts, coupons, add-ons, tax rules, refunds | Not built. A manual payment can record a different amount (for example a discount), with a note. There is no refund flow; Stripe refunds are done in Stripe. |
| Email templates and delivery logs | Not built. Emails use the existing fixed templates; without `RESEND_API_KEY` they are only printed in the server window (the health page says so). |
| Restoring a backup from the browser | Not built on purpose: restoring overwrites live data and should be done on the server with the service stopped (see README). |
| Custom roles | Roles are fixed in code so a console mistake cannot lock everyone out or widen access. |
| Archiving workspaces | Not built. Cancelling keeps all data and can be undone; a separate archived state would need a table rebuild. |
| Large exports in the background | Exports are generated straight away (up to 50,000 rows), which is enough at the current size. |
| Period comparisons for state counts and MRR | These use daily snapshots, which start on the day of this upgrade. Until there is history the dashboard says "No earlier data to compare" instead of guessing. Payment, failure, conversion and churn comparisons work from day one. |
| Timezones with daylight saving | Dashboard date grouping uses the timezone's current offset. Correct for Asia/Karachi (no daylight saving). |
