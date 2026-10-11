import { useMemo } from 'react';
import { Field } from './ui.jsx';

export const slugify = (s) => String(s || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);

/** Score an article the way an SEO plugin would: returns [{ok,label,tip}] and a 0–100 score. */
export function analyse(post) {
  const doc = new DOMParser().parseFromString(post.body || '', 'text/html');
  const text = (doc.body.textContent || '').replace(/\s+/g, ' ').trim();
  const words = (text.match(/[\w؀-ۿ'’-]+/g) || []).length;
  const kw = String(post.focus_keyword || '').trim().toLowerCase();
  const title = (post.seo_title || post.title || '').trim();
  const desc = (post.seo_desc || post.excerpt || '').trim();
  const heads = [...doc.querySelectorAll('h2,h3,h4')];
  const imgs = [...doc.querySelectorAll('img')];
  const links = [...doc.querySelectorAll('a[href]')].map((a) => a.getAttribute('href'));
  const first = text.split(' ').slice(0, 100).join(' ').toLowerCase();
  const slug = (post.slug || slugify(post.title)).replace(/-/g, ' ');
  const count = kw ? (text.toLowerCase().match(new RegExp(kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length : 0;
  const density = words && kw ? (count * kw.split(/\s+/).length * 100) / words : 0;
  const c = [
    { ok: !!kw, label: 'Focus keyword is set', tip: 'The phrase people would search for, e.g. “plots in Islamabad”.' },
    { ok: kw && title.toLowerCase().includes(kw), label: 'Keyword is in the SEO title', tip: 'Put it near the start of the title.', needs: kw },
    { ok: kw && desc.toLowerCase().includes(kw), label: 'Keyword is in the meta description', needs: kw },
    { ok: kw && first.includes(kw), label: 'Keyword appears in the first paragraph', needs: kw },
    { ok: kw && heads.some((h) => h.textContent.toLowerCase().includes(kw)), label: 'Keyword is in a subheading', needs: kw },
    { ok: kw && slug.includes(kw), label: 'Keyword is in the web address', tip: 'Edit the web address so it contains the keyword.', needs: kw },
    { ok: kw && density >= 0.4 && density <= 2.8, label: `Keyword density is healthy (${density.toFixed(1)}%, aim for 0.5–2.5%)`, needs: kw },
    { ok: title.length >= 30 && title.length <= 60, label: `SEO title is 30–60 characters (now ${title.length})` },
    { ok: desc.length >= 70 && desc.length <= 160, label: `Meta description is 70–160 characters (now ${desc.length})` },
    { ok: words >= 300, label: `Article has at least 300 words (now ${words})`, tip: 'Longer, useful articles rank better — 600+ is ideal.' },
    { ok: heads.filter((h) => h.tagName !== 'H4').length >= 2, label: 'Uses at least two subheadings (Heading 2 / 3)', tip: 'Break the article into sections.' },
    { ok: imgs.length > 0, label: 'Has at least one image' },
    { ok: imgs.length > 0 && imgs.every((i) => (i.getAttribute('alt') || '').trim()), label: imgs.length ? 'Every image has alt text' : 'Alt text on images', tip: 'Click an image in the editor and describe it.', needs: imgs.length },
    { ok: links.some((h) => /^\/|expertdevelopers/.test(h || '')), label: 'Links to another page of your site', tip: 'Link to a project, property or another article.' },
    { ok: !!post.cover, label: 'Cover image is set (used when the link is shared)' },
  ].filter((x) => x.needs === undefined || x.needs);
  const score = Math.round((c.filter((x) => x.ok).length / c.length) * 100);
  return { checks: c, score, words, headings: heads.map((h) => ({ level: Number(h.tagName[1]), text: h.textContent })) };
}

/** Side panel for the article editor: SEO fields, search preview, checklist, outline. */
export default function SeoAssistant({ post, set, base }) {
  const a = useMemo(() => analyse(post), [post.body, post.title, post.seo_title, post.seo_desc, post.excerpt, post.focus_keyword, post.slug, post.cover]); // eslint-disable-line
  const tone = a.score >= 80 ? 'green' : a.score >= 50 ? 'amber' : 'red';
  const t = post.seo_title || post.title || '', d = post.seo_desc || post.excerpt || '';
  const len = (v, lo, hi) => <span className={`pill ${!v.length ? 'grey' : v.length < lo || v.length > hi ? 'amber' : 'green'}`} style={{ marginLeft: 6 }}>{v.length}</span>;
  return (
    <aside className="seo-side">
      <div className="row between"><b>SEO score</b><span className={`pill ${tone}`} style={{ fontSize: 14 }}>{a.score}/100</span></div>
      <div className="seo-bar"><i style={{ width: `${a.score}%` }} className={tone} /></div>
      <Field label="Focus keyword" hint="One phrase this article should rank for"><input className="input" value={post.focus_keyword || ''} onChange={(e) => set({ focus_keyword: e.target.value })} placeholder="e.g. plots in Islamabad" /></Field>
      <Field label={<>SEO title{len(t, 30, 60)}</>}><input className="input" value={post.seo_title || ''} onChange={(e) => set({ seo_title: e.target.value })} placeholder={post.title} /></Field>
      <Field label={<>Meta description{len(d, 70, 160)}</>}><textarea className="textarea" rows={3} value={post.seo_desc || ''} onChange={(e) => set({ seo_desc: e.target.value })} placeholder={post.excerpt || 'Shown under the title in Google'} /></Field>
      <div className="serp">
        <div className="serp-url">{(base || window.location.origin).replace(/^https?:\/\//, '')}/site/blog/{post.slug || slugify(post.title) || '…'}</div>
        <div className="serp-t">{t.slice(0, 62) || 'Article title'}{t.length > 62 ? '…' : ''}</div>
        <div className="serp-d">{d.slice(0, 160) || 'No description yet.'}{d.length > 160 ? '…' : ''}</div>
      </div>
      <ul className="seo-checks">{a.checks.map((c) => <li key={c.label} className={c.ok ? 'ok' : 'no'} title={c.ok ? '' : c.tip}><span>{c.ok ? '✓' : '!'}</span>{c.label}</li>)}</ul>
      {a.headings.length > 0 && <details open><summary><b>Outline</b> ({a.headings.length})</summary><ol className="seo-outline">{a.headings.map((h, i) => <li key={i} style={{ marginLeft: (h.level - 2) * 14 }}>{h.text}</li>)}</ol></details>}
    </aside>
  );
}
