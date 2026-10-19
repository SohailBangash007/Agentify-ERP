# Agentify ERP SaaS conversion: implementation report

Branch `claude/project-thread-ql5vsp`, 10 commits on top of `main` (`d944e35`). Nothing was deployed: the deploy workflow only runs from `main`.

## Result
* **Tests:** 157 server tests pass (`npm test` in `server/`): 122 existing (one fixed: a leave test failed on dates around a public holiday) + 35 new. Client production build passes (`npm run build`).
* **Manually checked in a browser:** the public site (desktop and 375px phone width), the full sign-up flow for a construction workspace, the console pages, and the construction screens.
* **New runtime dependencies:** none.

## What was built

| Area | Delivered |
|---|---|
| Tenancy | Kept the existing database-per-workspace design, which is the strongest isolation SQLite allows. Added product separation and cross-workspace tests for every new area. |
| Products | Real Estate Brokerage and Construction Management as plan families, plus bundles. A product is chosen at signup and enforced on the server; the sidebar follows it and offers the other product as an upgrade. |
| Plans | Editable catalogue: prices per currency and interval, setup fees, users/projects/properties/storage/API limits, modules, features, recommended flag, trial eligibility. Also add-ons, coupons and versioned prices. |
| Subscriptions | Explicit states: trialing, pending, active, past_due, canceled, expired, suspended. Append-only history with reasons. |
| Trials | 7-day default, stored in UTC and shown in local time. One trial per owner email. Console extend, shorten, end, revoke and grant, each needing a reason. Reminders at 3, 1 and 0 days. |
| Lifecycle job | Hourly and idempotent: trial expiry, reminders, manual renewals, grace periods, expiry, retention flags. Works even if nobody signs in. |
| Billing | Stripe (hosted checkout, portal, signed webhooks, setup-fee price, refunds) is unchanged and extended. Local bank and wallet payments use amounts computed by the server. Manual activation needs a reason. Refunds are recorded per invoice. |
| Owner and staff | No default credentials: a one-time setup token creates the Platform Owner, then the setup closes. Staff are invited by email. Four new roles and five new permissions. Only owners manage owners. Password strength rules. |
| Console | Revenue & subscriptions page with MRR and ARR per currency, invoiced vs collected, refunds, net, recognised revenue, outstanding, movement and conversion. It filters by product, plan, status, currency and workspace and exports to CSV/Excel. Also new: website analytics, website & legal editor, demo requests, announcements & releases, integrations, trial controls, add-ons, refunds and data deletion. |
| Public website | Home page, two product pages, pricing (product, interval, currency, comparison, add-ons, trial terms), demo form, legal pages, find-workspace, product-first signup with terms acceptance, consent banner. SEO tags are rendered on the server, plus sitemap and robots. Screenshots are real, taken from local demo workspaces. |
| Legal | Four templates (terms, privacy, refunds, subscription terms) shipped as drafts. Publishing needs a named reviewer and no remaining placeholders. Versions are kept, and the accepted version is recorded per workspace. |
| Analytics | First-party and consent-first: Do Not Track and GPC are honoured, no IPs are stored, query strings are dropped. Browser and server conversion events, channels, landing pages, campaigns, funnel. GA4 is optional and only runs after consent. |
| Announcements | Draft, schedule, publish and retire. Target by product, plan, workspace or role. Read and seen counts, in-workspace banner, optional website display. The real running version comes from the deploy record or git. |
| Integrations | Registry with honest states (connected only after a real test), encrypted secrets, https-only public URLs, history. Covers Resend, Stripe, GA4, alerts webhook and backups. SMS is listed as not available. |
| Construction | Sites, phases, milestones (which can make a client installment due), BOQ with import, export and measured progress, estimates converted to BOQ, change orders, materials and site stock, purchase orders, subcontracts, payment certificates with retention, labour, site reports, and budget vs committed vs actual with earned value. Costs become ordinary expense vouchers, so there is no second ledger. Client portal shows progress only. |
| Retention | Cancelled workspaces are kept for 90 days (configurable), flagged for review, and deleted only by a person: typed confirmation and a reason, billing records kept, optional archive. Owners can request account closure. |
| Fixes found during the audit | New customer workspaces used to inherit the original company's website: its CEO bio, phone numbers, address, customer quotes and claims. They now get neutral defaults, and existing customer workspaces are cleaned once (only exact inherited values change). "Expert Marketing" fallbacks in PDFs and the app were replaced with "Agentify ERP". |

## Migrations
All additive, automatic at start-up, no data dropped. See [SAAS_OPERATIONS.md §11](SAAS_OPERATIONS.md) for the one-time data steps and the rollback procedure. Back up `server/data/` and the secrets key before upgrading production.

## Setup commands
```
npm run install:all && npm run build
ERP_BASE_DOMAIN=<your domain> npm start
npm --prefix server run platform:setup-token     # then open https://<domain>/platform/first-run
npm --prefix server run platform:lifecycle       # optional: run the lifecycle job by hand
npm test
```

## Needs your credentials or decisions before going live
1. **Prices.** The seeded plan prices are placeholders, including the construction tiers, which copy the real-estate prices. Set the real ones in Plans, add-ons & coupons.
2. **Stripe.** You need a live account, API keys, one price ID per plan and interval (plus setup-fee prices if you charge setup fees), and the webhook endpoint with its secret. Until then, card billing shows as not configured; bank and wallet payments and manual activation work today.
3. **Resend.** You need an API key and a verified sender domain for email. Without them, emails are only written to the server log, and invitation and reset links are shown to the admin instead.
4. **Legal text.** The four documents need your company details and a lawyer's review before you publish them. Until then they display as unreviewed templates.
5. **DNS and hosting.** You need DNS and a wildcard TLS certificate for `*.<main domain>`, plus `NODE_ENV=production`, `JWT_SECRET` and `ERP_SECRETS_KEY` on the server.
6. **Optional.** A GA4 measurement ID and an alerts webhook URL.

## Known limitations (honest notes)
* **SQLite and scheduling:** both stay single-server. The jobs run inside the server process, so run one instance. Moving to Postgres would mean changing `db.js` (already noted in the README).
* **Recognised revenue:** this is an operational estimate (straight-line over the invoice period), not a full accounting revenue schedule. There is no tax engine; prices are treated as tax-inclusive.
* **Coupons and add-ons on cards:** the platform applies coupons and add-ons to bank and wallet payments. For card payments, use Stripe promotion codes and add Stripe prices for add-ons.
* **Subcontract retention:** retention is expensed when it is released (cash basis). The certified gross is tracked on the certificates.
* **Client billing for construction:** this uses construction contracts (installment schedules, receipts, statements) and milestone-linked installments. A change order does not automatically change a client contract; bill variations as an extra contract.
* **Analytics without consent:** website analytics show only visitors who accept cookies. Conversions are counted for everyone from server records.
* **Not built:** SMS/WhatsApp provider adapters, calendar sync, cloud file storage, an accounting software connector, partner API docs and outbound webhooks beyond the existing website API, MFA for customer and vendor portal users, and automated browser (end-to-end) tests.
* **Outbound URL checks:** the check runs before each request, so DNS rebinding between the check and the request is not prevented.

## Files
New (server): `cli.js`, `constructionSchema.js`, `routes/announcements.js`, `routes/construction.js`, `services/analytics.js`, `announcements.js`, `commerce.js`, `construction.js`, `finance.js`, `integrations.js`, `lifecycle.js`, `marketing.js`, `platformStaff.js`, `retention.js`, `version.js`. Tests: `saas-staff`, `saas-lifecycle`, `saas-finance`, `saas-site`, `saas-ops`, `construction`.
New (client): `marketing/Marketing.jsx`, `marketing/analytics.js`, `marketing/marketing.css`, `pages/Construction.jsx`, `pages/platform/Finance.jsx`, `pages/platform/Content.jsx`, `components/Announcements.jsx`, `public/marketing/*.png`.
Changed: platform core (`platform.js`, `plans.js`, `plansStore.js`, `billing.js`, `stripe.js`, `platformAccess.js`, `platformAuth.js`, `platformTenants.js`, `platformConfig.js`, `mailer.js`, `siteDefaults.js`, `db.js`, `rbac.js`, `seed.js`, `index.js`), routes (`platform`, `platformAdmin`, `billing`, `portal`, `misc`, `site`, `siteAdmin`), console and app screens, deploy workflow, README, `.env.example`. `pages/Landing.jsx` was replaced by the new website.
