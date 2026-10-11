/**
 * Responsive layout settings for website sections (shared by the editor, the public site and the server validator).
 *
 * A section carries   style: { desktop: {…}, tablet: {…}, mobile: {…}, anchor: 'about-us' }
 * Desktop settings apply everywhere. Tablet settings apply at ≤ 768px and mobile settings at ≤ 480px, so a mobile
 * edit never touches the desktop layout, and a desktop edit cascades down until a smaller device overrides it.
 */

export const DEVICES = ['desktop', 'tablet', 'mobile'];
export const BREAKPOINTS = { tablet: 768, mobile: 480 };

/** key → [label, type, min, max, unit] — drives the editor controls, the validator and the CSS generator. */
export const STYLE_FIELDS = {
  hide: ['Hide on this device', 'bool'],
  pad_top: ['Space above content', 'num', 0, 300, 'px'],
  pad_bottom: ['Space below content', 'num', 0, 300, 'px'],
  pad_x: ['Side padding', 'num', 0, 120, 'px'],
  margin_top: ['Outer margin above', 'num', 0, 300, 'px'],
  margin_bottom: ['Outer margin below', 'num', 0, 300, 'px'],
  max_width: ['Maximum content width', 'num', 320, 1600, 'px'],
  min_height: ['Minimum height', 'num', 0, 1000, 'px'],
  align: ['Text alignment', 'align'],
  scale: ['Text & content size', 'num', 50, 150, '%'],
  cols: ['Columns', 'num', 1, 4, ''],
  gap: ['Gap between items', 'num', 0, 80, 'px'],
  reverse: ['Reverse stacking order', 'bool'],
  bg_color: ['Background colour', 'color'],
  bg_image: ['Background image', 'image'],
  overlay: ['Image darkening', 'num', 0, 85, '%'],
};

const HEX = /^#[0-9a-fA-F]{3,8}$/;
const IMG = /^(media\/[\w.-]+|\/uploads\/[\w./-]+|\/site\/[\w.-]+|https:\/\/[^\s"'()<>]+)$/;
export const safeId = (id) => String(id || '').replace(/[^\w-]/g, '').slice(0, 40);

/** Returns a cleaned copy of a section style (unknown keys and out-of-range values dropped). Throws Error on invalid colours / images. */
export function cleanSectionStyle(style) {
  if (!style || typeof style !== 'object' || Array.isArray(style)) return undefined;
  const out = {};
  for (const d of DEVICES) {
    const src = style[d]; if (!src || typeof src !== 'object') continue;
    const o = {};
    for (const [k, def] of Object.entries(STYLE_FIELDS)) {
      const v = src[k]; if (v === undefined || v === null || v === '') continue;
      if (def[1] === 'bool') o[k] = !!v;
      else if (def[1] === 'num') { const n = Number(v); if (!Number.isFinite(n)) throw new Error(`${def[0]} must be a number`); o[k] = Math.min(def[3], Math.max(def[2], Math.round(n))); }
      else if (def[1] === 'align') { if (!['left', 'center', 'right'].includes(v)) throw new Error('Text alignment must be left, centre or right'); o[k] = v; }
      else if (def[1] === 'color') { if (!HEX.test(String(v))) throw new Error('Background colour must be a hex value like #0f766e'); o[k] = v; }
      else if (def[1] === 'image') { if (!IMG.test(String(v))) throw new Error('Background image must be an uploaded image or an https:// link'); o[k] = String(v); }
    }
    if (Object.keys(o).length) out[d] = o;
  }
  if (style.anchor) { const a = String(style.anchor).toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/^-+|-+$/g, '').slice(0, 40); if (a) out.anchor = a; }
  return Object.keys(out).length ? out : undefined;
}

/** The value a device actually uses: its own override, else the next larger device, else undefined. */
export function resolveStyle(style, device, key) {
  const order = device === 'mobile' ? ['mobile', 'tablet', 'desktop'] : device === 'tablet' ? ['tablet', 'desktop'] : ['desktop'];
  for (const d of order) { const v = style?.[d]?.[key]; if (v !== undefined) return { value: v, from: d }; }
  return { value: undefined, from: null };
}

const imgUrl = (p) => (/^https?:/.test(p) ? p : /^\//.test(p) ? p : `/uploads/${p}`);

function rules(sel, s, device, keepHidden) {
  const r = [];
  const root = `${sel} > :first-child`;
  if (s.hide !== undefined && !keepHidden) r.push(s.hide ? `${sel}{display:none !important}` : (device === 'desktop' ? '' : `${sel}{display:block !important}`));
  if (s.margin_top !== undefined) r.push(`${sel}{margin-top:${s.margin_top}px}`);
  if (s.margin_bottom !== undefined) r.push(`${sel}{margin-bottom:${s.margin_bottom}px}`);
  if (s.pad_top !== undefined) r.push(`${root}{padding-top:${s.pad_top}px !important}`);
  if (s.pad_bottom !== undefined) r.push(`${root}{padding-bottom:${s.pad_bottom}px !important}`);
  if (s.pad_x !== undefined) r.push(`${sel} .wrap{padding-left:${s.pad_x}px !important;padding-right:${s.pad_x}px !important}`);
  if (s.max_width !== undefined) r.push(`${sel} .wrap{max-width:${s.max_width}px !important}`);
  if (s.min_height !== undefined) r.push(`${root}{min-height:${s.min_height}px}`);
  if (s.align !== undefined) r.push(`${sel}{text-align:${s.align}}${sel} .head,${sel} .sec-head{text-align:${s.align}}`);
  if (s.scale !== undefined) r.push(`${sel}{zoom:${s.scale}%}`);
  if (s.cols !== undefined) r.push(`${sel} .cols-grid{grid-template-columns:repeat(${s.cols},minmax(0,1fr)) !important}`);
  if (s.gap !== undefined) r.push(`${sel} :is(.cols-grid,.pgrid,.jgrid,.svc,.agrid,.bgrid,.team-grid){gap:${s.gap}px !important}`);
  if (s.reverse !== undefined) {
    r.push(s.reverse
      ? `${sel} :is(.split,.director)>:first-child{order:2 !important}${sel} :is(.split,.director)>:nth-child(2){order:1 !important}${sel} .cols-grid>*{order:calc(var(--n) - var(--i)) !important}`
      : `${sel} :is(.split,.director,.cols-grid)>*{order:0 !important}`);
  }
  if (s.bg_color !== undefined) r.push(`${root}{background-color:${s.bg_color} !important}`);
  if (s.bg_image !== undefined) {
    const o = (s.overlay ?? 0) / 100;
    r.push(`${root}{background-image:${o ? `linear-gradient(rgba(0,0,0,${o}),rgba(0,0,0,${o})),` : ''}url("${imgUrl(s.bg_image)}") !important;background-size:cover !important;background-position:center !important}`);
  } else if (s.overlay !== undefined && device !== 'desktop') { /* overlay only matters with an image */ }
  return r.filter(Boolean).join('');
}

/** Compile every section's responsive settings into one small stylesheet (desktop rules, then @media for tablet and mobile). */
export function sectionCss(sections, { keepHidden = false } = {}) {
  let base = '', tab = '', mob = '';
  for (const sec of sections || []) {
    const st = sec.style; if (!st) continue;
    const sel = `#sb-${safeId(sec.id)}`;
    if (st.desktop) base += rules(sel, st.desktop, 'desktop', keepHidden);
    if (st.tablet) tab += rules(sel, st.tablet, 'tablet', keepHidden);
    if (st.mobile) mob += rules(sel, st.mobile, 'mobile', keepHidden);
  }
  return `${base}${tab ? `@media (max-width:${BREAKPOINTS.tablet}px){${tab}}` : ''}${mob ? `@media (max-width:${BREAKPOINTS.mobile}px){${mob}}` : ''}`;
}
