// Provider-neutral, consent-first analytics for the public marketing site.
// Nothing is sent before the visitor accepts; Do Not Track and Global Privacy Control count as "no" and the banner is
// not shown. Events go to our own first-party endpoint and, when the platform owner configured one, to Google Analytics 4.
const KEY = 'agentify-consent';
const VID = 'agentify-vid';
const SID = 'agentify-sid';
const ATTR = 'agentify-attr';
const SESSION_MS = 30 * 60 * 1000;

const store = {
  get: (s, k) => { try { return s.getItem(k); } catch { return null; } },
  set: (s, k, v) => { try { s.setItem(k, v); } catch { /* storage blocked */ } },
  del: (s, k) => { try { s.removeItem(k); } catch { /* storage blocked */ } },
};
const ls = typeof window !== 'undefined' ? window.localStorage : null;
const ss = typeof window !== 'undefined' ? window.sessionStorage : null;
const rid = (p) => `${p}_${Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(36).padStart(2, '0')).join('').slice(0, 20)}`;

/** The browser asks not to be tracked. */
export const browserOptOut = () => typeof navigator !== 'undefined' && (navigator.doNotTrack === '1' || window.doNotTrack === '1' || navigator.globalPrivacyControl === true);
export const consent = () => (browserOptOut() ? 'denied' : store.get(ls, KEY)); // 'granted' | 'denied' | null (not asked yet)

let ga4 = null;
let listeners = [];
export const onConsentChange = (fn) => { listeners.push(fn); return () => { listeners = listeners.filter((x) => x !== fn); }; };

export function setConsent(v) {
  store.set(ls, KEY, v);
  if (v !== 'granted') { store.del(ls, VID); store.del(ss, SID); store.del(ss, ATTR); if (window.gtag) window.gtag('consent', 'update', { analytics_storage: 'denied' }); }
  else loadGa4();
  listeners.forEach((f) => f(v));
}

function ids() {
  if (consent() !== 'granted') return null;
  let vid = store.get(ls, VID);
  if (!vid) { vid = rid('v'); store.set(ls, VID, vid); }
  let s = null;
  try { s = JSON.parse(store.get(ss, SID) || 'null'); } catch { s = null; }
  if (!s || Date.now() - s.at > SESSION_MS) s = { id: rid('s'), at: Date.now() };
  s.at = Date.now();
  store.set(ss, SID, JSON.stringify(s));
  return { visitor_id: vid, session_id: s.id };
}

/** Campaign tags and referrer from the first page of the visit (kept for the session only). */
function attribution() {
  let a = null;
  try { a = JSON.parse(store.get(ss, ATTR) || 'null'); } catch { a = null; }
  if (a) return a;
  const q = new URLSearchParams(window.location.search);
  a = { utm_source: q.get('utm_source') || '', utm_medium: q.get('utm_medium') || '', utm_campaign: q.get('utm_campaign') || '', referrer: document.referrer || '', landing_page: window.location.pathname };
  store.set(ss, ATTR, JSON.stringify(a));
  return a;
}

/** Fields to attach to a sign-up or demo request so a conversion can be tied to its campaign (only with consent). */
export function attributionFields() {
  const i = ids();
  if (!i) return { consent: false };
  return { consent: true, ...i, ...attribution() };
}

/** Record one event. Silently does nothing without consent. */
export function track(name, props = {}) {
  const i = ids();
  if (!i) return;
  const a = attribution();
  const body = { consent: true, ...i, events: [{ name, path: window.location.pathname, ...a, ...props }] };
  try { fetch('/api/platform/analytics/collect', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), keepalive: true }).catch(() => {}); } catch { /* offline */ }
  if (window.gtag && ga4) window.gtag('event', name, { page_path: window.location.pathname, ...props });
}

/** Google Analytics 4, only when configured by the platform owner and only after consent. */
export function configureGa4(id) { ga4 = id && /^G-[A-Z0-9]{4,16}$/.test(id) ? id : null; if (consent() === 'granted') loadGa4(); }
function loadGa4() {
  if (!ga4 || document.getElementById('ga4-tag')) return;
  window.dataLayer = window.dataLayer || [];
  window.gtag = function gtag() { window.dataLayer.push(arguments); }; // eslint-disable-line prefer-rest-params
  window.gtag('consent', 'default', { analytics_storage: 'granted', ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied' });
  window.gtag('js', new Date());
  window.gtag('config', ga4, { anonymize_ip: true, send_page_view: false });
  const s = document.createElement('script');
  s.id = 'ga4-tag'; s.async = true; s.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(ga4)}`;
  document.head.appendChild(s);
}
