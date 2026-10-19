import PDFDocument from 'pdfkit';
import fs from 'node:fs';
import path from 'node:path';
import { getSetting, uploadDir } from '../db.js';
import { now } from '../util.js';

const money = (n) => `PKR ${Math.round(Number(n) || 0).toLocaleString('en-PK')}`;
const NAVY = '#0f1b33', GREY = '#667085', LINE = '#e4e7ec', ZEBRA = '#f7f8fa';

export function brand() {
  const g = (k, d = '') => getSetting(k, d) || d;
  let social = [];
  try { social = JSON.parse(g('print_social', '[]')).filter((x) => x.handle); } catch { /* ignore */ }
  const logoRel = g('print_logo');
  const logo = logoRel && g('print_show_logo', '1') !== '0' ? path.join(uploadDir(), logoRel) : null;
  return {
    name: g('print_header') || g('company_name', 'Agentify ERP'), address: g('print_address') || g('company_address'),
    phone: g('print_phone') || g('company_phone'), email: g('print_email') || g('company_email'), website: g('print_website'),
    footer: g('print_footer'), social, logo: logo && fs.existsSync(logo) ? logo : null,
  };
}

const cell = (c, v) => {
  if (v === null || v === undefined || v === '') return '';
  if (c.type === 'money' || (typeof v === 'number' && /(price|amount|paid|outstanding|overdue|balance|debit|credit|value|budget|salary|net)$/i.test(c.key))) return money(v);
  if (c.type === 'number' || (typeof v === 'number' && !/(^|_)(id|no|year)$/i.test(c.key))) return typeof v === 'number' ? v.toLocaleString('en-PK') : String(v);
  return String(v);
};

/**
 * Real PDF generation (vector text, repeating headers, page numbers) — replaces printing the browser window.
 * spec: { title, subtitle, summary:[[label,value]], sections:[{heading,text,columns:[{key,label,type}],rows,totals}] }
 * (or columns/rows/totals directly for a single table)
 */
export function sendPdf(res, filename, spec) {
  const sections = spec.sections || [{ columns: spec.columns, rows: spec.rows, totals: spec.totals }];
  const widest = Math.max(0, ...sections.map((s) => (s.columns || []).length));
  const landscape = widest > 6;
  const doc = new PDFDocument({ size: 'A4', layout: landscape ? 'landscape' : 'portrait', margin: 36, bufferPages: true, info: { Title: spec.title, Author: brand().name } });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename.replace(/[^\w.\- ]/g, '_')}.pdf"`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  doc.pipe(res);
  const b = brand();
  const M = 36, W = doc.page.width - M * 2;

  // ---- letterhead
  let y = M;
  if (b.logo) { try { doc.image(b.logo, M, y, { fit: [90, 46] }); } catch { /* unsupported image type */ } }
  const tx = b.logo ? M + 100 : M;
  doc.font('Helvetica-Bold').fontSize(15).fillColor(NAVY).text(b.name, tx, y, { width: W - (tx - M) - 170 });
  doc.font('Helvetica').fontSize(8.5).fillColor(GREY).text([b.address, [b.phone, b.email, b.website].filter(Boolean).join('  ·  ')].filter(Boolean).join('\n'), tx, doc.y + 1, { width: W - (tx - M) - 170 });
  doc.font('Helvetica-Bold').fontSize(13).fillColor(NAVY).text(spec.title, M, y, { width: W, align: 'right' });
  doc.font('Helvetica').fontSize(8.5).fillColor(GREY).text([spec.subtitle, `Generated ${now()} PKT`].filter(Boolean).join('\n'), M, doc.y + 1, { width: W, align: 'right' });
  y = Math.max(doc.y, y + 50) + 13;
  doc.moveTo(M, y).lineTo(M + W, y).lineWidth(1.5).strokeColor(NAVY).stroke();
  doc.y = y + 10;

  // ---- summary boxes
  if (spec.summary?.length) {
    const n = Math.min(spec.summary.length, 4), bw = (W - (n - 1) * 8) / n;
    let x = M; const top = doc.y;
    spec.summary.slice(0, 8).forEach(([label, value], i) => {
      if (i && i % n === 0) { x = M; doc.y = top + 46 * Math.floor(i / n); }
      const yy = top + 46 * Math.floor(i / n);
      doc.roundedRect(x, yy, bw, 38, 4).fillAndStroke('#f4f6fa', LINE);
      doc.fillColor(GREY).font('Helvetica').fontSize(7.5).text(label, x + 8, yy + 6, { width: bw - 16 });
      doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(11).text(String(value), x + 8, yy + 19, { width: bw - 16 });
      x += bw + 8;
    });
    doc.y = top + 46 * Math.ceil(Math.min(spec.summary.length, 8) / n) + 4;
  }

  // ---- voucher layout: key/value details in two columns, then a prominent amount box
  if (spec.details?.length) {
    const rows = spec.details.filter(([, v]) => v !== null && v !== undefined && v !== '' && v !== '—');
    const colW = (W - 24) / 2, half = Math.ceil(rows.length / 2), top = doc.y;
    let maxY = top;
    [rows.slice(0, half), rows.slice(half)].forEach((col, ci) => {
      let yy = top; const x = M + ci * (colW + 24);
      col.forEach(([l, v]) => {
        doc.font('Helvetica').fontSize(8.5).fillColor(GREY).text(l, x, yy + 1, { width: 92 });
        doc.font('Helvetica-Bold').fontSize(9.5).fillColor('#1f2937');
        const h = Math.max(15, doc.heightOfString(String(v), { width: colW - 98 }) + 5);
        doc.text(String(v), x + 98, yy, { width: colW - 98 });
        yy += h;
      });
      maxY = Math.max(maxY, yy);
    });
    doc.y = maxY + 8;
  }
  if (spec.amount) {
    const top = doc.y;
    doc.roundedRect(M, top, W, spec.amount.sub ? 66 : 54, 6).fillAndStroke('#f4f6fa', LINE);
    doc.fillColor(GREY).font('Helvetica').fontSize(9).text(spec.amount.label, M, top + 9, { width: W, align: 'center' });
    doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(24).text(spec.amount.value, M, top + 21, { width: W, align: 'center' });
    if (spec.amount.sub) doc.fillColor(GREY).font('Helvetica').fontSize(8.5).text(spec.amount.sub, M, top + 51, { width: W, align: 'center' });
    doc.y = top + (spec.amount.sub ? 78 : 66);
  }

  const bottom = () => doc.page.height - M - 26;
  const table = (cols, rows, totals) => {
    const sample = rows.slice(0, 60);
    const weight = cols.map((c) => Math.min(34, Math.max(c.label.length + 2, ...sample.map((r) => cell(c, r[c.key]).length), 6)));
    const sum = weight.reduce((a, v) => a + v, 0);
    const widths = weight.map((w) => (w / sum) * W);
    const right = cols.map((c) => c.type === 'money' || c.type === 'number' || sample.every((r) => r[c.key] == null || typeof r[c.key] === 'number'));
    const fs_ = widths.some((w) => w < 46) ? 7 : 8;
    const header = () => {
      let x = M; const h = 18, hy = doc.y; // text() moves doc.y, so every header cell is placed from the same top
      doc.rect(M, hy, W, h).fill(NAVY);
      cols.forEach((c, i) => { doc.fillColor('#fff').font('Helvetica-Bold').fontSize(fs_).text(c.label, x + 4, hy + 5, { width: widths[i] - 8, align: right[i] ? 'right' : 'left', lineBreak: false, ellipsis: true }); x += widths[i]; });
      doc.y = hy + h;
    };
    header();
    rows.forEach((r, ri) => {
      const texts = cols.map((c) => cell(c, r[c.key]));
      doc.font('Helvetica').fontSize(fs_);
      const h = Math.max(15, ...texts.map((t, i) => doc.heightOfString(t, { width: widths[i] - 8 }) + 7));
      if (doc.y + h > bottom()) { doc.addPage(); header(); }
      if (ri % 2) doc.rect(M, doc.y, W, h).fill(ZEBRA);
      let x = M; const top = doc.y;
      texts.forEach((t, i) => { doc.fillColor('#1f2937').font('Helvetica').fontSize(fs_).text(t, x + 4, top + 4, { width: widths[i] - 8, align: right[i] ? 'right' : 'left' }); x += widths[i]; });
      doc.moveTo(M, top + h).lineTo(M + W, top + h).lineWidth(0.4).strokeColor(LINE).stroke();
      doc.y = top + h;
    });
    if (totals) {
      const h = 18; if (doc.y + h > bottom()) { doc.addPage(); header(); }
      let x = M; const top = doc.y;
      doc.rect(M, top, W, h).fill('#eef1f6');
      cols.forEach((c, i) => {
        const v = i === 0 && totals[c.key] === undefined ? 'Total' : totals[c.key];
        doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(fs_).text(v === undefined ? '' : cell(c, v), x + 4, top + 5, { width: widths[i] - 8, align: right[i] ? 'right' : 'left', lineBreak: false });
        x += widths[i];
      });
      doc.y = top + h;
    }
    if (!rows.length) doc.fillColor(GREY).font('Helvetica-Oblique').fontSize(9).text('No records for this selection.', M, doc.y + 6);
  };

  for (const s of sections) {
    if (doc.y + 60 > bottom()) doc.addPage();
    if (s.heading) { doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(11).text(s.heading, M, doc.y + 6, { width: W }); doc.moveDown(0.3); }
    if (s.text) { doc.fillColor('#1f2937').font('Helvetica').fontSize(9.5).text(s.text, M, doc.y, { width: W }); doc.moveDown(0.5); }
    if (s.columns?.length) { table(s.columns, s.rows || [], s.totals); doc.moveDown(0.8); }
  }

  if (spec.note) { doc.fillColor('#1f2937').font('Helvetica').fontSize(9).text(spec.note, M, doc.y + 4, { width: W }); doc.moveDown(0.5); }
  if (spec.qr) {
    const sz = 112;
    if (doc.y + sz + 16 > bottom()) doc.addPage();
    const top = doc.y + 8;
    doc.roundedRect(M, top - 4, W, sz + 8, 6).lineWidth(0.6).strokeColor('#cfd8d6').stroke();
    try { doc.image(spec.qr.png, M + 6, top, { width: sz, height: sz }); } catch { /* unreadable image */ }
    doc.fillColor('#0b3d3a').font('Helvetica-Bold').fontSize(9).text('Scan for your ledger summary & portal link', M + sz + 18, top + 2, { width: W - sz - 28 });
    doc.fillColor('#1f2937').font('Helvetica').fontSize(8.2).text(spec.qr.lines.slice(1).filter((l, i, a) => !(l === '' && (i === 0 || a[i - 1] === ''))).join('\n'), { width: W - sz - 28, lineGap: 1 });
    doc.y = top + sz + 10;
  }
  if (spec.signatures?.length) {
    if (doc.y + 80 > bottom()) doc.addPage();
    const top = doc.y + 40, n = spec.signatures.length, bw = Math.min(190, (W - (n - 1) * 24) / n), gap = n > 1 ? (W - n * bw) / (n - 1) : 0;
    spec.signatures.forEach((label, i) => {
      const x = M + i * (bw + gap);
      doc.moveTo(x, top).lineTo(x + bw, top).lineWidth(0.7).strokeColor('#8b93a1').stroke();
      doc.fillColor(GREY).font('Helvetica').fontSize(8.5).text(label, x, top + 4, { width: bw, align: 'center' });
    });
    doc.y = top + 24;
  }

  // ---- footer on every page
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    if (spec.watermark) {
      doc.save(); doc.rotate(-32, { origin: [doc.page.width / 2, doc.page.height / 2] });
      doc.fillOpacity(0.1).fillColor('#dc2626').font('Helvetica-Bold').fontSize(120).text(spec.watermark, 0, doc.page.height / 2 - 60, { width: doc.page.width, align: 'center', lineBreak: false });
      doc.restore();
    }
    const fy = doc.page.height - M - 14;
    doc.moveTo(M, fy - 4).lineTo(M + W, fy - 4).lineWidth(0.5).strokeColor(LINE).stroke();
    const social = b.social.map((x) => `${x.platform}: ${x.handle}`).join('   ');
    doc.fillColor(GREY).font('Helvetica').fontSize(7.5).text([b.footer, social].filter(Boolean).join('   |   ') || b.name, M, fy, { width: W - 80, lineBreak: false, ellipsis: true });
    doc.text(`Page ${i - range.start + 1} of ${range.count}`, M, fy, { width: W, align: 'right', lineBreak: false });
  }
  doc.end();
}
