import Icon from './Icon.jsx';
import { useMeta, useToast } from '../context.jsx';
import { date, money } from '../format.js';

/** 0300-5551350, +92 300 5551350, 3005551350 → 923005551350 (digits only, as wa.me expects). */
export function waNumber(phone) {
  let d = String(phone || '').replace(/\D/g, '');
  if (!d) return '';
  if (d.startsWith('00')) d = d.slice(2);
  if (d.startsWith('0')) d = `92${d.slice(1)}`;
  else if (d.length === 10 && d.startsWith('3')) d = `92${d}`;
  return d;
}
export const waLink = (phone, text) => `https://wa.me/${waNumber(phone)}${text ? `?text=${encodeURIComponent(text)}` : ''}`;

/** Ready-made messages. `co` is the company name. */
export const WA = {
  overdue: ({ name, amount, due_date, days, sale_no }, co) => `Assalam o Alaikum ${name},\n\nA gentle reminder from ${co}: your installment of ${money(amount)} against ${sale_no || 'your file'} was due on ${date(due_date)} (${days} day${days === 1 ? '' : 's'} ago).\n\nKindly arrange the payment at your earliest convenience and share the receipt/transaction ID. JazakAllah.`,
  due: ({ name, amount, due_date, sale_no }, co) => `Assalam o Alaikum ${name},\n\nFriendly reminder from ${co}: your next installment of ${money(amount)} against ${sale_no || 'your file'} is due on ${date(due_date)}.\n\nPlease let us know if you need our bank details. JazakAllah.`,
  overdueTotal: ({ name, amount }, co) => `Assalam o Alaikum ${name},

A gentle reminder from ${co}: ${money(amount)} of your installments is overdue. Kindly arrange the payment at your earliest convenience and share the receipt/transaction ID. JazakAllah.`,
  receipt: ({ name, amount, receipt_no, date: d }, co) => `Assalam o Alaikum ${name},\n\nThank you! ${co} has received ${money(amount)} on ${date(d)} (receipt ${receipt_no}). Your payment voucher is attached.\n\nJazakAllah.`,
  /** Expense voucher to a vendor/contractor: approved, paid, or just "here is the voucher". */
  voucher: ({ name, amount, voucher_no, description, kind }, co) => {
    const what = description ? ` (${description})` : '';
    const body = kind === 'paid' ? `${co} has paid ${money(amount)} against voucher ${voucher_no}${what}.`
      : kind === 'approved' ? `${co} has approved expense voucher ${voucher_no}${what} for ${money(amount)}.`
        : `Please find expense voucher ${voucher_no}${what} for ${money(amount)} from ${co}.`;
    return `Assalam o Alaikum ${name},\n\n${body} The voucher is attached.\n\nJazakAllah.`;
  },
  followup: ({ name }, co) => `Assalam o Alaikum ${name}, this is from ${co}. Just following up on your property enquiry — would you like to schedule a site visit this week?`,
  hello: ({ name }, co) => `Assalam o Alaikum ${name}, this is from ${co}.`,
};

/** The right opener for a lead/contact: a plain hello for customers and cold/lost leads, a site-visit nudge otherwise. */
export function leadMessage(c, co) {
  const first = String(c.full_name || '').split(' ')[0] || 'there';
  return c.is_customer || /not interested|lost|dead|closed/i.test(c.stage || '') ? WA.hello({ name: first }, co) : WA.followup({ name: first }, co);
}

/** Round WhatsApp action; opens a chat with the message prefilled. Renders nothing without a phone number. */
export function WhatsAppButton({ phone, text, label, className = 'qa wa', size = 14, title = 'WhatsApp' }) {
  if (!waNumber(phone)) return null;
  return (
    <a className={className} href={waLink(phone, text)} target="_blank" rel="noopener noreferrer" title={title} aria-label={title} onClick={(e) => e.stopPropagation()}>
      <Icon name="whatsapp" size={size} />{label}
    </a>
  );
}

export function useCompanyName() {
  const { meta } = useMeta();
  return meta?.settings?.company_name || meta?.settings?.print_company || 'Agentify ERP';
}

/**
 * Share a server PDF (receipt / ledger) with WhatsApp: on phones the native share sheet attaches the file;
 * elsewhere the PDF downloads and the chat opens with the message ready to send.
 */
export function useSharePdf() {
  const toast = useToast();
  return async ({ pdfUrl, filename, phone, text }) => {
    try {
      const res = await fetch(pdfUrl, { credentials: 'same-origin', headers: { 'X-Requested-With': 'ERP' } });
      if (!res.ok) throw new Error('Could not prepare the PDF');
      const blob = await res.blob();
      const file = new File([blob], filename, { type: 'application/pdf' });
      if (navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file], text }); return; }
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 3000);
      window.open(waLink(phone, `${text}\n\n(PDF downloaded — attach it in the chat)`), '_blank', 'noopener');
      toast('PDF downloaded — attach it in WhatsApp', 'ok');
    } catch (e) { if (e?.name !== 'AbortError') toast(e.message || 'Sharing failed', 'err'); }
  };
}
