# Agentify ERP

A multi-tenant SaaS platform with two products: **Real Estate Brokerage Management** (CRM → sales → properties/projects → installments → receipts → accounting → customer portal → website) and **Construction Management** (projects, sites, BOQs, estimates, budgets, procurement, materials, labour, subcontracts, change orders, payment certificates, site reports, client portal). Each company gets its own workspace and database.

* **Operating the SaaS** (setup, tenancy, jobs, deployment): [docs/SAAS_OPERATIONS.md](docs/SAAS_OPERATIONS.md)
* **Plans, trials, billing and revenue formulas**: [docs/BILLING.md](docs/BILLING.md)
* **What was built in the SaaS conversion**: [docs/IMPLEMENTATION_REPORT.md](docs/IMPLEMENTATION_REPORT.md)

Architecture and data model: see [ARCHITECTURE.md](ARCHITECTURE.md).

**Stack:** Node 22+ (uses built-in `node:sqlite`) · Express API · SQLite · React + Vite SPA. No external services required.

## Run it

```bash
npm run install:all     # installs server + client dependencies
npm run build           # builds the React app into client/dist
npm run seed            # (optional) wipes the DB and loads base config + clearly-flagged DEMO data
npm start               # http://localhost:4000  (API + app)
```

Development with hot reload: `npm run dev:server` and `npm run dev:client` (client on :5173 proxies to :4000).
First start with an empty database auto-loads the demo data (set `ERP_DEMO=0` to skip it and get only the base configuration + one Super Admin; use `ADMIN_EMAIL` / `ADMIN_PASSWORD` to choose its credentials).

### Demo logins (single-company demo data only; password `Demo@12345`; never use on a real server)
| Role | Login |
|---|---|
| Super Admin | admin@expertdevelopers.pk |
| Admin | admin.demo@expertdevelopers.pk |
| Finance Manager | finance@expertdevelopers.pk |
| Sales Manager | salesmanager@expertdevelopers.pk |
| Sales Agent | agent1@ / agent2@ / agent3@expertdevelopers.pk |
| HR Manager | hr@expertdevelopers.pk |
| Project Manager | pm@expertdevelopers.pk |
| Customer portal (`/portal/login`) | m.ali@example.com |

Every seeded record carries a **DEMO** marker. Change/remove these accounts before real use.

## Tests

```bash
npm test
```
37 end-to-end tests run against a real server + temp database: the six acceptance scenarios (lead → sale → payment → project expense → client portal → website publish), ledger reconciliation (trial balance, receivable and vendor-payable control accounts vs sub-ledgers), agent/customer data isolation, RBAC, CSRF, void/cancel integrity, reminders, bundled split receipts, construction contracts, schedule forecasting, portal isolation of contract schedules and branding, server PDFs, portal ledger date filters, activities, goals and reminders, the assistant, the public website and editor, push subscriptions and the balance sheet, then employee self-service (profile, attendance %, leave approvals, payroll with commission, tasks), company assets, the content calendar, role deletion, plot file details, portal promotions/drawings/bank details and the installment plan generator.

## How the pieces connect

* **One posting engine** (`server/src/services/accounting.js`): every sale, receipt, refund, expense, vendor payment, commission, salary and transfer is a balanced double-entry journal. Reports/dashboards/portal are queries over those journals and the sub-ledgers — nothing is typed into a report.
* **Sale** → property *Sold*, contact → *Customer*, installment schedule, Dr Receivable / Cr Property Sales, commission by rule, optional booking receipt, portal login.
* **Receipt** → installment allocation (preferred type first, oldest due first), sale paid cache, journal, activity log, notifications. Excess over the balance is accepted only when flagged as an overpayment/advance. Void = reversing journal, nothing deleted.
* **Expense voucher**: created → submitted → approved (books the expense to the project and the vendor payable) → paid (reduces cash/bank/custody). Credit purchases age in the credit book.
* **Website**: ERP is the source of truth. `GET /api/public/properties|properties/featured|property/:id|projects|project/:id`, `POST /api/public/lead|inquiry|contact` with an `X-API-Key` (Settings → System). Draft/on-hold/cancelled → hidden, Available → published, Featured → featured, Reserved → reserved, Sold → sold. Optional webhook URL receives publish/feature/sold events. Inquiries become CRM leads, round-robin to an agent, and notify the Sales Manager.
* **Roles**: configurable view/create/edit/delete/approve/export/print per module; Sales Agents are row-restricted to their own leads, customers, sales and commission; customers are bound to their own `contact_id` server-side.

## Construction contracts, combined plans and schedules

* **Construction contract** = a sale of kind `construction` (title, construction project, optional linked plot). It reuses everything a property sale has: installment plan, receipts, receivable ledger, agent commission (its own rule, default 1.5 %) and portal view. Revenue posts to *4150 Construction Contract Income* under the project; expense vouchers can be tagged to a contract so you see its real margin.
* **Plot + house paid together**: tick *Also build a house on this plot* on a property sale, or add a contract from a customer's workspace and link their plot. The customer, plot, agent, dates and installment count are reused, and both sales join one **bundle**. A single receipt (`splits`) is divided between them (e.g. PKR 50,000 → 25,000 plot + 25,000 construction, each to its own project and ledger). Each sale keeps its own ledger; the portal and sale page also show the combined schedule and combined ledger.
* **Primavera-style schedule** (Project → Schedule, or a contract's *Build schedule* tab): activities with expected start/finish, weight, predecessor and optional grouping. Planned %, actual %, a schedule-performance index, forecast finish, per-task status and delay alerts are **calculated from the dates and progress** — including *future* slippage caused by late predecessors. Customers see their own contract schedule and the shared project schedule (Gantt, table, alerts) in the portal; late tasks notify the project manager and the affected customers once.
* **Receipts & branding** (Settings → Receipts & branding): logo, header/footer, address, phone, email, website, social handles, document titles, terms — applied to receipt vouchers, expense vouchers and customer statements (and portal receipts), with a live preview.
* **Agent ledger**: each agent's commission accruals and payments with a running balance (Sales Agents → agent → Commission ledger).
* Existing databases are upgraded automatically on start-up (the `sales` table is rebuilt once so a contract can exist without a plot).

## Round 3 features

* **Activities & automatic progress**: Project → Schedule → *Add activity* picks from a library (footing, slab, scaffolding, masonry… new names are added to the library as you type) or *Quick plan* spreads a project window (e.g. 3 months) across activities. Progress is **never typed**: planned % comes from each activity's start/due dates, an activity is finished by ✓ Complete (or Reopen), overdue ones are capped at 95 %, and the overall project % (weighted by duration × weight) feeds the project page and the customer portal.
* **Goals & Rewards** (`/goals`): the Sales Manager, Admin and Super Admin set daily/monthly targets (team default or per agent) for leads, follow-ups, conversions and sales value. Agents see the % of goal achieved, streaks, points, badges, a leaderboard and the **leads left to convert** (follow-up, not closed, interested). Reminders go out at 9 am, 2 pm (if under 60 %) and 6 pm, once per day, in-app and as phone/browser push.
* **Assistant** (floating *Ask* button): answers leads, follow-ups, customers, projects, budget used per project, employee leaves, salaries paid, balance sheet, profit, expenses, sales, collections, receivables, cash, vendors, commissions, inventory and agents from live data, respects each user's permissions, and every answer can be downloaded as PDF.
* **Balance sheet** (Accounting → Balance Sheet): as-of date, assets = liabilities + equity + current profit check, PDF/Excel/CSV.
* **Customer portal ledger**: download as PDF/Excel/CSV with a from/to date filter (per sale or combined plot + house).
* **Sale form**: the customer box searches the Customers module as you type and can add a new customer in place.
* **Public website** (`/site`): home, listings with filters and map, property detail with the listing agent's name/phone/email, projects, agents, blog, enquiry forms (become CRM leads), an **installment calculator** and a **construction-cost calculator**.
* **Website editor** (Website → Website Editor, `/website`): block-based pages (hero, listings, projects, services, calculators, agents, blog, testimonials, FAQ, CTA, text, gallery…), per-page SEO, new/duplicate pages, and a Site design area for logo, colours, fonts, header, footer, social icons, contact, calculator rates and listing options, plus blog and image library, with live desktop/tablet/phone preview. Sales Agents can add and publish their own properties (turn off with the *agents can publish* setting); only Featured is manager-controlled.
* **Mobile**: the ERP is an installable PWA (manifest, service worker, push, bottom tabs on phones). `mobile/` holds a Capacitor wrapper for Play Store / App Store builds.

## Round 4 features

* **My Space (every staff login)** - *My Profile* (photo added by HR, full name, email, phone, employee ID, emergency contact, date of birth, gender, joining date, father's name, employment status - Intern / Employee / Part time / Full time / Probation / Permanent / Contract based - plus the company assets assigned to them with asset number, date and instructions), *My Attendance* (month calendar and **attendance %** - approved leave is excused, half days count 0.5), *My Leave* (balances, apply, withdraw, status and the approver's comment), *My Payroll* (paid payslips with PDF, salary, commission earned / paid / still to be paid) and *My Tasks*. Link an employee to their login in HRM > Employees > Edit > *Login*.
* **Attendance (HR)** - HRM > Attendance: mark each person Present / Late / Half day / Absent / Leave with one tap, *Mark everyone present*, edit times, and see the monthly percentage per employee (Excel / PDF export). Future dates cannot be marked.
* **Leave workflow** - employees apply in My Leave; HR (`hrm:approve`) **or the employee's reporting manager** can approve, reject or **revoke** an approved leave (removes it from the attendance sheet), each with a comment; the employee and approvers are notified.
* **Payroll and commission** - generating payroll pulls the agent's approved, unpaid commission into the payslip; *Pay salary* settles those commissions (oldest first) through the commission ledger and books only the salary part to Salaries, so nothing is paid twice. Employees get a notification when they are paid.
* **Task assignment** - managers (HR, Sales Manager, Finance, Project Manager, anyone with direct reports, Super Admin) assign tasks to one or many people from My Tasks; assignees are notified, update status (To do / In progress / Blocked / Done) with notes, and the assigner is told. Due-today and overdue tasks remind once a day.
* **Assets & inventory** (HRM > Assets & Inventory) - company register with asset numbers, category, serial, cost, holder, assignment date and instructions. *Add asset* can **create the expense voucher** for the purchase (it goes through the normal Finance approval and pays from the chosen cash/bank account) or link an existing voucher.
* **Content calendar** - plan posts with type (story / reel / static / carousel / video / live), caption, platforms, date, day, time, assignee and the **creative** (image or video, downloadable). Month grid and spreadsheet view with inline editing. Tap a platform icon to post: on a phone the share sheet opens with the creative and caption (pick the already-logged-in app); on a computer the creative downloads, the caption is copied and the platform opens - then confirm to tick it off. Managers can store each platform's handle and API credentials (write-only).
* **Roles** - custom roles can be deleted from the role's header; if users hold the role you choose the role to move them to. Hover states in the roles list are neutral (no more dark flash).
* **Payment methods** - type, bank name, account title, account number, IBAN, branch, SWIFT, wallet number and instructions. Customers see them under *How to pay* in the portal.
* **Plots** - file number, registration number, file status (Active / Inactive / Suspended / Paused) and notes; filter and export by file status.
* **Customer portal** - *Documents* grouped into contracts, architectural & construction drawings and payment proofs (share from the sale / project / property *Documents* tab with *Share with the customer*), and an *Offers* tab with promotions (Customers > Portal Promotions) plus the properties currently on sale.
* **Website** - the budget filter is now minimum / maximum amounts typed with separators; the **installment calculator builds a complete schedule** (price, booking, advance, number of installments, balloon payments and their spacing, three dates, markup) with every due date, downloadable as Excel/CSV or PDF; the header no longer shows a duplicate *Sign in* button.
* **Voucher PDFs** - receipt vouchers and expense vouchers (and the customer's own receipts in the portal) download as real server-generated PDFs with the letterhead, logo, split / payment tables, signature lines and a VOID watermark on voided receipts (`GET /api/receipts/:id/pdf`, `/api/accounting/expenses/:id/pdf`, `/api/portal/receipts/:id/pdf`). *Print* still uses the browser's print.
* **Customer IDs & registration numbers** - every customer gets a customer ID (`CUS-0001`) the moment they buy (existing customers were numbered automatically); every property has a unique registration number (`REG-0001`, or the official number you type in). Search by name *or* ID in Customers, Contacts, receipts, sales and the global search; search by registration number or file number anywhere properties are searched. *Properties → Check a property* shows the sale status (available / reserved / sold and to whom), file status and price from just the registration number. Customer and property boxes in the receipt and sale forms are type-ahead lists (no dropdown to scroll). IDs appear on receipts, statements, PDFs and the customer portal.
* **Receipt voucher details** - every receipt (screen, live preview, PDF, and the customer's portal copy) states the customer's ID, CNIC, contact number and email, plus the registration no., file #, file status (Active / Inactive / Paused / Defaulted / Suspended), type (Plot / File / other), plot size, address and booking date of the file it is paid against. *Customers → Find a customer record* lets finance look a customer up by registered mobile number (any format), email, CNIC (with or without dashes), customer ID or name, and see each file's status and outstanding balance.
* **Live voucher preview** - while creating a receipt or an expense voucher, the voucher as it will print (letterhead, logo, details, amount, split, signature lines) builds up on the right of the form.
* **Quick plan** (project schedule) - pick activities and type the **days** each one takes; start/finish dates fill in automatically one after another, with optional sub-activities and a deadline check.

## Conventions
* Currency: PKR, whole rupees (integers); Timezone: Asia/Karachi for every timestamp and date preset; dates shown as `07-Oct-2026`.
* Uploads: validated by type and size, stored under random names. Listing images are public; **documents are only served through authenticated endpoints**.

## Known limits / honest notes
* Email/SMS/WhatsApp delivery is an *integration layer placeholder*: preferences are stored and in-app notifications work (installment due/overdue, follow-ups, vendor dues, payments, commissions, leave, development updates); no provider is wired.
* PDF, Excel and CSV exports are all generated on the server (`services/pdf.js`, exceljs), so downloads are real files, not page screenshots.
* Posting to social platforms goes through each platform's own app/website (or the phone share sheet); fully automatic publishing needs a developer app approved by each platform, which only you can create - the API-key fields are ready for it.
* The assistant is rule/intent based over your own data (no external AI service); it answers the question types listed above, not free-form chat.
* Phone push notifications need HTTPS (or localhost). An APK/IPA needs Android Studio/Xcode — see `mobile/README.md`.
* The property map preview uses an OpenStreetMap embed from GPS coordinates (no interactive pin picker).
* SQLite (WAL) suits a single-office deployment; moving to PostgreSQL means swapping `server/src/db.js` and the date/`julianday` SQL helpers.
* Put the app behind HTTPS in production (cookies become `Secure` when `NODE_ENV=production`) and set `JWT_SECRET`.

## Asset Library & private "Paid from"
* Buying an asset through an expense voucher fills the **Asset Library** (Accounting → Asset Library, HRM → Assets Library) automatically on approval; only missing details (serial, brand, category) need adding.
* Each expense voucher has a **Show "Paid from" on the printed voucher** switch (off by default) so vendors don't see which company account paid them.

## Supabase setup (partial)
* Fill `server/.env` and `client/.env` (see the `.env.example` files). The anon key is the only key the browser gets.
* `supabase/schema.sql` is the full Postgres schema (56 tables, 33 indexes, RLS on). Run it in the Supabase SQL editor, or `psql "$DATABASE_URL" -f supabase/schema.sql`. It is idempotent.
* The backend still runs on local SQLite (`server/src/db.js`, synchronous). Moving it to Postgres means making every query async — not done yet. `DATABASE_URL` is reserved for that.
* `client/src/supabase.js` exports `supabase` (null until real values are set).

## Interactive features (Round 5)
* **Ctrl+K** palette, role-based **Today** dashboard with a getting-started checklist, **Plot map** (Projects → Plot Map), **Customer 360** (click a customer), WhatsApp reminders/receipts, click-to-edit cells and saved views in the main lists, drag-and-drop pipeline with "going cold" glow, dark mode / density / accent colours (palette icon in the top bar), and an **8-second Undo** after deletes and stage moves (confirm dialogs still appear first).
* Works offline for notes, tasks, new leads and attendance — they sync when you reconnect.
* **Expense vouchers on WhatsApp:** after you approve (or pay) a voucher with a vendor, a prompt offers to send it on WhatsApp with the PDF — the vendor's number is prefilled and editable. The same **Send on WhatsApp** button stays on every approved/paid voucher. The PDF never shows the paying account unless "Show Paid from" is on.

## Vendor portal & tenders
* Sign-in at `/vendor/login` (demo: `abc.bricks@example.com` or `wood@example.com`, password `Demo@12345`). Vendors see payments released, what remains (synced with the books and vouchers, including credit), their ledger (PDF/Excel/CSV), their registration, open contracts and their bids.
* Staff: **Vendors → Tenders & Bids** to announce a contract with a BOQ, publish it, compare the bids and award. Give a vendor a login from the vendor record.
* Expense vouchers now have a **Send on WhatsApp** button in every status, in the list, and a "Save & send on WhatsApp" button on the form.

## Multi-tenant SaaS mode (Phase 1)

By default nothing changes: one company, one database (`server/data/erp.db`). Set `ERP_BASE_DOMAIN` to serve many companies from one deployment.

* **One database per tenant.** `server/data/platform.db` (the control plane) lists the tenants; each has its own `server/data/tenants/<slug>/erp.db` and `server/uploads/tenants/<slug>/`. The original install is registered automatically as the first tenant (`ERP_DEFAULT_TENANT`, default slug `default`) and keeps using its existing `erp.db` and `uploads/`, so no data moves.
* **Routing.** `<slug>.<ERP_BASE_DOMAIN>` (or a tenant's custom domain) selects the tenant. `src/platform.js tenantContext` runs the whole request inside that tenant using `AsyncLocalStorage` (`src/context.js`); `db.js` hands every `get/all/run/tx` call that tenant's connection, so routes and services are unchanged.
* **Isolation.** Login tokens carry the tenant id and are rejected on any other workspace; uploads, push keys, the account-code cache, timezone and reminders are all per tenant. `test/tenancy.test.js` proves it.
* **Signup.** `POST /api/platform/signup` `{slug, company_name, admin_name, admin_email, admin_password, timezone?, currency?}` provisions a workspace with the base configuration (no demo data). Operators list or suspend tenants with `GET /api/platform/tenants` and `POST /api/platform/tenants/:id/status` using `Authorization: Bearer $ERP_PLATFORM_ADMIN_TOKEN`.
* **Local development.** `ERP_BASE_DOMAIN=localhost npm run dev:server`, then open `http://acme.localhost:4000` after creating `acme` through the signup endpoint. Set `ERP_DEFAULT_TENANT` to the slug you want for the original data.

Not yet done (later phases): object storage for files, and per-tenant branding in generated documents and the public website defaults.

### Accounts, invitations and password reset (Phase 2)

* **Signup page:** `/signup` (React) creates a workspace through `POST /api/platform/signup`, sends a welcome email and links to `<slug>.<domain>/login`.
* **Invitations:** Settings > Users > *Invite by email* creates a one-time link (valid 7 days, only its hash is stored). The invitee picks a password and is signed in with the chosen role. A newer invite to the same address replaces the older one; admins can revoke pending ones. Only a Super Admin can invite a Super Admin.
* **Forgot password:** `/forgot-password` always answers the same way (it never reveals whether an account exists); the emailed link works once, expires in 2 hours and signs the user out everywhere.
* **Email:** set `RESEND_API_KEY` and `MAIL_FROM`; without them messages are printed to the server log (and the inviting admin is shown the link to share).
* **Workspace name:** sidebar, sign-in pages and portals show the company name from `settings.company_name` instead of the old hardcoded name.

### Plans and billing (Phase 3)

* **Plans** live in `server/src/services/plans.js` (Starter, Growth, Enterprise). **The prices and limits there are placeholders; edit them before launch.** Limits: team members (active staff logins plus pending invitations) and projects.
* **Lifecycle:** 14-day trial (Growth limits) > subscribe. A failed payment gives a 7-day grace period; a cancelled subscription stays usable until the paid period ends. After that, or when a trial ends unpaid, the workspace becomes **read-only**: people can still sign in, view and export everything, but writes return `402` until billing is up to date. Nothing is deleted. The original install is never metered.
* **Provider-agnostic:** nothing calls a payment API directly. `BILLING_PROVIDER=manual` records payments you receive by bank transfer or invoice (`POST /api/platform/tenants/:id/subscription` with the operator token). `BILLING_PROVIDER=generic` sends customers to hosted payment links (`BILLING_CHECKOUT_URL_<PLAN>_<MONTH|YEAR>`, tagged with `client_reference_id=<tenant id>`) and listens for a signed webhook.
* **Webhook:** `POST /api/platform/billing/webhook/generic`, header `X-Signature: sha256=<HMAC-SHA256 of the raw body with BILLING_WEBHOOK_SECRET>`, body `{id, type, tenant_id|tenant_slug, plan?, interval?, period_end?, customer_id?, subscription_id?, invoice?: {id, amount, currency, status, url}}` with type `subscription.activated|subscription.renewed|subscription.canceled|payment.failed|invoice.paid`. Replays are ignored. A Paddle, Lemon Squeezy, Safepay or Stripe adapter only has to translate that provider's payload into this shape.
* **Security hardening:** (1) *Email confirmation*: the workspace owner gets a confirm link in the welcome email (3 days, works once); until used they cannot invite people, which stops the signup form being used to mail strangers. (2) *Two-factor sign-in* (authenticator app, RFC 6238) for every staff account under My Space > Security, and for platform admins in the console's Security tab; 8 one-time recovery codes; a used code cannot be replayed; a Super Admin/Admin with settings access can reset a colleague who lost their phone (Settings > Users > Reset 2FA). Customer and vendor portal accounts do not have 2FA. (3) *Backups*: every `BACKUP_EVERY_HOURS` (default 24) a consistent snapshot of `platform.db` and each workspace database is written to `BACKUP_DIR` (default `server/data/backups`), keeping the newest `BACKUP_KEEP` (default 14); `BACKUP_UPLOADS=1` also copies uploaded files; `BACKUP_ENABLED=0` turns it off. Console > Backups lists them and has Back up now; a workspace Super Admin can download their own database from My Space > Security. **Copy the backup folder off the server** (a backup on the same disk does not survive losing the disk) and keep `ERP_SECRETS_KEY` / `data/.secrets-key` separately: it is not inside backups. **Restore:** stop the server, replace `server/data/platform.db` and the workspace's `erp.db` (under `server/data/tenants/<slug>/`) with the files from the backup, start the server.
* **Marketing landing page:** with `ERP_BASE_DOMAIN` set, the main domain's `/` shows the product page (features, how it works, pricing read live from `services/plans.js`, FAQ, sign-up and a "find my workspace" box). Workspace addresses and single-company installs still go to the company's own `/site`. Source: `client/src/pages/Landing.jsx` and `landing.css`; data from `GET /api/platform/site`.
* **Platform console (recommended way to configure all of this):** open `/platform` on your main domain (not a workspace address) and sign in with the admin created from `PLATFORM_ADMIN_EMAIL` / `PLATFORM_ADMIN_PASSWORD` (10+ characters; used only to create the first admin when none exists, then change the password in the console). Tabs: **Workspaces** (suspend/activate, set plan), **Payments** (approve/reject local payments), **Stripe settings** (test and live secret / publishable / webhook keys, price IDs, active mode, Test connection, the webhook URL to paste into Stripe) and **Local payment accounts** (add, edit, hide, delete the Raast / Easypaisa / JazzCash / SadaPay / NayaPay / bank accounts customers see). Secrets are stored AES-256-GCM encrypted and never sent back to the browser (only the last 4 characters). Set `ERP_SECRETS_KEY` (any long random string) in production; otherwise a key file `server/data/.secrets-key` is generated and **must be backed up with the database**. Keys saved in the console win over the env vars below, which remain as a fallback. `BILLING_PK_ACCOUNTS` now only seeds the account list once on first start.
* **Stripe (cards):** set `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` and one `STRIPE_PRICE_<PLAN>_<MONTH|YEAR>` per plan. "Pay" opens hosted Stripe Checkout tagged with the workspace id; the customer portal handles card changes, plan switches and cancellation. Add `POST /api/platform/billing/webhook/stripe` in the Stripe dashboard (events listed in `.env.example`); signatures are verified with a 5-minute freshness window and replays are ignored.
* **Raast, Easypaisa, JazzCash, SadaPay, NayaPay, bank transfer:** these are paid in PKR to the accounts you list in `BILLING_PK_ACCOUNTS`. The customer sends the money, then enters the transaction ID; it appears under `GET /api/platform/payments?status=pending` (and by email if `BILLING_OPERATOR_EMAIL` is set). After you check the money arrived, `POST /api/platform/payments/:id/approve` activates the plan for one month or year (extending from the current end date if renewing early, so no days are lost) and records an invoice; `.../reject` with a reason emails the customer. A transaction ID can only be used once. These are not automatic: Easypaisa and JazzCash merchant APIs, and Raast/SadaPay/NayaPay payment notifications, need merchant accounts and credentials from those providers and can be added as adapters later.
* **Screens:** Settings > Plan & Billing (usage, plan cards, invoices) and a banner on every page during the last 7 days of a trial, payment trouble or read-only mode.

Still to do: email verification at signup, 2FA, a platform admin console screen, and the marketing site (Phase 4).
