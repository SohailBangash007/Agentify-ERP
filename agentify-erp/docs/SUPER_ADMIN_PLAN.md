# Super Admin Portal: audit and implementation plan

## 1. What exists today

| Area | Where | Notes |
|---|---|---|
| Stack | Node 22 + Express, `node:sqlite` (SQLite), React 18 + Vite, recharts | One platform DB (`platform.db`) plus one SQLite DB per workspace |
| Console route | `/platform` (client `PlatformConsole.jsx` + `SuperAdmin.jsx`) | Only the exact path `/platform` is routed |
| Console API | `/api/platform/admin/*` (`routes/platformAdmin.js`), `/api/platform/tenants*`, `/api/platform/payments*` (`routes/platform.js`) | Only reachable on the platform host; cookie session + CSRF header, or bearer token for scripts |
| Auth | `services/platformAuth.js` | bcrypt passwords, JWT cookie (8h), optional TOTP 2FA with recovery codes, token_version revocation |
| Workspaces | `tenants` table | Lifecycle `status` (active/suspended/cancelled) and billing state (`subscription_status`, `plan`, `trial_ends_at`, `current_period_end`, `grace_until`) on the same row |
| Plans | `services/plans.js` `PLANS` constant | Hard-coded prices and limits (seats, projects); client also hard-codes the plan list |
| Billing | `services/billing.js`, `services/stripe.js` | Idempotent webhooks (`billing_events` UNIQUE(provider,event_id)); local-method payments need operator approval; `invoices` table |
| Access rules | `billingState()` | Trial → locked after end; past_due → 7-day grace; canceled → until period end; locked = read-only |
| Audit | `platform_audit` (admin, action, detail), `tenant_events` | No IP, reason, outcome or request id |
| Backups | `services/backup.js` | Scheduled snapshots of every DB, retention, manual run |

## 2. Gaps and defects found

1. **Plans are code, not data.** Prices/limits cannot be edited; changing them would silently change history. → Phase 3: `plans` table with versioned prices; invoices keep the amount charged.
2. **One row holds subscription and lifecycle state.** Workable, but there is no subscription history. → Phase 3: `subscription_history` written by every state change (service layer only).
3. **No metric history.** Previous-period comparisons for counts/MRR cannot be computed from the current schema. → Phase 2: daily `platform_metrics_daily` snapshots; comparisons appear once history exists (never invented).
4. **All super admins are all-powerful.** → Phase 4: roles and permissions enforced on every endpoint.
5. **Audit log is thin.** → Phase 4: IP, user agent, reason, outcome, request id; append-only.
6. **Spelling mismatch** `cancelled` (workspace) vs `canceled` (subscription). Kept as-is for compatibility; labels normalised in the UI.
7. **No platform notifications, global search, reports or health page.** → Phases 2, 4, 5.
8. **Console was only on `/platform`.** Deep links were impossible. → Phase 2: `/platform/*` routes; `/platform` still works.

## 3. What must not change

Workspace sign-in, signup, workspace URLs, Stripe keys/webhook URL, local payment approval flow, billing lock rules, backups, existing platform admin accounts and 2FA, all existing API endpoints (new ones are added beside them).

## 4. Phases

| Phase | Scope | Status |
|---|---|---|
| 1 | Audit and plan (this document) | Done |
| 2 | Sidebar layout (collapsible, mobile drawer, remembered state), routed pages, executive dashboard from real data with date ranges and period comparison, daily metric snapshots, global search, notification centre | Done |
| 3 | Plans in the database (editable, versioned), subscription history, invoice/payment views with separate statuses, workspace profile editing, internal notes, reasons on sensitive actions | Done |
| 4 | Admin roles and permissions, richer append-only audit log, login history and sessions, system health page with real checks, maintenance mode | Done |
| 5 | Reports and CSV/Excel export centre, reconciliation checks, regression tests | Done |
| 6 | Handover notes: features, files, migrations, environment variables, known limits | Done |

Not planned unless asked (needs an external service or a product decision first): SMS providers, IP allowlisting, workspace impersonation, restores from the browser, coupons and add-ons, tax engine.
