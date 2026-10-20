// UI text. English is the source; French and Arabic are loaded on demand. Machine-drafted translations are listed in
// docs/multi-region/translation-review.md and need a native reviewer before a region goes live.
import { createT, direction } from '../../shared/region/index.js';
import en from './locales/en.json';
import fr from './locales/fr.json';
import ar from './locales/ar.json';

const MESSAGES = { en, fr, ar };
let current = 'en';
let translate = createT({ locale: 'en', fallback: 'en', messages: MESSAGES });
const KEY = 'erp_lang';

/** Choose the language: the user's saved choice if the region offers it, else the region's default. */
export function pickLanguage(cfg) {
  let saved = null;
  try { saved = localStorage.getItem(KEY); } catch { /* storage may be blocked */ }
  const offered = cfg?.languages?.length ? cfg.languages : ['en'];
  return offered.includes(saved) ? saved : (cfg?.language || 'en');
}
export function setLanguage(lang) {
  current = MESSAGES[lang] ? lang : 'en';
  translate = createT({ locale: current, fallback: 'en', messages: MESSAGES });
  if (typeof document !== 'undefined') { document.documentElement.lang = current; document.documentElement.dir = direction(current); }
}
export const chooseLanguage = (lang) => { try { localStorage.setItem(KEY, lang); } catch { /* ignore */ } window.location.reload(); };
export const getLanguage = () => current;
/** t('auth.sign_in', 'Sign in') -> text in the current language, falling back to the English default. */
export const t = (key, def, params) => translate(key, def, params);
