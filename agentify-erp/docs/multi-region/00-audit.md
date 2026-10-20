# Multi-region audit (Step 0)

Audit of the repository at `main` (`539ac58`, plus the sign-in fix `d979180`), done before any multi-region code is written. All counts are from searching the source and are approximate touchpoints, not a guarantee of completeness.

## 1. Stack

| Area | What exists |
|---|---|
| Runtime / API | Node 22+, Express 4, plain JavaScript (ES modules), no TypeScript, no ORM. Routes in `server/src/routes/*`, logic in `server/src/services/*`. |
| Database | SQLite via built-in `node:sqlite`. Raw SQL with parameters. Schema is `CREATE TABLE IF NOT EXISTS` plus `addCol` migrations in `db.js` (additive, idempotent). 65 tables per workspace. |
| Tenancy | **Database per workspace** (`data/tenants/<slug>/erp.db`, `uploads/tenants/<slug>/`), chosen from the host name and bound with `AsyncLocalStorage`. A control-plane `platform.db` holds tenants, plans, billing, console. Each tenant row already has `timezone` and `currency` columns. |
| Auth | bcrypt + JWT cookie, CSRF header, TOTP 2FA, role/module/action permissions per workspace; separate console users. |
| Client | React 18 + Vite SPA, about 13.7k lines of page/component JSX (89 files), global CSS with variables (light/dark/density/accent). |
| i18n | **None.** All UI text is inline in JSX/JS. No `Intl` abstraction besides `client/src/format.js`. No RTL support. No Urdu either (the brief says "if present": it is not). |
| Tests | `node --test`, real server and temp databases, 157 tests (`server/test/*`). No browser tests. |
| Deployment | GitHub Actions → SSH → PM2 behind nginx. |

## 2. What is already region-neutral (good foundations)
* `tenants.timezone` and `tenants.currency` exist and are chosen at signup; server timestamps use the tenant timezone (`util.js now()/today()`).
* Database-per-tenant makes **data residency** feasible: a tenant directory can live on a regional disk/server.
* Platform billing already handles PKR and USD per plan; the SaaS layer has product entitlements, console roles, an audit log and a consent-aware analytics layer.
* Secrets encryption (AES-256-GCM, `ERP_SECRETS_KEY`) exists in `platformConfig.js`.
* Settings tables, lookups (stages, sources, types) and `custom_fields` already exist per workspace and are editable.

## 3. Everything Pakistan-specific and hardcoded

### 3.1 Currency and money (about 66 files mention PKR)
* **Client display:** `client/src/format.js` `money()` is `PKR` + `toLocaleString('en-PK')`; `num()` also uses `en-PK`; whole rupees only (`Math.round`). Many pages also print `PKR` directly (Billing, WebsiteEditor, WhatsApp templates, receipts, calculators).
* **Server:** `PKR` literals in `payments.js`, `expenses.js`, `commissions.js`, `insights.js`, `seed.js`, `pdf.js`/voucher PDFs, notification texts (`'PKR ' + n.toLocaleString('en-PK')`), the assistant and bot.
* **Storage:** money columns are **INTEGER whole rupees** (about 24 distinct money columns across 65 tables; 103 `Math.round/toFixed` uses). No currency column on business records; the workspace has one `settings.currency`, which the app barely reads.
* **Accounting:** one chart of accounts per workspace with PK-flavoured names and codes (e.g. 4100 Property Sales, 4150 Construction Contract Income, 5110 Bricks, 5120 Cement). Journals have no currency or FX.

### 3.2 Units
* `properties.unit DEFAULT 'Marla'`, `properties.area_size REAL`, `projects.land_unit DEFAULT 'Kanal'`; property form default `unit: 'Marla'`; seed data in Marla/Kanal; website filters, calculators and the construction cost calculator (`shared/constructionTools.js`, `site/ConstructionTools.jsx`, `Calculators.jsx`) use sq ft/Marla/Kanal and PKR rates per sq ft. About 10 files.
* No unit-conversion table; units are free text from a lookup.

### 3.3 Taxes and fees
**There is no tax, withholding, stamp-duty, CVT or FBR logic in the ERP.** Searches for withholding/stamp/CVT/FBR/advance tax find only platform billing text. Consequences:
* "Pakistan behaves identically" is a smaller problem than the brief assumes: the `PK` pack mostly holds *formatting, units, terms and field definitions*, and starts with an empty tax table.
* Any PK tax feature would be new work, and is not required for zero-regression.
* Commissions are percentage/tiered rules (`commission_rules`) with a default percentage setting; no tax on commission.

### 3.4 Identity, phone and address formats
* **CNIC** columns: `contacts.cnic`, `employees.cnic`, `vendors.cnic_tax`; used in about 31 client and 17 server files (forms, search, receipts, vouchers, portal, lookups). Stored **in plain text** and searched with `LIKE` (`customerSearchClause()` normalises dashes). Customer lookup by CNIC is a core Pakistan workflow.
* **Phone:** matching treats the last 10 digits as the identity (`0300…` = `+92 300…`) in `services/customers.js` and portal login; `+92` assumptions in WhatsApp helpers. This breaks for other countries (NANP numbers, UK, UAE numbers).
* **Address fields:** `province`, `city`, `area` free text with Pakistani examples; `country DEFAULT 'Pakistan'`; city/province names appear in seed data, SEO assistant, website defaults and form hints (about 12 files).
* **Dates:** `DD-Mon-YYYY` shown everywhere (`format.js`); stored as ISO text. Timestamps are wall-clock in the tenant timezone (no zone stored).
* Default timezone `Asia/Karachi` is hard-coded in 14 files (fallbacks, signup lists, reports, labels such as "PKT").

### 3.5 Workflows and terminology
* Plot / file / registration-number flows (`registration_no`, `file_no`, `file_status`), installment plans (booking, advance, balloon) with `shared/installmentPlan.js`, customer portal "How to pay" with Raast/Easypaisa/JazzCash/bank. These are **Pakistan-specific products of the sale model** and move into the `PK` pack unchanged.
* Role and field labels (Sales Agent, Customer, Plots, Marla) are literals in about 31 client files.
* Document templates: receipt/expense voucher/statement PDFs are code (pdfkit, Helvetica, English only) with settings-driven letterhead and terms text; the website builder has Pakistan sample content (now neutral for new SaaS workspaces).
* Reports: sales/collection/receivable/financial reports in PKR with the `DD-Mon-YYYY` format.
* Integrations: WhatsApp click-to-chat; Stripe for platform billing; no listing portals, e-sign, KYC or accounting export.

### 3.6 PDFs and fonts
`pdf.js` and `voucherPdf.js` use built-in Helvetica. **Helvetica has no Arabic glyphs**, and PDFKit does not reorder right-to-left text. Arabic documents need an embedded font (e.g. Noto Naskh Arabic, SIL OFL) plus a bidi step. This is the single largest technical risk for the UAE pack.

## 4. Gaps against the brief (no equivalent exists today)
1. i18n and RTL: nothing exists; roughly 13.7k lines of JSX plus server-generated texts (notifications, emails, PDFs, assistant answers) carry English literals.
2. Region concept: tenants have no `region`/`sub_region`.
3. Money model: single implicit currency, whole units, no FX table, no per-record currency.
4. Versioned, effective-dated rate tables and a rules/fee engine.
5. Mortgage/financing module, compliance checklist engine, document template engine with versions, transaction workflow (offers/contingencies/escrow), lettings, rentals (Ejari/PDC/deposit), Trakheesi/ORN tracking, lien/holdback/retainage/CIS/CDM workflows, pay applications (G702/G703), RFIs, submittals, COI tracking, goAML hooks. (The construction module built in the SaaS phase has BOQ, change orders, purchase orders, subcontract certificates with a single retention percentage, labour and site reports, which the construction region rules extend.)
6. Field-level encryption for personal identifiers; masking in logs/UI.
7. Region-aware privacy tooling (consent records, export/delete requests, per-region retention). Platform-level retention and consent for the marketing site exist; there is no workspace-level data-subject tooling.
8. Region picker at signup/login, region theming, locale switching.

## 5. Conflicts and risks to decide before coding

| # | Finding | Risk | Proposal |
|---|---|---|---|
| R1 | Money is stored as whole currency units. USD/CAD/GBP/AED need cents/fils. | Changing every PK amount to minor units (×100) touches 24 columns, all arithmetic, all inputs, PDFs, tests: high regression risk. | **Per-tenant money scale** (`minor_units`: PK 0 digits = today's integers; US/CA/UK/AE 2 digits). Integer arithmetic unchanged; a `Money` util converts at the edges (inputs/outputs/format). PK data is not migrated. Needs your approval (it changes the meaning of stored integers per tenant). |
| R2 | No i18n library and about 13.7k lines of inline text. | A big-bang extraction would touch nearly every file and risk PK regressions. | In-house `t(key, params)` (no new dependency) with a codemod and an extraction script; migrate module by module; English text stays the fallback and PK renders identically; translations live in JSON per locale. |
| R3 | CNIC is plaintext and searchable; the brief wants identifiers encrypted. | Encrypting PK CNIC would break search and customer lookup ("identical behaviour"). | Keep PK CNIC unchanged. New regions store identifiers with a typed `identity_documents` table: AES-256-GCM per tenant data key, a keyed hash for exact-match search, last-4 for display. Offer PK encryption later as an opt-in. Needs your approval. |
| R4 | Phone identity uses the last 10 digits (PK). | Wrong for other regions. | Move to a `phone` util driven by the pack (E.164 normalisation + national display). PK matching rules stay as they are. |
| R5 | Arabic PDFs (see 3.6). | PDFKit cannot shape/reorder Arabic alone. | Embed Noto Naskh Arabic and add one small free bidi library (e.g. `bidi-js`, MIT). Needs your approval to add a dependency. |
| R6 | "Region pack data editable without a deploy" vs database-per-tenant. | Where do versioned tax tables live? | Reference data (rates, fee schedules, checklists, template texts) in **`platform.db`**, edited in the console (new permission), versioned with `effective_from`. A transaction stores a **snapshot** of the rule version and result so past figures never change. Tenant-specific overrides are allowed in the tenant DB. |
| R7 | "Ask before changing tenancy". | Adding `tenants.region/sub_region` columns and tenant settings is additive, but is a tenancy change. | Additive only; no change to resolution, auth or isolation. Needs your approval. |
| R8 | Chart of accounts and journals have no currency. | Multi-currency reporting. | Keep one **base currency per tenant** for all journals (as today). Foreign-currency records keep their own currency and an FX rate captured at posting; reports convert via the FX table. Full multi-currency accounting is out of scope for v1. |
| R9 | The brief mixes legal rules from five jurisdictions. | Stating rules as facts could mislead customers. | Every rule ships as editable data with `needs_legal_review = true` and is listed in `legal-review-checklist.md`. No rate is authoritative. |
| R10 | Scope: five packs plus mortgage, checklists, templates, i18n and RTL. | Very large. | Deliver in the phases of `01-plan.md`; each phase ends with PK regression tests green and a working demo. |

## 6. Test baseline for "identical Pakistan"
* 157 existing tests must stay green after every phase.
* New **PK snapshot tests** (Phase 1): golden JSON/CSV/PDF-text outputs for sales, receipts, installments, vouchers, ledgers, commissions, reports and dashboard figures from the demo data, captured *before* refactoring and compared after.
* Formatting snapshot of `format.js` outputs for a table of values.
