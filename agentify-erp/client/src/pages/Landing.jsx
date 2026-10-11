import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import './landing.css';

const FEATURES = [
  ['CRM and sales pipeline', 'Leads, contacts, smart lists, follow-up tasks, goals and agent commissions in one place.'],
  ['Property and project inventory', 'Listings, approvals, development and construction projects, units and a plot map.'],
  ['Bookings and installments', 'Sales, installment, advance and balloon schedules, receipts and overdue tracking.'],
  ['Double-entry accounting', 'Every sale, receipt, expense and salary posts a balanced journal. Reports are queries, not typed numbers.'],
  ['Vendors and tenders', 'Vendor ledgers, credit book, purchases, tenders and bids, with a vendor portal.'],
  ['HR and payroll', 'Employees, attendance, leave, salary, bonuses and recruitment.'],
  ['Customer portal', 'Buyers see their own payments, documents and project progress, and report payments themselves.'],
  ['Your own website', 'A public website editor with SEO tools, fed live from your inventory, with an enquiry form into your CRM.'],
];
const FAQ = [
  ['Is my data separate from other companies?', 'Yes. Every workspace has its own database and its own uploaded files. There is no shared table, so one company can never query another.'],
  ['What happens when my trial ends?', 'The workspace turns read-only. Nothing is deleted and everything stays visible and exportable. Choose a plan and editing comes back immediately.'],
  ['How do I pay?', 'By card (Stripe), or in PKR through Raast, Easypaisa, JazzCash, SadaPay, NayaPay or bank transfer. For the local methods you send the money, enter the transaction ID, and we confirm it and activate your plan.'],
  ['Can my team have different access?', 'Yes. Invite people by email and give each a role with view, create, edit, delete, approve, export and print rights per module. Sales agents only see their own leads and sales.'],
  ['Does it work in my currency and timezone?', 'Each workspace sets its own currency and timezone at signup. The system was built for Pakistani real estate and developers first.'],
  ['Can I use my own domain?', ''],
];
const money = (p, cur, int) => new Intl.NumberFormat('en', { style: 'currency', currency: cur, maximumFractionDigits: 0 }).format(p.price[cur][int]);
const METHOD = { raast: 'Raast', easypaisa: 'Easypaisa', jazzcash: 'JazzCash', sadapay: 'SadaPay', nayapay: 'NayaPay', bank: 'Bank transfer' };

export default function Landing({ info }) {
  const [int, setInt] = useState('month');
  const [cur, setCur] = useState('PKR');
  const [slug, setSlug] = useState('');
  useEffect(() => {
    const prev = document.title;
    document.title = 'Agentify ERP: real estate ERP for agencies and developers';
    let m = document.querySelector('meta[name=description]');
    if (!m) { m = document.createElement('meta'); m.name = 'description'; document.head.appendChild(m); }
    m.content = 'CRM, inventory, installments, accounting, HR and a customer portal for real estate agencies and developers. Start a free 14-day trial.';
    return () => { document.title = prev; };
  }, []);
  const pay = [...(info.cards ? ['Cards (Stripe)'] : []), ...info.local_methods.map((k) => METHOD[k] || k)];
  const go = (e) => {
    e.preventDefault();
    const s = slug.trim().toLowerCase().replace(/[^a-z0-9-]/g, '');
    if (!s) return;
    const { protocol, port } = window.location;
    window.location.assign(`${protocol}//${s}.${info.base_domain}${port ? `:${port}` : ''}/login`);
  };
  return (
    <div className="lp">
      <header><div className="lwrap">
        <a className="llogo" href="/"><i>⌂</i>Agentify ERP</a>
        <nav><a className="hide-m" href="#features">Features</a><a className="hide-m" href="#pricing">Pricing</a><a className="hide-m" href="#faq">FAQ</a><a href="#signin">Sign in</a><Link className="lbtn p sm" to="/signup">Start free trial</Link></nav>
      </div></header>

      <div className="lwrap lhero">
        <h1>Run your whole real estate business <em>from one system</em></h1>
        <p>Leads, inventory, installments, accounting, HR and a customer portal, built for property agencies and developers. Your own private workspace in two minutes.</p>
        <div className="lcta"><Link className="lbtn p" to="/signup">Start your {info.trial_days}-day free trial</Link><a className="lbtn" href="#features">See what is inside</a></div>
        <div className="lfine">No card needed to start. Your data is never deleted if you stop paying.</div>
        <div className="lchips"><span>Private database per company</span><span>Role-based access</span><span>Double-entry accounting</span><span>Built for Pakistan: PKR, Raast, Easypaisa, JazzCash</span></div>
      </div>

      <section id="features" className="alt"><div className="lwrap">
        <div className="lsh"><h2>Everything a property business runs on</h2><p>One connected system, so a sale updates the inventory, the customer's schedule, the commission and the books together.</p></div>
        <div className="lgrid">{FEATURES.map(([t, d]) => <div className="lcard" key={t}><h3>{t}</h3><p>{d}</p></div>)}</div>
      </div></section>

      <section><div className="lwrap">
        <div className="lsh"><h2>Up and running today</h2></div>
        <div className="lgrid">
          {[['Create your workspace', 'Enter your company name and choose your address. Your private database is created instantly.'], ['Invite your team', 'Send email invitations and give each person the right access.'], ['Add your data', 'Enter properties and projects, or start with the built-in structure and customise it.'], ['Choose a plan when ready', 'Use the full trial first. Pay by card or in PKR through local methods.']].map(([t, d], i) => <div className="lcard" key={t}><div className="lnum">{i + 1}</div><h3>{t}</h3><p>{d}</p></div>)}
        </div>
      </div></section>

      <section id="pricing" className="alt"><div className="lwrap">
        <div className="lsh"><h2>Simple pricing</h2><p>Every plan starts with a {info.trial_days}-day trial that includes Growth limits.</p></div>
        <div className="ltog">
          <div><button className={int === 'month' ? 'on' : ''} onClick={() => setInt('month')}>Monthly</button><button className={int === 'year' ? 'on' : ''} onClick={() => setInt('year')}>Yearly</button></div>
          <div><button className={cur === 'PKR' ? 'on' : ''} onClick={() => setCur('PKR')}>PKR</button><button className={cur === 'USD' ? 'on' : ''} onClick={() => setCur('USD')}>USD</button></div>
        </div>
        <div className="lgrid">
          {info.plans.map((p) => (
            <div key={p.id} className={`lcard lplan ${p.id === 'growth' ? 'hot' : ''}`}>
              {p.id === 'growth' && <span className="ltag">Most popular</span>}
              <h3>{p.name}</h3>
              <div className="lprice">{money(p, cur, int)}<small> / {int === 'month' ? 'month' : 'year'}</small></div>
              <ul><li>{p.seats ? `Up to ${p.seats} users` : 'Unlimited users'}</li><li>{p.projects ? `Up to ${p.projects} projects` : 'Unlimited projects'}</li><li>All modules included</li><li>Customer and vendor portals</li><li>Your own website editor</li></ul>
              <Link className={`lbtn ${p.id === 'growth' ? 'p' : ''}`} to="/signup">Start free trial</Link>
            </div>
          ))}
        </div>
        {pay.length > 0 && <p className="lfine" style={{ textAlign: 'center', marginTop: 22 }}>Pay with: {pay.join(', ')}.</p>}
      </div></section>

      <section id="faq"><div className="lwrap">
        <div className="lsh"><h2>Questions</h2></div>
        {FAQ.map(([q, a]) => <details key={q}><summary>{q}</summary><p>{q.startsWith('Can I use my own domain') ? `Your workspace lives at your-name.${info.base_domain}. A custom domain can be attached for you on request.` : a}</p></details>)}
      </div></section>

      <section id="signin" style={{ paddingTop: 0 }}><div className="lwrap">
        <div className="lband"><h2>Ready to try it with your own data?</h2><p>Free for {info.trial_days} days. Set up in two minutes.</p><Link className="lbtn" to="/signup">Create your workspace</Link></div>
        <div className="lsh" style={{ marginTop: 40, marginBottom: 0 }}>
          <h3>Already have a workspace?</h3>
          <form className="lfind" onSubmit={go}><input value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="your-company" aria-label="Workspace name" /><span style={{ alignSelf: 'center', color: 'var(--mut)' }}>.{info.base_domain}</span><button className="lbtn p sm">Go to sign in</button></form>
        </div>
      </div></section>

      <footer><div className="lwrap"><span>© {new Date().getFullYear()} Agentify ERP</span><span><Link to="/signup">Sign up</Link></span></div></footer>
    </div>
  );
}
