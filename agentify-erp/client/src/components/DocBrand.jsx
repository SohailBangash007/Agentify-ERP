import { useMeta } from '../context.jsx';
import { fileUrl } from '../api.js';

const parseSocial = (s) => { try { const v = JSON.parse(s || '[]'); return Array.isArray(v) ? v.filter((x) => x.handle) : []; } catch { return []; } };

/** Branding comes from Settings → Receipts & branding (staff: meta; portal: pass `brand`). */
export function useBrand(brand) {
  const { meta } = useMeta();
  const s = brand || meta?.settings || {};
  return {
    s,
    name: s.print_header || s.company_name || 'Expert Marketing & Developers',
    logo: s.print_logo && s.print_show_logo !== '0' ? fileUrl(s.print_logo) : null,
    address: s.print_address || s.company_address, phone: s.print_phone || s.company_phone, email: s.print_email || s.company_email, website: s.print_website,
    social: parseSocial(s.print_social),
  };
}

/** kind: 'receipt' | 'expense' | 'statement' — picks the customised title and header text. */
export function DocHeader({ kind, title, number, extra, brand }) {
  const b = useBrand(brand);
  const custom = kind === 'receipt' ? b.s.receipt_header : kind === 'expense' ? b.s.expense_header : '';
  return (
    <div style={{ marginBottom: 18 }}>
      <div className="hdr">
        <div className="row" style={{ alignItems: 'flex-start', gap: 14 }}>
          {b.logo && <img src={b.logo} alt="Company logo" style={{ maxHeight: 64, maxWidth: 160, objectFit: 'contain' }} />}
          <div>
            <h2>{b.name}</h2>
            <div className="muted" style={{ lineHeight: 1.5 }}>
              {b.address && <div>{b.address}</div>}
              <div>{[b.phone, b.email, b.website].filter(Boolean).join(' · ')}</div>
            </div>
          </div>
        </div>
        <div className="right"><div style={{ fontSize: 18, fontWeight: 700 }}>{title}</div>{number && <div className="mono">{number}</div>}{extra}</div>
      </div>
      {custom && <div style={{ whiteSpace: 'pre-wrap', textAlign: 'center', color: 'var(--muted)' }}>{custom}</div>}
    </div>
  );
}

export function DocFooter({ kind, brand }) {
  const b = useBrand(brand);
  const text = kind === 'receipt' ? b.s.receipt_footer : kind === 'expense' ? b.s.expense_footer : b.s.print_footer;
  const common = kind !== 'statement' ? b.s.print_footer : '';
  return (
    <div style={{ marginTop: 28, paddingTop: 12, borderTop: '1px solid var(--border-2)', textAlign: 'center', fontSize: 12, color: 'var(--muted)', lineHeight: 1.6 }}>
      {kind === 'receipt' && b.s.receipt_terms && <div style={{ whiteSpace: 'pre-wrap', marginBottom: 6 }}>{b.s.receipt_terms}</div>}
      {text && <div style={{ whiteSpace: 'pre-wrap', color: 'var(--text)' }}>{text}</div>}
      {common && common !== text && <div style={{ whiteSpace: 'pre-wrap' }}>{common}</div>}
      {b.social.length > 0 && <div style={{ marginTop: 4 }}>{b.social.map((x, i) => <span key={i}>{i > 0 && '  ·  '}<b>{x.platform}</b> {x.handle}</span>)}</div>}
      <div style={{ marginTop: 2 }}>{[b.phone, b.email, b.website].filter(Boolean).join('  ·  ')}</div>
    </div>
  );
}
