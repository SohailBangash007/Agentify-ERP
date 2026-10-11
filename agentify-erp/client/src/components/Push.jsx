import { useEffect, useState } from 'react';
import Icon from './Icon.jsx';
import { api } from '../api.js';
import { useToast } from '../context.jsx';

const b64 = (s) => { const p = '='.repeat((4 - (s.length % 4)) % 4); const r = atob((s + p).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from([...r].map((c) => c.charCodeAt(0))); };
export const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

/** Register the service worker (installable app + phone notifications). Safe to call repeatedly. */
export function registerSW() {
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }
}

/** Turn phone / browser notifications on or off for this device. */
export default function PushToggle({ compact }) {
  const toast = useToast();
  const [state, setState] = useState('checking'); // checking | unsupported | off | on | blocked
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      if (!pushSupported()) return setState('unsupported');
      if (Notification.permission === 'denied') return setState('blocked');
      try { const reg = await navigator.serviceWorker.ready; const sub = await reg.pushManager.getSubscription(); setState(sub ? 'on' : 'off'); } catch { setState('off'); }
    })();
  }, []);

  const enable = async () => {
    setBusy(true);
    try {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') { setState(perm === 'denied' ? 'blocked' : 'off'); return; }
      const reg = await navigator.serviceWorker.ready;
      const { key } = await api.get('/api/push/key');
      const sub = (await reg.pushManager.getSubscription()) || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(key) });
      await api.post('/api/push/subscribe', { subscription: sub.toJSON() });
      setState('on'); toast('Notifications are on for this device', 'ok');
      await api.post('/api/push/test');
    } catch (e) { toast(e.message || 'Could not enable notifications', 'err'); } finally { setBusy(false); }
  };
  const disable = async () => {
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.ready; const sub = await reg.pushManager.getSubscription();
      if (sub) { await api.post('/api/push/unsubscribe', { endpoint: sub.endpoint }); await sub.unsubscribe(); }
      setState('off'); toast('Notifications turned off on this device', 'ok');
    } catch (e) { toast(e.message, 'err'); } finally { setBusy(false); }
  };

  if (state === 'checking') return null;
  if (state === 'unsupported') return compact ? null : <div className="muted" style={{ fontSize: 12 }}>This browser cannot show push notifications. Install the app on your phone (Add to Home Screen) to get them.</div>;
  if (state === 'blocked') return <div className="muted" style={{ fontSize: 12 }}>Notifications are blocked in your browser settings for this site.</div>;
  return state === 'on'
    ? <button className="btn sm" disabled={busy} onClick={disable}><Icon name="bell" size={13} />Notifications on — turn off</button>
    : <button className="btn sm primary" disabled={busy} onClick={enable}><Icon name="bell" size={13} />Turn on phone notifications</button>;
}
