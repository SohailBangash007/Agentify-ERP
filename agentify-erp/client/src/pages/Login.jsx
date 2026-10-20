import { useState } from 'react';
import { useNavigate, Link, useSearchParams } from 'react-router-dom';
import Icon from '../components/Icon.jsx';
import { Field } from '../components/ui.jsx';
import { useAuth } from '../context.jsx';
import { useBrand } from '../brand.js';
import { t, getLanguage, chooseLanguage } from '../i18n.js';
import { getRegion } from '../format.js';

export default function Login({ portal = false, vendor = false }) {
  const { login, loginMfa } = useAuth();
  const brand = useBrand();
  const nav = useNavigate();
  const [sp] = useSearchParams();
  const next = sp.get('next') || '';
  const [id, setId] = useState('');
  const [pw, setPw] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [mfa, setMfa] = useState(null);
  const [code, setCode] = useState('');
  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setErr('');
    const done = () => nav(portal ? (new RegExp(vendor ? '^/vendor(/|$)' : '^/portal(/|$)').test(next) && !next.includes('//') ? next : '/portal') : '/', { replace: true });
    try { const u = await (mfa ? loginMfa(mfa, code) : login(id, pw, portal)); if (u.mfa_required) { setMfa(u.mfa_token); setCode(''); } else done(); } catch (er) { setErr(er.message); if (mfa && /expired/i.test(er.message)) setMfa(null); } finally { setBusy(false); }
  };
  const FEATS = portal
    ? (vendor ? [['wallet', 'green', 'Payments & balance'], ['history', 'blue', 'Account ledger'], ['file', 'violet', 'Open contracts & bids'], ['badge', 'orange', 'Your registration']] : [['building', 'violet', 'Your properties'], ['wallet', 'green', 'Installments & receipts'], ['hardhat', 'orange', 'Site progress'], ['file', 'blue', 'Documents & offers']])
    : [['users', 'blue', 'Leads & CRM'], ['badge', 'violet', 'Sales & bookings'], ['wallet', 'green', 'Accounts & vouchers'], ['briefcase', 'orange', 'HR & attendance']];
  return (
    <div className="auth2">
      <div className="auth2-copy">
        <div className="brand"><div className="brand-mark"><Icon name="home" size={18} stroke={2.2} /></div><div className="brand-name">{brand.name}<small>{vendor ? 'Vendor portal' : portal ? 'Customer portal' : 'ERP'}</small></div></div>
        <div className="eyebrow"><i />{vendor ? 'Vendor portal' : portal ? 'Customer portal' : 'One connected system'}</div>
        <h1>{vendor ? <>Your payments, ledger and new contracts — <em>in one calm place.</em></> : portal ? <>Your property, payments and progress — <em>in one calm place.</em></> : <>From lead to ledger, <em>in one calm place.</em></>}</h1>
        <p>{vendor ? 'Sign in to see what you have been paid and what is still due, download your ledger, view your registration and bid on contracts the company announces.' : portal ? 'Sign in to see your purchased properties, installment schedule, receipts and the latest site updates.' : 'CRM, inventory, projects, installments, receipts, vendors, HR and accounting — all working together, on your desk and in your pocket.'}</p>
        <div className="auth2-feats">{FEATS.map(([ic, tone, l]) => <div key={l} className="auth2-feat"><span className={`ic-tile sm ic-${tone}`}><Icon name={ic} size={15} /></span>{l}</div>)}</div>
      </div>
      <form className="auth2-card stack" onSubmit={submit}>
        <div><h2>{vendor ? t('auth.vendor_sign_in', 'Vendor sign in') : portal ? t('auth.customer_sign_in', 'Customer sign in') : t('auth.sign_in', 'Sign in')}</h2><div className="muted" style={{ marginTop: 4 }}>{vendor ? 'Use the e-mail address you registered with the company.' : portal ? 'Use the email or phone number registered with us.' : 'Welcome back. Enter your work email and password.'}</div></div>
        {(getRegion().config.languages || []).length > 1 && <label className="muted" style={{ fontSize: 13 }}>{t('lang.label', 'Language')}: <select className="input" style={{ width: 'auto', display: 'inline-block' }} value={getLanguage()} onChange={(e) => chooseLanguage(e.target.value)}>{getRegion().config.languages.map((l) => <option key={l} value={l}>{{ en: 'English', fr: 'Français', ar: 'العربية' }[l] || l}</option>)}</select></label>}
        {err && <div className="alert err" role="alert">{err}</div>}
        {mfa ? <Field label="Authenticator code" hint="Open your authenticator app and enter the 6-digit code, or use a recovery code."><input className="input" autoFocus inputMode="text" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} required /></Field> : <>
        <Field label={portal ? t('auth.email_or_phone', 'Email or phone') : t('auth.email', 'Email')}><input className="input" autoFocus value={id} onChange={(e) => setId(e.target.value)} autoComplete="username" required /></Field>
        <Field label={t('auth.password', 'Password')}><input className="input" type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="current-password" required /></Field>
        </>}
        <button className="btn primary" disabled={busy}>{busy ? t('auth.signing_in', 'Signing in…') : mfa ? t('auth.verify', 'Verify') : t('auth.sign_in', 'Sign in')}</button>
        {!vendor && <div className="center muted"><Link to="/forgot-password">{t('auth.forgot', 'Forgot password?')}</Link>{!portal && <> · <Link to="/signup">{t('auth.create_workspace', 'Create a workspace')}</Link></>}</div>}
        <div className="center muted">{portal ? <><Link to="/login">{t('auth.staff_sign_in', 'Staff sign in')}</Link> · {vendor ? <Link to="/portal/login">Customer portal</Link> : <Link to="/vendor/login">Vendor portal</Link>}</> : <><Link to="/portal/login">Customer portal →</Link> · <Link to="/vendor/login">Vendor portal →</Link></>}</div>
        {!portal && brand.demo_logins.length > 0 && (
          <div className="demo-box">
            <b>Demo accounts</b> <span className="muted">(password <code>Demo@12345</code>)</span>
            {brand.demo_logins.map(({ role: r, email: e }) => <button type="button" key={e} onClick={() => { setId(e); setPw('Demo@12345'); }}>{r} — {e}</button>)}
          </div>
        )}
        {vendor && <div className="demo-box"><b>Demo vendors</b><button type="button" onClick={() => { setId('abc.bricks@example.com'); setPw('Demo@12345'); }}>ABC Bricks — abc.bricks@example.com</button><button type="button" onClick={() => { setId('wood@example.com'); setPw('Demo@12345'); }}>Expert Wood Suppliers — wood@example.com</button></div>}
        {portal && !vendor && <div className="demo-box"><b>Demo customer</b><button type="button" onClick={() => { setId('m.ali@example.com'); setPw('Demo@12345'); }}>m.ali@example.com / Demo@12345</button></div>}
      </form>
    </div>
  );
}
