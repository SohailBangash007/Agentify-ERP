import PDFDocument from 'pdfkit';
import { getSetting } from '../db.js';
import { brand } from './pdf.js';
import { moneyText } from '../util.js';

/**
 * Receipt voucher laid out for A4 paper with an OFFICE COPY and a CLIENT COPY, built from ruled tables like a printed
 * receipt book: details grid, amount band, split / installments applied, and (optional) a ledger-summary table with a small QR.
 *   layout 'sheet'  – both copies on ONE A4 page (office on top, client below, cut line between)  [default]
 *   layout 'pages'  – two A4 pages, one copy on each (larger type)
 *   layout 'client' – a single A4 page with only the client copy (customer portal download)
 *   layout 'office' – a single A4 page with only the office copy
 * `qr` is { png, plans } to include the ledger summary + QR, or null for a plain receipt.
 */

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dmy = (s) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s || ''); return m ? `${m[3]}-${MON[Number(m[2]) - 1]}-${m[1]}` : ''; };
const pkr = (n) => `${moneyText(Math.round(Number(n || 0)))}`;
const num = (n) => Math.round(Number(n || 0)).toLocaleString('en-PK');
const NAVY = '#0b3d3a', INK = '#1f2937', GREY = '#667085', LINE = '#b9c7c4', SOFT = '#eef5f3';

const ONES = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
const below100 = (n) => (n < 20 ? ONES[n] : `${TENS[Math.floor(n / 10)]}${n % 10 ? `-${ONES[n % 10]}` : ''}`);
const below1000 = (n) => (n >= 100 ? `${ONES[Math.floor(n / 100)]} hundred${n % 100 ? ` ${below100(n % 100)}` : ''}` : below100(n));
/** Amount in words, Pakistani grouping (thousand, lakh, crore, arab). */
export function rupeesInWords(amount) {
  let n = Math.round(Math.abs(Number(amount) || 0));
  if (!n) return 'Rupees zero only';
  const parts = [];
  for (const [div, name] of [[1e9, 'arab'], [1e7, 'crore'], [1e5, 'lakh'], [1e3, 'thousand']]) {
    if (n >= div) { parts.push(`${below1000(Math.floor(n / div))} ${name}`); n %= div; }
  }
  if (n) parts.push(below1000(n));
  const s = parts.join(' ');
  return `Rupees ${s.charAt(0).toUpperCase()}${s.slice(1)} only`;
}

/**
 * Ruled table. `cols` are widths; each row is an array of cells ({t, bold, align, color, fill, size} or a string).
 * Row heights follow the wrapped text. `label` lists the shaded label columns. Returns the y below the table.
 */
function table(doc, x, y, cols, rows, { s = 1, size = 7.4, pad = 2.1, label = [] } = {}) {
  let cy = y;
  for (const row of rows) {
    const cells = row.map((c) => (typeof c === 'object' && c !== null ? c : { t: c }));
    const fs = (c) => (c.size || size) * s;
    const font = (c, i) => (c.bold ? 'Helvetica-Bold' : 'Helvetica');
    const heights = cells.map((c, i) => {
      doc.font(font(c, i)).fontSize(fs(c));
      return doc.heightOfString(String(c.t ?? ''), { width: cols[i] - pad * 2 * s, lineGap: 0 }) + pad * 2 * s;
    });
    const rh = Math.max(...heights, 10.5 * s);
    let cx = x;
    cells.forEach((c, i) => {
      const isLabel = label.includes(i);
      const fill = c.fill || (isLabel ? SOFT : null);
      if (fill) doc.rect(cx, cy, cols[i], rh).fill(fill);
      doc.rect(cx, cy, cols[i], rh).lineWidth(0.5).strokeColor(LINE).stroke();
      doc.font(font(c, i)).fontSize(fs(c)).fillColor(c.color || (isLabel ? GREY : INK))
        .text(String(c.t ?? ''), cx + pad * s, cy + pad * s, { width: cols[i] - pad * 2 * s, align: c.align || 'left', lineGap: 0, height: rh - pad * s });
      cx += cols[i];
    });
    cy += rh;
  }
  return cy;
}

function detailRows(rc, label) {
  const rec = rc.record || {};
  const office = label === 'OFFICE COPY';
  return [
    ['Received from', rc.customer_code ? `${rc.customer_name} (${rc.customer_code})` : rc.customer_name],
    ['CNIC no.', rec.cnic], ['Customer contact no.', [rec.phone, rec.email].filter(Boolean).join('  ·  ')],
    ['Property / contract', rc.property_title], ['Project', rc.project_name],
    ['Reg. / File no.', [rec.registration_no, rec.file_no].filter(Boolean).join(' / ')], ['Plot size', rec.plot_size],
    ['Payment type', rc.payment_type], ['Method', rc.method],
    ['Reference / Txn', [rc.reference_no, rc.txn_id, rc.cheque_no].filter(Boolean).join(' · ')], ['Bank / channel', [rc.bank, rc.sender].filter(Boolean).join(' · ')],
    ...(office ? [['Deposited to', rc.account_name], ['Sale agent', [rc.agent_name, rc.agent_phone].filter(Boolean).join(' · ')], ['Received by', rc.received_by_name]] : [['Your sales agent', [rc.agent_name, rc.agent_phone].filter(Boolean).join(' · ')]]),
  ].filter(([, v]) => v);
}

/** Draw one copy inside the box (x, y, w, h). `s` scales the type so a full page looks as good as half a page. */
function drawCopy(doc, rc, qr, label, x, y, w, h, s) {
  const b = brand();
  const g = (k, d = '') => getSetting(k, d) || d;
  const pad = 10 * s, ix = x + pad, iw = w - pad * 2;
  const refund = rc.payment_type === 'Refund', isVoid = rc.status === 'void';
  doc.save();
  doc.roundedRect(x, y, w, h, 5).lineWidth(0.8).strokeColor(LINE).stroke();
  let cy = y + pad;

  // ---- header: logo + company, voucher title / number / date, copy tag
  let tx = ix;
  if (b.logo) { try { doc.image(b.logo, ix, cy, { fit: [64 * s, 34 * s] }); tx = ix + 72 * s; } catch { /* unsupported logo */ } }
  // the company name shrinks to fit on one line (never wraps into the address lines), whatever the copy size
  const titleText = refund ? 'REFUND VOUCHER' : g('receipt_title', 'RECEIPT VOUCHER');
  const titleW = doc.font('Helvetica-Bold').fontSize(12 * s).widthOfString(titleText);
  const nameW = Math.max(120, iw - titleW - 18 * s - (tx - ix));
  let nf = 11.5 * s;
  doc.font('Helvetica-Bold');
  while (nf > 7 && doc.fontSize(nf).widthOfString(b.name) > nameW) nf -= 0.4;
  doc.font('Helvetica-Bold').fontSize(nf).fillColor(NAVY).text(b.name, tx, cy, { width: nameW + 40, lineBreak: false });
  const hw = nameW;
  [b.address, b.phone, [b.email, b.website].filter(Boolean).join('  ·  ')].filter(Boolean).forEach((line, i) => doc.font(i === 1 ? 'Helvetica-Bold' : 'Helvetica').fontSize(6.6 * s).fillColor(i === 1 ? INK : GREY).text(line, tx, cy + (13 + i * 8.2) * s, { width: hw, height: 8 * s, lineBreak: false, ellipsis: true }));
  doc.font('Helvetica-Bold').fontSize(12 * s).fillColor(NAVY).text(titleText, ix, cy, { width: iw, align: 'right', lineBreak: false });
  doc.font('Helvetica').fontSize(8.5 * s).fillColor(INK).text(`${rc.receipt_no}${isVoid ? '  ·  VOID' : ''}   |   ${dmy(rc.date)}`, ix, cy + 15 * s, { width: iw, align: 'right', lineBreak: false });
  const tagW = 74 * s, office = label === 'OFFICE COPY';
  doc.roundedRect(ix + iw - tagW, cy + 26 * s, tagW, 12 * s, 6 * s).fillAndStroke(office ? '#fff3d6' : '#dff3ef', office ? '#e2b44c' : '#7cc4b9');
  doc.font('Helvetica-Bold').fontSize(6.8 * s).fillColor(office ? '#8a5a00' : NAVY).text(label, ix + iw - tagW, cy + 29 * s, { width: tagW, align: 'center', lineBreak: false });
  cy += 44 * s;
  doc.moveTo(ix, cy).lineTo(ix + iw, cy).lineWidth(1.2).strokeColor(NAVY).stroke();
  cy += 6 * s;

  // ---- details: a ruled 4-column grid (label | value | label | value)
  const items = detailRows(rc, label);
  const rows = [];
  for (let i = 0; i < items.length; i += 2) rows.push([items[i][0], { t: items[i][1], bold: true }, items[i + 1]?.[0] || '', { t: items[i + 1]?.[1] || '', bold: true }]);
  const lw = 84 * s, vw = iw / 2 - lw;
  cy = table(doc, ix, cy, [lw, vw, lw, vw], rows, { s, label: [0, 2], size: 7.4 }) + 5 * s;

  // ---- amount band
  const amH = 27 * s;
  doc.rect(ix, cy, iw, amH).fill(SOFT); doc.rect(ix, cy, iw, amH).lineWidth(0.5).strokeColor(LINE).stroke();
  doc.font('Helvetica').fontSize(7 * s).fillColor(GREY).text(refund ? 'Amount refunded' : 'Amount received', ix + 7 * s, cy + 2.5 * s, { lineBreak: false });
  doc.font('Helvetica-Bold').fontSize(14 * s).fillColor(NAVY).text(pkr(rc.amount), ix + 7 * s, cy + 11 * s, { lineBreak: false });
  doc.font('Helvetica-Oblique').fontSize(7.6 * s).fillColor(INK).text(rupeesInWords(rc.amount), ix + iw * 0.4, cy + 5 * s, { width: iw * 0.6 - 7 * s, align: 'right', height: 12 * s });
  if (rc.advance_amount > 0) doc.font('Helvetica').fontSize(6.8 * s).fillColor(GREY).text(`Includes ${pkr(rc.advance_amount)} advance`, ix + iw * 0.4, cy + 16.5 * s, { width: iw * 0.6 - 7 * s, align: 'right', lineBreak: false });
  cy += amH + 5 * s;

  // ---- split between sales / installments applied: two small tables side by side
  const parts = rc.parts || [], allocs = rc.allocations || [];
  const showSplit = parts.length > 1, showAlloc = allocs.length > 0;
  if (showSplit || showAlloc) {
    const gap = 8 * s, lwid = showSplit && showAlloc ? iw * 0.42 : iw, rwid = showSplit && showAlloc ? iw - lwid - gap : iw;
    let yl = cy, yr = cy;
    const hd = (t, align = 'left') => ({ t, bold: true, color: '#ffffff', fill: NAVY, size: 6.8, align });
    if (showSplit) {
      const r = [[hd('Split between'), hd('For'), hd('Share', 'right')], ...parts.slice(0, 3).map((p) => [`${p.sale_no} ${p.kind === 'construction' ? '(construction)' : '(plot)'}`, p.title || '', { t: num(p.amount), align: 'right', bold: true }])];
      yl = table(doc, ix, cy, [lwid * 0.34, lwid * 0.4, lwid * 0.26], r, { s, size: 6.8 });
    }
    if (showAlloc) {
      const ax = showSplit ? ix + lwid + gap : ix;
      const r = [[hd('#'), hd('Installment'), hd('Due date'), hd('Applied', 'right')], ...allocs.slice(0, 3).map((a) => [`${a.seq}`, a.kind, dmy(a.due_date), { t: num(a.amount), align: 'right', bold: true }])];
      if (allocs.length > 3) r.push([{ t: `+${allocs.length - 3} more installments`, color: GREY }, '', '', '']);
      yr = table(doc, ax, cy, [rwid * 0.1, rwid * 0.3, rwid * 0.32, rwid * 0.28], r, { s, size: 6.8 });
    }
    cy = Math.max(yl, yr) + 5 * s;
  }

  // ---- ledger summary table (+ small QR). Only when the QR option is on.
  const sign = 26 * s, foot = 10 * s;
  const bottomLimit = y + h - pad - sign - foot - 16 * s;
  if (qr && !isVoid && qr.plans?.length) {
    const qs = 58 * s, qw = qs + 14 * s, tw = iw - qw - 6 * s;
    const hd = (t, align = 'right') => ({ t, bold: true, color: '#ffffff', fill: NAVY, size: 6.8, align });
    const cols = [tw * 0.31, tw * 0.13, tw * 0.13, tw * 0.14, tw * 0.15, tw * 0.14];
    const lrows = [[hd('Ledger as of this receipt', 'left'), hd('Total'), hd('Paid'), hd('Remaining'), hd('Installments'), hd('Next due')]];
    for (const p of qr.plans.slice(0, 3)) {
      lrows.push([{ t: p.title, size: 6.9 }, { t: num(p.total), align: 'right' }, { t: num(p.paid), align: 'right' }, { t: num(p.remaining), align: 'right', bold: true }, { t: p.n ? `${p.nPaid}/${p.n} paid` : '—', align: 'right' }, { t: p.next ? `${dmy(p.next.date)}\n${num(p.next.amount)}` : (p.remaining === 0 ? 'Fully paid' : '—'), align: 'right' }]);
    }
    const ty = cy;
    const endY = table(doc, ix, ty, cols, lrows, { s, size: 7 });
    const qx = ix + tw + 6 * s + 7 * s;
    try { doc.image(qr.png, qx, ty, { width: qs, height: qs }); } catch { /* unreadable */ }
    doc.font('Helvetica').fontSize(5.6 * s).fillColor(GREY).text('Scan: live ledger on portal', qx - 7 * s, ty + qs + 1.5 * s, { width: qs + 14 * s, align: 'center', lineBreak: false });
    cy = Math.max(endY + 4 * s, ty + qs + 9 * s);
  } else if (isVoid) {
    doc.font('Helvetica-Bold').fontSize(9 * s).fillColor('#b42318').text(`Voided${rc.void_reason ? `: ${rc.void_reason}` : ''}`, ix, cy, { width: iw }); cy += 14 * s;
  }

  // ---- terms (one or two lines) and signatures pinned to the bottom of the copy
  const terms = [rc.notes && `Notes: ${rc.notes}`, g('receipt_terms')].filter(Boolean).join('  ');
  const sy = y + h - pad - sign - foot;
  if (terms) doc.font('Helvetica').fontSize(6.3 * s).fillColor(GREY).text(terms, ix, Math.min(Math.max(cy, sy - 17 * s), bottomLimit + 4 * s), { width: iw, height: 15 * s, ellipsis: true });
  const sw = Math.min(170 * s, iw / 2 - 20 * s);
  [['Received by', ix], ['Customer signature', ix + iw - sw]].forEach(([t, xx]) => {
    doc.moveTo(xx, sy + sign - 12 * s).lineTo(xx + sw, sy + sign - 12 * s).lineWidth(0.6).strokeColor('#8b93a1').stroke();
    doc.font('Helvetica').fontSize(7 * s).fillColor(GREY).text(t, xx, sy + sign - 9 * s, { width: sw, align: 'center', lineBreak: false });
  });
  doc.font('Helvetica').fontSize(6.3 * s).fillColor(GREY).text(`${office ? 'Office copy — keep for records' : 'Client copy — please keep this receipt'}  ·  ${g('receipt_footer') || b.footer || b.name}`, ix, y + h - pad - 6 * s, { width: iw, height: 7 * s, align: 'center', ellipsis: true });
  doc.restore();
}

export function receiptCopiesPdf(res, rc, { qr = null, layout = '' } = {}) {
  const mode = ['sheet', 'pages', 'client', 'office'].includes(layout) ? layout : (['sheet', 'pages'].includes(getSetting('receipt_copies')) ? getSetting('receipt_copies') : 'sheet');
  const doc = new PDFDocument({ size: 'A4', margin: 0, info: { Title: `Receipt ${rc.receipt_no}`, Author: brand().name } });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `${res.req?.query?.inline === '1' ? 'inline' : 'attachment'}; filename="receipt-${String(rc.receipt_no).replace(/[^\w.\- ]/g, '_')}.pdf"`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  doc.pipe(res);
  const PW = doc.page.width, PH = doc.page.height, M = 24;
  const mark = () => { if (rc.status === 'void') { doc.save(); doc.rotate(-32, { origin: [PW / 2, PH / 2] }); doc.fillOpacity(0.1).fillColor('#dc2626').font('Helvetica-Bold').fontSize(110).text('VOID', 0, PH / 2 - 55, { width: PW, align: 'center', lineBreak: false }); doc.restore(); } };
  if (mode === 'sheet') {
    const gap = 14, h = (PH - M * 2 - gap) / 2;
    drawCopy(doc, rc, qr, 'OFFICE COPY', M, M, PW - M * 2, h, 1);
    doc.save().dash(4, { space: 3 }).moveTo(M, M + h + gap / 2).lineTo(PW - M, M + h + gap / 2).lineWidth(0.6).strokeColor('#8b93a1').stroke().undash().restore();
    doc.font('Helvetica').fontSize(6.5).fillColor(GREY).text('cut here', PW / 2 - 24, M + h + gap / 2 - 3, { width: 48, align: 'center', lineBreak: false });
    drawCopy(doc, rc, qr, 'CLIENT COPY', M, M + h + gap, PW - M * 2, h, 1);
    mark();
  } else {
    const labels = mode === 'pages' ? ['OFFICE COPY', 'CLIENT COPY'] : [mode === 'office' ? 'OFFICE COPY' : 'CLIENT COPY'];
    labels.forEach((label, i) => {
      if (i) doc.addPage();
      drawCopy(doc, rc, qr, label, M, M, PW - M * 2, PH - M * 2, 1.12);
      mark();
    });
  }
  doc.end();
}
