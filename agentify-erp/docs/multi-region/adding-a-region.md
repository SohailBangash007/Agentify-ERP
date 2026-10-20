# Adding a region

A region is a JSON pack plus (optionally) data entered in the Super Admin console. No code change is needed for a normal region.

## 1. Write the pack

Copy `server/src/regions/packs/US.json` to `server/src/regions/packs/<CODE>.json` and edit:

| Field | Meaning |
|-------|---------|
| `code`, `name`, `version`, `status` | Use `"status": "draft"`; a draft cannot be chosen at signup. |
| `locale`, `language`, `languages` | BCP-47 locale (`en-GB`), default language, languages offered. A language needs files in `client/src/locales/`. Arabic and other right-to-left languages flip the page automatically. |
| `currency`, `money_scale`, `currency_style` | ISO code, decimal digits stored (0 = whole units like PKR, 2 = cents), `intl` or `code_prefix`. Money is always stored as integers in minor units. |
| `date_style`, `time_style`, `timezone` | `MM/DD/YYYY`, `DD/MM/YYYY`, `YYYY-MM-DD`, `DD Mon YYYY`; `12h`/`24h`; an IANA zone. |
| `units_system`, `area_units`, `default_area_unit` | Which area units property screens offer. |
| `phone` | `calling_code`, `trunk`, `match_tail` (0 = match whole international number), `national_length`. |
| `sub_region_label`, `sub_regions` | State / province / emirate list shown at signup. |
| `terminology` | Words that differ (`agent` becomes "Realtor"). |
| `identity.national_id` | Label and regular expression for the identity number (stored encrypted). |
| `ext_fields` | Extra typed fields on contacts or properties (`text`, `number`, `money`, `select`). |
| `templates`, `checklists` | Starter documents and checklists. Mark them `needs_legal_review`. |
| `flags` | Feature switches: `mortgage`, `templates`, `compliance`. |
| `mortgage_compounding` | `monthly` (default) or `semiannual` (Canada). |

## 2. Test

```bash
cd agentify-erp/server
node --test            # the Pakistan snapshots must stay green
```

`test/region-core.test.js` checks every pack has the required fields. Add a flow test like `test/region-us-flow.test.js` if the region needs special handling.

## 3. Switch it on (console)

1. Sign in to the Super Admin console, open **Regions**.
2. Review the sample rules, templates and checklists with a qualified person in that jurisdiction, then mark rules reviewed.
3. Turn on the feature switches the region needs, then press **Activate**. From then on it appears in the signup form.

A region that has workspaces cannot go back to draft. Pack changes made in the console are new versions; older versions are kept.

## 4. Before real customers

Work through `legal-review-checklist.md` for that region and have every French, Arabic or other translation reviewed by a native speaker (`translation-review.md`).

## What the platform guarantees

- Pakistan output is covered by snapshot tests (`test/pk-golden.test.js`, `test/pk-format.test.js`); any change to a Pakistani figure fails the build.
- Money is integer minor units; rates are integer basis points; rounding is half away from zero; splits always add up.
- Personal data export and erasure are in `server/src/regions/privacy.js`.
