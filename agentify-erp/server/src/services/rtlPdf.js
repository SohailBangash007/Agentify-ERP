// Right-to-left (Arabic-script) text for pdfkit. pdfkit shapes Arabic correctly (joined letters) but draws glyphs in
// logical order, which reads backwards. drawText() splits a string into Arabic-script runs and everything else, then
// draws the runs in visual order: Arabic runs are laid out with their glyphs reversed, other runs normally.
// The font is Noto Naskh Arabic (SIL Open Font License), shipped in server/assets/fonts.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FONT_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'assets', 'fonts', 'NotoNaskhArabic-Regular.woff');
export const ARABIC_FONT = 'NotoNaskhArabic';
const ARABIC = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/;
export const hasArabic = (s) => ARABIC.test(String(s ?? ''));

/** Runs of text: [{ rtl: boolean, text }]. Spaces and punctuation between two Arabic words stay in the Arabic run. */
export function runs(str) {
  const out = [];
  for (const ch of String(str ?? '')) {
    const rtl = ARABIC.test(ch);
    const neutral = /[\s،؛؟.,:;()\-]/.test(ch) && !rtl;
    const last = out[out.length - 1];
    if (neutral && last) last.text += ch;
    else if (last && last.rtl === rtl) last.text += ch;
    else out.push({ rtl, text: ch });
  }
  // trailing neutrals belong to the preceding run; a neutral-only run between two Arabic runs joins them
  for (let i = 1; i < out.length - 1; i += 1) {
    if (!out[i].rtl && /^[\s،؛؟.,:;()\-]+$/.test(out[i].text) && out[i - 1].rtl && out[i + 1].rtl) { out[i - 1].text += out[i].text + out[i + 1].text; out.splice(i, 2); i -= 1; }
  }
  return out;
}

export function registerArabic(doc) {
  if (!doc._rtlRegistered) { doc.registerFont(ARABIC_FONT, FONT_FILE); doc._rtlRegistered = true; }
}

/** Width of a mixed string in points at the current size (Arabic runs measured with the Arabic font). */
function widthOf(doc, text, latinFont, size) {
  return runs(text).reduce((w, r) => {
    doc.font(r.rtl ? ARABIC_FONT : latinFont).fontSize(size);
    return w + doc.widthOfString(r.text);
  }, 0);
}

/**
 * Draw `text` with its right edge at x (right-to-left, the way Arabic reads). `latinFont` is the pdfkit font used for
 * non-Arabic runs. Returns the width drawn.
 */
export function drawRtl(doc, text, xRight, y, { size = 11, latinFont = 'Helvetica', color } = {}) {
  registerArabic(doc);
  const rs = runs(text);
  const total = widthOf(doc, text, latinFont, size);
  let x = xRight - total;
  if (color) doc.fillColor(color);
  // visual order for a right-to-left paragraph: the first run in reading order sits at the right
  for (const r of [...rs].reverse()) {
    if (r.rtl) {
      doc.font(ARABIC_FONT).fontSize(size);
      const font = doc._font;
      const original = font.layout;
      // reverse the shaped glyphs (and their positions) so the text reads right to left when drawn left to right
      font.layout = function layout(...a) {
        const res = original.apply(this, a);
        if (!res.glyphs) return res; // width-only measurement
        return { ...res, glyphs: [...res.glyphs].reverse(), positions: [...res.positions].reverse() };
      };
      try { doc.text(r.text, x, y, { lineBreak: false }); } finally { font.layout = original; }
      x += doc.widthOfString(r.text);
    } else {
      doc.font(latinFont).fontSize(size).text(r.text, x, y, { lineBreak: false });
      x += doc.widthOfString(r.text);
    }
  }
  return total;
}
