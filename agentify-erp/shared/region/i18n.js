// Small translation layer (no dependency). `t(key, defaultText, params)`: the English default text lives next to the
// call, so screens can be converted gradually and an untranslated key still shows readable English. Dictionaries are flat
// JSON objects ({"sales.title": "Sales"}); plural forms use "key.one" / "key.other" (Intl.PluralRules categories).
const RTL = new Set(['ar', 'he', 'fa', 'ur', 'ps', 'sd', 'ug', 'yi']);
export const baseLang = (locale) => String(locale || 'en').toLowerCase().split(/[-_]/)[0];
export const isRtl = (locale) => RTL.has(baseLang(locale));
export const direction = (locale) => (isRtl(locale) ? 'rtl' : 'ltr');

/** Fallback chain: fr-CA -> fr -> en. */
export const chain = (locale, fallback = 'en') => {
  const l = String(locale || fallback).replace('_', '-');
  return [...new Set([l, baseLang(l), fallback])];
};

const fill = (s, params) => String(s).replace(/\{(\w+)\}/g, (m, k) => (params && params[k] !== undefined ? String(params[k]) : m));

export function createT({ locale = 'en', fallback = 'en', messages = {} } = {}) {
  const order = chain(locale, fallback);
  const lookup = (key) => { for (const l of order) { const v = messages[l]?.[key]; if (v !== undefined) return v; } return undefined; };
  const rules = (() => { try { return new Intl.PluralRules(locale); } catch { return new Intl.PluralRules('en'); } })();
  const t = (key, defaultText, params) => {
    if (params && typeof params.count === 'number') {
      const form = lookup(`${key}.${rules.select(params.count)}`) ?? lookup(`${key}.other`);
      if (form !== undefined) return fill(form, params);
    }
    const v = lookup(key);
    return fill(v !== undefined ? v : (defaultText ?? key), params);
  };
  t.locale = locale; t.dir = direction(locale); t.has = (key) => lookup(key) !== undefined;
  return t;
}
