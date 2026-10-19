import { useEffect, useState } from 'react';
import { DocFooter, DocHeader } from '../components/DocBrand.jsx';
import { FileUploader } from '../components/Uploaders.jsx';
import { Card, Field, Loading, PageHead, Select, Toggle } from '../components/ui.jsx';
import { api, fileUrl } from '../api.js';
import { useAuth, useFetch, useMeta, useToast } from '../context.jsx';
import { money } from '../format.js';

const PLATFORMS = ['Facebook', 'Instagram', 'WhatsApp', 'X (Twitter)', 'YouTube', 'LinkedIn', 'TikTok', 'Website', 'Other'];

/** Customise how receipt vouchers, expense vouchers and statements look when printed or saved as PDF. */
export default function Branding() {
  const toast = useToast();
  const { can } = useAuth();
  const { reload } = useMeta();
  const { data, reload: rl } = useFetch('/api/settings/system');
  const meta = useMeta().meta;
  const [f, setF] = useState(null);
  const [social, setSocial] = useState([]);
  const [tab, setTab] = useState('receipt');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (data) { setF({ ...data }); try { setSocial(JSON.parse(data.print_social || '[]')); } catch { setSocial([]); } }
  }, [data]);
  if (!f || !meta) return <Loading />;
  const ro = !can('settings', 'edit');
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const logo = meta.settings.print_logo;
  const brand = { ...f, print_logo: meta.settings.print_logo, print_social: JSON.stringify(social.filter((x) => x.handle)) };

  const save = async () => {
    setBusy(true);
    try {
      await api.put('/api/settings/system', { ...f, print_social: JSON.stringify(social.filter((x) => x.handle)) });
      toast('Branding saved — new documents use it immediately', 'ok'); reload(); rl();
    } catch (e) { toast(e.message, 'err'); } finally { setBusy(false); }
  };
  const upload = async ([file]) => {
    try { const fd = new FormData(); fd.append('logo', file); await api.upload('/api/settings/branding/logo', fd); toast('Logo updated', 'ok'); reload(); } catch (e) { toast(e.message, 'err'); }
  };
  const sample = tab === 'receipt'
    ? { title: f.receipt_title || 'RECEIPT VOUCHER', number: 'RV-00123' }
    : { title: f.expense_title || 'EXPENSE VOUCHER', number: 'EV-00045' };

  return (
    <div style={{ maxWidth: 1180 }}>
      <PageHead title="Receipts & branding" sub="Logo, header, footer, contact details and social handles used on receipt vouchers, expense vouchers and customer statements">
        <button className="btn primary" disabled={busy || ro} onClick={save}>Save branding</button>
      </PageHead>
      <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', alignItems: 'start' }}>
        <div className="stack">
          <Card title="Logo">
            <div className="row" style={{ gap: 16, alignItems: 'flex-start' }}>
              <div style={{ width: 120, height: 80, border: '1px dashed var(--border-2)', borderRadius: 8, display: 'grid', placeItems: 'center', background: 'var(--surface-2)' }}>
                {logo ? <img src={fileUrl(logo)} alt="Logo" style={{ maxWidth: 110, maxHeight: 70, objectFit: 'contain' }} /> : <span className="faint">No logo</span>}
              </div>
              <div className="grow stack" style={{ gap: 8 }}>
                {!ro && <FileUploader multiple={false} accept="image/png,image/jpeg,image/webp,image/gif" onFiles={upload} label="Upload a logo (PNG, JPG, WebP — max 5 MB)" />}
                {logo && !ro && <button className="btn sm danger" style={{ width: 'fit-content' }} onClick={async () => { await api.del('/api/settings/branding/logo'); reload(); toast('Logo removed', 'ok'); }}>Remove logo</button>}
                <div className="row between"><span>Print the logo on documents</span><Toggle value={f.print_show_logo !== '0'} onChange={(v) => set('print_show_logo', v ? '1' : '0')} /></div>
              </div>
            </div>
          </Card>
          <Card title="Header & contact details"><div className="form-grid">
            <Field label="Header / company name" className="full"><input className="input" disabled={ro} value={f.print_header || ''} onChange={(e) => set('print_header', e.target.value)} placeholder="Your company name" /></Field>
            <Field label="Address" className="full"><input className="input" disabled={ro} value={f.print_address || ''} onChange={(e) => set('print_address', e.target.value)} /></Field>
            <Field label="Contact number"><input className="input" disabled={ro} value={f.print_phone || ''} onChange={(e) => set('print_phone', e.target.value)} placeholder="Mobile: 0300-5551350  |  Ph: 051-5575280" /></Field>
            <Field label="Email"><input className="input" type="email" disabled={ro} value={f.print_email || ''} onChange={(e) => set('print_email', e.target.value)} /></Field>
            <Field label="Website" className="full"><input className="input" disabled={ro} value={f.print_website || ''} onChange={(e) => set('print_website', e.target.value)} /></Field>
          </div></Card>
          <Card title="Social media handles" actions={!ro && <button className="btn sm" onClick={() => setSocial([...social, { platform: 'Facebook', handle: '' }])}>Add handle</button>}>
            <div className="stack" style={{ gap: 8 }}>
              {!social.length && <span className="muted">No social handles. They print in the footer next to your contact details.</span>}
              {social.map((x, i) => (
                <div key={i} className="row">
                  <div style={{ width: 150 }}><Select allowEmpty={false} value={x.platform} onChange={(v) => setSocial(social.map((y, j) => (j === i ? { ...y, platform: v } : y)))} options={PLATFORMS} disabled={ro} /></div>
                  <input className="input grow" disabled={ro} value={x.handle} placeholder="@handle or number" onChange={(e) => setSocial(social.map((y, j) => (j === i ? { ...y, handle: e.target.value } : y)))} />
                  {!ro && <button className="btn sm ghost danger" onClick={() => setSocial(social.filter((_, j) => j !== i))}>×</button>}
                </div>
              ))}
            </div>
          </Card>
          <Card title="Receipt voucher"><div className="form-grid">
            <Field label="Document title"><input className="input" disabled={ro} value={f.receipt_title || ''} onChange={(e) => set('receipt_title', e.target.value)} placeholder="RECEIPT VOUCHER" /></Field>
            <Field label="Header note (under the letterhead)" className="full"><textarea className="textarea" disabled={ro} value={f.receipt_header || ''} onChange={(e) => set('receipt_header', e.target.value)} /></Field>
            <Field label="Footer text" className="full"><textarea className="textarea" disabled={ro} value={f.receipt_footer || ''} onChange={(e) => set('receipt_footer', e.target.value)} /></Field>
            <Field label="Terms & conditions" className="full"><textarea className="textarea" disabled={ro} value={f.receipt_terms || ''} onChange={(e) => set('receipt_terms', e.target.value)} /></Field>
            <Field label="QR code & ledger summary" className="full" hint="Default for printed and downloaded receipts. It can be switched on or off for any single receipt, and nothing else on the receipt changes."><div className="row between"><span>Show on receipts</span><Toggle value={(f.receipt_qr ?? '1') !== '0'} onChange={(v) => !ro && set('receipt_qr', v ? '1' : '0')} /></div></Field>
            <Field label="Printed copies (default)" className="full" hint="Office copy + client copy. Customers always get their own client copy from the portal."><select className="input" disabled={ro} value={f.receipt_copies || 'sheet'} onChange={(e) => set('receipt_copies', e.target.value)}><option value="sheet">Both copies on one A4 sheet (cut line between)</option><option value="pages">Two A4 pages — office copy, then client copy</option></select></Field>
          </div></Card>
          <Card title="Expense voucher"><div className="form-grid">
            <Field label="Document title"><input className="input" disabled={ro} value={f.expense_title || ''} onChange={(e) => set('expense_title', e.target.value)} placeholder="EXPENSE VOUCHER" /></Field>
            <Field label="Header note" className="full"><textarea className="textarea" disabled={ro} value={f.expense_header || ''} onChange={(e) => set('expense_header', e.target.value)} /></Field>
            <Field label="Footer text" className="full"><textarea className="textarea" disabled={ro} value={f.expense_footer || ''} onChange={(e) => set('expense_footer', e.target.value)} /></Field>
          </div></Card>
          <Card title="Common footer (statements & all documents)"><textarea className="textarea" disabled={ro} value={f.print_footer || ''} onChange={(e) => set('print_footer', e.target.value)} /></Card>
        </div>

        <div className="stack" style={{ position: 'sticky', top: 0 }}>
          <div className="top-tabs" style={{ marginBottom: 0 }}>
            {[['receipt', 'Receipt preview'], ['expense', 'Expense preview']].map(([k, l]) => <button key={k} className={`chip ${tab === k ? 'active' : ''}`} onClick={() => setTab(k)}>{l}</button>)}
          </div>
          <div className="print-doc" style={{ padding: 22, fontSize: 12, maxWidth: 'none', transform: 'none' }}>
            <DocHeader kind={tab} title={sample.title} number={sample.number} brand={brand} />
            <div className="grid g2" style={{ marginBottom: 10 }}>
              <div className="muted">Date<br /><b style={{ color: 'var(--text)' }}>08-Oct-2026</b></div>
              <div className="muted">{tab === 'receipt' ? 'Received from' : 'Vendor'}<br /><b style={{ color: 'var(--text)' }}>{tab === 'receipt' ? 'Muhammad Ali' : 'ABC Bricks'}</b></div>
            </div>
            <div className="sum-box" style={{ textAlign: 'center' }}><div className="l">Amount</div><div className="v" style={{ fontSize: 20 }}>{money(tab === 'receipt' ? 250000 : 180000)}</div></div>
            <DocFooter kind={tab} brand={brand} />
          </div>
          <div className="muted" style={{ fontSize: 12 }}>This preview updates as you type. Use Print → Save as PDF on any receipt, expense voucher or statement to get a branded PDF.</div>
        </div>
      </div>
    </div>
  );
}
