import { useCallback, useEffect, useState } from 'react';
import { Card, Field, Loading, TextInput } from './ui.jsx';
import { api } from '../api.js';
import { useToast } from '../context.jsx';

/** Authenticator-app sign-in settings. `base` is the API prefix: /api/auth/2fa for workspace staff, /api/platform/admin/2fa for the console. */
export default function TwoFactor({ base }) {
  const toast = useToast();
  const [st, setSt] = useState(null);
  const [setup, setSetup] = useState(null);
  const [code, setCode] = useState('');
  const [codes, setCodes] = useState(null);
  const [off, setOff] = useState(null);
  const load = useCallback(() => api.get(base).then(setSt).catch((e) => toast(e.message, 'err')), [base, toast]);
  useEffect(() => { load(); }, [load]);
  if (!st) return <Loading />;
  const start = async () => { try { setSetup(await api.post(`${base}/setup`)); setCode(''); } catch (e) { toast(e.message, 'err'); } };
  const enable = async () => { try { const r = await api.post(`${base}/enable`, { code }); setCodes(r.recovery_codes); setSetup(null); load(); } catch (e) { toast(e.message, 'err'); } };
  const disable = async () => { try { await api.post(`${base}/disable`, off); setOff(null); load(); toast('Two-factor sign-in turned off'); } catch (e) { toast(e.message, 'err'); } };
  return (
    <Card title="Two-factor sign-in">
      <p className="muted">Adds a 6-digit code from an authenticator app (Google Authenticator, Microsoft Authenticator, Authy) after your password, so a stolen password alone is not enough.</p>
      {codes && (
        <div className="alert warn">
          <b>Save these recovery codes now.</b> Each works once if you lose your phone. They will not be shown again.
          <pre className="mono" style={{ margin: '8px 0 0', columns: 2 }}>{codes.join('\n')}</pre>
          <button className="btn sm" onClick={() => setCodes(null)}>I have saved them</button>
        </div>
      )}
      {!st.enabled && !setup && <button className="btn primary" onClick={start}>Set up two-factor sign-in</button>}
      {setup && (
        <div style={{ display: 'grid', gap: 12, maxWidth: 380 }}>
          <div>1. Scan this with your authenticator app.</div>
          <img src={setup.qr} alt="QR code for your authenticator app" width={220} height={220} />
          <div className="muted">Cannot scan? Enter this key: <code style={{ wordBreak: 'break-all' }}>{setup.secret}</code></div>
          <Field label="2. Enter the 6-digit code it shows"><TextInput inputMode="numeric" autoComplete="one-time-code" value={code} onChange={setCode} placeholder="123456" /></Field>
          <div><button className="btn primary" onClick={enable} disabled={code.replace(/\s/g, '').length !== 6}>Turn on</button>{' '}<button className="btn" onClick={() => setSetup(null)}>Cancel</button></div>
        </div>
      )}
      {st.enabled && !off && <div><span className="badge ok">On</span> <span className="muted">{st.recovery_left} recovery code{st.recovery_left === 1 ? '' : 's'} left</span>{' '}<button className="btn sm" onClick={() => setOff({ password: '', code: '' })}>Turn off</button></div>}
      {off && (
        <div style={{ display: 'grid', gap: 8, maxWidth: 340 }}>
          <Field label="Password"><TextInput type="password" value={off.password} onChange={(v) => setOff({ ...off, password: v })} /></Field>
          <Field label="Authenticator or recovery code"><TextInput value={off.code} onChange={(v) => setOff({ ...off, code: v })} /></Field>
          <div><button className="btn danger" onClick={disable}>Turn off</button>{' '}<button className="btn" onClick={() => setOff(null)}>Cancel</button></div>
        </div>
      )}
    </Card>
  );
}
