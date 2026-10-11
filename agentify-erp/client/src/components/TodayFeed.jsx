import { Link, useNavigate } from 'react-router-dom';
import Icon from './Icon.jsx';
import { Empty } from './ui.jsx';
import { useFetch } from '../context.jsx';
import { money } from '../format.js';
import { WA, WhatsAppButton, useCompanyName } from './WhatsApp.jsx';

/** card key → pastel tile colour (shared by the cards and the "Needs attention" list). */
export const CARD_TONE = { overdue: 'red', duesoon: 'orange', followups: 'blue', crmtasks: 'violet', work: 'violet', stale: 'orange', vouchers: 'teal', commissions: 'green', assets: 'slate', leaves: 'orange', attendance: 'rose', content: 'rose' };
export const useToday = () => useFetch('/api/insights/today');

/** Compact list in the style of the reference dashboard: coloured icon chip + one line per thing that needs you. */
export function NeedsAttention({ data }) {
  if (!data) return <div className="skel skel-card" style={{ height: 200 }} />;
  if (!data.cards.length) return <Empty icon="check" title="Nothing needs you right now" hint="No follow-ups, approvals or reminders are due. Enjoy the quiet." />;
  return (
    <div className="attn">
      {data.cards.slice(0, 7).map((c) => (
        <Link key={c.key} to={c.link || '/'} className="attn-item">
          <span className={`ic-tile sm ic-${CARD_TONE[c.key] || 'teal'}`}><Icon name={c.icon} size={15} /></span>
          <span className="tx"><b className={c.hot ? 'neg' : ''}>{c.count}</b> {c.title.toLowerCase()}{c.total ? <small>{money(c.total)}</small> : c.items[0] ? <small>{c.items[0].title}</small> : null}</span>
          <Icon name="chevR" size={14} className="go" />
        </Link>
      ))}
    </div>
  );
}

/** Detailed cards, each opening the relevant screen already filtered. */
export default function TodayCards({ data }) {
  const nav = useNavigate();
  const co = useCompanyName();
  if (!data?.cards.length) return null;
  return (
    <div className="today-grid">
      {data.cards.map((c) => (
        <div key={c.key} className="card today-card">
          <div className="today-head">
            <span className={`ic c-${CARD_TONE[c.key] || 'teal'}`}><Icon name={c.icon} size={16} /></span>
            <div><b>{c.title}</b>{c.total ? <div className="muted" style={{ fontSize: 11.5 }}>{money(c.total)}</div> : null}</div>
            <span className={`n ${c.hot ? 'hot' : ''}`}>{c.count}</span>
          </div>
          <div className="card-b">
            {c.items.map((it, i) => (
              <Link key={i} to={it.link} className="today-item">
                <div className="grow" style={{ minWidth: 0 }}>
                  <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.title}</div>
                  <div className={`sub ${it.hot ? 'neg' : ''}`}>{it.sub}</div>
                </div>
                {it.amount ? <span className="mono bold nowrap">{money(it.amount)}</span> : null}
                {it.phone ? <WhatsAppButton phone={it.phone} text={WA.followup({ name: it.title }, co)} /> : null}
                {it.badge && <span className="tag">{it.badge}</span>}
              </Link>
            ))}
            {c.count > c.items.length && c.items.length > 0 && <div className="today-more muted">+ {c.count - c.items.length} more</div>}
            {!c.items.length && <div className="today-clear">{c.count} waiting</div>}
          </div>
          {c.link && <button className="btn sm ghost" style={{ margin: '0 8px 8px', justifyContent: 'space-between' }} onClick={() => nav(c.link)}>Open <Icon name="chevR" size={13} /></button>}
        </div>
      ))}
    </div>
  );
}
