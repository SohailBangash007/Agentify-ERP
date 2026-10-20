# Translation review

French (`fr`, used for Canada/Quebec) and Arabic (`ar`, UAE) strings in `client/src/locales/` were drafted by the build and have **not** been reviewed by a native speaker. Region packs for Canada and the UAE must not be activated for real customers until a reviewer has signed off the files below.

| File | Language | Reviewer | Date | Status |
|------|----------|----------|------|--------|
| `client/src/locales/fr.json` | Français (Canada) | — | — | needs review |
| `client/src/locales/ar.json` | العربية (UAE) | — | — | needs review |

Coverage today: sign-in and shared buttons. More screens move to `t('key', 'English default')` phase by phase; any missing key falls back to English, so a partial translation never breaks a screen.
