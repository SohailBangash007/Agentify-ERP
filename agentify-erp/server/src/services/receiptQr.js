import QRCode from 'qrcode';
import { all, get, getSetting, run } from '../db.js';
import { jparse, now, moneyText } from '../util.js';

/**
 * QR code for a receipt voucher. It carries a plain-text ledger summary of the customer's plan — as it stood when
 * this receipt was issued: total, paid, remaining, installments paid / left, next due — plus the customer-portal link,
 * where the live ledger is available after sign-in. The text is generated the first time the voucher is printed or saved
 * and then kept (a printed receipt must not change); finance can refresh it on request.
 */

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dmy = (s) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s || ''); return m ? `${m[3]}-${MON[Number(m[2]) - 1]}-${m[1]}` : ''; };
const pkr = (n) => `${moneyText(Math.round(Number(n || 0)))}`;

/** Public address of the website / portal: the address saved in the SEO settings, else the address the request came in on. */
export function publicBase(req) {
  const saved = jparse(getSetting('site_config'), {}).seo?.base_url;
  const base = (saved || `${req.protocol}://${req.get('host')}`).replace(/\/+$/, '');
  return { base, local: !saved && /^(localhost|127\.|\[::1\]|0\.0\.0\.0)/i.test(req.get('host') || '') };
}

/** Where a plan stood right after this receipt: each installment's paid amount counts only receipts up to and including it. */
function planLine(rc, saleId) {
  const s = get(`SELECT s.id, s.sale_no, s.kind, s.net_price, s.paid_amount, COALESCE(s.title, p.title) title FROM sales s LEFT JOIN properties p ON p.id=s.property_id WHERE s.id=?`, saleId);
  if (!s) return null;
  const later = get(`SELECT COALESCE(SUM(CASE WHEN r2.payment_type='Refund' THEN -x.v ELSE x.v END),0) v FROM (
      SELECT r2.id, COALESCE((SELECT rs.amount FROM receipt_sales rs WHERE rs.receipt_id=r2.id AND rs.sale_id=?), CASE WHEN r2.sale_id=? THEN r2.amount END) v FROM receipts r2
      WHERE r2.status='valid' AND (r2.date>? OR (r2.date=? AND r2.id>?))) x JOIN receipts r2 ON r2.id=x.id WHERE x.v IS NOT NULL`, saleId, saleId, rc.date, rc.date, rc.id).v;
  const paid = Math.max(0, s.paid_amount - later);
  const inst = all(`SELECT i.id, i.kind, i.amount, i.due_date,
      COALESCE((SELECT SUM(ra.amount) FROM receipt_allocations ra JOIN receipts r2 ON r2.id=ra.receipt_id WHERE ra.installment_id=i.id AND r2.status='valid' AND (r2.date<? OR (r2.date=? AND r2.id<=?))),0) paid
    FROM installments i WHERE i.sale_id=? ORDER BY i.due_date, i.seq`, rc.date, rc.date, rc.id, saleId);
  const monthly = inst.filter((i) => i.kind === 'installment');
  const open = inst.filter((i) => i.paid < i.amount);
  const next = open[0];
  return {
    title: s.title || s.sale_no, sale_no: s.sale_no, total: s.net_price, paid, remaining: Math.max(0, s.net_price - paid),
    n: monthly.length, nPaid: monthly.filter((i) => i.paid >= i.amount).length, each: monthly[0]?.amount || 0,
    next: next ? { date: next.due_date, amount: next.amount - next.paid } : null,
  };
}

/** The plans (sales) this receipt belongs to, with their ledger position right after the receipt. */
export function receiptPlans(rc) {
  const saleIds = rc.sale_id ? [rc.sale_id] : all('SELECT sale_id FROM receipt_sales WHERE receipt_id=? ORDER BY sale_id', rc.id).map((x) => x.sale_id);
  return saleIds.map((id) => planLine(rc, id)).filter(Boolean);
}

export function buildReceiptQrText(rc, base) {
  const brand = getSetting('company_name') || 'Agentify ERP';
  const saleIds = rc.sale_id ? [rc.sale_id] : all('SELECT sale_id FROM receipt_sales WHERE receipt_id=? ORDER BY sale_id', rc.id).map((x) => x.sale_id);
  const lines = [`${brand}`, `${rc.payment_type === 'Refund' ? 'Refund' : 'Receipt'} ${rc.receipt_no} | ${dmy(rc.date)} | ${pkr(rc.amount)}`, `Customer: ${rc.customer_name}${rc.customer_code ? ` (${rc.customer_code})` : ''}`];
  const plans = saleIds.map((id) => planLine(rc, id)).filter(Boolean);
  for (const p of plans.slice(0, 2)) {
    lines.push('', `${p.title} [${p.sale_no}]`, `Total ${pkr(p.total)} | Paid ${pkr(p.paid)} | Remaining ${pkr(p.remaining)}`);
    if (p.n) lines.push(`Installments: ${p.nPaid}/${p.n} paid, ${p.n - p.nPaid} left (${pkr(p.each)} each)`);
    if (p.next) lines.push(`Next due ${dmy(p.next.date)}: ${pkr(p.next.amount)}`); else if (p.remaining === 0) lines.push('Fully paid');
  }
  if (plans.length > 2) lines.push(`+${plans.length - 2} more — see portal`);
  lines.push('', 'Live ledger (sign in):', `${base}/portal/login?next=/portal/payments`);
  return lines.join('\n');
}

/**
 * The receipt's QR: created on first use and stored with the receipt; `refresh` rebuilds it from today's figures.
 * Returns { text, lines, link, png (Buffer), generated_at, local }.
 */
export async function receiptQr(rc, req, { refresh = false } = {}) {
  const { base, local } = publicBase(req);
  const row = get('SELECT qr_payload, qr_at FROM receipts WHERE id=?', rc.id);
  let text = row?.qr_payload, at = row?.qr_at;
  // a stored code whose link points at another address (e.g. the real domain was set later) is rebuilt
  if (refresh || !text || !text.includes(`${base}/portal/login`)) {
    text = buildReceiptQrText(rc, base); at = now();
    run('UPDATE receipts SET qr_payload=?, qr_at=? WHERE id=?', text, at, rc.id);
  }
  const png = await QRCode.toBuffer(text, { errorCorrectionLevel: 'M', margin: 1, scale: 8, type: 'png', color: { dark: '#0b3d3a', light: '#ffffff' } });
  return { text, lines: text.split('\n'), plans: receiptPlans(rc), link: `${base}/portal/login?next=/portal/payments`, png, generated_at: at, local };
}
