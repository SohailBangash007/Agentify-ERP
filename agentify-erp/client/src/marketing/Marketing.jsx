// Public website on the main domain: home, the two product pages, pricing, contact/demo, legal documents, sign-up and
// "find my workspace". Texts, plans, prices, trial terms and legal documents come from /api/platform/marketing and are
// edited by platform staff in the console. Nothing here invents customers, counts, testimonials or integrations.
import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { Link, NavLink, useLocation, useNavigate, Navigate } from 'react-router-dom';
import { api } from '../api.js';
import { Loading } from '../components/ui.jsx';
import Flag from '../components/Flag.jsx';
import { BRANDS } from './brandIcons.js';
import { track, consent, setConsent, browserOptOut, configureGa4, attributionFields, onConsentChange } from './analytics.js';
import { setRegion } from '../format.js';
import { MortgageCalculator, PurchaseCostCalculator, UnitConverter } from '../site/RegionCalculators.jsx';
import '../site/site.css';
import '../pages/landing.css';
import './marketing.css';


import { motion } from "framer-motion";

const PRODUCT_PATH = { real_estate: '/real-estate', construction: '/construction' };
const METHOD = { raast: 'Raast', easypaisa: 'Easypaisa', jazzcash: 'JazzCash', sadapay: 'SadaPay', nayapay: 'NayaPay', bank: 'Bank transfer' };
const fmt = (amount, cur) => new Intl.NumberFormat('en', { style: 'currency', currency: cur, maximumFractionDigits: 0 }).format(amount);
const limitLine = (v, one, many) => (v == null ? `Unlimited ${many}` : `Up to ${Number(v).toLocaleString()} ${v === 1 ? one : many}`);

/** Real screenshots of the application, taken from a demo workspace (see docs). Hidden if an image is missing. */
const SCREENS = {
  real_estate: [['re-dashboard.png', 'Dashboard with collections, receivables and follow-ups'], ['re-sale.png', 'A sale with its installment schedule and receipts']],
  construction: [['con-project.png', 'Construction project: budget vs actual, BOQ and progress'], ['con-boq.png', 'Bill of quantities with measured progress']],
};
function Shot({ file, caption }) {
  const [ok, setOk] = useState(true);
  if (!ok) return null;
  return <figure className="lshot" style={{ margin: 0 }}><img src={`/marketing/${file}`} alt={caption} loading="lazy" onError={() => setOk(false)} /><figcaption>{caption} (application screenshot)</figcaption></figure>;
}

function useTitle(title, description) {
  useEffect(() => {
    if (!title) return;
    document.title = title;
    let m = document.querySelector('meta[name=description]');
    if (!m) { m = document.createElement('meta'); m.name = 'description'; document.head.appendChild(m); }
    m.content = description || '';
  }, [title, description]);
}

// ---------------------------------------------------------------- country
// One site for every country. The visitor's country decides the currency, the wording and the calculators; it is saved in
// localStorage and a cookie and kept in the URL (?country=uk) so a link keeps it. A first visit only suggests a country
// from the browser's language and time zone, never from the IP address.
const CountryCtx = createContext(null);
export const useCountry = () => useContext(CountryCtx);
const PATH_COUNTRY = { us: 'US', uk: 'UK', ae: 'AE', pk: 'PK', ca: 'CA' };
function guessCountry(countries) {
  const langs = (navigator.languages || [navigator.language || '']).map((l) => String(l).toLowerCase());
  const tz = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch { return ''; } })();
  const g = tz === 'Asia/Karachi' || langs.some((l) => l.endsWith('-pk')) ? 'PK' : tz === 'Asia/Dubai' || langs.some((l) => l.endsWith('-ae')) ? 'AE' : tz === 'Europe/London' || langs.some((l) => l.endsWith('-gb')) ? 'UK'
    : tz.startsWith('America/') || langs.some((l) => l.endsWith('-us')) ? 'US' : null;
  return countries.find((c) => c.code === g)?.code || countries.find((c) => c.open)?.code || countries[0].code;
}
function CountryProvider({ info, children }) {
  const loc = useLocation();
  const nav = useNavigate();
  const countries = info.countries?.length ? info.countries : [{ code: 'PK', name: 'Pakistan', currency: 'PKR', open: true, config: {}, copy: {}, timezones: ['Asia/Karachi'] }];
  const byCode = (c) => countries.find((x) => x.code === String(c || '').toUpperCase());
  const [code, setCode] = useState(() => {
    const q = new URLSearchParams(loc.search).get('country');
    const slug = loc.pathname.replace(/^\/+|\/+$/g, '').toLowerCase();
    let saved = null; try { saved = localStorage.getItem('agentify_country'); } catch { /* storage blocked */ }
    return (byCode(q) || byCode(PATH_COUNTRY[slug]) || byCode(saved))?.code || guessCountry(countries);
  });
  const country = byCode(code) || countries[0];
  // applied during render so the calculators below read this country's formats on their first paint
  if (country.config?.region) setRegion(country.config);
  useEffect(() => {
    const slug = loc.pathname.replace(/^\/+|\/+$/g, '').toLowerCase();
    if (PATH_COUNTRY[slug] && byCode(PATH_COUNTRY[slug])) setCode(PATH_COUNTRY[slug]);
  }, [loc.pathname]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    try { localStorage.setItem('agentify_country', country.code); } catch { /* ignore */ }
    document.cookie = `agentify_country=${country.code}; path=/; max-age=31536000; samesite=lax`;
    // alternate-language/country links for search engines
    document.head.querySelectorAll('link[data-hreflang]').forEach((n) => n.remove());
    for (const c of countries) {
      const l = document.createElement('link'); l.rel = 'alternate'; l.hreflang = `${String(c.locale || 'en').split('-')[0]}-${c.code === 'UK' ? 'GB' : c.code}`; l.href = `${window.location.origin}/${c.slug}`; l.setAttribute('data-hreflang', '1'); document.head.appendChild(l);
    }
  }, [country.code]); // eslint-disable-line react-hooks/exhaustive-deps
  const choose = (c) => {
    setCode(c);
    const q = new URLSearchParams(loc.search); q.set('country', String(c).toLowerCase() === 'uk' ? 'uk' : String(c).toLowerCase());
    nav({ pathname: PATH_COUNTRY[loc.pathname.replace(/^\/+|\/+$/g, '').toLowerCase()] ? '/' : loc.pathname, search: `?${q}` }, { replace: true });
    track('country_selected', { country: c });
  };
  return <CountryCtx.Provider value={{ country, countries, setCountry: choose }}>{children}</CountryCtx.Provider>;
}
function CountrySwitch({ compact }) {
  const { country, countries, setCountry } = useCountry();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => { if (!e.target.closest?.('.lcountry')) setOpen(false); };
    const esc = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('click', close); document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('click', close); document.removeEventListener('keydown', esc); };
  }, [open]);
  if (countries.length < 2) return null;
  return (
    <div className="lcountry" style={{ position: 'relative', display: 'inline-block', fontSize: 14 }}>
      <button type="button" aria-haspopup="listbox" aria-expanded={open} aria-label={`Country: ${country.name}. Change`} onClick={() => setOpen(!open)}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 8, font: 'inherit', padding: '7px 10px', borderRadius: 8, border: '1px solid #d0d5dd', background: '#fff', cursor: 'pointer', color: 'inherit' }}>
        <Flag code={country.code} /><span>{country.name}</span><span aria-hidden style={{ fontSize: 10, opacity: 0.6 }}>▾</span>
      </button>
      {open && (
        <ul role="listbox" aria-label="Country" style={{ position: 'absolute', right: 0, top: '110%', zIndex: 50, margin: 0, padding: 4, listStyle: 'none', background: '#fff', border: '1px solid #d0d5dd', borderRadius: 10, boxShadow: '0 8px 24px rgba(16,24,40,.14)', minWidth: 210 }}>
          {countries.map((c) => (
            <li key={c.code} role="option" aria-selected={c.code === country.code}>
              <button type="button" onClick={() => { setCountry(c.code); setOpen(false); }}
                style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left', font: 'inherit', padding: '8px 10px', border: 0, borderRadius: 8, background: c.code === country.code ? '#e6f4f1' : 'transparent', cursor: 'pointer', color: 'inherit' }}>
                <Flag code={c.code} /><span style={{ flex: 1 }}>{c.name}</span>{!c.open && <small style={{ opacity: 0.6 }}>soon</small>}
              </button>
            </li>))}
        </ul>)}
    </div>
  );
}
const SITE_VARS = { '--s-primary': '#0f766e', '--s-accent': '#f59e0b', '--s-dark': '#17202e', '--s-bg': '#ffffff', '--s-soft': '#f4f7f6', '--s-radius': '12px', '--s-font-h': 'inherit', '--s-font-b': 'inherit' };
/** Live calculators for the chosen country, so a visitor can try the numbers before signing up. */

function CalcStrip() {
  const { country } = useCountry();
  const c = country.config || {};
  const copy = country.copy || {};

  const tabs = [
    ...(c.calculators?.mortgage
      ? [["mortgage", "Mortgage calculator", MortgageCalculator]]
      : []),

    ...(c.calculators?.purchase_costs
      ? [[
          "costs",
          c.calculators.purchase_costs === "sdlt"
            ? "Stamp Duty"
            : c.calculators.purchase_costs === "dld"
              ? "Purchase fees"
              : "Closing costs",
          PurchaseCostCalculator,
        ]]
      : []),

    ...(c.calculators?.unit_converter
      ? [["units", "Area converter", UnitConverter]]
      : []),
  ];

  const [tab, setTab] = useState(tabs[0]?.[0]);
  const [hoveredTab, setHoveredTab] = useState(null);

  useEffect(() => {
    setTab(tabs[0]?.[0]);
  }, [country.code]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!tabs.length) return null;

  const Active = (tabs.find(([key]) => key === tab) || tabs[0])[2];

  const styles = {
    section: {
      padding: "clamp(48px, 7vw, 90px) 20px",
      background:
        "radial-gradient(ellipse at 10% 5%, rgba(129,140,248,0.13), transparent 38%), radial-gradient(ellipse at 90% 90%, rgba(56,189,248,0.12), transparent 35%), #f7f8fc",
      position: "relative",
      overflow: "hidden",
    },

    container: {
      width: "100%",
      maxWidth: "1120px",
      margin: "0 auto",
    },

    heading: {
      textAlign: "center",
      margin: "0 auto 36px",
      maxWidth: "700px",
    },

    eyebrow: {
      display: "inline-block",
      padding: "8px 14px",
      marginBottom: "17px",
      borderRadius: "30px",
      background: "#e9eaff",
      color: "#5145cd",
      fontSize: "11px",
      fontWeight: 800,
      letterSpacing: "1.6px",
      textTransform: "uppercase",
    },

    title: {
      fontSize: "clamp(30px, 4.5vw, 48px)",
      lineHeight: 1.12,
      letterSpacing: "-1.8px",
      fontWeight: 800,
      color: "#151b35",
      margin: "0 0 16px",
    },

    gradientText: {
      background: "linear-gradient(100deg, #635bdf, #3989e8)",
      WebkitBackgroundClip: "text",
      WebkitTextFillColor: "transparent",
      backgroundClip: "text",
    },

    subtitle: {
      fontSize: "16px",
      lineHeight: 1.8,
      color: "#69738a",
      margin: 0,
    },

    card: {
      background: "rgba(255,255,255,0.96)",
      border: "1px solid #e6e9f2",
      borderRadius: "24px",
      padding: "clamp(16px, 3vw, 32px)",
      boxShadow:
        "0 20px 60px rgba(31,41,85,0.07), 0 3px 12px rgba(31,41,85,0.03)",
    },

    tabs: {
      display: "flex",
      flexWrap: "wrap",
      alignItems: "center",
      justifyContent: "center",
      gap: "8px",
      padding: "7px",
      background: "#f2f4fa",
      border: "1px solid #e9ecf4",
      borderRadius: "15px",
      marginBottom: "30px",
    },

    calculator: {
      minWidth: 0,
      width: "100%",
    },

    footer: {
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      flexWrap: "wrap",
      gap: "8px",
      marginTop: "24px",
      color: "#788198",
      fontSize: "12px",
      textAlign: "center",
    },
  };

  return (
    <section className="alt" style={styles.section}>
      <div className="lwrap" style={styles.container}>

        {/* Section Heading */}
        <div className="lsh" style={styles.heading}>
          <span style={styles.eyebrow}>
            ✦ Smart property tools
          </span>

          <h2 style={styles.title}>
            {copy.calc_title || "Make your next move"}
            <br />
            <span style={styles.gradientText}>
              with confidence.
            </span>
          </h2>

          <p style={styles.subtitle}>
            {copy.calc_sub ||
              "Explore your options, estimate your costs, and plan your property journey with simple, easy-to-use tools."}
          </p>
        </div>

        {/* Calculator Card */}
        <div
          className="site"
          style={{
            ...SITE_VARS,
            background: "transparent",
            minHeight: 0,
            width: "100%",
            maxWidth: "100%",
            boxSizing: "border-box",
          }}
          key={country.code}
        >
          {/* Calculator Tabs */}
          <div style={styles.card}>
            <div
              className="tabs-pill"
              style={styles.tabs}
              role="tablist"
              aria-label="Choose a calculator"
            >
              {tabs.map(([key, label]) => {
                const isActive = (tab || tabs[0][0]) === key;
                const isHovered = hoveredTab === key;

                return (
                  <button
                    type="button"
                    key={key}
                    role="tab"
                    aria-selected={isActive}
                    onClick={() => setTab(key)}
                    onMouseEnter={() => setHoveredTab(key)}
                    onMouseLeave={() => setHoveredTab(null)}
                    style={{
                      flex: "1 1 180px",
                      minWidth: 0,
                      maxWidth: "100%",
                      padding: "14px 18px",
                      border: isActive
                        ? "1px solid transparent"
                        : "1px solid transparent",
                      borderRadius: "11px",
                      background: isActive
                        ? "linear-gradient(110deg, #5145cd, #7168ee)"
                        : isHovered
                          ? "#ffffff"
                          : "transparent",
                      color: isActive ? "#ffffff" : "#59627a",
                      fontSize: "13px",
                      fontWeight: isActive ? 750 : 600,
                      fontFamily: "inherit",
                      cursor: "pointer",
                      boxShadow: isActive
                        ? "0 5px 14px rgba(81,69,205,0.24)"
                        : isHovered
                          ? "0 2px 8px rgba(31,41,85,0.05)"
                          : "none",
                      transition:
                        "background 200ms ease, color 200ms ease, box-shadow 200ms ease, transform 200ms ease",
                      transform:
                        isHovered && !isActive
                          ? "translateY(-1px)"
                          : "translateY(0)",
                    }}
                  >
                    <span
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "9px",
                        justifyContent: "center",
                      }}
                    >
                      <span
                        aria-hidden="true"
                        style={{
                          fontSize: "16px",
                          lineHeight: 1,
                        }}
                      >
                        {key === "mortgage"
                          ? "⌂"
                          : key === "costs"
                            ? "◈"
                            : "↔"}
                      </span>
                      {label}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Existing Calculator */}
            <div
              key={`${country.code}-${tab}`}
              role="tabpanel"
              style={styles.calculator}
            >
              <Active />
            </div>

            {/* Trust Note */}
            <div style={styles.footer}>
              <span aria-hidden="true" style={{ color: "#5145cd" }}>
                ✦
              </span>
              <span>
                Simple tools to help you plan with confidence.
              </span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}


function Header({ info }) {
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  useEffect(() => setOpen(false), [loc.pathname]);
  const brand = info.content.brand;
  const links = [['/real-estate', 'Real Estate'], ['/construction', 'Construction'], ['/pricing', 'Pricing'], ['/contact', 'Book a demo']];
  return (
    <>
      {info.content.announcement_bar && <div className="lbar">{info.content.announcement_bar}</div>}
      <header><div className="lwrap">
        <Link className="llogo" to="/" aria-label={`${brand} home`}><i aria-hidden>⌂</i>{brand}</Link>
        <nav aria-label="Main">
          {links.map(([to, l]) => <NavLink key={to} className="hide-m" to={to}>{l}</NavLink>)}
          <NavLink className="hide-m" to="/login">Sign in</NavLink>
          <span className="hide-m"><CountrySwitch /></span>
          <Link className="lbtn p sm" to="/signup">Start free trial</Link>
          <button className="lmenu" aria-label="Open menu" aria-expanded={open} onClick={() => setOpen(!open)}>☰</button>
        </nav>
      </div></header>
      <div className={`ldrawer ${open ? 'open' : ''}`}>{[...links, ['/login', 'Sign in']].map(([to, l]) => <Link key={to} to={to}>{l}</Link>)}<div style={{ padding: '10px 16px' }}><CountrySwitch /></div></div>
    </>
  );
}

function Footer({ info, onCookies }) {
  const c = info.content;
  const social = Object.entries(c.social || {}).filter(([, v]) => v);
  return (
    <footer><div className="lwrap"><div className="lcols">
      <div><h4>{c.brand}</h4><p style={{ margin: 0 }}>{PRODUCT_LABELS.real_estate} and {PRODUCT_LABELS.construction} on one platform.</p>
        {(c.contact_email || c.contact_phone || c.address) && <p style={{ marginTop: 10 }}>{[c.contact_email && <a key="e" href={`mailto:${c.contact_email}`}>{c.contact_email}</a>, c.contact_phone, c.address].filter(Boolean).map((x, i) => <span key={i} style={{ display: 'block' }}>{x}</span>)}</p>}
        {!!social.length && <p>{social.map(([k, v]) => <a key={k} href={v} target="_blank" rel="noreferrer noopener" style={{ marginRight: 12, textTransform: 'capitalize' }}>{k}</a>)}</p>}
      </div>
      <div><h4>Products</h4><Link to="/real-estate">Real Estate Brokerage</Link><Link to="/construction">Construction Management</Link><Link to="/pricing">Pricing</Link></div>
      <div><h4>Company</h4><Link to="/contact">Book a demo</Link><Link to="/signup">Start free trial</Link><Link to="/login">Sign in</Link></div>
      <div><h4>Country</h4><CountrySwitch /></div>
      <div><h4>Legal</h4>{info.content.legal.map((d) => <Link key={d.slug} to={`/legal/${d.slug}`}>{d.title}</Link>)}<button className="llink" onClick={onCookies}>Cookie settings</button></div>
    </div><div style={{ width: '100%', marginTop: 18 }}>© {new Date().getFullYear()} {c.brand}</div></div></footer>
  );
}
const PRODUCT_LABELS = { real_estate: 'Real Estate Brokerage Management', construction: 'Construction Management' };

function ConsentBanner({ show, onClose }) {
  if (!show) return null;
  const pick = (v) => { setConsent(v); onClose(); };
  return (
    <div className="lconsent" role="dialog" aria-live="polite" aria-label="Cookie choice">
      <p>We would like to use optional analytics to learn which pages help visitors. No advertising, no selling of data. <Link to="/legal/privacy">Privacy policy</Link></p>
      <button className="lbtn sm" onClick={() => pick('denied')}>Decline</button>
      <button className="lbtn p sm" onClick={() => pick('granted')}>Accept analytics</button>
    </div>
  );
}

// ---------------------------------------------------------------- pages

function Home({ info }) {
  const c = info.content;
  const { country } = useCountry();
  const cc = country.copy || {};

  useTitle(c.seo.home.title, c.seo.home.description);

  return (
    <>
      {/* Premium Hero Section */}
      <section
        style={{
          position: "relative",
          overflow: "hidden",
          padding: "clamp(48px, 7vw, 85px) 0",
          background:
            "radial-gradient(ellipse at 82% 45%, rgba(59,130,246,0.12), transparent 48%)",
        }}
      >
        <div
          className="lwrap home-premium-grid"
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(0, 0.88fr) minmax(0, 1.12fr)",
            alignItems: "center",
            gap: "clamp(35px, 6vw, 90px)",
          }}
        >
          {/* LEFT CONTENT */}
          <div
            style={{
              width: "100%",
              maxWidth: "470px",
              position: "relative",
              zIndex: 2,
              padding: "5px 0",
            }}
          >
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "9px",
                padding: "8px 13px",
                marginBottom: "20px",
                border: "1px solid rgba(59,130,246,0.22)",
                borderRadius: "30px",
                background: "rgba(59,130,246,0.07)",
                fontSize: "12px",
                fontWeight: 600,
                letterSpacing: "0.3px",
              }}
            >
              <span
                style={{
                  width: "7px",
                  height: "7px",
                  borderRadius: "50%",
                  background: "#34d399",
                  boxShadow: "0 0 10px rgba(52,211,153,0.5)",
                }}
              />
              Smart tools for modern businesses
            </div>

            <h1
              style={{
                fontSize: "clamp(32px, 3.6vw, 48px)",
                lineHeight: 1.14,
                letterSpacing: "-1.5px",
                fontWeight: 750,
                margin: "0 0 18px",
                maxWidth: "450px",
                textWrap: "balance",
              }}
            >
              {cc.hero_title || c.hero_title}
            </h1>

            <p
              style={{
                fontSize: "15px",
                lineHeight: 1.8,
                opacity: 0.76,
                maxWidth: "410px",
                margin: "0 0 24px",
              }}
            >
              Manage properties, clients, and projects — all from one
              simple, powerful platform.
            </p>

            {/* Existing signup form */}
            <div style={{ maxWidth: "420px", width: "100%" }}>
              <EmailStart
                trialDays={info.trial_days}
                where="hero"
              />
            </div>

            {/* Short trust points */}
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: "10px 18px",
                marginTop: "17px",
                fontSize: "12px",
                lineHeight: 1.6,
                opacity: 0.78,
              }}
            >
              <span>✓ No credit card needed</span>
              <span>✓ Quick setup</span>
            </div>

            <Link
              className="llink2"
              to="/contact"
              onClick={() =>
                track("cta_book_demo", { where: "hero" })
              }
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "8px",
                marginTop: "22px",
                fontSize: "14px",
                fontWeight: 600,
                textDecoration: "none",
                transition: "gap 0.2s ease",
              }}
            >
              Book a personal demo <span>→</span>
            </Link>
          </div>

          {/* RIGHT VISUAL */}
          <div
            className="home-premium-visual"
            style={{
              position: "relative",
              width: "100%",
              minWidth: 0,
              transform: "translateX(12px)",
              animation: "homeVisualFloat 5s ease-in-out infinite",
            }}
          >
            {/* Soft background glow */}
            <div
              aria-hidden="true"
              style={{
                position: "absolute",
                inset: "10% -3% 5% 8%",
                borderRadius: "45%",
                background:
                  "radial-gradient(ellipse, rgba(59,130,246,0.18), transparent 70%)",
                filter: "blur(35px)",
                pointerEvents: "none",
              }}
            />

            {/* Keep your existing visual */}
            <div
              style={{
                position: "relative",
                zIndex: 1,
                width: "100%",
              }}
            >
              <HeroVisual />
            </div>
          </div>
        </div>

        {/* Responsive styling */}
        <style>{`
          @keyframes homeVisualFloat {
            0%, 100% {
              transform: translate3d(12px, 0, 0);
            }
            50% {
              transform: translate3d(12px, -7px, 0);
            }
          }

          .home-premium-grid {
            box-sizing: border-box;
          }

          .home-premium-grid > * {
            min-width: 0;
          }

          @media (max-width: 800px) {
            .home-premium-grid {
              grid-template-columns: minmax(0, 1fr) !important;
              gap: 34px !important;
            }

            .home-premium-visual {
              transform: none !important;
              animation: none !important;
              width: 100%;
            }
          }

          @media (max-width: 480px) {
            .home-premium-grid {
              gap: 24px !important;
            }
          }

          @media (prefers-reduced-motion: reduce) {
            .home-premium-visual {
              animation: none !important;
            }
          }
        `}</style>
      </section>

      {/* Existing sections — preserved */}
      <LogoStrip />
      <Outcomes />
      <Platform />

      <section className="alt">
        <div
          className="lwrap lsplit"
          style={{ alignItems: "center" }}
        >
          <div
            className="lmeetmock"
            aria-label="Example of a video meeting with a shared screen and the script beside it"
          >
            <div className="lmm-bar">
              <i />
              <i />
              <i />
              <span>Site walkthrough · 24:10 left</span>
            </div>

            <div className="lmm-body">
              <div className="lmm-stage">
                <div className="lmm-pen" />
                <span className="lmm-ptr" />
                <em>Presenting: floor plan</em>
              </div>

              <div className="lmm-side">
                <b>Script</b>
                <p>
                  Thank you for joining. Today I will show you the
                  floor plan, then the payment options.
                </p>
                <b>Captions</b>
                <p>“…this corner unit faces the park.”</p>
              </div>
            </div>

            <div className="lmm-ctl">
              <span>🎤</span>
              <span>📷</span>
              <span className="on">🖥️</span>
              <span>✏️</span>
              <span className="rec">⏺️</span>
            </div>
          </div>

          <div>
            <span className="ltag2">Meetings and calls</span>
            <h2 style={{ fontSize: 34, margin: "10px 0" }}>
              Show the property on a call, not just describe it.
            </h2>
            <p>
              Schedule a video meeting, send each person their own
              link by email, text message or WhatsApp, and start.
              Share your screen, point and draw on it, switch on
              live captions, and keep your call script beside you.
            </p>
            <ul className="lcheck">
              <li>
                Set the date, time and the longest length of every
                meeting
              </li>
              <li>Guests join from a link, with no account</li>
              <li>
                Record the meeting and the phone calls; recordings
                and transcripts stay in your own workspace
              </li>
              <li>
                See calls made, how many connected and the average
                call length
              </li>
            </ul>
            <p className="lfine">
              The pointer and pen are drawn on the shared screen.
              Browsers do not allow one person to take over another
              person's computer.
            </p>
            <Link
              className="lbtn p"
              to="/signup"
              onClick={() =>
                track("cta_start_trial", { where: "meetings" })
              }
            >
              Try meetings free for {info.trial_days} days
            </Link>
          </div>
        </div>
      </section>

      <CallNextSection />
      <LeakCalc trialDays={info.trial_days} />
      <CalcStrip />
      <Screens product={null} />

      <Voices
        testimonials={(c.testimonials || []).filter(
          (t) => !t.country || t.country === country.code
        )}
        trialDays={info.trial_days}
      />

      <section className="alt">
        <div className="lwrap">
          <div className="lsh">
            <h2>Two products, one platform</h2>
            <p>
              Pick the product your business needs. Shared sign-in,
              users, billing, reports and notifications; product
              modules stay separate.
            </p>
          </div>

          <div className="lprod">
            {["real_estate", "construction"].map((p) => (
              <Link
                key={p}
                className="lcard"
                to={PRODUCT_PATH[p]}
                onClick={() =>
                  track("product_page_view", { product: p })
                }
              >
                <span className="ltag2">
                  {p === "real_estate"
                    ? "For agencies & developers"
                    : "For contractors & builders"}
                </span>

                <h3>{c[p].title}</h3>
                <p>{c[p].subtitle}</p>

                <ul className="lcheck">
                  {c[p].features.slice(0, 4).map(([t]) => (
                    <li key={t}>{t}</li>
                  ))}
                </ul>

                <span className="lgo">
                  Explore{" "}
                  {p === "real_estate"
                    ? "Real Estate"
                    : "Construction"}{" "}
                  →
                </span>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section>
        <div className="lwrap">
          <div className="lsh">
            <h2>Up and running today</h2>
          </div>

          <div className="lgrid">
            {[
              [
                "Choose your product",
                "Real Estate Brokerage or Construction Management. A bundle gives you both.",
              ],
              [
                "Create your workspace",
                "Your company gets its own address and its own private database straight away.",
              ],
              [
                "Invite your team",
                "Email invitations with the right role for each person.",
              ],
              [
                "Pick a plan when ready",
                `Use the full ${info.trial_days}-day trial first. Pay by card or local transfer.`,
              ],
            ].map(([t, d], i) => (
              <div className="lcard" key={t}>
                <div className="lnum">{i + 1}</div>
                <h3>{t}</h3>
                <p>{d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <Faq faqs={[...(c.faqs || []), ...(cc.faqs || [])]} />
      <Band info={info} />
      <StickyCta trialDays={info.trial_days} />
    </>
  );
}


/** Email first: one field, and the sign-up form opens with it filled in. Nothing is stored until the person creates a workspace. */
function EmailStart({ trialDays, where }) {
  const nav = useNavigate();
  const [email, setEmail] = useState('');
  const go = (e) => { e.preventDefault(); track('cta_start_trial', { where }); nav(`/signup${email ? `?email=${encodeURIComponent(email.trim())}` : ''}`); };
  return (
    <form className="lstart" onSubmit={go}>
      <input type="email" inputMode="email" autoComplete="email" aria-label="Your work email" placeholder="Your work email" value={email} onChange={(e) => setEmail(e.target.value)} />
      <button className="lbtn p lg" type="submit">Start your {trialDays}-day free trial</button>
    </form>
  );
}

/** Tools the product really connects with. Shown as compatibility, never as partners or customers. */


function LogoStrip() {
  return (
    <section className="logo-marquee-section">
      <div className="logo-marquee-heading">
        <span>INTEGRATIONS</span>
        <h2>Works with your favorite tools</h2>
      </div>

      <div className="logo-marquee">
        <div className="logo-marquee-track">
          {[...BRANDS, ...BRANDS].map((b, index) => (
            <div className="logo-marquee-item" key={`${b.id}-${index}`}>
              <svg
                viewBox="0 0 24 24"
                width="26"
                height="26"
                role="img"
                aria-label={b.name}
              >
                <path d={b.path} fill="currentColor" />
              </svg>

              <span>{b.name}</span>
            </div>
          ))}
        </div>
      </div>

      <style>{`
        .logo-marquee-section {
          overflow: hidden;
          width: 100%;
          padding: 55px 0 45px;
          color: #fff;
          background: #000;
        }

        .logo-marquee-heading {
          text-align: center;
          padding: 0 20px;
          margin-bottom: 35px;
        }

        .logo-marquee-heading > span {
          display: block;
          margin-bottom: 12px;
          color: #aaa;
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 3px;
        }

        .logo-marquee-heading h2 {
          margin: 0;
          color: #fff;
          font-size: clamp(22px, 3vw, 34px);
          font-weight: 700;
          letter-spacing: -0.7px;
        }

        .logo-marquee {
          position: relative;
          overflow: hidden;
          width: 100%;
          background: #000;

          /* Fade at both edges */
          -webkit-mask-image: linear-gradient(
            90deg,
            transparent 0%,
            #000 8%,
            #000 92%,
            transparent 100%
          );
          mask-image: linear-gradient(
            90deg,
            transparent 0%,
            #000 8%,
            #000 92%,
            transparent 100%
          );
        }

        .logo-marquee-track {
          display: flex;
          align-items: center;
          width: max-content;
          animation: logoMarqueeMove 35s linear infinite;
          will-change: transform;
        }

        .logo-marquee-item {
          display: inline-flex;
          flex: 0 0 auto;
          align-items: center;
          justify-content: center;
          gap: 13px;
          min-width: 190px;
          padding: 24px 30px;
          color: #fff;
          white-space: nowrap;
          transition: opacity .25s ease;
        }

        .logo-marquee-item svg {
          flex-shrink: 0;
          color: #fff;
          transition: transform .25s ease;
        }

        .logo-marquee-item span {
          color: #fff;
          font-size: 16px;
          font-weight: 600;
        }

        .logo-marquee-item:hover {
          opacity: .7;
        }

        .logo-marquee-item:hover svg {
          transform: scale(1.15);
        }

        .logo-marquee:hover .logo-marquee-track {
          animation-play-state: paused;
        }

        @keyframes logoMarqueeMove {
          from {
            transform: translateX(0);
          }

          to {
            transform: translateX(-50%);
          }
        }

        @media (max-width: 600px) {
          .logo-marquee-section {
            padding: 40px 0 32px;
          }

          .logo-marquee-heading {
            margin-bottom: 22px;
          }

          .logo-marquee-item {
            min-width: 145px;
            gap: 10px;
            padding: 18px 20px;
          }

          .logo-marquee-item svg {
            width: 22px;
            height: 22px;
          }

          .logo-marquee-item span {
            font-size: 14px;
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .logo-marquee-track {
            animation-duration: 80s;
          }
        }
      `}</style>
    </section>
  );
}



function Outcomes() {
  const items = [
    "Never lose a lead",
    "Book more viewings",
    "Know your performance",
    "Keep finances clear",
  ];

  return (
    <section
      style={{
        padding: "90px 0",
        background: "#ffffff",
        color: "#000000",
      }}
    >
      <div className="lwrap">
        <div style={{ marginBottom: "48px" }}>
          <span
            style={{
              color: "#4f46e5",
              fontSize: "11px",
              fontWeight: 700,
              letterSpacing: "2px",
            }}
          >
            BUILT FOR BROKERAGES
          </span>

          <h2
            style={{
              margin: "18px 0 0",
              color: "#000000",
              fontSize: "clamp(36px, 5vw, 58px)",
              fontWeight: 750,
              letterSpacing: "-2px",
              lineHeight: 1.12,
            }}
          >
            Less admin.
            <br />
            <span style={{ color: "#4f46e5" }}>
              More closed deals.
            </span>
          </h2>
        </div>

        <div
          style={{
            borderTop: "1px solid rgba(0, 0, 0, 0.15)",
          }}
        >
          {items.map((item, index) => (
            <div
              key={item}
              className="outcomes-minimal-item"
              style={{
                display: "grid",
                gridTemplateColumns: "55px 1fr 30px",
                alignItems: "center",
                gap: "18px",
                padding: "23px 4px",
                borderBottom: "1px solid rgba(0, 0, 0, 0.15)",
                transition: "padding 0.25s ease",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.paddingLeft = "12px";
                e.currentTarget.style.paddingRight = "12px";
                e.currentTarget.querySelector(
                  ".outcomes-arrow"
                ).style.opacity = "1";
                e.currentTarget.querySelector(
                  ".outcomes-arrow"
                ).style.transform = "translate(0, 0)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.paddingLeft = "4px";
                e.currentTarget.style.paddingRight = "4px";
                e.currentTarget.querySelector(
                  ".outcomes-arrow"
                ).style.opacity = "0";
                e.currentTarget.querySelector(
                  ".outcomes-arrow"
                ).style.transform = "translate(-5px, 5px)";
              }}
            >
              <span
                style={{
                  color: "#4f46e5",
                  fontSize: "12px",
                  fontWeight: 600,
                }}
              >
                {String(index + 1).padStart(2, "0")}
              </span>

              <h3
                style={{
                  margin: 0,
                  color: "#000000",
                  fontSize: "clamp(18px, 2.3vw, 25px)",
                  fontWeight: 500,
                  letterSpacing: "-0.5px",
                }}
              >
                {item}
              </h3>

              <span
                className="outcomes-arrow"
                style={{
                  color: "#4f46e5",
                  fontSize: "21px",
                  opacity: 0,
                  transform: "translate(-5px, 5px)",
                  transition: "all 0.25s ease",
                  textAlign: "center",
                }}
              >
                ↗
              </span>
            </div>
          ))}
        </div>
      </div>

      <style>{`
        @media (max-width: 600px) {
          .outcomes-minimal-item {
            grid-template-columns: 32px 1fr 20px !important;
            gap: 10px !important;
            padding: 20px 2px !important;
          }

          .outcomes-minimal-item h3 {
            font-size: 17px !important;
          }

          .outcomes-arrow {
            opacity: 1 !important;
            transform: none !important;
          }
        }
      `}</style>
    </section>
  );
}



const COMMISSION = { PK: 250000, AE: 25000, US: 6000, UK: 4000, CA: 6000 };
/** An estimate from the visitor's own numbers. The starting values are placeholders to change, not statistics. */







function LeakCalc({ trialDays }) {
  const { country } = useCountry();
  const cur = country?.currency || "USD";

  const [v, setV] = useState({
    leads: 80,
    lost: 15,
    close: 3,
    commission: COMMISSION[country?.code] || 5000,
  });

  useEffect(() => {
    setV((x) => ({
      ...x,
      commission: COMMISSION[country?.code] || 5000,
    }));
  }, [cur, country?.code]);

  const n = (k) => Math.max(0, Number(v[k]) || 0);

  const lostDeals =
    ((n("leads") * n("lost")) / 100) * (n("close") / 100);

  const missedLeads = (n("leads") * n("lost")) / 100;
  const monthlyLoss = lostDeals * n("commission");

  const money = (x) =>
    new Intl.NumberFormat("en", {
      style: "currency",
      currency: cur,
      maximumFractionDigits: 0,
    }).format(Math.round(x));

  const field = (k, label, suffix, hint) => (
    <label key={k} htmlFor={`leak-${k}`} className="leak-field">
      <span className="leak-label">{label}</span>

      <div className="leak-input-wrap">
        <input
          id={`leak-${k}`}
          type="number"
          min="0"
          step="any"
          inputMode="decimal"
          value={v[k]}
          onChange={(e) =>
            setV((prev) => ({
              ...prev,
              [k]: e.target.value,
            }))
          }
        />

        {suffix && <span className="leak-suffix">{suffix}</span>}
      </div>

      {hint && <span className="leak-hint">{hint}</span>}
    </label>
  );

  const metrics = [
    {
      icon: "↗",
      value: missedLeads.toFixed(1),
      label: "Leads missed monthly",
    },
    {
      icon: "◎",
      value: lostDeals.toFixed(1),
      label: "Potential lost sales",
    },
  ];

  return (
    <section className="leak-section">
      <style>{`
        .leak-section {
          --purple: #6d5dfc;
          --purple-dark: #5141dc;
          --purple-light: #eeeaff;
          --ink: #111827;
          --muted: #596579;
          --card: #e5e7eb;
          --border: #d1d5db;

          position: relative;
          isolation: isolate;
          overflow: hidden;
          padding: clamp(55px, 8vw, 100px) 20px;
          background:
            radial-gradient(ellipse at 0% 0%, #f0edff 0%, transparent 32%),
            radial-gradient(ellipse at 100% 90%, #f0edff 0%, transparent 30%),
            #ffffff;
          color: var(--ink);
          font-family: inherit;
        }

        .leak-section *,
        .leak-section *::before,
        .leak-section *::after {
          box-sizing: border-box;
        }

        .leak-container {
          width: 100%;
          max-width: 1120px;
          margin: 0 auto;
        }

        /* Heading */

        .leak-heading {
          max-width: 760px;
          margin: 0 auto 48px;
          text-align: center;
          animation: leakEnter .7s ease both;
        }

        .leak-eyebrow {
          display: inline-flex;
          align-items: center;
          gap: 10px;
          padding: 10px 16px;
          border: 1px solid #ddd6fe;
          border-radius: 50px;
          background: #f5f3ff;
          color: #5141dc;
          font-size: 10px;
          font-weight: 850;
          letter-spacing: 1.7px;
          transition: transform .3s ease, box-shadow .3s ease;
        }

        .leak-eyebrow:hover {
          transform: translateY(-2px);
          box-shadow: 0 8px 22px rgba(109, 93, 252, .13);
        }

        .leak-dot {
          width: 8px;
          height: 8px;
          flex-shrink: 0;
          border-radius: 50%;
          background: var(--purple);
          box-shadow: 0 0 0 4px rgba(109, 93, 252, .13);
          animation: leakPulse 2s infinite;
        }

        .leak-title {
          margin: 23px 0 17px;
          color: #111827;
          font-size: clamp(32px, 5vw, 54px);
          font-weight: 850;
          line-height: 1.12;
          letter-spacing: -1.8px;
        }

        .leak-title span {
          display: block;
          margin-top: 7px;
          background: linear-gradient(100deg, #5141dc, #8b5cf6, #6d5dfc);
          -webkit-background-clip: text;
          background-clip: text;
          -webkit-text-fill-color: transparent;
        }

        .leak-description {
          max-width: 610px;
          margin: 0 auto;
          color: #596579;
          font-size: 15px;
          line-height: 1.9;
        }

        /* Main cards */

        .leak-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          align-items: stretch;
          gap: 24px;
        }

        .leak-card {
          min-width: 0;
          padding: clamp(21px, 3vw, 32px);
          border: 1px solid #d1d5db;
          border-radius: 22px;
          color: #111827;
          animation: leakCardEnter .75s ease both;
          transition:
            transform .35s ease,
            border-color .35s ease,
            box-shadow .35s ease;
        }

        .leak-input-card {
          background: linear-gradient(145deg, #f3f4f6 0%, #e5e7eb 100%);
          box-shadow:
            0 12px 32px rgba(31, 41, 55, .07),
            inset 0 1px 0 rgba(255, 255, 255, .9);
        }

        .leak-result-card {
          display: flex;
          flex-direction: column;
          background:
            radial-gradient(
              ellipse at 100% 0%,
              rgba(196, 181, 253, .35),
              transparent 45%
            ),
            linear-gradient(145deg, #f3f4f6 0%, #e5e7eb 100%);
          box-shadow:
            0 12px 32px rgba(31, 41, 55, .08),
            inset 0 1px 0 rgba(255, 255, 255, .9);
          animation-delay: .12s;
        }

        .leak-card:hover {
          transform: translateY(-6px);
          border-color: #a5a0ff;
          box-shadow:
            0 22px 45px rgba(31, 41, 55, .12),
            0 0 0 3px rgba(109, 93, 252, .05);
        }

        .leak-card-header {
          display: flex;
          align-items: center;
          gap: 14px;
          margin-bottom: 30px;
        }

        .leak-icon-box,
        .leak-result-icon {
          display: grid;
          place-items: center;
          flex-shrink: 0;
          color: #5b4be7;
          border: 1px solid #d8d1ff;
          background: linear-gradient(135deg, #f1eeff, #e4deff);
          transition: transform .35s ease, box-shadow .35s ease;
        }

        .leak-icon-box {
          width: 48px;
          height: 48px;
          border-radius: 15px;
        }

        .leak-card:hover .leak-icon-box,
        .leak-card:hover .leak-result-icon {
          transform: rotate(-4deg) scale(1.06);
          box-shadow: 0 7px 18px rgba(109, 93, 252, .16);
        }

        .leak-card-title {
          margin: 0;
          color: #111827;
          font-size: 18px;
          font-weight: 800;
        }

        .leak-card-subtitle {
          margin: 5px 0 0;
          color: #596579;
          font-size: 12px;
          line-height: 1.7;
        }

        /* Input fields */

        .leak-fields {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 24px 18px;
        }

        .leak-field {
          display: flex;
          flex-direction: column;
          gap: 9px;
          min-width: 0;
        }

        .leak-label {
          color: #1f2937;
          font-size: 13px;
          font-weight: 750;
          line-height: 1.5;
        }

        .leak-input-wrap {
          display: flex;
          align-items: center;
          min-width: 0;
          height: 52px;
          padding: 0 14px;
          border: 1.5px solid #d1d5db;
          border-radius: 12px;
          background: #ffffff;
          transition:
            border-color .25s ease,
            box-shadow .25s ease,
            transform .25s ease;
        }

        .leak-input-wrap:hover {
          border-color: #a5a0ff;
        }

        .leak-input-wrap:focus-within {
          border-color: var(--purple);
          box-shadow: 0 0 0 4px rgba(109, 93, 252, .12);
          transform: translateY(-2px);
        }

        .leak-input-wrap input {
          width: 100%;
          min-width: 0;
          border: none;
          outline: none;
          background: transparent;
          color: #111827;
          font-size: 16px;
          font-weight: 750;
          font-family: inherit;
        }

        .leak-input-wrap input:focus {
          outline: none;
        }

        .leak-input-wrap input::-webkit-inner-spin-button,
        .leak-input-wrap input::-webkit-outer-spin-button {
          opacity: .7;
        }

        .leak-suffix {
          margin-left: 8px;
          color: #5141dc;
          font-size: 12px;
          font-weight: 800;
        }

        .leak-hint {
          color: #687386;
          font-size: 11px;
          line-height: 1.6;
        }

        .leak-note {
          display: flex;
          align-items: flex-start;
          gap: 10px;
          margin-top: 28px;
          padding: 15px;
          border: 1px solid #d9d3ff;
          border-radius: 13px;
          background: linear-gradient(120deg, #f5f3ff, #f9f8ff);
          color: #4b5563;
          font-size: 11px;
          line-height: 1.8;
        }

        .leak-note-icon {
          flex-shrink: 0;
          color: #5b4be7;
          font-size: 16px;
        }

        /* Results */

        .leak-result-top {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
        }

        .leak-result-label {
          color: #596579;
          font-size: 10px;
          font-weight: 850;
          letter-spacing: 1.3px;
          line-height: 1.7;
        }

        .leak-result-icon {
          width: 43px;
          height: 43px;
          border-radius: 13px;
        }

        .leak-amount {
          margin-top: 24px;
          overflow-wrap: anywhere;
          color: #111827;
          font-size: clamp(34px, 4.5vw, 48px);
          font-weight: 850;
          line-height: 1.15;
          letter-spacing: -1.5px;
          font-variant-numeric: tabular-nums;
          animation: leakAmountEnter .35s ease both;
        }

        .leak-result-description {
          max-width: 340px;
          margin: 13px 0 0;
          color: #596579;
          font-size: 12px;
          line-height: 1.9;
        }

        .leak-divider {
          height: 1px;
          margin: 27px 0 22px;
          background: linear-gradient(90deg, #a5a0ff, #d1d5db, transparent);
        }

        /* Metrics */

        .leak-metrics {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 12px;
        }

        .leak-metric-card {
          display: flex;
          align-items: flex-start;
          gap: 10px;
          min-width: 0;
          padding: 15px 12px;
          border: 1px solid #d1d5db;
          border-radius: 13px;
          background: linear-gradient(145deg, #f9fafb, #e5e7eb);
          transition:
            transform .3s ease,
            box-shadow .3s ease,
            border-color .3s ease,
            background .3s ease;
        }

        .leak-metric-card:hover {
          transform: translateY(-4px);
          border-color: #aaa1ff;
          background: #ffffff;
          box-shadow: 0 10px 22px rgba(31, 41, 55, .08);
        }

        .leak-metric-icon {
          display: grid;
          place-items: center;
          width: 29px;
          height: 29px;
          flex-shrink: 0;
          border-radius: 9px;
          background: #ede9fe;
          color: #5b4be7;
          font-size: 16px;
          font-weight: 800;
        }

        .leak-metric-value {
          display: block;
          overflow-wrap: anywhere;
          color: #111827;
          font-size: 20px;
          font-weight: 800;
          line-height: 1.3;
        }

        .leak-metric-label {
          display: block;
          margin-top: 5px;
          color: #596579;
          font-size: 10px;
          line-height: 1.6;
        }

        /* Insight */

        .leak-insight {
          display: flex;
          align-items: flex-start;
          gap: 11px;
          margin-top: 22px;
          padding: 15px;
          border: 1px solid #d9d3ff;
          border-radius: 13px;
          background: linear-gradient(120deg, #f5f3ff, #eeebff);
          transition: border-color .25s ease, transform .25s ease;
        }

        .leak-insight:hover {
          transform: translateY(-2px);
          border-color: #aaa1ff;
        }

        .leak-check {
          display: grid;
          place-items: center;
          width: 22px;
          height: 22px;
          flex-shrink: 0;
          border-radius: 50%;
          background: #6d5dfc;
          color: #ffffff;
          font-size: 12px;
          font-weight: 900;
        }

        .leak-insight p {
          margin: 0;
          color: #374151;
          font-size: 11px;
          line-height: 1.8;
        }

        /* CTA */

        .leak-cta {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 14px;
          width: 100%;
          min-height: 55px;
          margin-top: 24px;
          padding: 12px 16px;
          border: 1px solid #8d81ff;
          border-radius: 13px;
          background: linear-gradient(110deg, #7565f5, #5141dc, #806bff);
          background-size: 200% 100%;
          color: #ffffff;
          font-size: 13px;
          font-weight: 750;
          line-height: 1.5;
          text-decoration: none;
          box-shadow: 0 8px 22px rgba(109, 93, 252, .22);
          transition:
            transform .3s ease,
            box-shadow .3s ease,
            background-position .4s ease;
        }

        .leak-cta:hover {
          transform: translateY(-3px);
          background-position: 100% 0;
          box-shadow: 0 14px 28px rgba(109, 93, 252, .32);
        }

        .leak-cta:active {
          transform: scale(.985);
        }

        .leak-cta:focus-visible {
          outline: 3px solid #b9b0ff;
          outline-offset: 4px;
        }

        .leak-cta-arrow {
          display: grid;
          place-items: center;
          width: 30px;
          height: 30px;
          flex-shrink: 0;
          border-radius: 9px;
          background: rgba(255, 255, 255, .18);
          font-size: 19px;
          transition: transform .3s ease;
        }

        .leak-cta:hover .leak-cta-arrow {
          transform: translateX(5px);
        }

        .leak-cta-caption {
          margin: 12px 0 0;
          color: #687386;
          font-size: 10px;
          line-height: 1.7;
          text-align: center;
        }

        /* Disclaimer */

        .leak-disclaimer {
          display: flex;
          align-items: center;
          justify-content: center;
          flex-wrap: wrap;
          gap: 12px;
          margin-top: 34px;
          color: #687386;
          font-size: 11px;
          font-weight: 500;
          line-height: 1.8;
          text-align: center;
        }

        .leak-disclaimer-line {
          width: 25px;
          height: 1px;
          background: #c4c8d2;
        }

        /* Animations */

        @keyframes leakEnter {
          from {
            opacity: 0;
            transform: translateY(18px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        @keyframes leakCardEnter {
          from {
            opacity: 0;
            transform: translateY(22px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        @keyframes leakAmountEnter {
          from {
            opacity: .4;
            transform: translateY(6px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        @keyframes leakPulse {
          0%, 100% {
            box-shadow: 0 0 0 3px rgba(109, 93, 252, .15);
          }
          50% {
            box-shadow: 0 0 0 7px rgba(109, 93, 252, .04);
          }
        }

        /* Tablet */

        @media (max-width: 760px) {
          .leak-grid {
            grid-template-columns: minmax(0, 1fr);
          }

          .leak-heading {
            margin-bottom: 32px;
          }

          .leak-title {
            letter-spacing: -1px;
          }
        }

        /* Mobile */

        @media (max-width: 460px) {
          .leak-section {
            padding-right: 14px;
            padding-left: 14px;
          }

          .leak-card {
            padding: 19px 16px;
            border-radius: 18px;
          }

          .leak-fields {
            grid-template-columns: minmax(0, 1fr);
            gap: 19px;
          }

          .leak-metrics {
            gap: 8px;
          }

          .leak-metric-card {
            flex-direction: column;
            padding: 12px 10px;
          }

          .leak-metric-value {
            font-size: 18px;
          }

          .leak-result-label {
            font-size: 9px;
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .leak-section *,
          .leak-section *::before,
          .leak-section *::after {
            animation: none !important;
            transition: none !important;
          }
        }
      `}</style>

      <div className="leak-container">
        <div className="leak-heading">
          <span className="leak-eyebrow">
            <span className="leak-dot" />
            KNOW YOUR NUMBERS
          </span>

          <h2 className="leak-title">
            How much are slow
            <span>follow-ups costing you?</span>
          </h2>

          <p className="leak-description">
            Every missed follow-up could mean a missed commission.
            Enter your numbers and see your estimated monthly impact
            in real time.
          </p>
        </div>

        <div className="leak-grid">
          {/* Input card */}
          <div className="leak-card leak-input-card">
            <div className="leak-card-header">
              <div className="leak-icon-box">
                <svg
                  width="24"
                  height="24"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  aria-hidden="true"
                >
                  <rect x="4" y="3" width="16" height="18" rx="3" />
                  <path d="M8 7h8M8 11h2m4 0h2M8 15h2m4 0h2" />
                </svg>
              </div>

              <div>
                <h3 className="leak-card-title">Your business numbers</h3>
                <p className="leak-card-subtitle">
                  Adjust the values to match your business.
                </p>
              </div>
            </div>

            <div className="leak-fields">
              {field(
                "leads",
                "New leads per month",
                "",
                "Total enquiries received monthly"
              )}

              {field(
                "lost",
                "Leads missed or not followed up",
                "%",
                "Estimated percentage of leads"
              )}

              {field(
                "close",
                "Typical conversion rate",
                "%",
                "Percentage of leads that become sales"
              )}

              {field(
                "commission",
                "Average commission per sale",
                cur,
                "Your average commission amount"
              )}
            </div>

            <div className="leak-note">
              <span className="leak-note-icon">ⓘ</span>
              <span>
                Starting values are examples. Use your own numbers
                for a more relevant estimate.
              </span>
            </div>
          </div>

          {/* Results card */}
          <div className="leak-card leak-result-card" aria-live="polite">
            <div className="leak-result-top">
              <span className="leak-result-label">
                YOUR ESTIMATED MONTHLY LOSS
              </span>

              <span className="leak-result-icon">
                <svg
                  width="23"
                  height="23"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  aria-hidden="true"
                >
                  <path d="M3 17l6-6 4 4 8-9" />
                  <path d="M15 6h6v6" />
                </svg>
              </span>
            </div>

            <div className="leak-amount" key={`${cur}-${monthlyLoss}`}>
              {money(monthlyLoss)}
            </div>

            <p className="leak-result-description">
              Estimated commission potentially slipping away every
              month due to missed follow-ups.
            </p>

            <div className="leak-divider" />

            <div className="leak-metrics">
              {metrics.map((item) => (
                <div className="leak-metric-card" key={item.label}>
                  <span className="leak-metric-icon">{item.icon}</span>

                  <div style={{ minWidth: 0 }}>
                    <strong className="leak-metric-value">
                      {item.value}
                    </strong>
                    <span className="leak-metric-label">{item.label}</span>
                  </div>
                </div>
              ))}
            </div>

            <div className="leak-insight">
              <span className="leak-check">✓</span>
              <p>
                Consistent follow-ups help your team keep track of
                leads and follow-up opportunities.
              </p>
            </div>

            <Link
              to="/signup"
              className="leak-cta"
              onClick={() =>
                track("cta_start_trial", {
                  where: "leak_calc",
                })
              }
            >
              <span>Start your {trialDays}-day free trial</span>
              <span className="leak-cta-arrow">→</span>
            </Link>

            <p className="leak-cta-caption">
              Explore a smarter way to manage your leads.
            </p>
          </div>
        </div>

        <div className="leak-disclaimer">
          <span className="leak-disclaimer-line" />
          An estimate based on the numbers you enter — not a guarantee.
          <span className="leak-disclaimer-line" />
        </div>
      </div>
    </section>
  );
}





/** Real, permitted customer quotes entered in the console. Until there are some, say what an early customer gets instead. */
function Voices({ testimonials, trialDays }) {
  if (testimonials.length) {
    const [lead, ...rest] = testimonials;
    return (
      <section><div className="lwrap">
        <div className="lsh"><h2>What customers say</h2></div>
        <figure className="lvoice"><blockquote>“{lead.quote}”</blockquote><figcaption><b>{lead.name}</b>{lead.role ? `, ${lead.role}` : ''}<span>{lead.company}</span></figcaption></figure>
        {!!rest.length && <div className="lgrid" style={{ marginTop: 18 }}>{rest.map((t, i) => <blockquote key={i} className="lcard lquote" style={{ margin: 0 }}>“{t.quote}”<footer>{t.name}{t.role ? `, ${t.role}` : ''} · {t.company}</footer></blockquote>)}</div>}
      </div></section>
    );
  }
  return (
    <section><div className="lwrap">
      <div className="lfound">
        <div>
          <span className="ltag2">Founding customers</span>
          <h2 style={{ fontSize: 32, margin: '10px 0' }}>Be one of the first teams on it.</h2>
          <p>We are onboarding our first customers personally. You get the full {trialDays}-day trial, help moving your contacts and listings across, and a direct line to the people who build it.</p>
          <p className="lfine">When you are happy and say we may, we will publish your story here. Only real, approved quotes are ever shown on this page.</p>
        </div>
        <div className="lfound-c"><Link className="lbtn p lg" to="/contact" onClick={() => track('cta_founding_customer', { where: 'voices' })}>Talk to us about onboarding</Link><Link className="lbtn lg" to="/signup" onClick={() => track('cta_start_trial', { where: 'voices' })}>Or start the free trial</Link></div>
      </div>
    </div></section>
  );
}

/** A slim bar that appears after the visitor has scrolled past the first screen. */
function StickyCta({ trialDays }) {
  const [show, setShow] = useState(false);
  useEffect(() => { const h = () => setShow(window.scrollY > 700); h(); window.addEventListener('scroll', h, { passive: true }); return () => window.removeEventListener('scroll', h); }, []);
  return (
    <div className={`lsticky ${show ? 'on' : ''}`} aria-hidden={!show}>
      <span>Free for {trialDays} days. No card needed.</span>
      <Link className="lbtn p sm" to="/signup" tabIndex={show ? 0 : -1} onClick={() => track('cta_start_trial', { where: 'sticky' })}>Start free trial</Link>
      <Link className="lbtn sm" to="/contact" tabIndex={show ? 0 : -1} onClick={() => track('cta_book_demo', { where: 'sticky' })}>Book a demo</Link>
    </div>
  );
}

/** The product at the top of the page: a real screenshot of the visitor's country when there is one, otherwise a drawn example. */
function HeroVisual() {
  const { country } = useCountry();
  const file = country.code === 'PK' ? 're-dashboard.png' : `re-dashboard-${country.code.toLowerCase()}.png`;
  const [ok, setOk] = useState(true);
  useEffect(() => setOk(true), [file]);
  return (
    <div className="lhero2v">
      <div className="lframe" role="img" aria-label="The Agentify dashboard">
        <div className="lframe-bar"><i /><i /><i /><span>app.agentify</span></div>
        {ok ? <img src={`/marketing/${file}`} alt="" onError={() => setOk(false)} fetchPriority="high" /> : (
          <div className="lframe-mock"><b>Today</b><div className="lmk-row"><span>New leads</span><em>12</em></div><div className="lmk-row"><span>Follow-ups due</span><em>7</em></div><div className="lmk-row"><span>Viewings this week</span><em>5</em></div><div className="lmk-bars"><i style={{ height: '40%' }} /><i style={{ height: '65%' }} /><i style={{ height: '50%' }} /><i style={{ height: '85%' }} /><i style={{ height: '70%' }} /></div><small>Example layout</small></div>)}
      </div>
      <div className="lfloat lfloat-a" aria-hidden><b>Call next</b><span>Follow-up due 2 days ago</span></div>
      <div className="lfloat lfloat-b" aria-hidden><b>Meeting at 3:00</b><span>Link sent on WhatsApp</span></div>
    </div>
  );
}

/** What is in the platform, in the order a brokerage uses it. Only things the product really does. */

const PLATFORM = [
  [
    "📞",
    "Call next dialer",
    "Prioritize leads, log calls and schedule follow-ups.",
  ],
  [
    "🎥",
    "Video meetings",
    "Meet buyers with screen sharing and live annotations.",
  ],
  [
    "✦",
    "AI assistants",
    "Use Claude and ChatGPT to explore data and create listing content.",
  ],
  [
    "🌐",
    "Property website",
    "Showcase listings and capture enquiries on your own domain.",
  ],
  [
    "📅",
    "Appointments",
    "Manage viewings and sync meetings with Google Calendar.",
  ],
  [
    "↗",
    "Portals & social",
    "Share properties across social media and supported portals.",
  ],
];

function Platform() {
  return (
    <section
      style={{
        padding: "90px 0",
        background: "#ffffff",
        color: "#111827",
      }}
    >
      <div className="lwrap">
        {/* Heading */}
        <div
          style={{
            maxWidth: "650px",
            marginBottom: "42px",
          }}
        >
          <span
            style={{
              display: "inline-block",
              marginBottom: "15px",
              color: "#4f46e5",
              fontSize: "11px",
              fontWeight: 700,
              letterSpacing: "2px",
            }}
          >
            ONE CONNECTED PLATFORM
          </span>

          <h2
            style={{
              margin: "0 0 14px",
              color: "#111827",
              fontSize: "clamp(32px, 4vw, 48px)",
              fontWeight: 750,
              letterSpacing: "-1.8px",
              lineHeight: 1.15,
            }}
          >
            Everything your  Needs.
            <span style={{ color: "#4f46e5" }}>
              {" "}All in one place.
            </span>
          </h2>

          <p
            style={{
              margin: 0,
              maxWidth: "520px",
              color: "#6b7280",
              fontSize: "15px",
              lineHeight: 1.8,
            }}
          >
            Manage conversations, appointments, marketing and property
            enquiries from one connected workspace.
          </p>
        </div>

        {/* Features */}
        <div className="platform-grid">
          {PLATFORM.map(([icon, title, description], index) => (
            <article
              className="platform-card"
              key={title}
            >
              <div className="platform-card-top">
                <span className="platform-icon">
                  {icon}
                </span>

                <span className="platform-index">
                  0{index + 1}
                </span>
              </div>

              <h3>{title}</h3>

              <p>{description}</p>

              <div className="platform-card-bottom">
                <span>Explore feature</span>
                <span className="platform-arrow">↗</span>
              </div>
            </article>
          ))}
        </div>
      </div>

      <style>{`
        .platform-grid {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 18px;
        }

        .platform-card {
          min-width: 0;
          display: flex;
          flex-direction: column;
          padding: 25px;
          border: 1px solid #000000;
          border-radius: 14px;
          background: #ffffff;
          transition:
            border-color 0.25s ease,
            transform 0.25s ease,
            box-shadow 0.25s ease;
        }

        .platform-card:hover {
          transform: translateY(-4px);
          border-color: #c7d2fe;
          box-shadow: 0 12px 30px rgba(30, 41, 59, 0.07);
        }

        .platform-card-top {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 25px;
        }

        .platform-icon {
          display: grid;
          place-items: center;
          width: 44px;
          height: 44px;
          border-radius: 12px;
          background: #eef2ff;
          color: #4f46e5;
          font-size: 21px;
        }

        .platform-index {
          color: #9ca3af;
          font-size: 11px;
          font-weight: 600;
          letter-spacing: 1px;
        }

        .platform-card h3 {
          margin: 0 0 9px;
          color: #111827;
          font-size: 18px;
          font-weight: 650;
          letter-spacing: -0.4px;
        }

        .platform-card p {
          flex: 1;
          margin: 0 0 22px;
          color: #6b7280;
          font-size: 13px;
          line-height: 1.8;
        }

        .platform-card-bottom {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
          padding-top: 15px;
          border-top: 1px solid #f0f1f4;
          color: #4f46e5;
          font-size: 12px;
          font-weight: 600;
        }

        .platform-arrow {
          font-size: 17px;
          transition: transform 0.25s ease;
        }

        .platform-card:hover .platform-arrow {
          transform: translate(3px, -3px);
        }

        @media (max-width: 900px) {
          .platform-grid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 14px;
          }
        }

        @media (max-width: 560px) {
          .platform-grid {
            grid-template-columns: 1fr;
            gap: 12px;
          }

          .platform-card {
            padding: 21px;
          }

          .platform-card-top {
            margin-bottom: 19px;
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .platform-card,
          .platform-arrow {
            transition: none;
          }
        }
      `}</style>
    </section>
  );
}


// Screenshots come from a demo workspace in each country, so a visitor never sees another country's currency.
const COUNTRY_SCREENS = (code) => ({
  real_estate: [[`re-dashboard-${code}.png`, 'Dashboard with sales, collections and follow-ups'], [`re-sale-${code}.png`, 'A sale with its payment schedule']],
  construction: [],
});
/** What the CRM does for every lead, and the free website. No customer quotes or numbers are made up here. */




function CallNextSection() {
  const { country } = useCountry();
  const cc = country?.copy || {};

  const rows = [
    ["PS", "Priya Shah", "Follow-up was due 2 days ago", "High priority"],
    ["DB", "Daniel Brooks", "New lead, not called yet", ""],
    ["OH", "Omar Haddad", "No contact for 9 days", ""],
  ];

  return (
    <>
      {/* TOP SECTION — CALL NEXT */}
      <section className="call-next-section">
        <div className="lwrap lsplit call-next-layout">
          <div className="call-next-copy">
            <span className="call-next-eyebrow">
              <span className="call-next-dot" />
              NEVER LOSE A LEAD
            </span>

            <h2 className="call-next-title">
              No lead goes cold.
              <span>Every buyer gets a follow-up.</span>
            </h2>

            <p className="call-next-description">
              A real estate CRM with a call-next assistant: it ranks
              the people who most need a phone call right now and tells
              you why, so the first call goes to the lead that matters most.
            </p>

            <div className="call-next-note">
              <span className="call-next-check">✓</span>
              Calls, outcomes and follow-ups in one place
            </div>

            {cc.calls && (
              <p className="call-next-fine">{cc.calls}</p>
            )}
          </div>

          {/* LEADS DASHBOARD */}
          <div
            className="call-dashboard"
            aria-label="Example of the call-next list"
          >
            <div className="call-dashboard-heading">
              <div>
                <strong>Call next</strong>
                <span>Your priority leads</span>
              </div>
              <span className="call-count">3 leads</span>
            </div>

            {rows.map(([initials, name, reason, tag]) => (
              <div className="call-lead-row" key={name}>
                <div className="call-avatar">{initials}</div>

                <div className="call-lead-info">
                  <strong>{name}</strong>
                  <span>{reason}</span>
                </div>

                {tag ? (
                  <span className="call-priority">{tag}</span>
                ) : (
                  <span className="call-action">Call ↗</span>
                )}
              </div>
            ))}

            <div className="call-dashboard-footer">
              <span>✓</span>
              Every outcome sets the next follow-up
            </div>
          </div>
        </div>
      </section>

      {/* BOTTOM SECTION — DARK THEME */}
      <section className="property-website-section">
        <div className="lwrap property-center-content">
          <span className="property-center-eyebrow">
            <span className="property-eyebrow-line" />
            INCLUDED WITH EVERY PLAN
            <span className="property-eyebrow-line" />
          </span>

          <h2 className="property-center-title">
            You pay for the CRM.
            <span>Your property website is included.</span>
          </h2>
{/* 
          <p className="property-center-description">
            Every plan comes with a public website for your listings,
            your own domain, and the calculators your buyers expect.
            No separate website bill.
          </p> */}

          {Array.isArray(cc.works_with) &&
            cc.works_with.length > 0 && (
              <div className="property-center-chips">
                {cc.works_with.map((item, index) => (
                  <span
                    className="property-center-chip"
                    key={item}
                    style={{ "--chip-index": index }}
                  >
                    <span className="property-chip-check">✓</span>
                    {item}
                  </span>
                ))}
              </div>
            )}

          <div className="property-center-signin">
            <span className="property-signin-icon">✓</span>
            <div>
              <strong>Simple and secure sign-in</strong>
              <span>Sign in with email, Google or Apple.</span>
            </div>
          </div>

          <div className="property-center-footer">
            <span />
            Built for modern real estate teams
            <span />
          </div>
        </div>
      </section>

      {/* STYLES */}
      <style>{`
        /* =========================
           TOP SECTION — UNCHANGED
        ========================= */

        .call-next-section {
          padding: 90px 0;
          overflow: hidden;
          background: #ffffff;
          color: #111827;
        }

        .call-next-layout {
          align-items: center;
          gap: 50px;
        }

        .call-next-copy {
          flex: 1;
          min-width: 0;
        }

        .call-next-eyebrow {
          display: inline-flex;
          align-items: center;
          gap: 9px;
          color: #4f46e5;
          font-size: 11px;
          font-weight: 750;
          letter-spacing: 1.8px;
        }

        .call-next-dot {
          width: 8px;
          height: 8px;
          flex-shrink: 0;
          border-radius: 50%;
          background: #4f46e5;
          box-shadow: 0 0 0 4px #eef2ff;
        }

        .call-next-title {
          margin: 20px 0 18px;
          color: #111827;
          font-size: clamp(34px, 4vw, 48px);
          font-weight: 750;
          line-height: 1.13;
          letter-spacing: -1.8px;
        }

        .call-next-title span {
          display: block;
          color: #4f46e5;
        }

        .call-next-description {
          max-width: 490px;
          margin: 0;
          color: #6b7280;
          font-size: 15px;
          line-height: 1.9;
        }

        .call-next-note {
          display: flex;
          align-items: center;
          gap: 10px;
          margin-top: 25px;
          color: #374151;
          font-size: 13px;
        }

        .call-next-check {
          display: grid;
          place-items: center;
          width: 24px;
          height: 24px;
          flex-shrink: 0;
          border-radius: 50%;
          background: #eef2ff;
          color: #4f46e5;
          font-weight: 700;
        }

        .call-next-fine {
          margin-top: 18px;
          color: #9ca3af;
          font-size: 12px;
        }

        /* Dashboard */

        .call-dashboard {
          flex: 1;
          min-width: 0;
          padding: 22px;
          border: 1.5px solid #111827;
          border-radius: 18px;
          background: #ffffff;
          box-shadow: 0 16px 45px rgba(15, 23, 42, 0.07);
          animation: callFadeUp 0.7s ease both;
          transition: transform 0.3s ease, box-shadow 0.3s ease;
        }

        .call-dashboard:hover {
          transform: translateY(-5px);
          box-shadow: 0 25px 55px rgba(15, 23, 42, 0.13);
        }

        .call-dashboard-heading {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          margin-bottom: 18px;
        }

        .call-dashboard-heading strong {
          display: block;
          color: #111827;
          font-size: 17px;
          font-weight: 750;
        }

        .call-dashboard-heading > div > span {
          display: block;
          margin-top: 5px;
          color: #6b7280;
          font-size: 12px;
        }

        .call-count {
          padding: 7px 10px;
          border-radius: 7px;
          background: #eef2ff;
          color: #4f46e5;
          font-size: 11px;
          font-weight: 650;
          white-space: nowrap;
        }

        .call-lead-row {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 16px 0;
          border-top: 1px solid #e5e7eb;
          transition: padding 0.25s ease, background 0.25s ease;
        }

        .call-lead-row:hover {
          padding-right: 7px;
          padding-left: 7px;
          background: #fafaff;
        }

        .call-avatar {
          display: grid;
          place-items: center;
          width: 42px;
          height: 42px;
          flex-shrink: 0;
          border: 1px solid #d1d5db;
          border-radius: 12px;
          background: #f3f4f6;
          color: #111827;
          font-size: 12px;
          font-weight: 700;
        }

        .call-lead-info {
          flex: 1;
          min-width: 0;
        }

        .call-lead-info strong {
          display: block;
          margin-bottom: 5px;
          color: #111827;
          font-size: 13px;
          font-weight: 650;
        }

        .call-lead-info > span {
          display: block;
          color: #6b7280;
          font-size: 11px;
          line-height: 1.5;
        }

        .call-priority {
          padding: 6px 8px;
          border: 1px solid #d1d5db;
          border-radius: 6px;
          color: #374151;
          font-size: 10px;
          white-space: nowrap;
        }

        .call-action {
          color: #4f46e5;
          font-size: 12px;
          font-weight: 650;
          white-space: nowrap;
          transition: transform 0.2s ease;
        }

        .call-lead-row:hover .call-action {
          transform: translateX(3px);
        }

        .call-dashboard-footer {
          display: flex;
          align-items: center;
          gap: 9px;
          margin-top: 8px;
          padding: 13px 12px;
          border-radius: 9px;
          background: #f8fafc;
          color: #4b5563;
          font-size: 11px;
        }

        .call-dashboard-footer > span {
          color: #4f46e5;
        }

        /* =========================
           BOTTOM SECTION — DARK
        ========================= */

        .property-website-section {
          position: relative;
          padding: 100px 20px;
          overflow: hidden;
          border-top: 1px solid #252b43;
          background:
            radial-gradient(
              ellipse at 50% 0%,
              rgba(99, 102, 241, 0.22),
              transparent 60%
            ),
            linear-gradient(
              135deg,
              #101426 0%,
              #171b32 55%,
              #0c1020 100%
            );
          color: #f8fafc;
        }

        .property-center-content {
          position: relative;
          display: flex;
          flex-direction: column;
          align-items: center;
          max-width: 850px;
          margin: 0 auto;
          text-align: center;
          animation: propertyCenterReveal 0.8s ease both;
        }

        .property-center-eyebrow {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 12px;
          color: #a5b4fc;
          font-size: 11px;
          font-weight: 750;
          letter-spacing: 2px;
        }

        .property-eyebrow-line {
          display: inline-block;
          width: 24px;
          height: 2px;
          border-radius: 10px;
          background: #818cf8;
          transition: width 0.3s ease;
        }

        .property-center-eyebrow:hover .property-eyebrow-line {
          width: 38px;
        }

        .property-center-title {
          max-width: 800px;
          margin: 24px 0 18px;
          color: #f8fafc;
          font-size: clamp(34px, 5vw, 54px);
          font-weight: 800;
          line-height: 1.12;
          letter-spacing: -2px;
        }

        .property-center-title span {
          display: block;
          margin-top: 7px;
          background: linear-gradient(
            90deg,
            #a5b4fc,
            #818cf8,
            #c4b5fd
          );
          background-clip: text;
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
        }

        .property-center-description {
          max-width: 620px;
          margin: 0;
          color: #cbd5e1;
          font-size: 15px;
          line-height: 1.9;
        }

        .property-center-chips {
          display: flex;
          justify-content: center;
          flex-wrap: wrap;
          gap: 12px;
          margin-top: 30px;
        }

        .property-center-chip {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          padding: 11px 16px;
          border: 1px solid #343b58;
          border-radius: 10px;
          background: rgba(255, 255, 255, 0.045);
          color: #e2e8f0;
          font-size: 12px;
          font-weight: 550;
          box-shadow: 0 3px 12px rgba(0, 0, 0, 0.12);
          animation: propertyChipReveal 0.5s ease both;
          animation-delay: calc(var(--chip-index, 0) * 80ms);
          transition:
            transform 0.25s ease,
            border-color 0.25s ease,
            background 0.25s ease,
            box-shadow 0.25s ease;
        }

        .property-center-chip:hover {
          transform: translateY(-5px);
          border-color: #818cf8;
          background: rgba(99, 102, 241, 0.16);
          box-shadow: 0 12px 24px rgba(79, 70, 229, 0.18);
        }

        .property-chip-check {
          display: grid;
          place-items: center;
          width: 19px;
          height: 19px;
          border-radius: 50%;
          background: rgba(99, 102, 241, 0.2);
          color: #c7d2fe;
          font-size: 11px;
          font-weight: 800;
          transition: color 0.25s ease, background 0.25s ease;
        }

        .property-center-chip:hover .property-chip-check {
          background: #6366f1;
          color: #ffffff;
        }

        .property-center-signin {
          display: inline-flex;
          align-items: center;
          gap: 13px;
          margin-top: 32px;
          padding: 15px 22px;
          border: 1px solid #343b58;
          border-radius: 13px;
          background: rgba(255, 255, 255, 0.045);
          text-align: left;
          box-shadow: 0 8px 30px rgba(0, 0, 0, 0.15);
          transition:
            transform 0.25s ease,
            border-color 0.25s ease,
            background 0.25s ease,
            box-shadow 0.25s ease;
        }

        .property-center-signin:hover {
          transform: translateY(-4px);
          border-color: #818cf8;
          background: rgba(99, 102, 241, 0.1);
          box-shadow: 0 15px 35px rgba(79, 70, 229, 0.18);
        }

        .property-signin-icon {
          display: grid;
          place-items: center;
          width: 38px;
          height: 38px;
          flex-shrink: 0;
          border-radius: 11px;
          background: rgba(99, 102, 241, 0.2);
          color: #c7d2fe;
          font-size: 16px;
          font-weight: 800;
        }

        .property-center-signin > div {
          display: grid;
          gap: 5px;
        }

        .property-center-signin strong {
          color: #f8fafc;
          font-size: 13px;
          font-weight: 700;
        }

        .property-center-signin > div > span {
          color: #cbd5e1;
          font-size: 12px;
        }

        .property-center-footer {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 12px;
          margin-top: 28px;
          color: #94a3b8;
          font-size: 11px;
          letter-spacing: 0.5px;
        }

        .property-center-footer span {
          width: 25px;
          height: 1px;
          background: #6366f1;
        }

        /* ANIMATIONS */

        @keyframes callFadeUp {
          from {
            opacity: 0;
            transform: translateY(16px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        @keyframes propertyCenterReveal {
          from {
            opacity: 0;
            transform: translateY(22px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        @keyframes propertyChipReveal {
          from {
            opacity: 0;
            transform: translateY(10px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        /* RESPONSIVE */

        @media (max-width: 900px) {
          .call-next-section {
            padding: 70px 0;
          }

          .call-next-layout {
            gap: 32px;
          }

          .property-website-section {
            padding: 80px 20px;
          }
        }

        @media (max-width: 700px) {
          .call-next-section {
            padding: 55px 0;
          }

          .call-next-layout {
            display: grid;
            grid-template-columns: 1fr;
            gap: 30px;
          }

          .call-next-title {
            font-size: clamp(32px, 8vw, 42px);
          }

          .call-dashboard {
            padding: 17px;
          }

          .call-lead-row {
            gap: 9px;
          }

          .call-avatar {
            width: 36px;
            height: 36px;
          }

          .call-priority {
            padding: 5px;
            font-size: 9px;
          }

          .property-website-section {
            padding: 70px 18px;
          }

          .property-center-title {
            font-size: clamp(32px, 8vw, 42px);
            letter-spacing: -1.3px;
          }

          .property-center-description {
            font-size: 14px;
          }

          .property-center-chips {
            gap: 9px;
            margin-top: 24px;
          }

          .property-center-chip {
            padding: 9px 12px;
            font-size: 11px;
          }

          .property-center-signin {
            width: 100%;
            max-width: 340px;
            padding: 13px;
          }

          .property-center-footer {
            gap: 7px;
            font-size: 10px;
          }

          .property-center-footer span {
            width: 15px;
          }
        }

        @media (max-width: 420px) {
          .call-dashboard {
            padding: 13px;
          }

          .call-lead-row {
            gap: 7px;
          }

          .call-lead-info strong {
            font-size: 12px;
          }

          .call-lead-info > span {
            font-size: 10px;
          }

          .call-priority {
            max-width: 84px;
            white-space: normal;
            text-align: center;
          }

          .property-center-eyebrow {
            gap: 7px;
            font-size: 9px;
            letter-spacing: 1.2px;
          }

          .property-eyebrow-line {
            width: 15px;
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .call-dashboard,
          .property-center-content,
          .property-center-chip {
            animation: none !important;
          }

          .call-dashboard,
          .call-lead-row,
          .call-action,
          .property-center-chip,
          .property-center-signin,
          .property-eyebrow-line,
          .property-chip-check {
            transition: none !important;
          }
        }
      `}</style>
    </>
  );
}







function Screens({ product }) {
  const { country } = useCountry();
  const set = country.code === 'PK' ? SCREENS : COUNTRY_SCREENS(country.code.toLowerCase());
  const list = product ? set[product] : country.code === 'PK' ? [...SCREENS.real_estate.slice(0, 1), ...SCREENS.construction.slice(0, 1)] : set.real_estate.slice(0, 2);
  if (!list.length) return null;
  return <section className={product ? '' : 'alt'}><div className="lwrap"><div className="lsh"><h2>See the application</h2><p>Screens from the working product, with demo data.</p></div><div className="lshots">{list.map(([f, cap]) => <Shot key={f} file={f} caption={cap} />)}</div></div></section>;
}

function Faq({ faqs }) {
  if (!faqs?.length) return null;
  return <section id="faq"><div className="lwrap"><div className="lsh"><h2>Questions</h2></div>{faqs.map(([q, a]) => <details key={q}><summary>{q}</summary><p>{a}</p></details>)}</div></section>;
}
function Band({ info, product }) {
  return (
    <section style={{ paddingTop: 0 }}><div className="lwrap"><div className="lband">
      <h2>Ready to try it with your own data?</h2>
      <p>Free for {info.trial_days} days. No card needed. If you stop, your data becomes read-only and is never deleted.</p>
      <div className="lcta"><Link className="lbtn lg" to={`/signup${product ? `?product=${product}` : ''}`} onClick={() => track('cta_start_trial', { where: 'band' })}>Create your workspace</Link><Link className="lbtn lg ghost" to="/contact" onClick={() => track('cta_book_demo', { where: 'band' })}>Book a demo</Link></div>
    </div></div></section>
  );
}

function ProductPage({ info, product }) {
  const { country } = useCountry();
  const cur = country.currency;
  const c = info.content[product];
  const seo = info.content.seo[product];
  useTitle(seo.title, seo.description);
  useEffect(() => { track('product_page_view', { product }); }, [product]);
  const plans = info.plans.filter((p) => p.product === product);
  return (
    <>
      <div className="lwrap lhero">
        <span className="ltag2">{product === 'real_estate' ? 'Real Estate Brokerage Management' : 'Construction Management'}</span>
        <h1 style={{ marginTop: 14 }}>{c.title}</h1>
        <p>{c.subtitle}</p>
        <div className="lcta"><Link className="lbtn p" to={`/signup?product=${product}`}>Start free trial</Link><Link className="lbtn" to={`/pricing?product=${product}`}>See pricing</Link><Link className="lbtn" to={`/contact?product=${product}`}>Book a demo</Link></div>
      </div>
      <section className="alt"><div className="lwrap">
        <div className="lsh"><h2>What is included</h2></div>
        <div className="lgrid">{c.features.map(([t, d]) => <div className="lcard" key={t}><h3>{t}</h3><p>{d}</p></div>)}</div>
      </div></section>
      <Screens product={product} />
      {!!c.use_cases?.length && <section className="alt"><div className="lwrap lsplit">
        <div><h2 style={{ fontSize: 30 }}>Who it is for</h2><ul className="lcheck">{c.use_cases.map((u) => <li key={u}>{u}</li>)}</ul></div>
        <div className="lcard"><h3>Shared with every product</h3><ul className="lcheck"><li>Contacts and CRM</li><li>Users, roles and invitations</li><li>Accounting, invoices and receipts</li><li>Documents and notifications</li><li>Reports and exports</li><li>Customer / client portal</li></ul></div>
      </div></section>}
      {!!plans.length && <section><div className="lwrap"><div className="lsh"><h2>Plans</h2><p>Monthly prices. Yearly billing and all details on the pricing page.</p></div>
        <div className="lgrid">{plans.map((p) => <div key={p.id} className={`lcard lplan ${p.highlight ? 'hot' : ''}`}>{p.highlight && <span className="ltag">Recommended</span>}<h3>{p.name}</h3><div className="lprice">{p.price[cur]?.month != null ? fmt(p.price[cur].month, cur) : '—'}<small> / month</small></div><p>{p.description || ''}</p><Link className={`lbtn ${p.highlight ? 'p' : ''}`} to={`/signup?product=${product}`}>Start free trial</Link></div>)}</div>
        <p className="lfine" style={{ textAlign: 'center' }}><Link to={`/pricing?product=${product}`}>Compare plans →</Link></p>
      </div></section>}
      <Band info={info} product={product} />
    </>
  );
}

function Pricing({ info }) {
  const c = info.content;
  useTitle(c.seo.pricing.title, c.seo.pricing.description);
  const loc = useLocation();
  const initial = new URLSearchParams(loc.search).get('product');
  const hasBundle = info.plans.some((p) => p.product === 'bundle');
  const [prod, setProd] = useState(['real_estate', 'construction', 'bundle'].includes(initial) ? initial : 'real_estate');
  const [int, setInt] = useState('month');
  const { country } = useCountry();
  const cur = country.currency;
  const setCur = () => {};
  useEffect(() => { track('pricing_view', { product: prod }); }, [prod]);
  const plans = info.plans.filter((p) => p.product === prod);
  const currencies = [...new Set(info.plans.flatMap((p) => Object.keys(p.price)))].sort((a, b) => (a === 'PKR' ? -1 : b === 'PKR' ? 1 : a.localeCompare(b)));
  const addons = info.addons.filter((a) => a.product === 'any' || a.product === prod || prod === 'bundle');
  const pay = [...(info.cards ? ['Cards'] : []), ...info.local_methods.map((k) => METHOD[k] || k)];
  const saving = (p) => (p.price[cur]?.month && p.price[cur]?.year && p.price[cur].year < p.price[cur].month * 12 ? Math.round((1 - p.price[cur].year / (p.price[cur].month * 12)) * 100) : 0);
  const rows = [
    ['Team members', (p) => (p.seats == null ? 'Unlimited' : p.seats)], ['Projects', (p) => (p.projects == null ? 'Unlimited' : p.projects)],
    ...(prod !== 'construction' ? [['Properties', (p) => (p.properties == null ? 'Unlimited' : Number(p.properties).toLocaleString())]] : []),
    ['File storage', (p) => (p.storage_mb == null ? 'Unlimited' : `${Math.round((p.storage_mb / 1024) * 10) / 10} GB`)], ['Website / partner API', (p) => (p.api_access ? '✓' : '—')],
    ['One-time setup fee', (p) => (p.setup_fee?.[cur] ? fmt(p.setup_fee[cur], cur) : 'None')], ['Free trial', (p) => (p.trial_eligible ? `${info.trial_days} days` : '—')],
  ];
  return (
    <>
      <div className="lwrap lhero" style={{ paddingBottom: 24 }}><h1>Pricing</h1><p>Separate plans for each product. Every eligible new workspace starts with a {info.trial_days}-day free trial{info.one_trial_per_email ? ' (one per owner email)' : ''}. No card needed to start.</p></div>
      <section style={{ paddingTop: 0 }}><div className="lwrap">
        <div className="ltog">
          <div role="tablist" aria-label="Product">{[['real_estate', 'Real Estate'], ['construction', 'Construction'], ...(hasBundle ? [['bundle', 'Both']] : [])].map(([k, l]) => <button key={k} role="tab" aria-selected={prod === k} className={prod === k ? 'on' : ''} onClick={() => setProd(k)}>{l}</button>)}</div>
          <div role="tablist" aria-label="Billing">{['month', 'year'].map((i) => <button key={i} role="tab" aria-selected={int === i} className={int === i ? 'on' : ''} onClick={() => setInt(i)}>{i === 'month' ? 'Monthly' : 'Yearly'}</button>)}</div>
          {false && <div role="tablist" aria-label="Currency">{currencies.map((k) => <button key={k} role="tab" aria-selected={cur === k} className={cur === k ? 'on' : ''} onClick={() => setCur(k)}>{k}</button>)}</div>}
        </div>
        {!plans.length ? <p className="lfine" style={{ textAlign: 'center' }}>Plans for this product are being prepared. <Link to="/contact">Contact us</Link>.</p> : (
          <div className="lgrid">{plans.map((p) => (
            <div key={p.id} className={`lcard lplan ${p.highlight ? 'hot' : ''}`}>
              {p.highlight && <span className="ltag">Recommended</span>}
              <h3>{p.name}</h3>
              <div className="lprice">{p.price[cur]?.[int] != null ? fmt(p.price[cur][int], cur) : '—'}<small> / {int === 'month' ? 'month' : 'year'}</small></div>
              {int === 'year' && saving(p) > 0 && <div className="lmini">Save {saving(p)}% compared with monthly</div>}
              {p.setup_fee?.[cur] ? <div className="lmini">+ {fmt(p.setup_fee[cur], cur)} one-time setup</div> : null}
              {p.description && <p>{p.description}</p>}
              <ul>
                <li>{limitLine(p.seats, 'team member', 'team members')}</li><li>{limitLine(p.projects, 'project', 'projects')}</li>
                {p.product !== 'construction' && <li>{limitLine(p.properties, 'property', 'properties')}</li>}
                {p.api_access && <li>Website / partner API</li>}
                {(p.features || []).map((f) => <li key={f}>{f}</li>)}
              </ul>
              <Link className={`lbtn ${p.highlight ? 'p' : ''}`} to={`/signup?product=${p.product === 'bundle' ? 'real_estate' : p.product}&plan=${p.id}`}>{p.trial_eligible ? 'Start free trial' : 'Get started'}</Link>
            </div>
          ))}</div>
        )}
        {!!plans.length && <div className="lscroll" style={{ marginTop: 30 }}><table className="lcmp"><thead><tr><th>Compare</th>{plans.map((p) => <th key={p.id} className="c">{p.name}</th>)}</tr></thead><tbody>{rows.map(([l, f]) => <tr key={l}><td>{l}</td>{plans.map((p) => <td key={p.id} className="c">{f(p)}</td>)}</tr>)}</tbody></table></div>}
        {!!addons.length && <><h3 style={{ margin: '34px 0 12px', textAlign: 'center' }}>Optional add-ons</h3><div className="lscroll"><table className="lcmp"><thead><tr><th>Add-on</th><th>Adds</th><th className="c">Price</th></tr></thead><tbody>{addons.map((a) => <tr key={a.id}><td><b>{a.name}</b>{a.description ? <div className="lmini">{a.description}</div> : null}</td><td>{Object.entries(a.entitlements).map(([k, v]) => (k === 'api_access' ? 'API access' : `+${v} ${k === 'storage_mb' ? 'MB storage' : k}`)).join(', ')}</td><td className="c">{a.price[cur]?.[int] != null ? `${fmt(a.price[cur][int], cur)} / ${int === 'month' ? 'mo' : 'yr'}` : '—'}</td></tr>)}</tbody></table></div></>}
        <div className="lgrid" style={{ marginTop: 34 }}>
          <div className="lcard"><h3>Trial terms</h3><p>{info.trial_days} days, no card needed. When it ends without a plan, the workspace becomes read-only: you can still sign in and export everything. Nothing is deleted.</p></div>
          <div className="lcard"><h3>Billing</h3><p>Monthly or yearly. Plans renew automatically by card, or by bank/wallet transfer with reminders before each renewal. Cancel any time; access continues to the end of the paid period.</p></div>
          <div className="lcard"><h3>Payment methods</h3><p>{pay.length ? `${pay.join(', ')}.` : 'Contact us to arrange payment.'} Card details are handled by the payment provider and never stored by us.</p></div>
        </div>
        <p className="lfine" style={{ textAlign: 'center' }}>Prices include applicable taxes unless stated otherwise. See the <Link to="/legal/subscription">Subscription Terms</Link> and <Link to="/legal/refunds">Cancellation &amp; Refund Policy</Link>.</p>
      </div></section>
      <Band info={info} product={prod === 'bundle' ? null : prod} />
    </>
  );
}

function Contact({ info }) {
  const c = info.content;
  useTitle(c.seo.contact.title, c.seo.contact.description);
  const loc = useLocation();
  const [f, setF] = useState({ name: '', email: '', phone: '', company: '', product: new URLSearchParams(loc.search).get('product') || '', team_size: '', message: '', website: '' });
  const [err, setErr] = useState('');
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => { track('demo_form_view'); }, []);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const submit = async (e) => {
    e.preventDefault(); setErr(''); setBusy(true);
    const a = attributionFields();
    try { await api.post('/api/platform/demo-request', { ...f, source: a.utm_source || a.referrer || '', landing_page: a.landing_page || '', ...a }); setDone(true); } catch (x) { setErr(x.message); } finally { setBusy(false); }
  };
  return (
    <section><div className="lwrap">
      <div className="lsh"><h1 style={{ fontSize: 40 }}>Book a demo</h1><p>Tell us about your business and we will show you the parts that matter to you.{c.contact_email ? <> You can also email <a href={`mailto:${c.contact_email}`}>{c.contact_email}</a>.</> : ''}</p></div>
      {done ? <div className="lok" style={{ maxWidth: 560, margin: '0 auto' }}>Thank you. We have your request and will contact you at {f.email}.</div> : (
        <form className="lform" onSubmit={submit} noValidate>
          {err && <div className="lerr" role="alert">{err}</div>}
          <div className="lrow"><label>Your name<input required value={f.name} onChange={set('name')} autoComplete="name" /></label><label>Work email<input type="email" required value={f.email} onChange={set('email')} autoComplete="email" /></label></div>
          <div className="lrow"><label>Company<input value={f.company} onChange={set('company')} autoComplete="organization" /></label><label>Phone <span className="lhint">optional</span><input value={f.phone} onChange={set('phone')} autoComplete="tel" /></label></div>
          <div className="lrow"><label>Interested in<select value={f.product} onChange={set('product')}><option value="">Not sure yet</option><option value="real_estate">Real Estate Brokerage</option><option value="construction">Construction Management</option><option value="both">Both</option></select></label>
            <label>Team size<select value={f.team_size} onChange={set('team_size')}><option value="">Choose</option>{['1-5', '6-20', '21-50', '51+'].map((x) => <option key={x}>{x}</option>)}</select></label></div>
          <label>What would you like to see?<textarea rows={4} value={f.message} onChange={set('message')} /></label>
          <label className="lhp" aria-hidden>Website<input tabIndex={-1} autoComplete="off" value={f.website} onChange={set('website')} /></label>
          <button className="lbtn p" disabled={busy}>{busy ? 'Sending…' : 'Request a demo'}</button>
          <p className="lmini" style={{ margin: 0 }}>We use these details only to reply to you. See the <Link to="/legal/privacy">Privacy Policy</Link>.</p>
        </form>
      )}
    </div></section>
  );
}

/** Very small, safe renderer for the legal documents: ## headings, - lists and paragraphs; no HTML is ever injected. */
function Doc({ text }) {
  const blocks = [];
  let list = null;
  for (const line of String(text).split('\n')) {
    if (/^- /.test(line)) { (list ||= []).push(line.slice(2)); continue; }
    if (list) { blocks.push(<ul key={blocks.length}>{list.map((x, i) => <li key={i}>{x}</li>)}</ul>); list = null; }
    if (/^## /.test(line)) blocks.push(<h2 key={blocks.length}>{line.slice(3)}</h2>);
    else if (line.trim()) blocks.push(<p key={blocks.length}>{line}</p>);
  }
  if (list) blocks.push(<ul key={blocks.length}>{list.map((x, i) => <li key={i}>{x}</li>)}</ul>);
  return <>{blocks}</>;
}
function Legal({ info, slug }) {
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  useEffect(() => { setD(null); api.get(`/api/platform/legal/${encodeURIComponent(slug)}`).then(setD).catch((e) => setErr(e.message)); }, [slug]);
  useTitle(d ? `${d.title} | ${info.content.brand}` : null, d?.title);
  if (err) return <section><div className="lwrap"><div className="lerr">{err}</div></div></section>;
  if (!d) return <Loading />;
  return (
    <section><div className="lwrap"><article className="ldoc">
      {d.status !== 'published' && <div className="ldraft" role="note">This document is a template that has not been reviewed and published yet. It is shown for transparency and may change.</div>}
      <h1 style={{ fontSize: 32, marginBottom: 6 }}>{d.title}</h1>
      {d.published_at && <p className="lmini">Version {d.version} · published {String(d.published_at).slice(0, 10)}</p>}
      <Doc text={d.body} />
    </article></div></section>
  );
}

/** Does this address open at all (DNS and certificate)? A cross-origin request that fails to connect means no. */
const reachable = (url) => fetch(`${String(url).replace(/\/$/, '')}/health`, { mode: 'no-cors', cache: 'no-store' }).then(() => true, () => false);
const WS_KEY = 'agentify_workspace';
const rememberWorkspace = (s) => { try { localStorage.setItem(WS_KEY, s); } catch { /* storage blocked */ } };
const lastWorkspace = () => { try { return localStorage.getItem(WS_KEY) || ''; } catch { return ''; } };
function FindWorkspace({ info }) {
  const last = lastWorkspace();
  const [blocked, setBlocked] = useState('');
  const open = async (s) => {
    const { protocol, port } = window.location;
    const base = `${protocol}//${s}.${info.base_domain}${port ? `:${port}` : ''}`;
    setBlocked('');
    if (!(await reachable(base))) { setBlocked(`${s}.${info.base_domain} cannot be reached right now. Check the spelling of the address. If it is right, the address is still being connected on our side: try again shortly.`); return; }
    rememberWorkspace(s);
    window.location.assign(`${base}/login`);
  };
  const [slug, setSlug] = useState('');
  const [email, setEmail] = useState('');
  const [msg, setMsg] = useState('');
  useTitle(`Sign in | ${info.content.brand}`, 'Sign in to your workspace.');
  const go = (e) => {
    e.preventDefault();
    const s = slug.trim().toLowerCase().replace(/[^a-z0-9-]/g, '');
    if (!s) return;
    open(s);
  };
  const find = async (e) => { e.preventDefault(); setMsg(''); try { setMsg((await api.post('/api/platform/find-workspace', { email })).message); } catch (x) { setMsg(x.message); } };
  return (
    <section><div className="lwrap">
      <div className="lsh"><h1 style={{ fontSize: 38 }}>Sign in to your workspace</h1><p>Each company has its own address.</p></div>
      {blocked && <div className="lerr" role="alert" style={{ maxWidth: 560, margin: '0 auto 14px' }}>{blocked}</div>}
      {last && <div className="lform" style={{ marginBottom: 18, textAlign: 'center' }}><button type="button" className="lbtn p lg" onClick={() => open(last)}>Continue to {last}.{info.base_domain}</button><div className="lmini">The workspace you used last on this device.</div></div>}
      <form className="lform" onSubmit={go}>
        <label>Workspace address<div style={{ display: 'flex', gap: 8, alignItems: 'center' }}><input value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="your-company" aria-label="Workspace address" /><span className="lmini">.{info.base_domain}</span></div></label>
        <button className="lbtn p">Continue</button>
      </form>
      <form className="lform" style={{ marginTop: 18 }} onSubmit={find}>
        <label>Forgot your address?<span className="lhint">Enter the owner's email and we will email the workspace address.</span><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
        <button className="lbtn">Email me my workspace</button>
        {msg && <div className="lok">{msg}</div>}
      </form>
    </div></section>
  );
}

// ---------------------------------------------------------------- sign-up
const TIMEZONES = [['Asia/Karachi', 'Pakistan (PKT)'], ['Asia/Dubai', 'UAE (GST)'], ['Asia/Riyadh', 'Saudi Arabia (AST)'], ['Asia/Kolkata', 'India (IST)'], ['Asia/Dhaka', 'Bangladesh (BST)'], ['Europe/London', 'United Kingdom'], ['America/New_York', 'US Eastern'], ['UTC', 'UTC']];
const CURRENCIES = ['PKR', 'AED', 'SAR', 'INR', 'BDT', 'GBP', 'USD', 'EUR'];
const slugify = (s) => String(s || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32);

function Signup({ info }) {
  const { country, countries, setCountry } = useCountry();
  const loc = useLocation();
  const q = new URLSearchParams(loc.search);
  const [product, setProduct] = useState(['real_estate', 'construction'].includes(q.get('product')) ? q.get('product') : '');
  const [f, setF] = useState({ company_name: '', slug: '', admin_name: '', admin_email: q.get('email') || '', admin_password: '', timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Karachi', currency: 'PKR', accept_terms: false });
  const [slugTouched, setSlugTouched] = useState(false);
  const [avail, setAvail] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);
  useTitle(`Start your free trial | ${info.content.brand}`, `Create your ${info.content.brand} workspace with a ${info.trial_days}-day free trial.`);
  useEffect(() => { track('signup_started', { product: product || undefined }); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!f.slug) { setAvail(null); return undefined; }
    const t = setTimeout(async () => { try { setAvail(await api.get(`/api/platform/slug-available/${encodeURIComponent(f.slug)}`)); } catch { setAvail(null); } }, 350);
    return () => clearTimeout(t);
  }, [f.slug]);
  const tzs = useMemo(() => (TIMEZONES.some(([v]) => v === f.timezone) ? TIMEZONES : [[f.timezone, f.timezone], ...TIMEZONES]), [f.timezone]);
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  const submit = async (e) => {
    e.preventDefault(); setErr('');
    if (!product) { setErr('Choose a product first'); return; }
    if (!f.accept_terms) { setErr('Please accept the Terms of Service and Privacy Policy'); return; }
    setBusy(true);
    try { setDone(await api.post('/api/platform/signup', { ...f, region: country.code, currency: country.currency, timezone: (country.timezones || []).includes(f.timezone) ? f.timezone : (country.timezones || [f.timezone])[0], language: f.language || null, sample_data: !!f.sample_data, product, analytics: attributionFields() })); } catch (x) { setErr(x.message); } finally { setBusy(false); }
  };
  // straight into the new workspace, already signed in (the one-time code lasts two minutes, so do it now)
  const [unreachable, setUnreachable] = useState(false);
  const [checking, setChecking] = useState(false);
  // only go there if the workspace address actually opens; otherwise say so instead of showing a browser error page
  const enter = async () => {
    if (!done) return;
    setChecking(true); setUnreachable(false);
    const ok = await reachable(done.login_url);
    setChecking(false);
    if (ok) window.location.replace(done.enter_url || `${done.login_url}/login`);
    else setUnreachable(true);
  };
  useEffect(() => {
    if (!done) return;
    if (done.tenant?.slug) rememberWorkspace(done.tenant.slug);
    if (!done.enter_url) return;
    enter();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [done]);
  if (done) {
    const t = done.tenant;
    return (
      <section><div className="lwrap"><div className="lform" style={{ textAlign: 'center' }}>
        <h1 style={{ fontSize: 30 }}>Your workspace is ready</h1>
        <p><b>{t.name}</b> · {PRODUCT_LABELS[t.product]}</p>
        {t.trial_ends_at ? <p>Your free trial runs until <b>{new Date(t.trial_ends_at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</b> (your local time).</p>
          : <p>{t.trial_note ? `${t.trial_note}. ` : ''}Choose a plan in Settings › Plan &amp; Billing to start working.</p>}
        <p className="lmini">We emailed {t.owner_email} a link to confirm the address.</p>
        {unreachable && <div className="lerr" role="alert" style={{ textAlign: 'left', margin: '12px 0' }}>Your workspace was created at <b>{done.login_url.replace(/^https?:\/\//, '')}</b>, but that address cannot be reached yet. This is a setup step on our side (the website address for workspaces is still being connected). Your data is safe. Please try the button below again in a little while, or contact us.</div>}
        <button type="button" className="lbtn p" onClick={enter} disabled={checking}>{checking ? 'Checking the address…' : unreachable ? 'Check again' : 'Open your workspace'}</button>
      </div></div></section>
    );
  }
  return (
    <section><div className="lwrap">
      <div className="lsh"><h1 style={{ fontSize: 40 }}>Start your free trial</h1><p>{info.trial_days} days free, no card needed{info.one_trial_per_email ? ', one trial per owner email' : ''}. Your company gets its own private workspace.</p></div>
      <form className="lform" onSubmit={submit} style={{ maxWidth: 640 }}>
        {err && <div className="lerr" role="alert">{err}</div>}
        <fieldset style={{ border: 0, padding: 0, margin: 0 }}><legend style={{ fontWeight: 700, marginBottom: 8 }}>1. What do you need?</legend>
          <div className="lchoose">
            <button type="button" className={product === 'real_estate' ? 'on' : ''} aria-pressed={product === 'real_estate'} onClick={() => setProduct('real_estate')}><b>Real Estate Brokerage</b><span>Leads, inventory, sales, installments, commissions, receipts, customer portal.</span></button>
            <button type="button" className={product === 'construction' ? 'on' : ''} aria-pressed={product === 'construction'} onClick={() => setProduct('construction')}><b>Construction Management</b><span>Projects, BOQs, budgets, procurement, materials, labour, progress, client billing.</span></button>
          </div>
        </fieldset>
        <div style={{ fontWeight: 700 }}>2. Your company and account</div>
        <label>Company name<input required value={f.company_name} onChange={(e) => { const v = e.target.value; setF((s) => ({ ...s, company_name: v, slug: slugTouched ? s.slug : slugify(v) })); }} autoComplete="organization" /></label>
        <label>Workspace address<span className="lhint">{avail ? (avail.available ? `Available: ${f.slug}.${info.base_domain}` : avail.reason) : 'Letters, digits and hyphens'}</span>
          <input required value={f.slug} onChange={(e) => { setSlugTouched(true); setF((s) => ({ ...s, slug: slugify(e.target.value) })); }} placeholder="your-company" aria-invalid={avail && !avail.available} /></label>
        <div className="lrow"><label>Your name<input required value={f.admin_name} onChange={set('admin_name')} autoComplete="name" /></label><label>Work email<input type="email" required value={f.admin_email} onChange={set('admin_email')} autoComplete="email" /></label></div>
        <label>Password<span className="lhint">At least 8 characters</span><input type="password" minLength={8} required value={f.admin_password} onChange={set('admin_password')} autoComplete="new-password" /></label>
        <div style={{ fontWeight: 700 }}>3. Your country</div>
        <div className="lrow">
          <label>Country<span style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Flag code={country.code} height={20} /><select style={{ flex: 1 }} value={country.code} onChange={(e) => setCountry(e.target.value)}>{countries.map((c) => <option key={c.code} value={c.code} disabled={!c.open}>{c.name}{c.open ? '' : ' (opening soon)'}</option>)}</select></span></label>
          {country.sub_regions?.length > 0 && <label>{country.sub_region_label || 'State'}<select required value={f.sub_region || ''} onChange={set('sub_region')}><option value="">Choose…</option>{country.sub_regions.map((x) => <option key={x}>{x}</option>)}</select></label>}
        </div>
        {country.timezones?.length > 1 && <label>Time zone<select value={country.timezones.includes(f.timezone) ? f.timezone : country.timezones[0]} onChange={set('timezone')}>{country.timezones.map((z) => <option key={z} value={z}>{z.replace('_', ' ')}</option>)}</select></label>}
        {country.languages?.length > 1 && <label>Language<select value={f.language || country.languages[0]} onChange={set('language')}>{country.languages.map((x) => <option key={x} value={x}>{{ en: 'English', fr: 'Français', ar: 'العربية' }[x] || x}</option>)}</select></label>}
        <div className="lhint" aria-live="polite">Set from your country: {[country.currency, country.config?.date_style, country.config?.area?.labels?.[country.config?.area?.default], country.config?.timezone].filter(Boolean).join(' · ')}</div>
        {country.code !== 'PK' && <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', fontWeight: 400 }}><input type="checkbox" checked={!!f.sample_data} onChange={set('sample_data')} style={{ width: 'auto', marginTop: 4 }} /><span>Add sample listings, clients and sales for {country.name} so I can explore (marked as demo data).</span></label>}
        {!country.open && <div className="lerr" role="status">Signups for {country.name} are not open yet. <Link to={`/contact?country=${country.code.toLowerCase()}`}>Join the waiting list</Link> and we will email you when they open.</div>}
        <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', fontWeight: 400 }}><input type="checkbox" checked={f.accept_terms} onChange={set('accept_terms')} style={{ width: 'auto', marginTop: 4 }} />
          <span>I agree to the <Link to="/legal/terms" target="_blank">Terms of Service</Link>, <Link to="/legal/subscription" target="_blank">Subscription Terms</Link> and <Link to="/legal/privacy" target="_blank">Privacy Policy</Link>.</span></label>
        <button className="lbtn p" disabled={busy || !country.open || (avail && !avail.available)}>{busy ? 'Creating your workspace…' : 'Create workspace'}</button>
        <p className="lmini" style={{ margin: 0, textAlign: 'center' }}>Already have one? <Link to="/login">Sign in</Link></p>
      </form>
    </div></section>
  );
}

// ---------------------------------------------------------------- shell
/** The page for a path. (The site is mounted from several top-level routes, so it picks its page itself.) */
function page(path, info) {
  const p = path.replace(/\/+$/, '') || '/';
  if (p === '/' || PATH_COUNTRY[p.slice(1)]) return <Home info={info} />;
  if (p === '/real-estate') return <ProductPage info={info} product="real_estate" />;
  if (p === '/construction') return <ProductPage info={info} product="construction" />;
  if (p === '/pricing') return <Pricing info={info} />;
  if (p === '/contact') return <Contact info={info} />;
  if (p === '/signup') return <Signup info={info} />;
  if (p === '/login') return <FindWorkspace info={info} />;
  const legal = p.match(/^\/legal\/([a-z-]+)$/);
  if (legal) return <Legal key={legal[1]} info={info} slug={legal[1]} />;
  return <Navigate to="/" replace />;
}

export default function MarketingSite() {
  const [info, setInfo] = useState(null);
  const [err, setErr] = useState('');
  const [banner, setBanner] = useState(false);
  const loc = useLocation();
  const nav = useNavigate();
  useEffect(() => { api.get('/api/platform/marketing').then((d) => { setInfo(d); configureGa4(d.ga4_id); }).catch((e) => setErr(e.message)); }, []);
  useEffect(() => { if (!browserOptOut() && !consent()) setBanner(true); return onConsentChange(() => {}); }, []);
  useEffect(() => { window.scrollTo(0, 0); track('page_view'); }, [loc.pathname]);
  if (err) return <div className="lp"><div className="lwrap" style={{ padding: 40 }}><div className="lerr">{err}</div><button className="lbtn" onClick={() => nav(0)}>Try again</button></div></div>;
  if (!info) return <Loading />;
  return (
    <CountryProvider info={info}>
    <div className="lp">
      <a href="#main" className="lhp">Skip to content</a>
      <Header info={info} />
      <main id="main">
        {page(loc.pathname, info)}
      </main>
      <Footer info={info} onCookies={() => setBanner(true)} />
      <ConsentBanner show={banner && !browserOptOut()} onClose={() => setBanner(false)} />
    </div>
    </CountryProvider>
  );
}
