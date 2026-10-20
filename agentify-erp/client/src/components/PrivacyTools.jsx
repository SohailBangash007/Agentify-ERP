// Administrator-only: export everything held about a person, or erase their personal details.
import { useState } from 'react';
import { Card, Field } from './ui.jsx';
import { api, download } from '../api.js';
import { useAuth, useToast } from '../context.jsx';

export default function PrivacyTools({ contactId, onErased }) {
  const { user } = useAuth();
  const toast = useToast();
  const [confirm, setConfirm] = useState('');
  const [open, setOpen] = useState(false);
  if (!user?.isSuper) return null;
  const exportIt = async () => { try { await download(`/api/privacy/contact/${contactId}/export`, {}, `contact-${contactId}-export.json`); } catch (e) { toast(e.message, 'err'); } };
  const erase = async () => {
    try { await api.post(`/api/privacy/contact/${contactId}/erase`, { confirm, reason: 'Erased from the contact page' }); toast('Personal details erased'); setOpen(false); setConfirm(''); onErased?.(); } catch (e) { toast(e.message, 'err'); }
  };
  return (
    <Card title="Privacy">
      <div className="muted" style={{ marginBottom: 8 }}>Export what we hold about this person, or erase their personal details. Sales, receipts and accounting entries are kept (detached from the person) because record-keeping rules usually require it.</div>
      <div className="row">
        <button className="btn sm" onClick={exportIt}>Export data (JSON)</button>
        <button className="btn danger sm" onClick={() => setOpen(!open)}>Erase personal data…</button>
      </div>
      {open && (
        <div className="stack" style={{ marginTop: 10 }}>
          <Field label={`Type ERASE ${contactId} to confirm`} hint="This cannot be undone."><input className="input" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="off" /></Field>
          <div><button className="btn danger sm" disabled={confirm !== `ERASE ${contactId}`} onClick={erase}>Erase now</button></div>
        </div>)}
    </Card>
  );
}
