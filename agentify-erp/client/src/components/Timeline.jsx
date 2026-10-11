import { dateTime } from '../format.js';
import { Empty } from './ui.jsx';

const COLORS = [
  [/created|converted|received|generated|sold/i, '#16a34a'], [/changed|assigned|updated|reserved/i, '#2563eb'], [/note|task|follow/i, '#f59e0b'],
  [/void|cancel|delete|refund/i, '#ef4444'], [/commission/i, '#8b5cf6'],
];
const colorFor = (a) => COLORS.find(([re]) => re.test(a))?.[1] || '#64748b';

/** Activity feed / timeline: every entry shows date, time, user, action and previous → new value. */
export default function Timeline({ items, detailed }) {
  if (!items?.length) return <Empty>No activity recorded yet.</Empty>;
  return (
    <div className="timeline">
      {items.map((a) => (
        <div className="tl-item" key={a.id}>
          <span className="tl-dot" style={{ borderColor: colorFor(a.action) }} />
          <div><b>{a.action}</b>{a.field && <span className="muted"> · {a.field}</span>}</div>
          {(a.prev_value || a.new_value) && (
            <div style={{ marginTop: 2 }}>
              {a.prev_value && <span className="tl-change" style={{ textDecoration: 'line-through', color: 'var(--muted)' }}>{a.prev_value}</span>}
              {a.prev_value && a.new_value && ' → '}
              {a.new_value && <span className="tl-change" style={{ background: 'var(--blue-bg)', color: '#1d4ed8' }}>{a.new_value}</span>}
            </div>
          )}
          {a.detail && <div className="muted" style={{ marginTop: 2 }}>{a.detail}</div>}
          <div className="when">{dateTime(a.created_at)} PKT · {a.user_name || 'System'}</div>
        </div>
      ))}
      {detailed && null}
    </div>
  );
}
