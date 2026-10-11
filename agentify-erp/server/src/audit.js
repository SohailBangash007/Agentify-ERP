import { run, all, get } from './db.js';
import { now } from './util.js';
import { pushTo } from './services/push.js';

export function audit(req, action, entity, entityId, detail) {
  const u = req?.user;
  run('INSERT INTO audit_log(user_id,user_name,action,entity,entity_id,detail,ip,created_at) VALUES(?,?,?,?,?,?,?,?)',
    u?.id ?? null, u ? `${u.name} (${u.role})` : 'system', action, entity ?? null, entityId == null ? null : String(entityId),
    typeof detail === 'string' ? detail : detail ? JSON.stringify(detail) : null, req?.ip ?? null, now());
}

/** Contact timeline entry. */
export function activity(contactId, user, action, { field, prev, next, detail, entityType, entityId } = {}) {
  const ts = now();
  run(`INSERT INTO activities(contact_id,entity_type,entity_id,user_id,user_name,action,field,prev_value,new_value,detail,created_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
    contactId ?? null, entityType ?? null, entityId ?? null, user?.id ?? null, user?.name ?? 'System', action,
    field ?? null, prev ?? null, next ?? null, detail ?? null, ts);
  if (contactId) run('UPDATE contacts SET last_activity_at=? WHERE id=?', ts, contactId);
}

/** In-app notification (+ phone push when subscribed). `opts.dedupe` makes a notification once-only per user. */
export function notify(userIds, type, title, body, link, opts = {}) {
  const ids = [...new Set([].concat(userIds).filter(Boolean))];
  for (const id of ids) {
    const r = run('INSERT OR IGNORE INTO notifications(user_id,type,title,body,link,read,dedupe,created_at) VALUES(?,?,?,?,?,0,?,?)', id, type, title, body ?? null, link ?? null, opts.dedupe ?? null, now());
    if (r.changes) pushTo(id, { title, body: body ?? '', url: link || '/' });
  }
}
/** Notify every active user whose role has a permission. */
export function notifyPerm(module, action, type, title, body, link) {
  const rows = all(`SELECT DISTINCT u.id FROM users u JOIN roles r ON r.id=u.role_id
    LEFT JOIN role_permissions p ON p.role_id=r.id AND p.module=? AND p.action=?
    WHERE u.active=1 AND r.portal=0 AND (r.name='Super Admin' OR p.role_id IS NOT NULL)`, module, action);
  notify(rows.map((r) => r.id), type, title, body, link);
}
export const userName = (id) => (id ? get('SELECT name FROM users WHERE id=?', id)?.name : null);
