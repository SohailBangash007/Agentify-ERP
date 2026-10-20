# Multi-region changelog

## Foundation (branch claude/multi-region-phase1)

Added (all additive; Pakistan output verified unchanged by snapshot tests):

- Region packs for PK (active) and US, CA, UK, AE (draft) with a console **Regions** page: activate, feature switches, versioned rules marked for legal review, exchange rates, audit trail.
- Shared utilities (`shared/region/`): money in minor units, units, phone, dates, translations, rules, mortgage maths, document templates.
- Workspace columns `region, sub_region, money_scale, locale, language, units_system, flags`; region picker and language switcher at signup/sign-in; `GET /api/auth/region`.
- Cents-aware money input, spreadsheet/CSV exports in major units, receipt sheet and statements in the region's number format.
- Right-to-left styles and English/French/Arabic string loader (sign-in translated; other screens fall back to English).
- Region-specific fields on contacts and properties; encrypted identity numbers (masked, reveal audited).
- Mortgage and financing module, document templates (with editor screen), compliance checklists (each off until its switch is on).
- Privacy export and erasure for a person (administrator only).
- Demo data for each non-Pakistani region.

Not yet done: translations of most screens (sign-in and the sidebar groups are done), Arabic PDF output (needs an embedded Arabic font and right-to-left layout), tax and fee rules content (needs legal input), construction and rentals/off-plan rules, FX conversion in reports.

## Integrations (see docs/integrations.md)

- Twilio calling and texting with a ranked "Call next" dialer, call outcomes that schedule follow-ups, do-not-call handling and signed web hooks; a generic HTTPS voice provider for Pakistan.
- Google sign-in and sign-in with Apple (existing staff only), Google Calendar sync for a new Appointments page.
- Custom domains with DNS verification and an on-demand-certificate check for the web server.
- Property portal feeds per country with readiness checks and the UAE advertising-permit rule; RESO API push for MLS boards.
- Facebook, Instagram, LinkedIn and TikTok connections, scheduled posts and reports.
- Landing page: call-next section, "included website" message, per-country integration list; testimonials only from real quotes entered in the console.
