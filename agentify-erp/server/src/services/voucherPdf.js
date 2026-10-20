import { getSetting } from '../db.js';
import { sendPdf } from './pdf.js';
import { moneyText } from '../util.js';

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dmy = (s) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s || ''); return m ? `${m[3]}-${MON[Number(m[2]) - 1]}-${m[1]}` : ''; };
const pkr = (n) => `${moneyText(Math.round(Number(n || 0)))}`;
const g = (k, d = '') => getSetting(k, d) || d;

/**
 * Receipt voucher as a real PDF, branded from Settings → Receipts & branding.
 * `forCustomer` omits internal columns (deposit account, receiving staff, agent) for the customer portal.
 */
export function receiptPdf(res, rc, { forCustomer = false, qr = null } = {}) {
  const refund = rc.payment_type === 'Refund';
  const rec = rc.record || {};
  const isVoid = rc.status === 'void';
  const parts = rc.parts || [];
  const sections = [];
  if (parts.length > 1) {
    sections.push({ heading: 'Split between', columns: [{ key: 'sale', label: 'Sale' }, { key: 'for', label: 'For' }, { key: 'share', label: 'Share', type: 'money' }],
      rows: parts.map((x) => ({ sale: `${x.sale_no}${x.kind === 'construction' ? ' (construction)' : ' (plot)'}`, for: x.title, share: x.amount })) });
  }
  if (rc.allocations?.length) {
    sections.push({ heading: 'Applied to installments', columns: [{ key: 'seq', label: '#' }, { key: 'kind', label: 'Type' }, { key: 'due', label: 'Due date' }, { key: 'applied', label: 'Applied', type: 'money' }],
      rows: rc.allocations.map((a) => ({ seq: a.seq, kind: a.kind, due: dmy(a.due_date), applied: a.amount })) });
  }
  const custom = g('receipt_header');
  const notes = [custom, rc.notes && `Notes: ${rc.notes}`, rc.void_reason && `Voided: ${rc.void_reason}`, g('receipt_terms') && `Terms: ${g('receipt_terms')}`].filter(Boolean).join('\n\n');
  sendPdf(res, `receipt-${rc.receipt_no}`, {
    title: refund ? 'REFUND VOUCHER' : g('receipt_title', 'RECEIPT VOUCHER'),
    subtitle: `${rc.receipt_no}${isVoid ? '  ·  VOID' : ''}`,
    details: [
      ['Date', dmy(rc.date)], ['Received from', rc.customer_code ? `${rc.customer_name}  (${rc.customer_code})` : rc.customer_name],
      ['CNIC no.', rec.cnic], ['Contact no.', rec.phone], ['Email', rec.email],
      ['Registration no.', rec.registration_no], ['File #', rec.file_no], ['File status', rec.file_status], ['Type', rec.property_type], ['Plot size', rec.plot_size],
      ['Booking date', rec.booking_date ? dmy(rec.booking_date) : ''], ['Address', rec.address],
      ['Property / contract', rc.property_title], ['Project', rc.project_name],
      ...(forCustomer ? [] : [['Sale agent', rc.agent_name]]),
      ['Payment type', rc.payment_type], ['Method', rc.method], ...(forCustomer ? [] : [['Deposited to', rc.account_name]]),
      ['Reference', rc.reference_no], ['Transaction ID', rc.txn_id], ['Cheque no.', rc.cheque_no], ['Bank / channel', rc.bank], ['Sender', rc.sender],
      ...(forCustomer ? [] : [['Received by', rc.received_by_name]]),
    ],
    amount: { label: refund ? 'Amount refunded' : 'Amount received', value: pkr(rc.amount), sub: rc.advance_amount > 0 ? `Includes ${pkr(rc.advance_amount)} advance` : undefined },
    sections: sections.length ? sections : undefined, columns: undefined,
    note: notes || undefined, qr: qr && !isVoid ? { png: qr.png, lines: qr.lines } : undefined, signatures: ['Received by', 'Customer signature'], watermark: isVoid ? 'VOID' : undefined,
  });
}

/** What an expense voucher states. The paying account appears only when the voucher is set to show it (it can be confidential). */
export function expenseDetails(e) {
  const qty = Number(e.quantity) || 1;
  return [
    ['Date', dmy(e.date)], ['Project', e.project_name], ['Contract', e.contract_no ? `${e.contract_no} — ${e.contract_customer || e.contract_title || ''}` : ''],
    ['Vendor', e.vendor_name], ['Vendor no.', e.vendor_code], ['Vendor contact no.', e.vendor_phone], ['Vendor email', e.vendor_email], ['Expense account', `${e.expense_account_code} ${e.expense_account_name}`], ['Description', e.description],
    ['Quantity × unit cost', qty !== 1 || e.unit_cost ? `${qty.toLocaleString('en-PK')} × ${pkr(e.unit_cost)}` : ''],
    ['Payment method', e.payment_method], ...(e.show_paid_from ? [['Paid from', e.paid_from_name]] : []), ['Reference', e.reference_no],
    ['Asset record', (e.assets || []).map((a) => a.asset_no).join(', ')],
    ['Credit purchase', e.is_credit ? `Yes${e.due_date ? ` — due ${dmy(e.due_date)}` : ''}` : ''], ['Created by', e.created_by_name], ['Approved by', e.approved_by_name],
  ];
}

/** Expense voucher as a real PDF. */
export function expensePdf(res, e) {
  const sections = [];
  if (e.payments?.length) {
    const showAcc = !!e.show_paid_from;
    sections.push({ heading: 'Payments', columns: [{ key: 'date', label: 'Date' }, { key: 'payment_no', label: 'Payment' }, { key: 'method', label: 'Method' }, ...(showAcc ? [{ key: 'account', label: 'Paid from' }] : []), { key: 'amount', label: 'Amount', type: 'money' }],
      rows: e.payments.map((p) => ({ date: dmy(p.date), payment_no: p.payment_no, method: p.method, account: p.account_name, amount: p.amount })) });
  }
  const notes = [g('expense_header'), e.notes && `Notes: ${e.notes}`, g('expense_footer')].filter(Boolean).join('\n\n');
  sendPdf(res, `expense-${e.voucher_no}`, {
    title: g('expense_title', 'EXPENSE VOUCHER'), subtitle: `${e.voucher_no}  ·  ${String(e.status).toUpperCase()}`,
    details: expenseDetails(e),
    amount: { label: 'Total amount', value: pkr(e.amount), sub: `Paid ${pkr(e.paid_amount)}  ·  Balance ${pkr(e.amount - e.paid_amount)}` },
    sections: sections.length ? sections : undefined, columns: undefined,
    note: notes || undefined, signatures: ['Prepared by', 'Approved by', 'Received by'],
  });
}
