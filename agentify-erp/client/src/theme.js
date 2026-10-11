// Per-user appearance (theme, density, accent). Applied before React renders so there is no flash.
const KEY = 'erp-appearance';
export const ACCENTS = {
  blue: ['#2563eb', '#1d4ed8', '#eff4ff'], teal: ['#0e7c6b', '#0b5f52', '#e2f4f0'], violet: ['#7c3aed', '#6d28d9', '#f3edff'],
  rose: ['#e11d48', '#be123c', '#ffeef2'], amber: ['#d97706', '#b45309', '#fff5e1'], green: ['#16a34a', '#15803d', '#e8f6ee'],
};
const DEFAULTS = { theme: 'auto', density: 'comfortable', accent: 'teal', text: 'normal' };

export function loadAppearance() {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { return { ...DEFAULTS }; }
}

const darkQuery = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

export function applyAppearance(a = loadAppearance()) {
  const root = document.documentElement;
  const dark = a.theme === 'dark' || (a.theme === 'auto' && darkQuery?.matches);
  root.dataset.theme = dark ? 'dark' : 'light';
  root.dataset.density = a.density;
  root.dataset.text = a.text || 'normal';
  const [p, pd, pl] = ACCENTS[a.accent] || ACCENTS.blue;
  root.style.setProperty('--primary', p); root.style.setProperty('--primary-d', pd);
  // in dark mode the tinted background must be dark too
  root.style.setProperty('--primary-l', dark ? `color-mix(in srgb, ${p} 22%, #101826)` : pl);
  return a;
}

export function saveAppearance(patch) {
  const next = { ...loadAppearance(), ...patch };
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* private mode */ }
  applyAppearance(next);
  window.dispatchEvent(new Event('erp:appearance'));
  return next;
}

applyAppearance();
darkQuery?.addEventListener?.('change', () => applyAppearance());
