import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { CalculatorTabs } from './ConstructionTools.jsx';
import { useMemo } from 'react';
import { Markdown, imgUrl, isInternal, priceText, useSite, waLink, MoneyBox, curCode, siteCopy, isPK, exampleAmount } from './siteCore.jsx';
import { safeId, sectionCss } from '../../../shared/sectionStyle.js';

/** Internal links use the router; external/tel/mailto use a normal anchor. */
const SAFE = /^(https?:\/\/|\/|#|mailto:|tel:)/i;
export const safeHref = (h) => (typeof h === 'string' && SAFE.test(h.trim()) ? h.trim() : '');
export function A({ href: raw, children, ...p }) {
  const href = safeHref(raw);
  if (!href) return <span {...p}>{children}</span>;
  return isInternal(href) ? <Link to={href} {...p}>{children}</Link> : <a href={href} {...(/^https?:/.test(href) ? { target: '_blank', rel: 'noreferrer' } : {})} {...p}>{children}</a>;
}

const usePublic = (url, params) => {
  const [data, setData] = useState(null);
  const key = url + JSON.stringify(params || {});
  useEffect(() => { let off = false; setData(null); if (!url) return undefined; api.get(url, params).then((d) => !off && setData(d)).catch(() => !off && setData({ data: [], error: true })); return () => { off = true; }; /* eslint-disable-next-line */ }, [key]);
  return data;
};
export { usePublic };

export const Placeholder = ({ icon = '🏠', label }) => <div className="ph" aria-hidden="true"><span>{icon}</span>{label && <small>{label}</small>}</div>;

export function Stars() { return <span className="featured-tag">★ Featured</span>; }

export function PropertyCard({ p, onEnquire }) {
  const sold = p.status === 'sold', reserved = p.status === 'reserved';
  return (
    <article className="pcard">
      <Link to={`/site/property/${p.id}`} className="pcard-img" aria-label={p.title}>
        {p.cover ? <img src={imgUrl(p.cover)} alt={p.title} loading="lazy" /> : <Placeholder icon={p.type === 'Plots' ? '🌳' : p.type === 'Shops' || p.type === 'Offices' ? '🏢' : '🏠'} />}
        <div className="tags">{p.featured && <Stars />}{p.purpose === 'Rent' && <span className="tag-rent">For rent</span>}{sold && <span className="tag-sold">Sold</span>}{reserved && <span className="tag-res">Reserved</span>}{p.ready && <span className="tag-ready">Ready</span>}</div>
        {p.photos > 1 && <span className="photos">📷 {p.photos}</span>}
      </Link>
      <div className="pcard-body">
        <div className="price">{priceText(p.price, p.purpose)}{p.discount > 0 && <small className="was">{priceText(p.total_price)}</small>}</div>
        <Link to={`/site/property/${p.id}`} className="ptitle">{p.title}</Link>
        <div className="ploc">📍 {[p.area_name, p.city].filter(Boolean).join(', ') || p.location || '—'}</div>
        <div className="pfacts">
          {p.area && <span>📐 {p.area} {p.unit}</span>}
          {p.bedrooms != null && <span>🛏 {p.bedrooms}</span>}
          {p.bathrooms != null && <span>🛁 {p.bathrooms}</span>}
          {p.installment && <span className="inst">💳 Installments</span>}
        </div>
        {p.agent && <div className="pagent"><span className="av">{p.agent.name.split(' ').map((x) => x[0]).join('').slice(0, 2)}</span><span className="grow">{p.agent.name}</span>
          {p.agent.phone && <a href={`tel:${p.agent.phone}`} aria-label={`Call ${p.agent.name}`} className="ic">📞</a>}
          {p.agent.whatsapp && <a href={waLink(p.agent.whatsapp, `Hi, I'm interested in ${p.title} (${p.code})`)} target="_blank" rel="noreferrer" aria-label="WhatsApp" className="ic">💬</a>}</div>}
      </div>
    </article>
  );
}

export function AgentCard({ a }) {
  return (
    <div className="acard">
      <div className="av lg">{a.name.split(' ').map((x) => x[0]).join('').slice(0, 2)}</div>
      <h4>{a.name}</h4>
      <div className="muted">{a.role === 'Sales Manager' ? 'Sales manager' : 'Listing agent'} · {a.listings} listing{a.listings === 1 ? '' : 's'}</div>
      <div className="acts">
        {a.phone && <a className="btn-s" href={`tel:${a.phone}`}>📞 Call</a>}
        {a.whatsapp && <a className="btn-s wa" href={waLink(a.whatsapp)} target="_blank" rel="noreferrer">💬 WhatsApp</a>}
        {a.email && <a className="btn-s" href={`mailto:${a.email}`}>✉️ Email</a>}
      </div>
      <Link to={`/site/agent/${a.id}`} className="more">View listings →</Link>
    </div>
  );
}

export function ProjectCard({ p }) {
  return (
    <Link to={`/site/project/${p.id}`} className="jcard">
      <div className="jimg">{p.cover ? <img src={imgUrl(p.cover)} alt={p.name} loading="lazy" /> : <Placeholder icon="🏗️" />}<span className="jstatus">{p.dev_status}</span></div>
      <div className="jbody">
        <h3>{p.name}</h3><div className="muted">📍 {p.location || '—'}</div>
        {p.description && <p>{p.description.slice(0, 110)}{p.description.length > 110 ? '…' : ''}</p>}
        <div className="jbar"><div style={{ width: `${p.progress || 0}%` }} /></div>
        <div className="jmeta"><span>{p.progress || 0}% developed</span><b>{p.available} available</b></div>
      </div>
    </Link>
  );
}

export function PostCard({ p }) {
  return (
    <Link to={`/site/blog/${p.slug}`} className="bcard">
      <div className="bimg">{p.cover ? <img src={imgUrl(p.cover)} alt={p.title} loading="lazy" /> : <Placeholder icon="📰" />}</div>
      <div className="bbody"><div className="muted">{(p.published_at || '').slice(0, 10)}</div><h3>{p.title}</h3><p>{p.excerpt}</p><span className="more">Read more →</span></div>
    </Link>
  );
}

/** Zameen-style search: Buy / Rent / Projects tabs with city, type and price. */
export function SearchBox({ initial = {}, onSearch }) {
  const nav = useNavigate();
  const facets = usePublic('/api/site/facets');
  const [tab, setTab] = useState(initial.purpose === 'Rent' ? 'Rent' : 'Buy');
  const [f, setF] = useState({ city: '', type: '', q: '', min_price: '', max_price: '', ...initial });
  const go = (e) => {
    e?.preventDefault();
    if (tab === 'Projects') return nav('/site/projects');
    const p = new URLSearchParams(); p.set('purpose', tab === 'Rent' ? 'Rent' : 'Sell');
    for (const k of ['city', 'type', 'q', 'min_price', 'max_price']) if (f[k]) p.set(k, f[k]);
    nav(`/site/properties?${p}`); onSearch?.();
  };
  return (
    <form className="searchbox" onSubmit={go}>
      <div className="stabs" role="tablist">{['Buy', 'Rent', 'Projects'].map((t) => <button type="button" role="tab" aria-selected={tab === t} key={t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>{t}</button>)}</div>
      {tab !== 'Projects' ? (
        <div className="sfields">
          <label>City<select value={f.city} onChange={(e) => setF({ ...f, city: e.target.value })}><option value="">All cities</option>{facets?.cities?.map((c) => <option key={c.value} value={c.value}>{c.value} ({c.n})</option>)}</select></label>
          <label>Type<select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}><option value="">All types</option>{facets?.types?.map((c) => <option key={c.value} value={c.value}>{c.value} ({c.n})</option>)}</select></label>
          <label className="budget">{tab === 'Rent' ? `${isPK() ? 'Monthly rent' : 'Rent'} (${curCode()})` : `Budget (${curCode()})`}<span className="two-in"><MoneyBox value={f.min_price} onChange={(v) => setF({ ...f, min_price: v })} placeholder={`Min  ${exampleAmount(2000000)}`} /><MoneyBox value={f.max_price} onChange={(v) => setF({ ...f, max_price: v })} placeholder={`Max  ${exampleAmount(10000000)}`} /></span></label>
          <label className="grow">Keyword<input value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} placeholder={siteCopy('keyword_placeholder', 'Location, project or plot no.')} /></label>
          <button className="btn-p" type="submit">Search</button>
        </div>
      ) : <div className="sfields"><span className="grow">Explore our planned communities, see development progress and available units.</span><button className="btn-p" type="submit">View projects</button></div>}
    </form>
  );
}

/** Lead capture — becomes a CRM contact assigned to the listing agent (or round-robin). */
export function InquiryForm({ propertyId, title = 'Send an enquiry', kind = 'inquiry', agent, compact }) {
  const [f, setF] = useState({ name: '', phone: '', email: '', message: '', website: '' });
  const [state, setState] = useState({ busy: false, done: null, err: '' });
  const submit = async (e) => {
    e.preventDefault(); setState({ busy: true, done: null, err: '' });
    try { const r = await api.post('/api/site/inquiry', { ...f, property_id: propertyId, kind }); setState({ busy: false, done: r.reference, err: '' }); setF({ name: '', phone: '', email: '', message: '', website: '' }); }
    catch (er) { setState({ busy: false, done: null, err: er.message }); }
  };
  if (state.done) return <div className="inq ok"><b>Thank you!</b><p>Your message was sent{agent ? ` to ${agent.name}` : ''}. We will contact you shortly. Reference <code>{state.done}</code>.</p></div>;
  return (
    <form className={`inq ${compact ? 'compact' : ''}`} onSubmit={submit}>
      <h4>{title}</h4>
      {state.err && <div className="inq-err" role="alert">{state.err}</div>}
      <input required placeholder="Your name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoComplete="name" />
      <input required placeholder="Phone number" inputMode="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} autoComplete="tel" />
      <input type="email" placeholder="Email (optional)" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} autoComplete="email" />
      <textarea rows={compact ? 3 : 4} placeholder="Message" value={f.message} onChange={(e) => setF({ ...f, message: e.target.value })} />
      <input className="hp" tabIndex={-1} autoComplete="off" aria-hidden="true" value={f.website} onChange={(e) => setF({ ...f, website: e.target.value })} />
      <button className="btn-p" disabled={state.busy}>{state.busy ? 'Sending…' : 'Send'}</button>
    </form>
  );
}

// ---------------------------------------------------------------- page sections
const Head = ({ title, subtitle, href, hrefLabel = 'View all →' }) => (title || subtitle) ? (
  <div className="sec-head"><div>{title && <h2>{title}</h2>}{subtitle && <p>{subtitle}</p>}</div>{href && <A href={href} className="more">{hrefLabel}</A>}</div>
) : null;

function Hero({ p }) {
  const bg = imgUrl(p.image);
  return (
    <section className={`hero ${p.height || 'tall'}`} style={bg ? { backgroundImage: `linear-gradient(rgba(4,36,34,${(p.overlay ?? 55) / 100}), rgba(4,36,34,${(p.overlay ?? 55) / 100})), url(${bg})` } : undefined}>
      <div className="wrap">
        <h1>{p.headline}</h1>{p.subheadline && <p>{p.subheadline}</p>}
        {p.cta_label && <A href={p.cta_href} className="btn-p lg">{p.cta_label}</A>}
        {p.show_search && <SearchBox />}
      </div>
    </section>
  );
}

function Listings({ p }) {
  const params = { limit: p.limit || 8, purpose: p.purpose || undefined, featured: p.source === 'featured' ? 1 : undefined, project_id: p.source === 'project' ? p.project_id : undefined, type: p.source === 'type' ? p.property_type : undefined, sort: p.source === 'latest' ? undefined : undefined };
  let d = usePublic('/api/site/listings', params);
  const fallback = usePublic(p.source === 'featured' && d && d.data?.length === 0 ? '/api/site/listings' : null, { limit: p.limit || 8 });
  if (d && p.source === 'featured' && d.data.length === 0 && fallback) d = fallback;
  return (
    <section className="sec"><div className="wrap">
      <Head title={p.title} subtitle={p.subtitle} href={p.view_all_href} />
      {!d ? <div className="skeleton-row">{[1, 2, 3, 4].map((i) => <div key={i} className="skeleton" />)}</div> : !d.data.length ? <p className="muted">No properties to show yet.</p> : (
        <div className={p.layout === 'carousel' ? 'carousel' : 'pgrid'}>{d.data.map((x) => <PropertyCard key={x.id} p={x} />)}</div>
      )}
    </div></section>
  );
}

function Projects({ p }) {
  const d = usePublic('/api/site/projects');
  return <section className="sec soft"><div className="wrap"><Head title={p.title} subtitle={p.subtitle} href="/site/projects" />{!d ? null : <div className="jgrid">{d.data.slice(0, p.limit || 3).map((x) => <ProjectCard key={x.id} p={x} />)}</div>}</div></section>;
}

const Stats = ({ p }) => <section className="stats"><div className="wrap">{(p.items || []).map((s, i) => <div key={i}><b>{s.value}</b><span>{s.label}</span></div>)}</div></section>;

const Services = ({ p }) => (
  <section className="sec"><div className="wrap"><Head title={p.title} />
    <div className="svc">{(p.items || []).map((s, i) => <A key={i} href={s.href} className="svc-card"><span className="svc-ic">{s.icon}</span><h4>{s.title}</h4><p>{s.text}</p></A>)}</div></div></section>
);

const Calculators = ({ p }) => <section className="sec soft"><div className="wrap"><Head title={p.title} subtitle={p.subtitle} href="/site/calculators" hrefLabel="Open full calculators →" /><CalculatorTabs /></div></section>;

function Agents({ p }) {
  const d = usePublic('/api/site/agents');
  if (d && !d.data.length) return null;
  return <section className="sec"><div className="wrap"><Head title={p.title} subtitle={p.subtitle} href="/site/agents" />{d && <div className="agrid">{d.data.slice(0, p.limit || 4).map((a) => <AgentCard key={a.id} a={a} />)}</div>}</div></section>;
}

const Testimonials = ({ p }) => (
  <section className="sec soft"><div className="wrap"><Head title={p.title} />
    <div className="tgrid">{(p.items || []).filter((t) => t.quote).map((t, i) => <figure key={i} className="tcard"><blockquote>“{t.quote}”</blockquote><figcaption><span className="av">{(t.name || '?')[0]}</span><div><b>{t.name}</b><small>{t.role}</small></div></figcaption></figure>)}</div></div></section>
);

function Blog({ p }) {
  const d = usePublic('/api/site/posts', { limit: p.limit || 3 });
  if (d && !d.data.length) return null;
  return <section className="sec"><div className="wrap"><Head title={p.title} href="/site/blog" />{d && <div className="bgrid">{d.data.map((x) => <PostCard key={x.id} p={x} />)}</div>}</div></section>;
}

function Cta({ p }) {
  const bg = imgUrl(p.image);
  return (
    <section className={`cta ${p.tone || 'dark'}`} style={bg ? { backgroundImage: `linear-gradient(rgba(4,36,34,.6), rgba(4,36,34,.6)), url(${bg})` } : undefined}>
      <div className="wrap"><h2>{p.headline}</h2>{p.text && <p>{p.text}</p>}{p.button_label && <A href={p.button_href} className="btn-p lg alt">{p.button_label}</A>}</div>
    </section>
  );
}

const TextBlock = ({ p }) => <section className="sec"><div className="wrap narrow" style={{ textAlign: p.align || 'left' }}>{p.title && <h2>{p.title}</h2>}<Markdown text={p.html} /></div></section>;

const ImageText = ({ p }) => (
  <section className="sec"><div className={`wrap split ${p.image_side === 'left' ? 'rev' : ''}`}>
    <div className="split-text">{p.title && <h2>{p.title}</h2>}<Markdown text={p.text} />{p.button_label && <A href={p.button_href} className="btn-p">{p.button_label}</A>}</div>
    <div className="split-img">{p.image ? <img src={imgUrl(p.image)} alt={p.title || ''} loading="lazy" /> : <Placeholder icon="🏡" />}</div>
  </div></section>
);

function Faq({ p }) {
  const [open, setOpen] = useState(0);
  return <section className="sec"><div className="wrap narrow"><Head title={p.title} />{(p.items || []).filter((i) => i.q).map((i, k) => (
    <div key={k} className={`faq ${open === k ? 'open' : ''}`}><button type="button" aria-expanded={open === k} onClick={() => setOpen(open === k ? -1 : k)}>{i.q}<span>{open === k ? '−' : '+'}</span></button>{open === k && <div className="faq-a"><Markdown text={i.a} /></div>}</div>))}</div></section>;
}

function Contact({ p }) {
  const { config } = useSite();
  const c = config.contact;
  return (
    <section className="sec"><div className="wrap split">
      <div className="split-text"><h2>{p.title}</h2>{p.text && <p>{p.text}</p>}
        {p.show_details && <ul className="cdetails">{c.phone && <li>📞 <a href={`tel:${c.phone}`}>{c.phone}</a></li>}{c.landline && <li>☎️ <a href={`tel:${c.landline}`}>{c.landline}</a></li>}{c.whatsapp && <li>💬 <a href={waLink(c.whatsapp)} target="_blank" rel="noreferrer">WhatsApp {c.whatsapp}</a></li>}{c.email && <li>✉️ <a href={`mailto:${c.email}`}>{c.email}</a></li>}{c.address && <li>📍 {c.address}</li>}{c.hours && <li>🕘 {c.hours}</li>}</ul>}</div>
      {p.show_form && <InquiryForm title="Send us a message" kind="contact" />}
    </div></section>
  );
}

const Gallery = ({ p }) => <section className="sec"><div className="wrap"><Head title={p.title} /><div className="ggrid">{(p.images || []).filter((i) => i.src).map((i, k) => <figure key={k}><img src={imgUrl(i.src)} alt={i.caption || ''} loading="lazy" />{i.caption && <figcaption>{i.caption}</figcaption>}</figure>)}</div></div></section>;

function Leadership({ p }) {
  const all = (p.members || []).filter((m) => m.name);
  if (!all.length) return null;
  const directors = all.filter((m) => m.director), team = all.filter((m) => !m.director);
  const contact = (m) => (m.phone || m.email) && <div className="mem-contact">{m.phone && <a href={`tel:${m.phone}`}>📞 {m.phone}</a>}{m.email && <a href={`mailto:${m.email}`}>✉️ {m.email}</a>}</div>;
  return (
    <section className="sec soft"><div className="wrap"><Head title={p.title} subtitle={p.subtitle} />
      {directors.map((m, i) => (
        <article key={i} className={`director ${i % 2 ? 'rev' : ''}`}>
          <div className="director-img">{m.photo ? <img src={imgUrl(m.photo)} alt={m.name} loading="lazy" /> : <Placeholder icon="👤" />}</div>
          <div className="director-body"><span className="eyebrow">{m.role}</span><h3>{m.name}</h3><Markdown text={m.bio} />{contact(m)}</div>
        </article>
      ))}
      {team.length > 0 && <div className="team-grid">{team.map((m, i) => (
        <article key={i} className="member">{m.photo ? <img src={imgUrl(m.photo)} alt={m.name} loading="lazy" /> : <span className="av lg">{m.name[0]}</span>}<h4>{m.name}</h4><small>{m.role}</small>{m.bio && <p>{m.bio}</p>}{contact(m)}</article>
      ))}</div>}
    </div></section>
  );
}

function ProjectInfo({ p }) {
  const line = (t) => { const [a, ...b] = String(t).split('|'); return [a.trim(), b.join('|').trim()]; };
  return (
    <section className="sec"><div className="wrap">
      <Head title={p.title} />
      {p.intro && <p className="pi-intro">{p.intro}</p>}
      {(p.stats || []).length > 0 && <div className="pi-stats">{p.stats.map((s, i) => <div key={i}><b>{s.value}</b><span>{s.label}</span></div>)}</div>}
      <div className="pi-groups">{(p.groups || []).map((g, i) => (
        <div key={i} className="pi-group"><h3>{g.heading}</h3>
          <ul>{String(g.items || '').split('\n').map((t) => t.trim()).filter(Boolean).map((t, k) => { const [a, b] = line(t); return <li key={k}><b>{a}</b>{b && <small>{b}</small>}</li>; })}</ul></div>
      ))}</div>
    </div></section>
  );
}

/** Free-form columns (1–4) with image, heading, text and button — the general-purpose layout block. */
function Columns({ p }) {
  const items = (p.items || []).filter((x) => x.title || x.text || x.image);
  const n = Math.min(4, Math.max(1, Number(p.cols) || items.length || 1));
  return (
    <section className="sec"><div className="wrap">
      <Head title={p.title} subtitle={p.subtitle} />
      <div className={`cols-grid va-${p.valign || 'top'}`} style={{ '--cols': n, '--n': items.length + 1 }}>
        {items.map((x, i) => (
          <div key={i} className="cols-item" style={{ '--i': i + 1 }}>
            {x.image && <img src={imgUrl(x.image)} alt={x.title || ''} loading="lazy" decoding="async" />}
            {x.title && <h3>{x.title}</h3>}
            {x.text && <Markdown text={x.text} />}
            {x.button_label && <A href={x.button_href} className="btn-p">{x.button_label}</A>}
          </div>
        ))}
      </div>
    </div></section>
  );
}

const Spacer = ({ p }) => <div className="spacer" style={{ height: Number(p.height) || 40 }} aria-hidden="true" />;

const METRICS = { listings: 'Properties available', featured: 'Featured properties', for_rent: 'Properties for rent', sold: 'Properties sold', projects: 'Live projects', agents: 'Listing agents', articles: 'Articles published' };
/** Numbers pulled live from the ERP (available listings, projects, sold units …) — they update themselves. */
function LiveStats({ p }) {
  const d = usePublic('/api/site/metrics');
  return (
    <section className="stats live"><div className="wrap">
      {(p.items || []).map((it, i) => <div key={i}><b>{d ? Number(d[it.metric] ?? 0).toLocaleString('en-PK') + (it.suffix || '') : '…'}</b><span>{it.label || METRICS[it.metric] || it.metric}</span></div>)}
    </div></section>
  );
}

/** Book a site visit: picks project, day and time slot, then arrives in the CRM as a lead with the request attached. */
function Booking({ p }) {
  const opts = usePublic('/api/site/booking-options');
  const slots = String(p.slots || '').split('\n').map((x) => x.trim()).filter(Boolean);
  const day = (n) => new Date(Date.now() + 5 * 3600e3 + n * 864e5).toISOString().slice(0, 10);
  const [f, setF] = useState({ name: '', phone: '', project: '', date: day(1), time: slots[0] || '', note: '', website: '' });
  const [st, setSt] = useState({ busy: false, done: '', err: '' });
  const submit = async (e) => {
    e.preventDefault(); setSt({ busy: true, done: '', err: '' });
    const dow = new Date(f.date).getUTCDay();
    if (p.skip_friday && dow === 5) return setSt({ busy: false, done: '', err: 'Visits are not available on Fridays — please pick another day.' });
    try {
      const r = await api.post('/api/site/inquiry', { name: f.name, phone: f.phone, kind: 'visit', website: f.website, message: `Site visit request: ${f.project || 'any project'} on ${f.date}${f.time ? ` at ${f.time}` : ''}.${f.note ? ` ${f.note}` : ''}` });
      setSt({ busy: false, done: r.reference, err: '' });
    } catch (er) { setSt({ busy: false, done: '', err: er.message }); }
  };
  return (
    <section className="sec soft"><div className="wrap narrow">
      <Head title={p.title} subtitle={p.subtitle} />
      {st.done ? <div className="inq ok"><b>Visit requested!</b><p>We will confirm your visit on {f.date}{f.time ? ` (${f.time})` : ''} by phone. Reference <code>{st.done}</code>.</p></div> : (
        <form className="inq booking" onSubmit={submit}>
          {st.err && <div className="inq-err" role="alert">{st.err}</div>}
          <div className="two"><input required placeholder="Your name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoComplete="name" /><input required placeholder="Phone number" inputMode="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} autoComplete="tel" /></div>
          <select value={f.project} onChange={(e) => setF({ ...f, project: e.target.value })}><option value="">Any project</option>{(opts?.projects || []).map((x) => <option key={x.id}>{x.name}</option>)}</select>
          <div className="two"><input type="date" required min={day(0)} value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />{slots.length > 0 && <select value={f.time} onChange={(e) => setF({ ...f, time: e.target.value })}>{slots.map((s) => <option key={s}>{s}</option>)}</select>}</div>
          <textarea rows={2} placeholder="Anything we should know? (optional)" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
          <input className="hp" tabIndex={-1} autoComplete="off" aria-hidden="true" value={f.website} onChange={(e) => setF({ ...f, website: e.target.value })} />
          <button className="btn-p" disabled={st.busy}>{st.busy ? 'Booking…' : 'Book my visit'}</button>
        </form>
      )}
    </div></section>
  );
}

/** Sign-in doors to the customer and vendor portals. */
const Portal = ({ p }) => (
  <section className="sec"><div className="wrap">
    <Head title={p.title} subtitle={p.subtitle} />
    <div className="portal-cards">
      {p.show_customer !== false && <A href="/portal/login" className="portal-card"><span>🏠</span><h3>Customer portal</h3><p>{siteCopy('portal_blurb', 'See your plot or house, payments, receipts, documents and construction progress.')}</p><b>Sign in →</b></A>}
      {p.show_vendor !== false && <A href="/vendor/login" className="portal-card"><span>🧰</span><h3>Vendor portal</h3><p>Check payments and ledger, and bid on open tenders and contracts.</p><b>Sign in →</b></A>}
    </div>
  </div></section>
);

const Banner = ({ p }) => { const inner = <div className="wrap">{p.text}</div>; return p.href ? <A href={p.href} className={`banner ${p.tone || 'primary'}`}>{inner}</A> : <div className={`banner ${p.tone || 'primary'}`}>{inner}</div>; };

const MAP = { hero: Hero, listings: Listings, projects: Projects, stats: Stats, services: Services, calculators: Calculators, agents: Agents, testimonials: Testimonials, blog: Blog, cta: Cta, text: TextBlock, imagetext: ImageText, faq: Faq, contact: Contact, gallery: Gallery, banner: Banner, leadership: Leadership, projectinfo: ProjectInfo, columns: Columns, spacer: Spacer, livestats: LiveStats, booking: Booking, portal: Portal };

/**
 * Renders a page's sections. Each one sits in a wrapper (#sb-<id>) so the responsive layout settings can be compiled
 * into one small stylesheet: desktop rules, then @media (max-width:768px) for tablet and (max-width:480px) for mobile.
 * `wrap` lets the visual editor add its selection / drag handles around every block.
 */
export function SectionRenderer({ sections, wrap, editor }) {
  const list = sections || [];
  const css = useMemo(() => sectionCss(list, { keepHidden: !!editor }), [list, editor]);
  return (
    <>
      {css && <style>{css}</style>}
      {list.map((s, i) => {
        const C = MAP[s.type]; if (!C) return null;
        const node = <div key={s.id} id={`sb-${safeId(s.id)}`} className={`sb ${editor ? 'sb-ed' : ''}`} data-sid={s.id} data-type={s.type}><C p={s.props || {}} />{s.style?.anchor && <span id={s.style.anchor} className="sb-anchor" />}</div>;
        return wrap ? wrap(node, s, i) : node;
      })}
    </>
  );
}
