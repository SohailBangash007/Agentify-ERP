# Multi-region implementation plan

Status: **proposal, awaiting approval. No feature code has been written.** Read [00-audit.md](00-audit.md) first.

## 1. Architecture (config as data)

```
platform.db (reference data, versioned, edited in the console)
  regions(code, name, status, default_locale, default_currency, ...)
  region_packs(region, version, effective_from, manifest JSON)         # locale, units, formats, terminology, flags
  region_rules(region, sub_region, kind, key, value JSON, effective_from, effective_to, needs_legal_review, source_note)
        kinds: tax_bracket | fee_schedule | threshold | commission_rule | checklist | pipeline | field_def | template | mortgage_type | calculator
  fx_rates(base, quote, rate, as_of, source)
  rule_audit(who, what, before, after, reason)                          # append-only, like platform_audit

tenants: + region, sub_region, base_currency, money_scale, locale, language, units_system   (additive columns)

tenant DB (per workspace)
  region_ext_values(entity_type, entity_id, field_key, value_text|value_num|value_date)   # typed custom fields, indexed
  identity_documents(owner_type, owner_id, kind, last4, ciphertext, blind_index)         # encrypted, masked
  checklist_instances / checklist_items, document_instances (template version + variables snapshot)
  mortgage_profiles, mortgage_applications, lenders, referral_fees
  rule_snapshots(entity, rule_id, rule_version, inputs, result)                          # past figures never recalculated
```

* **Region Pack = data first, code only where unavoidable.** A pack is a manifest plus rule rows seeded from `server/src/regions/<CODE>/` (JSON) and an optional plug-in module for logic that cannot be expressed as data (e.g. SDLT band calculation shape, Quebec notary flow). Plug-ins implement a small interface: `calculateTaxes(ctx)`, `validateIdentity(doc)`, `onTransactionStage(ctx)`.
* **Resolution:** a request already knows its tenant; the tenant's `region/sub_region` selects the active pack version, rules effective on the transaction date, feature flags, locale, and terminology. A resolver `region(ctx)` is the single entry point (`server/src/regions/index.js`); nothing else reads country codes.
* **Feature flags:** `region_flags` (per region, per tenant override) controlling each region module; platform staff switch them in the console.
* **Support switch:** console staff with a new `region.support` permission can open a tenant "as" another region for demos (read-only impersonation of *configuration*, audited), and demo workspaces are seeded per region.
* **Adding a region** = add `regions/<CODE>/pack.json` + rule seeds (+ optional plug-in) + locale files; demonstrated in `docs/multi-region/adding-a-region.md` (Phase 5).

### Cross-cutting utilities (Phase 1)
| Util | Purpose | Notes |
|---|---|---|
| `money` (server + client) | integer minor units per tenant `money_scale`; add/sub/multiply by rate with banker-safe rounding; parse/format | PK scale 0 = identical to today. No floats for money. |
| `units` | area/length conversion table, display preference per tenant, store canonical sq m beside the entered value | PK keeps Marla/Kanal as entered. |
| `fmt` | single locale layer over `Intl` (dates, numbers, currency, lists, relative time) with per-region date style | PK keeps `DD-Mon-YYYY` and `en-PK`. |
| `phone` / `address` | pack-driven normalisation and display | PK matching rules unchanged. |
| `t()` | string lookup with params and plurals, locale fallback chain, RTL flag | in-house, no dependency. |
| `crypto/identity` | per-tenant data key (HKDF from `ERP_SECRETS_KEY` + tenant id), AES-256-GCM, blind index (HMAC), masking helper, log redaction | new regions only; PK unchanged. |

## 2. Phases, deliverables and risk

Every phase: reversible/additive migrations, seeds per pack, unit + integration tests, docs, a changelog entry, small commits, app runnable at every commit, all 157 tests plus the PK snapshots green.

| Phase | Scope | Main touchpoints (est.) | Risk |
|---|---|---|---|
| **1 Foundation** | tenant region fields; resolver; `money`/`units`/`fmt`/`phone`/`t` utilities; extract `PK` pack with **no behaviour change**; PK snapshot tests; rules tables + console editor skeleton; `identity_documents`; feature flags | server: `platform.js`, `db.js`, `util.js`, new `regions/*`, `services/*` (about 25 files touched); client: `format.js` + replace direct `PKR`/`en-PK` uses (about 66 files, mechanical) | **High** (touches formatting everywhere). Mitigated by golden snapshots and by keeping PK scale 0. |
| **2 Selector, onboarding, locale, RTL** | region picker (marketing site, signup, login); onboarding wizard (region → sub-region → business type → defaults from pack); locale switch; string extraction module by module; RTL stylesheet (logical CSS properties), Arabic fonts; Arabic PDF support | client: signup/login/Layout, styles (3 CSS files), extraction codemod over about 89 files; server: onboarding, PDFs (`pdf.js`, `voucherPdf.js`, `receiptSheet.js`) | **High** for RTL and PDFs |
| **3 Mortgage / financing** | shared engine: pipeline, profile fields, lenders/brokers, referral fees, calculator (payment, amortisation, affordability, transfer-tax estimate via rules), per-region mortgage types as rule data | new tables/routes/pages (about 12 new files), CRM lead/deal screens | Medium |
| **4a US** | USD, state rules, commission splits/caps/teams, license tracking, transaction workflow with deadlines, disclosures, Fair Housing guardrails, TCPA/CAN-SPAM consent, e-sign hook; construction: pay applications G702/G703, schedule of values, retainage, RFIs, submittals, lien waivers and deadlines, permits, COI, 1099 export, OSHA log; QuickBooks export; listing/MLS feed points (stubs) | extends `construction` module + new `transactions`, `compliance` modules | Medium-High (legal variance) |
| **4b UK** | GBP, nations, sales/lettings flows, chain tracking, SDLT/LBTT/LTT, lettings compliance certificates and reminders, deposit protection, Right to Rent, client money ledger, AML, CIS, VAT reverse charge, CDM, warranties, Xero export | same modules | Medium-High |
| **4c Canada** | CAD, provinces, EN/FR (fr-CA), GST/HST/PST/QST, land transfer tax, rebates, FINTRAC records, CASL, lien holdback and release dates, prompt payment, WSIB/WCB, new-home warranty, QuickBooks export | same modules | Medium-High |
| **4d UAE** | AED, emirates, Arabic RTL, Hijri display, ORN/BRN/Trakheesi, Form A/B/F templates, DLD fee calculator, VAT on commission, off-plan (Oqood, payment plans, escrow milestones, SPA), rentals (Ejari, PDC tracker, rent calculator, service charges), goAML hooks, PDPL, Golden Visa tracker, WhatsApp channel, bilingual templates, construction roles/NOCs/escrow/bank guarantees; portal feed points | same modules | High (Arabic, workflows) |
| **5 Reporting, exports, hardening, docs** | region-aware reports (commission, tax summary, aged receivables, cost-to-complete), accounting exports, privacy tooling (consent, export/delete, retention per region, residency doc), security review, `adding-a-region.md`, `legal-review-checklist.md` finalised | cross-cutting | Medium |

### Cross-cutting engines (built in the phase that first needs them)
* **Template engine** (Phase 2/3): versioned templates with variables (`{{buyer.name}}`), per-language versions, snapshot of variables per generated document; no legal text in code (seed texts are placeholders marked `needs_legal_review`).
* **Compliance checklist engine** (Phase 3/4): checklists per region/sub-region/transaction type; items with due date rules, owner, status, evidence, audit trail.
* **Rules engine** (Phase 1 skeleton, used from Phase 3): effective-dated lookups with bracket/threshold calculators and snapshots.

## 3. Pakistan zero-regression strategy
1. Before any refactor: record **golden outputs** from the demo data (APIs for sales, ledgers, receipts, installments, commissions, reports, dashboard; PDF text extraction; `format.js` table).
2. Phase 1 moves behaviour behind the `PK` pack with the same numbers; every golden output must match byte-for-byte.
3. PK tenants keep `money_scale = 0`, `units = Marla/Kanal`, `fmt = DD-Mon-YYYY`, plaintext CNIC, last-10-digit phone identity, `en-PK` numbers, Asia/Karachi.
4. No existing table is dropped or renamed. Only additive columns/tables.

## 4. Decisions I need from you (recommendations first)

1. **Money model (R1):** per-tenant money scale (PK unchanged; other regions in cents/fils). *Recommended.* Alternative: convert everything to minor units (PK ×100): cleaner but high regression risk.
2. **i18n approach (R2):** in-house `t()` and module-by-module extraction, no new dependency. *Recommended.* Alternative: adopt `i18next` (free, adds a dependency).
3. **Identifiers (R3):** keep PK CNIC as is; encrypt identifiers only for new regions (optional PK opt-in later). *Recommended.*
4. **Arabic PDFs (R5):** add one small free library (`bidi-js`, MIT) and embed Noto Naskh Arabic (SIL OFL). *Recommended.* Alternative: no Arabic PDFs (English-only documents in AE).
5. **Tenancy additions (R7):** add `region/sub_region/base_currency/money_scale/locale/units_system` to `tenants` (additive only). *Recommended.*
6. **Where rule data lives (R6):** platform DB, console-editable, snapshotted on use. *Recommended.*
7. **Order and depth:** the brief's order is US → UK → Canada → UAE. Given the size, do you want all four built to the full depth listed, or a first release with **core (currency, units, formats, terminology, fields, pipelines, tax calculators, mortgage, templates, checklists) for all four and the heavy construction/lettings/off-plan workflows in a second release**? *Recommended: the two-release split.*
8. **Languages:** en-US, en-CA, fr-CA, en-GB, en-AE, ar-AE. Translations for fr-CA and ar-AE need a human reviewer; I will machine-draft them and flag them `needs_review`. OK?
9. **Dependencies:** no paid third-party services are needed. Feed points for MLS/Rightmove/Property Finder/etc. are interfaces and stubs until you hold accounts.

## 5. Out of scope for the first cut (will be listed, not silently skipped)
Live integrations with MLS, listing portals, e-sign providers, KYC vendors, goAML and accounting APIs (interfaces + export files only); full multi-currency accounting (one base currency per tenant plus FX for reporting); data-residency deployment automation (documented approach only); any claim of legal or regulatory compliance.
