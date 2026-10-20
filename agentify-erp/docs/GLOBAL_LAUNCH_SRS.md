# Agentify ERP: Global Launch SRS (USA, UK, UAE, Pakistan)

Oct 20, 2026 · Asad B Zaman · Living copy: https://claude.ai/code/artifact/3c69646f-797a-482a-a379-6c2584b70e95

## 1. Introduction

Agentify ERP goes live in the USA, UK, UAE and Pakistan from **one** marketing site, **one** signup and **one** codebase. The country chosen at signup switches the whole workspace: currency, number style, area units, property types, calculators, documents, compliance and language. No separate per-country site, app or window is built.

### 1.1 Purpose

This Software Requirements Specification (SRS) defines what must change in the existing Agentify ERP so it can be sold and used in four launch countries. It is written for the product owner, developers, testers and the legal reviewers of each country.

### 1.2 Scope

- **In scope:** the global marketing landing page, unified signup console, the country configuration engine (Region Packs), the public property website each workspace publishes, the Real Estate Brokerage product and the Construction Management product, and the Super Admin console controls for countries.
- **Launch countries:** United States (US), United Kingdom (UK), United Arab Emirates (AE) and Pakistan (PK). Canada (CA) already has a draft pack and is a later, optional region.
- **Out of scope for launch:** live MLS, Rightmove, Property Finder or Zameen feeds (export files and interfaces only), live e-signature or KYC vendors, full multi-currency accounting, and any claim of legal compliance without local review.

### 1.3 Definitions

| Term | Meaning |
| --- | --- |
| Workspace | One customer company. Each has its own private database. |
| Region Pack | A data file (`server/src/regions/packs/<CODE>.json`) that holds a country's currency, formats, units, property types, terms, fields, templates and checklists. |
| Marketing site | Agentify's own public site where companies learn about and buy the product. |
| Tenant website | The public property website a workspace publishes for its own buyers (the `site/` pages). |
| Brokerage | Real estate agency work: listings, leads, deals, commissions, lettings. |
| Minor units | Cents, pence or fils. PK stays in whole rupees. |
| Sub-region | State (US), nation (UK: England, Scotland, Wales, Northern Ireland), emirate (AE) or province (PK). |

### 1.4 References

- Repository docs: `docs/SAAS_PLAN.md`, `docs/multi-region/00-audit.md`, `docs/multi-region/01-plan.md`, `docs/multi-region/legal-review-checklist.md`, `docs/multi-region/adding-a-region.md`.
- Competitor and market sources are listed in section 9.

## 2. Current state audit

The ERP core is already region-aware, but the public websites are not: every page under `client/src/site/` is hard-coded for Pakistan, so a US, UK or UAE workspace publishes a site in crores, lakhs and marla. This is the bug the user reported, and it has one root cause, not four separate broken sites. The audit below was done on the code in `C:\Users\HP\Documents\AgentifyERP` on 20 Oct 2026.

### 2.1 What already works (keep)

- **Region Packs** for PK (active) and US, UK, AE, CA (draft) in `server/src/regions/packs/`. Each holds currency, minor units, locale, date style, timezone, area units, phone rules, sub-regions, terminology, ID rules, extra fields, sample templates and checklists.
- **Shared utilities** in `shared/region/`: money in minor units, unit conversion (sq m, sq ft, sq yd, acre, hectare, marla, kanal), phone, date format, translation `t()`, and a mortgage engine (payment, amortisation, affordability, Canadian semi-annual compounding).
- **Signup** (`createTenant` in `server/src/platform.js`) already stores region, sub-region, currency, money scale, locale, language and units on the workspace, and refuses inactive regions.
- **ERP modules** behind switches: mortgage pipeline, document templates, compliance checklists, privacy export/erase, encrypted non-PK IDs, FR/AR sidebar translations, per-region demo data.

### 2.2 What is wrong (fix)

| # | Where | What a US/UK/UAE visitor sees today | Code |
| --- | --- | --- | --- |
| A1 | Tenant website prices | "PKR 1.25 Crore", "45 Lakh", `en-PK` grouping | `site/siteCore.jsx` `priceText()`, `fullPrice()`, `MoneyBox` |
| A2 | Search and filters | "Budget (PKR)", "Min price (PKR)", "Location, project or plot no." | `site/components.jsx`, `site/SiteApp.jsx` |
| A3 | Property types | Plots, Files, Ready Homes, Houses, Apartments; "Plot / unit", "Block / sector" facts | `pages/PropertyForm.jsx` (`HOUSE_TYPES`, `PLOT_TYPES`), `site/SiteApp.jsx` |
| A4 | Area units | Marla and Kanal by default on listings and the construction calculator ("5 Marla … 1 Kanal") | `site/ConstructionTools.jsx` `PLOTS`, `shared/constructionTools.js` |
| A5 | Calculators | Only a Pakistani installment plan (booking, advance, balloon). No mortgage calculator on any public page. | `site/Calculators.jsx` |
| A6 | Construction cost rates | PKR per sq ft, steel/cement/bricks in PK rates, location factor "Islamabad / Rawalpindi / DHA / Bahria" | `shared/constructionTools.js` |
| A7 | SEO data | `addressCountry: 'PK'`, `areaServed: ['Islamabad','Rawalpindi']` for every site | `site/siteCore.jsx` |
| A8 | Customer portal copy | "See your plot or house…"; Raast/Easypaisa/JazzCash payment steps | `site/components.jsx`, portal |
| A9 | Marketing pricing | Plan cards show PKR first; other currencies only if a plan has them | `marketing/Marketing.jsx` |
| A10 | Signup country picker | Hidden while only PK is active, so nobody abroad can pick their country | `marketing/Marketing.jsx` signup form |
| A11 | Signup fallbacks | Timezone list and currency list are Pakistan-first and include SAR, INR, BDT, EUR that have no pack | `marketing/Marketing.jsx` `TIMEZONES`, `CURRENCIES` |
| A12 | Region packs | No property-type list, no listing fields (beds/baths/parking/tenure), no calculator settings, no public-site copy | `regions/packs/*.json` |

### 2.3 Root cause

The Region Pack reaches the signed-in ERP but not the public website or the calculators. `site/*` reads only the website config, which was designed for one Pakistani agency. The fix is to feed the workspace's pack into the website, not to build a website per country.

## 3. Market research

No single competitor covers brokerage plus construction in all four countries. Each market uses a local brokerage CRM plus a separate global construction tool. Agentify's opening is one workspace that switches by country and covers both products. Vendor pages below were read on 20 Oct 2026; several are written by a competitor of the product they compare, which is noted.

### 3.1 What buyers and agents see on portals

| Portal | Country | What it shows that Agentify's tenant site must match |
| --- | --- | --- |
| [Zillow mortgage calculator](https://www.zillow.com/mortgage-calculator/) | US | Home price, down payment ($ or %), rate, 30/15-year fixed or 5-year ARM, property tax, homeowners insurance, HOA, PMI; monthly breakdown (P&I, taxes, insurance) and amortisation chart. |
| [Rightmove](https://www.rightmove.co.uk/) | UK | For sale, new homes, to rent, student, retirement, commercial, sold prices; Stamp Duty, Mortgage and Remortgage calculators; instant valuation. |
| [Bayut](https://www.bayut.com/) | UAE | Buy / Rent / Transactions tabs; Ready vs Off-Plan; beds and baths; prices in AED; area in sq ft (switchable); TruEstimate valuation; Find My Agent. |
| [Zameen](https://www.zameen.com/) | PK | Homes / Plots / Commercial; area in Marla (Sqft optional); price in PKR; construction cost calculator, home loan calculator, area unit converter. |
| [AgentLocator](http://www.agentlocator.ca/) | CA / US | Not a portal: lead-gen websites, IDX/VOW sites and a CRM for agents ($249/mo bundle). Lead magnets: "Home Worth" valuation, "Nosy Neighbour" sold alerts, automated listing SMS. |

### 3.2 Brokerage software in use

| Product | Market | Strength | Source |
| --- | --- | --- | --- |
| Lone Wolf / BoldTrail BackOffice (ex-Brokermint) | US, CA | Back office: commissions, transactions, accounting, reporting | [The Close](https://theclose.com/real-estate-brokerage-software/) |
| Follow Up Boss, Lofty, kvCORE/BoldTrail | US | CRM, lead routing, IDX sites | [The Close](https://theclose.com/real-estate-brokerage-software/) |
| Dotloop | US | Transaction management, e-sign, compliance checklists | [The Close](https://theclose.com/real-estate-brokerage-software/) |
| Alto, Reapit, Street, Loop, Dezrez | UK | Sales and lettings CRM, client accounting, certificate renewals (gas, EPC, EICR), AML/ID checks, portal publishing | [Alto 2026 comparison](https://www.altosoftware.co.uk/blog/best-estate-agency-crms-in-2026-alto-vs-reapit-vs-street/) (written by Alto) |
| PropSpace, PropCRM, Goyzer | UAE | Publish to Property Finder/Bayut, Trakheesi/Madhmoun permit numbers, RERA Forms A/B/F/I, Ejari tenancy documents, 5% VAT on commission, off-plan database | [PropSpace guide](https://www.propspace.com/blog/real-estate-crm-dubai-complete-guide) (written by PropSpace) |
| Local builder ERPs, Zameen agency tools | PK | Plot files, installment plans, booking and possession | [Zameen](https://www.zameen.com/) |

### 3.3 Construction software in use

| Product | Fits | Strength | Gap Agentify can fill |
| --- | --- | --- | --- |
| [Procore](https://buildern.com/resources/blog/buildertrend-vs-procore/) | Large general contractors | Cost codes, commitments, WIP, RFIs, submittals, inspections | Per-module, per-user pricing; no brokerage side |
| [Buildertrend](https://buildern.com/resources/blog/buildertrend-vs-procore/) | Home builders, remodelers | Estimates to budget, change orders, daily logs, Gantt, client portal | No RFIs; weak AIA-style pay applications |

(The Procore/Buildertrend comparison is written by Buildern, another vendor.)

### 3.4 What this means for the SRS

- Every market expects a **mortgage calculator** on the public site, and the UK and UAE also expect a **purchase-cost calculator** (Stamp Duty; DLD fees).
- Every market expects **portal publishing** and **lead capture**; live feeds can follow launch, but listing export files must exist.
- UK lettings and UAE rentals are core brokerage work, not extras: certificates, deposits, Ejari, cheques.
- Construction buyers in the US/UK expect pay applications, retainage, RFIs and change orders; Agentify already has BOQ, change orders, POs and retention, so pay applications and RFIs are the main gap.

## 4. Product vision and principles

One door, many countries: a visitor lands on one page, picks a country once, and everything after that (prices, units, property types, calculators, forms, documents, language) comes from that country's Region Pack.

```
Global landing page  -->  Unified signup  -->  Region Pack (US, UK, AE, PK; CA later)
(country picker,          (product, country,    (currency, units, types, fees)
 local prices)             state, language)              |
                                     +-------------------+--------------------+
                                     v                   v                    v
                              ERP workspace       Property website     Documents, compliance
                              local types,        $, £, AED or PKR;    local templates,
                              sq ft/sq m/Marla,   mortgage and fee     fee and tax tables,
                              commission, VAT     calculators          legal review flags
```

The Region Pack is the only place that knows the country; the ERP, the public website and the documents all read from it.

### 4.1 Principles

1. **One codebase, one marketing site, one signup.** No `uk.agentify…` or separate apps. Country is data, not a branch of code.
2. **Config, not forks.** Anything that differs by country (currency, units, property types, fees, templates, checklists, copy) lives in the Region Pack JSON or the console, never in `if (country === …)` scattered through pages.
3. **Pakistan does not regress.** PK keeps whole rupees, Marla/Kanal, crore/lakh display, installment plans and CNIC exactly as today; golden tests prove it.
4. **Country is locked per workspace, not per user.** A workspace's books are in one base currency. A company with offices in two countries opens two workspaces under one login.
5. **Nothing legal is presented as fact.** Every fee, tax rate and template is editable data with an effective date and a `needs_legal_review` flag until a local reviewer signs it off.
6. **Same product depth everywhere.** A US agency gets the same quality as a PK one: local property types, a real mortgage calculator, local documents.

## 5. Functional requirements

There are 7 requirement groups and 59 requirements. Priority: **M** = must have for launch, **S** = should have for launch, **L** = later release.

### 5.1 Global marketing landing page (one site)

| ID | Requirement | Pri |
| --- | --- | --- |
| FR-LP-1 | One marketing site at one domain. A country switcher (US, UK, UAE, Pakistan) sits in the header and footer; no separate country domains or apps. | M |
| FR-LP-2 | First visit suggests a country from the browser locale and timezone (never by IP alone) and shows "Showing prices for United Kingdom · change". The choice is saved in a cookie and in the URL as `?country=uk` so links can be shared. | M |
| FR-LP-3 | Plan prices show in the selected country's currency with the right symbol and decimals, for example (illustrative prices): $49.00, £39.00, AED 179.00, PKR 9,999. No PKR shown to non-PK visitors. | M |
| FR-LP-4 | Hero copy, screenshots, feature lists and FAQ swap per country from console-edited content (e.g. US: "transaction management and commission splits"; UK: "sales, lettings and certificate reminders"; UAE: "Trakheesi permits, Ejari and off-plan plans"; PK: "plot files and installment plans"). | M |
| FR-LP-5 | A live **demo calculator strip** on the landing page uses the selected country: mortgage payment (US, UK, AE), stamp duty (UK), DLD fees (AE), installment plan (PK). | S |
| FR-LP-6 | Product choice: Real Estate Brokerage, Construction Management, or Bundle, with one "Start 7-day free trial" button leading to the unified signup. | M |
| FR-LP-7 | Legal pages (privacy, terms, cookies) show the version for the selected country (GDPR/UK GDPR, CCPA wording, UAE PDPL, PK). | M |
| FR-LP-8 | SEO: one page per country path (`/us`, `/uk`, `/ae`, `/pk`) with `hreflang` tags, local schema.org data, and no duplicate-content penalty. | S |

### 5.2 Unified signup console

| ID | Requirement | Pri |
| --- | --- | --- |
| FR-SU-1 | One signup form for all countries. Steps: 1) product, 2) country, 3) state/nation/emirate/province, 4) company and workspace address, 5) admin user, 6) language (English; Arabic offered for UAE), 7) accept terms. | M |
| FR-SU-2 | Country is pre-filled from the landing page choice and always shown, even while only one region is active (fixes A10). | M |
| FR-SU-3 | Currency, timezone, date style, number style and units are **derived** from the country and shown read-only as a summary ("USD · MM/DD/YYYY · sq ft · America/New_York"); the timezone can be changed when the country has several (US). | M |
| FR-SU-4 | Phone field validates with the country code (+1, +44, +971, +92). Business ID field asks for the local number and is optional: EIN (US), Companies House number (UK), Trade Licence and ORN (UAE), NTN (PK). | M |
| FR-SU-5 | Country cannot be changed by the customer after the first financial record exists; Super Admin can change it before that (already supported in the console). | M |
| FR-SU-6 | Demo data option seeds country-correct listings (US townhouses in Texas, UK semis in Manchester, UAE apartments in Dubai Marina, PK plots in DHA). | S |
| FR-SU-7 | Billing at checkout uses the country's currency and tax: US sales tax where applicable, UK VAT 20%, UAE VAT 5%, PK as today; Stripe for cards, bank transfer kept for PK and UAE. | M |

### 5.3 Country configuration engine (Region Pack additions)

The existing pack already holds currency, money scale, locale, date style, timezone, area units, phone, sub-regions, terminology, ID rules, extra fields, templates and checklists. Add:

| ID | Pack key | Purpose | Pri |
| --- | --- | --- | --- |
| FR-RP-1 | `property_types` | Residential and commercial type lists per country (section 6), used by the ERP form, the website filters and portal export. | M |
| FR-RP-2 | `listing_fields` | Which fields a listing shows and requires: beds, baths, half-baths, garage/parking, lot size, tenure, council tax band, EPC rating, HOA, service charge, furnishing, plot/file no. | M |
| FR-RP-3 | `price_style` | `intl` (£450,000, $1.2M short form) or `south_asian` (PKR 1.25 Crore / 45 Lakh). Only PK uses `south_asian`. | M |
| FR-RP-4 | `area` | Default unit, allowed units, and which secondary unit to show in brackets (UAE: 1,250 sq ft (116 sq m)). | M |
| FR-RP-5 | `calculators` | Which calculators appear and their defaults (term, rate, down %, taxes, fee tables). | M |
| FR-RP-6 | `site_copy` | Default website texts: search placeholders, hero lines, portal wording, payment steps. | M |
| FR-RP-7 | `fees` | Effective-dated purchase-cost tables (SDLT bands, DLD fee rows, US closing-cost defaults) marked `needs_legal_review`. | M |
| FR-RP-8 | `modules` | Which modules switch on by default (mortgage, lettings, off-plan, installments, pay applications). | M |
| FR-RP-9 | (status) | Packs for US, UK and AE move from `draft` to `active` only after the launch checklist in section 8 passes. | M |

### 5.4 Public property website (each workspace's own site)

| ID | Requirement | Pri |
| --- | --- | --- |
| FR-WS-1 | Prices use the workspace currency and `price_style` everywhere (cards, detail page, filters, calculators, CSV/PDF). Removes hard-coded `PKR`, `en-PK`, Crore and Lakh outside PK (fixes A1, A2). | M |
| FR-WS-2 | Search filters come from the pack: property type, beds, baths, price, area unit, plus country extras (US: HOA max, year built; UK: tenure, new build, shared ownership; UAE: ready / off-plan, furnished, completion year; PK: plot / file / possession). | M |
| FR-WS-3 | Listing detail facts come from `listing_fields`; "Plot / unit" and "Block / sector" show only in PK. | M |
| FR-WS-4 | **Mortgage calculator** (US, UK, AE): price, deposit ($ or %), rate, term, and for US property tax, insurance, HOA and PMI; output = monthly payment breakdown and amortisation chart, matching the Zillow pattern. Uses the existing `shared/region/mortgage.js`. | M |
| FR-WS-5 | **Purchase-cost calculator**: UK Stamp Duty (standard, first-time buyer, additional property, non-resident); UAE DLD fees (4% transfer, registration, trustee, mortgage registration 0.25% + AED 290, agent 2% + 5% VAT); US estimated closing costs (editable %). | M |
| FR-WS-6 | **Affordability calculator** (income, debts, deposit → max price) for US/UK/AE using the existing `affordability()` function. | S |
| FR-WS-7 | **Rent calculators**: UK rent-to-income check; UAE rent with number of cheques. | S |
| FR-WS-8 | Installment-plan calculator stays for PK and can be switched on for UAE off-plan payment plans (e.g. 60/40), in AED. | M |
| FR-WS-9 | Construction cost calculator uses the pack's units and rates: sq ft (US/UK/AE) or Marla (PK); no Marla plot picker outside PK; rates and location factors are console data (fixes A4, A6). | M |
| FR-WS-10 | SEO data uses the workspace's country and cities (fixes A7). | M |
| FR-WS-11 | Customer portal wording and payment steps come from `site_copy` (fixes A8). | M |
| FR-WS-12 | Area unit converter (PK and AE). | S |
| FR-WS-13 | Lead-capture tools like AgentLocator's: "What's my home worth" request form and saved-search email alerts. | S |

### 5.5 Real estate brokerage modules

| ID | Requirement | Countries | Pri |
| --- | --- | --- | --- |
| FR-RE-1 | Listings with pack-driven type, fields and units; stores area in the entered unit and in sq m. | All | M |
| FR-RE-2 | Leads and CRM: capture from website, portals (email parsing), WhatsApp click-to-chat, phone; routing rules and round-robin. | All | M |
| FR-RE-3 | Deal pipeline per country: US offer → under contract → inspection → appraisal → closing; UK offer → sale agreed → conveyancing → exchange → completion (with chain tracking); UAE Form A/B → MOU (Form F) → NOC → transfer; PK booking → allotment → installments → possession → transfer. | All | M |
| FR-RE-4 | Commission: splits, caps, team and referral splits; tax on commission per pack (UAE 5% VAT, UK 20% VAT if registered). | All | M |
| FR-RE-5 | Agent licence tracking: US state licence, UAE BRN/ORN with expiry reminders. | US, AE | M |
| FR-RE-6 | Advertising permit number (Trakheesi/Madhmoun) required before a UAE listing is published. | AE | M |
| FR-RE-7 | Lettings: tenancy records, rent schedule, deposit, renewals; UK gas safety, EPC, EICR certificate expiry reminders, deposit protection and Right to Rent checks; UAE Ejari number and post-dated cheque tracker. | UK, AE | M |
| FR-RE-8 | Off-plan: developer projects, units, payment plans, escrow milestones. | AE, PK | S |
| FR-RE-9 | AML / KYC checklist per deal with ID documents stored encrypted (non-PK). | US, UK, AE | M |
| FR-RE-10 | Listing export files (XML/CSV) in a portal-ready format; live feeds to Zillow/MLS, Rightmove/Zoopla, Bayut/Property Finder, Zameen later. | All | S (files), L (live) |
| FR-RE-11 | Mortgage referral pipeline (exists behind the `mortgage` switch) turned on by default for US, UK, AE, with a "start application" button on the client page. | US, UK, AE | M |

### 5.6 Construction management modules

| ID | Requirement | Countries | Pri |
| --- | --- | --- | --- |
| FR-CN-1 | BOQ, budgets, purchase orders, change orders, subcontracts, labour and site reports (exist) use the workspace currency and units. | All | M |
| FR-CN-2 | Pay applications with schedule of values (AIA G702/G703 style) and retainage per line. | US | M |
| FR-CN-3 | UK interim valuations and payment notices; CIS deductions on subcontractor payments; VAT domestic reverse charge flag. | UK | M |
| FR-CN-4 | RFIs and submittals with status, due dates and attachments. | All | S |
| FR-CN-5 | Lien waivers (US), and certificate of insurance (COI) expiry tracking for subcontractors. | US | S |
| FR-CN-6 | Permits and NOCs register with expiry (UAE authority NOCs, US/UK building permits). | All | S |
| FR-CN-7 | Cost estimate units: sq ft (US, UK, AE), sq m option, Marla/sq ft (PK). | All | M |

### 5.7 Super Admin console

| ID | Requirement | Pri |
| --- | --- | --- |
| FR-SA-1 | Countries page: activate/deactivate a pack, edit property types, fields, calculators, fee tables and site copy, with version history and effective dates. | M |
| FR-SA-2 | Country pricing: plan prices per currency, tax setting per country. | M |
| FR-SA-3 | Preview the marketing site and a demo workspace "as" any country. | S |
| FR-SA-4 | Legal review status per pack item, with the reviewer's name and date. | M |

## 6. Country profiles

Each column below becomes that country's Region Pack. Fee and tax figures are starting data for the calculators and must pass local legal review before launch.

### 6.1 Formats and units

| Setting | USA | UK | UAE | Pakistan (unchanged) |
| --- | --- | --- | --- | --- |
| Currency, decimals | USD, 2 | GBP, 2 | AED, 2 | PKR, 0 |
| Price display | $1,250,000 · short $1.25M | £450,000 · short £450K | AED 2,400,000 · short AED 2.4M | PKR 1.25 Crore / 45 Lakh |
| Date | MM/DD/YYYY | DD/MM/YYYY | DD/MM/YYYY (Hijri optional) | DD-Mon-YYYY |
| Area (default, others) | sq ft; acre for lots | sq ft; sq m shown alongside; acre for land | sq ft; sq m alongside | Marla, Kanal; sq ft, sq yd |
| Sub-region | State | Nation (England, Scotland, Wales, NI) | Emirate | Province |
| Language | English | English | English, Arabic (RTL) | English (Urdu later) |
| Phone | +1 | +44 | +971 | +92 |
| Business ID at signup | EIN | Companies House no. | Trade licence, ORN | NTN |
| Personal ID (encrypted outside PK) | SSN last 4 | Passport / driving licence | Emirates ID | CNIC (plain, as today) |

### 6.2 Property types

| Group | USA | UK | UAE | Pakistan |
| --- | --- | --- | --- | --- |
| Houses | Single-family home, townhouse, duplex, triplex/fourplex, manufactured / mobile home | Detached, semi-detached, terraced, end-of-terrace, bungalow, cottage | Villa, townhouse | House, farmhouse, upper portion, lower portion |
| Apartments | Condo, co-op, apartment, studio, loft | Flat, maisonette, studio, penthouse | Apartment, studio, penthouse, duplex, hotel apartment | Flat, penthouse, room |
| Land | Lot / land, farm / ranch | Land, plot | Land / plot | Residential plot, commercial plot, agricultural land, plot file |
| Commercial | Office, retail, industrial, multi-family (5+) | Office, shop, industrial, mixed use | Office, retail, warehouse, whole building | Shop, office, warehouse, building, factory |
| Extra listing fields | Beds, full/half baths, garage, lot size, year built, HOA, property tax | Beds, baths, receptions, tenure (freehold, leasehold, share of freehold), council tax band, EPC rating, ground rent, service charge | Beds (studio = 0), baths, maid's room, parking, furnished, ready/off-plan, completion date, service charge, permit no. | Beds, baths, plot no., block/sector, file no., possession, installments |

### 6.3 Calculators per country

| Calculator | USA | UK | UAE | Pakistan |
| --- | --- | --- | --- | --- |
| Mortgage payment | Yes: 30/15-year fixed, ARM; tax, insurance, HOA, PMI | Yes: repayment or interest-only, 25-year default | Yes: 25-year max term default, down % | Home loan (optional) |
| Purchase costs | Closing costs (editable %, default 2–5%) | Stamp Duty Land Tax (England, NI); LBTT/LTT for Scotland/Wales later | DLD fee calculator | Transfer costs (later, needs input) |
| Affordability | Yes | Yes | Yes | No |
| Rent | Rent vs buy (later) | Rent-to-income | Rent by cheques | Rent |
| Installment plan | No | No | Off-plan payment plan | Yes (as today) |
| Construction cost | $ per sq ft | £ per sq ft / sq m | AED per sq ft | PKR per sq ft by Marla (as today) |
| Unit converter | No | No | sq ft ↔ sq m | Marla, Kanal, sq ft, sq yd |

### 6.4 Purchase-cost starting data

- **UK SDLT** (England and NI, residential, from [GOV.UK](https://www.gov.uk/stamp-duty-land-tax/residential-property-rates)): 0% to £125,000; 2% to £250,000; 5% to £925,000; 10% to £1.5m; 12% above. First-time buyers: 0% to £300,000 and 5% to £500,000, no relief above £500,000. +5% for additional properties; +2% for non-UK residents.
- **UAE DLD** (Dubai, from [fäm Properties](https://famproperties.com/advice/what-are-the-fees-for-transferring-property-in-dubai)): transfer 4% of price; registration AED 4,200 above AED 500,000 (AED 2,100 at or below); trustee AED 4,000 (AED 2,000); mortgage registration 0.25% of the loan + AED 290; agent commission typically 2% plus 5% VAT. Other emirates differ and stay as draft data.
- **US**: no national transfer tax table at launch; closing costs are an editable percentage per state, and state transfer tax tables follow as data.
- **Pakistan**: no tax logic exists today; nothing changes at launch.

### 6.5 Compliance focus (checklists, not legal advice)

| Country | Brokerage | Construction | Data |
| --- | --- | --- | --- |
| USA | Fair Housing wording, state licence, earnest money, disclosures, TCPA/CAN-SPAM consent | Lien waivers, retainage, COI, OSHA log, 1099 export | CCPA/state privacy |
| UK | AML/ID checks, Right to Rent, deposit protection, gas/EPC/EICR certificates, material information on listings | CIS, VAT reverse charge, CDM duties | UK GDPR |
| UAE | RERA Forms A/B/F, Trakheesi permit, Ejari, goAML reporting | Authority NOCs, escrow milestones for off-plan | UAE PDPL |
| Pakistan | As today | As today | As today |

## 7. Non-functional requirements

| ID | Area | Requirement |
| --- | --- | --- |
| NFR-1 | No PK regression | All existing server tests (185 at the last merge) and the PK golden tests stay green after every change. PK output (amounts, crore/lakh text, Marla, PDFs) is byte-identical. |
| NFR-2 | No hard-coded country | A lint check fails the build if `PKR`, `en-PK`, `Crore`, `Lakh`, `Marla` or `Kanal` appear outside the PK pack, PK tests or `shared/region/`. |
| NFR-3 | Money accuracy | All money is integer minor units; calculators round half away from zero; a mortgage schedule ends at exactly zero (already true in `mortgage.js`). |
| NFR-4 | Performance | Landing page Largest Contentful Paint under 2.5 s on 4G; switching country on the landing page re-renders in under 200 ms without a reload; calculators update on each keystroke. |
| NFR-5 | Localisation | All user-facing text goes through `t()`; Arabic UI is right-to-left with mirrored layout; Arabic PDFs use the embedded Noto Naskh Arabic font. Native-speaker review before AR goes live. |
| NFR-6 | Accessibility | WCAG 2.1 AA on the marketing site, signup, calculators and tenant site: labels on every input, keyboard use, 4.5:1 contrast. |
| NFR-7 | Security | Existing 2FA, separate DB per workspace, AES-256-GCM for non-PK personal IDs, audit log for pack edits. |
| NFR-8 | Privacy | Cookie consent per country; data export and erase (exists); retention rules per pack. Data residency (e.g. UK/EU or UAE hosting) is documented as a later option. |
| NFR-9 | Legal safety | Every fee, tax and template shows "Estimate only" on public calculators and carries `needs_legal_review` until signed off. |
| NFR-10 | Mobile | Marketing site, signup, calculators and tenant site work at 360 px width; the existing Capacitor app reads the same pack. |
| NFR-11 | Observability | Landing analytics record selected country, calculator use and signup step drop-off (consent-aware, already supported). |

## 8. Release plan, acceptance and open questions

Fix the public website first, because it is what prospects see today; then open signup for each country one at a time.

### 8.1 Phases

1. **Phase 1 – Fix the public face.** Pack additions FR-RP-1 to 6; tenant website made pack-driven (FR-WS-1 to 5, 9 to 11); landing page country switcher and local pricing (FR-LP-1 to 4, 6); signup shows country (FR-SU-1 to 3). Gate: no PKR, Crore, Lakh or Marla visible in US, UK or UAE demo sites.
2. **Phase 2 – Open UK and USA.** Brokerage pipelines, commission tax, lettings certificates (UK), licences (US), AML checklist, mortgage referral on, Stripe in USD/GBP, legal review of US and UK packs. Gate: legal sign-off, pack set to active.
3. **Phase 3 – Open UAE.** Arabic UI and PDFs, Trakheesi permit gate, Forms A/B/F templates, Ejari and cheque tracker, DLD calculator, off-plan payment plans, AED billing with 5% VAT. Gate: Arabic native review and legal sign-off.
4. **Phase 4 – Construction depth and feeds.** Pay applications and retainage (US), CIS and valuations (UK), RFIs, submittals, COI, permits/NOCs; portal export files. Canada pack can follow the same steps.

### 8.2 Acceptance criteria

| # | Test | Pass when |
| --- | --- | --- |
| AC-1 | Visit the landing page, choose UK | All plan prices in £; hero and FAQ are UK copy; Stamp Duty calculator for £400,000 standard purchase shows £10,000. |
| AC-2 | Sign up a US brokerage | Workspace has USD, MM/DD/YYYY, sq ft, State chosen; property form offers Townhouse, Condo, Single-family; no Marla anywhere. |
| AC-3 | US tenant site, $500,000 home, 20% down, 6.5%, 30 years | Mortgage calculator shows principal and interest of $2,528.27 a month plus tax, insurance and HOA lines. |
| AC-4 | UAE workspace, AED 2,000,000 cash purchase | DLD calculator shows a transfer fee of AED 80,000 plus registration and trustee fees; Arabic toggle flips the page right-to-left. |
| AC-5 | UAE listing without a permit number | Cannot be published on the website. |
| AC-6 | Existing PK workspace | Every PK golden test passes; site shows "PKR 1.25 Crore" and Marla as before. |
| AC-7 | Lint check | Fails if `Crore` or `PKR` is added to a non-PK file. |

### 8.3 Open questions

- [ ] Final plan prices in USD, GBP and AED (the SRS uses placeholders).
- [ ] Which UK nations at launch: England and NI only (SDLT), or also Scotland (LBTT) and Wales (LTT)?
- [ ] Which emirates at launch: Dubai only, or Abu Dhabi too (different fees and Madhmoun permits)?
- [ ] Who does legal review in each country, and on what budget?
- [ ] Is Canada in this launch or the next?
- [ ] Hosting: is one server (Contabo) enough at launch, or do UK/UAE customers need local data residency?

## 9. Sources

All pages opened on 20 Oct 2026.

- [Zillow mortgage calculator](https://www.zillow.com/mortgage-calculator/)
- [Rightmove home page](https://www.rightmove.co.uk/)
- [Bayut home page](https://www.bayut.com/)
- [Zameen home page](https://www.zameen.com/)
- [AgentLocator](http://www.agentlocator.ca/)
- [The Close: Best real estate brokerage software for 2026](https://theclose.com/real-estate-brokerage-software/)
- [Alto: Best estate agency CRM software in 2026](https://www.altosoftware.co.uk/blog/best-estate-agency-crms-in-2026-alto-vs-reapit-vs-street/) (vendor-written)
- [PropSpace: Real estate CRM Dubai complete guide](https://www.propspace.com/blog/real-estate-crm-dubai-complete-guide) (vendor-written)
- [Buildern: Buildertrend vs Procore](https://buildern.com/resources/blog/buildertrend-vs-procore/) (vendor-written)
- [GOV.UK: Stamp Duty Land Tax residential rates](https://www.gov.uk/stamp-duty-land-tax/residential-property-rates)
- [fäm Properties: Fees for transferring property in Dubai](https://famproperties.com/advice/what-are-the-fees-for-transferring-property-in-dubai)
- Agentify ERP source code and docs in `C:\Users\HP\Documents\AgentifyERP\agentify-erp` (audit in section 2).
