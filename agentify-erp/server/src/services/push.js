import webpush from 'web-push';
import { all, get, run, getSetting, setSetting } from '../db.js';

/** VAPID details of the current tenant (each tenant has its own keys in its settings), created on first use. */
function init() {
  try {
    let pub = getSetting('vapid_public'), priv = getSetting('vapid_private');
    if (!pub || !priv) { const k = webpush.generateVAPIDKeys(); pub = k.publicKey; priv = k.privateKey; setSetting('vapid_public', pub); setSetting('vapid_private', priv); }
    const contact = getSetting('company_email') || 'admin@example.com';
    return { subject: `mailto:${contact}`, publicKey: pub, privateKey: priv };
  } catch (e) { console.error('push init failed', e.message); return null; }
}

export const vapidPublicKey = () => init()?.publicKey || null;

export function saveSubscription(userId, sub) {
  if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) throw new Error('Invalid push subscription');
  run(`INSERT INTO push_subscriptions(user_id,endpoint,p256dh,auth,created_at) VALUES(?,?,?,?,datetime('now','+5 hours'))
    ON CONFLICT(endpoint) DO UPDATE SET user_id=excluded.user_id, p256dh=excluded.p256dh, auth=excluded.auth`, userId, sub.endpoint, sub.keys.p256dh, sub.keys.auth);
}
export const removeSubscription = (userId, endpoint) => run('DELETE FROM push_subscriptions WHERE user_id=? AND endpoint=?', userId, endpoint);

/** Fire-and-forget phone/desktop push. Never throws into the caller's transaction. */
export function pushTo(userId, payload) {
  const subs = all('SELECT * FROM push_subscriptions WHERE user_id=?', userId);
  const vapidDetails = subs.length ? init() : null;
  if (!vapidDetails) return;
  const body = JSON.stringify({ title: payload.title, body: String(payload.body || '').slice(0, 180), url: payload.url || '/' });
  for (const s of subs) {
    webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, body, { TTL: 3600, vapidDetails })
      .catch((e) => { if ([404, 410].includes(e.statusCode)) run('DELETE FROM push_subscriptions WHERE id=?', s.id); });
  }
}
export const hasSubscription = (userId) => !!get('SELECT 1 FROM push_subscriptions WHERE user_id=?', userId);
