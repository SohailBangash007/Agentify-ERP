/**
 * Allow-list HTML sanitiser for the rich-text editor (blog posts, website text blocks).
 * No dependencies: tags, attributes, classes and inline styles are re-emitted only if they are on the lists below,
 * links and image sources must be safe, and anything else (scripts, iframes, event handlers, unknown styles) is dropped.
 */

const TAGS = new Set(['p', 'div', 'br', 'hr', 'h2', 'h3', 'h4', 'strong', 'em', 'u', 's', 'mark', 'sub', 'sup', 'ul', 'ol', 'li', 'blockquote', 'a', 'img', 'figure', 'figcaption', 'span', 'pre', 'code']);
const RENAME = { b: 'strong', i: 'em', strike: 's', del: 's', h1: 'h2', h5: 'h4', h6: 'h4', font: 'span' };
const VOID = new Set(['br', 'hr', 'img']);
const SKIP = new Set(['script', 'style', 'iframe', 'object', 'embed', 'noscript', 'template', 'svg', 'math', 'form', 'textarea', 'select', 'button', 'title', 'head']);
const CLASSES = new Set(['callout', 'callout-tip', 'callout-warn', 'lead', 'align-left', 'align-center', 'align-right', 'align-justify', 'img-left', 'img-right', 'img-center', 'img-full', 'img-sm', 'img-md', 'img-lg', 'cta-line']);
export const EDITOR_FONTS = ['Inter', 'Poppins', 'Roboto', 'Open Sans', 'Montserrat', 'Lato', 'Nunito', 'Playfair Display', 'Merriweather', 'DM Sans', 'Manrope', 'Raleway', 'Work Sans', 'Source Sans 3', 'Georgia', 'Times New Roman', 'Arial', 'Courier New'];
const SIZES = new Set(['12px', '14px', '16px', '18px', '20px', '24px', '28px', '32px', '40px']);
const COLOR = /^(#[0-9a-f]{3,8}|rgb\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*\)|rgba\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*[\d.]+\s*\))$/i;
const SAFE_HREF = /^(https?:\/\/[^\s"'<>]+|\/(?!\/)[^\s"'<>]*|#[\w-]*|mailto:[^\s"'<>]+|tel:[+\d\s()-]+)$/i;
const SAFE_SRC = /^(media\/[\w.-]+|\/uploads\/[\w./-]+|\/site\/[\w.-]+|https:\/\/[^\s"'<>]+)$/i;

const esc = (s) => String(s).replace(/&(?!(?:[a-z]+|#\d+|#x[0-9a-f]+);)/gi, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const unesc = (s) => String(s).replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');

function cleanStyle(raw) {
  const out = [];
  for (const decl of String(raw || '').split(';')) {
    const i = decl.indexOf(':'); if (i < 0) continue;
    const k = decl.slice(0, i).trim().toLowerCase(), v = decl.slice(i + 1).trim().replace(/^["']|["']$/g, '');
    if (k === 'font-family') {
      const first = v.split(',')[0].trim().replace(/^["']|["']$/g, '');
      const hit = EDITOR_FONTS.find((f) => f.toLowerCase() === first.toLowerCase());
      if (hit) out.push(`font-family: '${hit}'`);
    } else if (k === 'font-size' && SIZES.has(v.toLowerCase())) out.push(`font-size: ${v.toLowerCase()}`);
    else if ((k === 'color' || k === 'background-color' || k === 'background') && COLOR.test(v)) out.push(`${k === 'background' ? 'background-color' : k}: ${v}`);
    else if (k === 'text-align' && /^(left|center|right|justify)$/i.test(v)) out.push(`text-align: ${v.toLowerCase()}`);
  }
  return out.join('; ');
}

function attrsOf(str) {
  const attrs = {}; const re = /([a-zA-Z_:][-\w:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g; let m;
  while ((m = re.exec(str))) attrs[m[1].toLowerCase()] = unesc(m[2] ?? m[3] ?? m[4] ?? '');
  return attrs;
}

const slug = (t) => String(t).toLowerCase().replace(/&[a-z#0-9]+;/g, ' ').replace(/[^a-z0-9؀-ۿ]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);

export function sanitizeHtml(input) {
  const html = String(input ?? '').slice(0, 400_000);
  const parts = html.split(/(<!--[\s\S]*?-->|<\/?[a-zA-Z][^>]*>)/g);
  const out = []; const stack = []; let skip = null;
  for (const part of parts) {
    if (!part || part.startsWith('<!--')) continue;
    const tag = /^<(\/?)([a-zA-Z][a-zA-Z0-9]*)([^>]*)>$/.exec(part);
    if (!tag) { if (!skip) out.push(esc(part).replace(/</g, '&lt;')); continue; }
    const closing = tag[1] === '/', raw = tag[2].toLowerCase(), name = RENAME[raw] || raw;
    if (skip) { if (closing && raw === skip) skip = null; continue; }
    if (SKIP.has(raw)) { if (!closing && !/\/\s*$/.test(tag[3])) skip = raw; continue; }
    if (!TAGS.has(name)) continue;
    if (closing) {
      if (VOID.has(name)) continue;
      const at = stack.lastIndexOf(name);
      if (at < 0) continue;
      while (stack.length > at) out.push(`</${stack.pop()}>`);
      continue;
    }
    const a = attrsOf(tag[3]);
    const attrs = [];
    const style = cleanStyle(raw === 'font' ? `${a.face ? `font-family:${a.face}` : ''};${a.color ? `color:${a.color}` : ''};${a.style || ''}` : a.style);
    if (style && !['br', 'hr', 'img', 'li', 'ul', 'ol'].includes(name)) attrs.push(`style="${style.replace(/"/g, "'")}"`);
    const cls = String(a.class || '').split(/\s+/).filter((c) => CLASSES.has(c));
    if (cls.length) attrs.push(`class="${cls.join(' ')}"`);
    if (name === 'a') {
      const href = String(a.href || '').trim();
      if (SAFE_HREF.test(href)) { attrs.push(`href="${esc(href)}"`); if (/^https?:/i.test(href)) attrs.push('target="_blank"', 'rel="noopener noreferrer"'); }
    }
    if (name === 'img') {
      const src = String(a.src || '').trim();
      if (!SAFE_SRC.test(src)) continue;
      attrs.push(`src="${esc(src)}"`, `alt="${esc(String(a.alt || '').slice(0, 200))}"`, 'loading="lazy"');
      const w = parseInt(a.width, 10), h = parseInt(a.height, 10);
      if (w > 0 && w <= 4000) attrs.push(`width="${w}"`); if (h > 0 && h <= 4000) attrs.push(`height="${h}"`);
    }
    out.push(`<${name}${attrs.length ? ` ${attrs.join(' ')}` : ''}>`);
    if (!VOID.has(name)) stack.push(name);
  }
  while (stack.length) out.push(`</${stack.pop()}>`);
  // anchors for the table of contents
  const used = new Set();
  return out.join('').replace(/<(h[234])([^>]*)>([\s\S]*?)<\/\1>/g, (all, h, attrs, inner) => {
    const base = slug(inner.replace(/<[^>]+>/g, '')) || 'section'; let id = base, n = 2;
    while (used.has(id)) id = `${base}-${n++}`; used.add(id);
    return `<${h}${attrs} id="${id}">${inner}</${h}>`;
  });
}

export const isHtml = (s) => /<\/?(p|h[1-6]|div|ul|ol|figure|img|blockquote|strong|em|span|br)\b/i.test(String(s || ''));
export const stripHtml = (s) => unesc(String(s || '').replace(/<(br|\/p|\/h[1-6]|\/li|\/div|\/figure|\/blockquote)[^>]*>/gi, ' ').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim());
export const wordCount = (s) => (stripHtml(isHtml(s) ? s : String(s || '').replace(/[*#\[\]()]/g, ' ')).match(/[\w؀-ۿ'’-]+/g) || []).length;
export const readingMinutes = (s) => Math.max(1, Math.round(wordCount(s) / 210));
export function outline(html) {
  const items = []; const re = /<(h[234])[^>]*\sid="([^"]+)"[^>]*>([\s\S]*?)<\/\1>/g; let m;
  while ((m = re.exec(html || ''))) items.push({ level: Number(m[1][1]), id: m[2], text: stripHtml(m[3]) });
  return items;
}
