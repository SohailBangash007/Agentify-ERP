import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Icon from '../components/Icon.jsx';
import PushToggle from '../components/Push.jsx';
import { FormModal } from '../components/ResourcePage.jsx';
import { Card, CurrencyInput, Empty, Field, Loading, Modal, PageHead, ProgressBar, StagePill, Tabs } from '../components/ui.jsx';
import { api } from '../api.js';
import { useAuth, useFetch, useToast } from '../context.jsx';
import { date, money, moneyShort } from '../format.js';
import { celebrate } from '../celebrate.js';

const tone = (p) => (p >= 80 ? '#16a34a' : p >= 40 ? '#d97706' : '#dc2626');

export function Ring({ pct, size = 150, stroke = 13, label, sub }) {
  const r = (size - stroke) / 2, c = 2 * Math.PI * r;
  return (
    <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }} role="img" aria-label={`${pct}% of goal achieved`}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#e8ecf3" strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={tone(pct)} strokeWidth={stroke} strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - Math.min(100, pct) / 100)} style={{ transition: 'stroke-dashoffset .6s' }} />
      </svg>
      <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', textAlign: 'center' }}>
        <div><div style={{ fontSize: size / 3.6, fontWeight: 700, lineHeight: 1 }}>{pct}%</div><div className="muted" style={{ fontSize: 11.5, marginTop: 2 }}>{label}</div>{sub && <div className="faint" style={{ fontSize: 10.5 }}>{sub}</div>}</div>
      </div>
    </div>
  );
}

export function MetricBars({ progress }) {
  if (!progress.metrics.length) return <Empty>No goal is set for this period yet.</Empty>;
  return (
    <div className="stack" style={{ gap: 12 }}>
      {progress.metrics.map((m) => (
        <div key={m.key}>
          <div className="row between" style={{ marginBottom: 4 }}>
            <b>{m.label}</b>
            <span className="mono">{m.money ? `${moneyShort(m.actual)} / ${moneyShort(m.target)}` : `${m.actual} / ${m.target}`} · <b style={{ color: tone(m.pct) }}>{m.pct}%</b></span>
          </div>
          <div className="progress"><div style={{ width: `${m.pct}%`, background: tone(m.pct) }} /></div>
          <div className="faint" style={{ fontSize: 11.5, marginTop: 2 }}>{m.remaining > 0 ? `${m.money ? money(m.remaining) : m.remaining} to go` : '✓ Goal reached'}</div>
        </div>
      ))}
    </div>
  );
}

export function ConvertPanel({ opp }) {
  const wa = (p) => (p || '').replace(/[^\d]/g, '');
  return (
    <Card title={<span>🎯 Leads to convert <span className="pill amber" style={{ marginLeft: 6 }}>{opp.to_convert}</span></span>} actions={<Link className="btn sm" to="/pipeline">Open pipeline</Link>}>
      <div className="grid g4" style={{ marginBottom: 12 }}>
        <div className="sum-box"><div className="l">Interested</div><div className="v pos">{opp.interested}</div></div>
        <div className="sum-box"><div className="l">In follow-up</div><div className="v warn">{opp.follow_up}</div></div>
        <div className="sum-box"><div className="l">Overdue follow-ups</div><div className={`v ${opp.overdue_followups ? 'neg' : ''}`}>{opp.overdue_followups}</div></div>
        <div className="sum-box"><div className="l">Pipeline value</div><div className="v">{moneyShort(opp.pipeline_value)}</div></div>
      </div>
      {!opp.leads.length ? <Empty>No open leads in follow-up or interested stages. Add new leads!</Empty> : (
        <div className="stack" style={{ gap: 6 }}>
          {opp.leads.map((l) => (
            <div key={l.id} className="row" style={{ border: '1px solid var(--border)', borderRadius: 8, padding: '8px 10px', gap: 10 }}>
              <div className="grow" style={{ minWidth: 0 }}>
                <Link to={`/contacts/${l.id}`} className="bold">{l.full_name}</Link> <StagePill name={l.stage} color={l.stage_color} />
                <div className="muted" style={{ fontSize: 12 }}>{[l.property_title, l.budget ? `Budget ${money(l.budget)}` : null, l.followup_date ? `Follow-up ${date(l.followup_date)}` : 'No follow-up set'].filter(Boolean).join(' · ')}</div>
              </div>
              {l.phone && <a className="icon-btn" href={`tel:${l.phone}`} aria-label={`Call ${l.full_name}`}><Icon name="phone" size={15} /></a>}
              {l.phone && <a className="icon-btn" target="_blank" rel="noreferrer" href={`https://wa.me/${wa(l.phone)}`} aria-label="WhatsApp"><Icon name="chat" size={15} /></a>}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

export function Leaderboard({ rows, meId }) {
  const medal = (r) => (r === 1 ? '🥇' : r === 2 ? '🥈' : r === 3 ? '🥉' : r);
  return (
    <table className="t"><thead><tr><th style={{ width: 44 }}>#</th><th>Agent</th><th className="num">Points</th><th className="num">Sales (month)</th><th style={{ width: 150 }}>Month goal</th></tr></thead>
      <tbody>{rows.map((r) => (
        <tr key={r.id} style={r.id === meId ? { background: 'var(--primary-l)', fontWeight: 600 } : undefined}>
          <td>{medal(r.rank)}</td><td>{r.name}{r.id === meId && <span className="pill blue" style={{ marginLeft: 6 }}>You</span>}</td><td className="num mono">{r.points}</td><td className="num">{r.sales}</td>
          <td><div className="row"><div className="grow"><ProgressBar value={r.monthly_pct} /></div><span>{r.monthly_pct}%</span></div></td></tr>))}</tbody></table>
  );
}

function AgentView({ me, leaderboard, userId }) {
  const d = me.daily, mo = me.monthly;
  // confetti once per day, the first time the daily target is reached
  useEffect(() => {
    if (d.overall_pct < 100) return;
    const key = `goal-celebrated:${userId || 'me'}:${new Date().toISOString().slice(0, 10)}`;
    try { if (localStorage.getItem(key)) return; localStorage.setItem(key, '1'); } catch { /* ignore */ }
    celebrate(90);
  }, [d.overall_pct, userId]);
  return (
    <div className="stack">
      <div className="card" style={{ padding: 20, background: 'linear-gradient(135deg,#0f1b33,#1c3366)', color: '#fff' }}>
        <div className="row wrap" style={{ gap: 24, alignItems: 'center' }}>
          <div style={{ background: 'var(--surface)', borderRadius: '50%', padding: 6 }}><Ring pct={d.overall_pct} label="of today's goal" /></div>
          <div className="grow" style={{ minWidth: 240 }}>
            <div className="row wrap" style={{ gap: 8 }}><span className={`tier ${me.tier.tier}`}>{me.tier.tier.toUpperCase()}</span><span className="pill" style={{ background: '#ffffff22', color: '#fff' }}>🔥 {me.streak.days}-day streak</span><span className="pill" style={{ background: '#ffffff22', color: '#fff' }}>⭐ {me.points.month} pts this month</span></div>
            <h2 style={{ fontSize: 20, margin: '10px 0 6px' }}>{me.message}</h2>
            {me.tier.next && <div style={{ color: '#b9c6e4', fontSize: 12.5 }}>{me.tier.next.remaining} more sale(s) to reach {me.tier.next.name}</div>}
            <div style={{ marginTop: 10 }}><PushToggle /></div>
          </div>
        </div>
      </div>
      <div className="grid g2" style={{ alignItems: 'start' }}>
        <Card title="Today's goal" actions={<span className="muted">{d.source === 'personal' ? 'Set for you by your manager' : 'Team goal'}</span>}><MetricBars progress={d} /></Card>
        <Card title="This month" actions={<b style={{ color: tone(mo.overall_pct) }}>{mo.overall_pct}%</b>}><MetricBars progress={mo} /></Card>
      </div>
      <ConvertPanel opp={me.opportunities} />
      <div className="grid g2" style={{ alignItems: 'start' }}>
        <Card title="Badges">
          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))' }}>
            {me.badges.map((b) => (
              <div key={b.key} className="sum-box" style={{ textAlign: 'center', opacity: b.earned ? 1 : 0.4, filter: b.earned ? 'none' : 'grayscale(1)' }}>
                <div style={{ fontSize: 28 }}>{b.icon}</div><div className="bold">{b.name}</div><div className="muted" style={{ fontSize: 11 }}>{b.desc}</div>
              </div>))}
          </div>
        </Card>
        <Card title="Leaderboard — this month" flush><Leaderboard rows={leaderboard} meId={userId} /></Card>
      </div>
    </div>
  );
}

function GoalForm({ title, initial, onClose, onSaved, metrics }) {
  const toast = useToast();
  const [period, setPeriod] = useState('daily');
  const [vals, setVals] = useState({ daily: { ...initial.daily }, monthly: { ...initial.monthly } });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const v = vals[period];
  const set = (k, x) => setVals((o) => ({ ...o, [period]: { ...o[period], [k]: x === '' ? 0 : Number(x) } }));
  const save = async () => {
    setBusy(true); setErr('');
    try { await api.put('/api/goals', { user_id: initial.user_id || null, period, ...Object.fromEntries(metrics.map((m) => [m.key, v[m.key] || 0])) }); toast(`${period === 'daily' ? 'Daily' : 'Monthly'} goal saved — the agent has been notified`, 'ok'); onSaved(); }
    catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <Modal title={title} size="sm" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy} onClick={save}>Save {period} goal</button></>}>
      <div className="stack">
        {err && <div className="alert err">{err}</div>}
        <div className="top-tabs" style={{ marginBottom: 0 }}>{['daily', 'monthly'].map((p) => <button key={p} className={`chip ${period === p ? 'active' : ''}`} onClick={() => setPeriod(p)}>{p === 'daily' ? 'Daily goal' : 'Monthly goal'}</button>)}</div>
        {metrics.map((m) => (
          <Field key={m.key} label={m.label} hint={m.key === 'conversions' && period === 'daily' ? '0 = not part of the daily goal' : m.key === 'sales_value' ? '0 = not part of the goal' : undefined}>
            {m.money ? <CurrencyInput value={v[m.key] || ''} onChange={(x) => set(m.key, x)} /> : <input className="input" type="number" min="0" value={v[m.key] ?? 0} onChange={(e) => set(m.key, e.target.value)} />}
          </Field>
        ))}
        <div className="muted" style={{ fontSize: 12 }}>The performance % is the average of the goals above (those set to 0 are ignored).</div>
      </div>
    </Modal>
  );
}

function ManagerView({ ov, reload }) {
  const toast = useToast();
  const [tab, setTab] = useState('team');
  const [editing, setEditing] = useState(null);
  const [nudge, setNudge] = useState(null);
  const team = ov.team || [];
  const hit = team.filter((t) => t.daily.achieved).length;
  const conv = team.reduce((a, t) => a + t.to_convert, 0);
  return (
    <div className="stack">
      <div className="grid g4">
        <div className="card stat"><span className="label">Agents on target today</span><span className="value">{hit}/{team.length}</span></div>
        <div className="card stat"><span className="label">Average today</span><span className="value">{team.length ? Math.round(team.reduce((a, t) => a + t.daily.overall_pct, 0) / team.length) : 0}%</span></div>
        <div className="card stat"><span className="label">Leads waiting to convert</span><span className="value warn">{conv}</span><span className="sub-v">in follow-up or interested</span></div>
        <div className="card stat"><span className="label">Overdue follow-ups</span><span className="value neg">{team.reduce((a, t) => a + t.overdue_followups, 0)}</span></div>
      </div>
      <Card flush>
        <Tabs value={tab} onChange={setTab} tabs={[{ key: 'team', label: 'Team today' }, { key: 'goals', label: 'Set goals' }, { key: 'board', label: 'Leaderboard' }]} />
        {tab === 'team' && (
          <div className="table-wrap"><table className="t"><thead><tr><th>#</th><th>Agent</th><th style={{ minWidth: 150 }}>Today</th><th style={{ minWidth: 130 }}>This month</th><th className="num">Interested</th><th className="num">Follow-up</th><th className="num">Overdue</th><th className="num">Streak</th><th className="num">Points</th><th /></tr></thead>
            <tbody>{team.map((t) => (
              <tr key={t.id}><td>{t.rank}</td><td className="cell-main">{t.name}</td>
                <td><div className="row"><div className="grow"><div className="progress"><div style={{ width: `${t.daily.overall_pct}%`, background: tone(t.daily.overall_pct) }} /></div></div><b style={{ color: tone(t.daily.overall_pct) }}>{t.daily.overall_pct}%</b></div></td>
                <td><div className="row"><div className="grow"><ProgressBar value={t.monthly.overall_pct} /></div><span>{t.monthly.overall_pct}%</span></div></td>
                <td className="num">{t.interested}</td><td className="num">{t.follow_up}</td><td className={`num ${t.overdue_followups ? 'neg bold' : ''}`}>{t.overdue_followups}</td><td className="num">{t.streak ? `🔥 ${t.streak}` : '—'}</td><td className="num mono">{t.points}</td>
                <td className="right nowrap"><button className="btn sm" onClick={() => setNudge({ user_id: t.id, name: t.name, message: '' })}>Nudge</button></td></tr>))}</tbody></table>
            {!team.length && <Empty>No sales agents yet.</Empty>}</div>
        )}
        {tab === 'goals' && (
          <div className="card-b stack">
            <div className="alert info">Goals set here drive each agent's performance percentage and their daily reminders. An agent without a personal goal uses the team default. Daily reminders go out at 9am, 2pm (if under 60%) and 6pm to the agent's web and phone.</div>
            <table className="t"><thead><tr><th>Agent</th><th>Daily goal</th><th>Monthly goal</th><th /></tr></thead>
              <tbody>
                <tr style={{ background: 'var(--surface-2)' }}><td className="bold">Team default <span className="muted">(all agents without a personal goal)</span></td>
                  <td>{describe(ov.defaults.daily, ov.metrics)}</td><td>{describe(ov.defaults.monthly, ov.metrics)}</td><td className="right"><button className="btn sm primary" onClick={() => setEditing({ title: 'Team default goals', user_id: null, daily: ov.defaults.daily, monthly: ov.defaults.monthly })}>Edit</button></td></tr>
                {ov.agents.map((a) => (
                  <tr key={a.id}><td className="cell-main">{a.name}</td>
                    <td>{describe(a.daily, ov.metrics)} {a.daily.source === 'personal' && <span className="pill blue">personal</span>}</td><td>{describe(a.monthly, ov.metrics)} {a.monthly.source === 'personal' && <span className="pill blue">personal</span>}</td>
                    <td className="right nowrap"><button className="btn sm" onClick={() => setEditing({ title: `Goals for ${a.name}`, user_id: a.id, daily: a.daily, monthly: a.monthly })}>Set goal</button>
                      {(a.daily.source === 'personal' || a.monthly.source === 'personal') && <button className="btn sm ghost" onClick={async () => { for (const p of ['daily', 'monthly']) await api.del(`/api/goals/${a.id}/${p}`); toast('Reset to team default', 'ok'); reload(); }}>Reset</button>}</td></tr>))}
              </tbody></table>
          </div>
        )}
        {tab === 'board' && <Leaderboard rows={ov.leaderboard} />}
      </Card>
      {editing && <GoalForm title={editing.title} initial={editing} metrics={ov.metrics} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} />}
      {nudge && <FormModal title={`Motivate ${nudge.name}`} size="sm" initial={nudge} fields={[{ name: 'message', label: 'Message (sent as a notification to their web and phone)', type: 'textarea', required: true }]} submitLabel="Send"
        onClose={() => setNudge(null)} onSave={async (f) => { await api.post('/api/goals/nudge', { user_id: nudge.user_id, message: f.message }); toast('Message sent', 'ok'); setNudge(null); }} />}
    </div>
  );
}
const describe = (g, metrics) => metrics.filter((m) => g[m.key] > 0).map((m) => (m.money ? `${moneyShort(g[m.key])} sales` : `${g[m.key]} ${m.short.toLowerCase()}`)).join(' · ') || <span className="muted">none</span>;

export default function Goals() {
  const { user } = useAuth();
  const { data: ov, error, reload } = useFetch('/api/goals/overview');
  const alerts = useFetch('/api/notifications', { type: 'goal', limit: 20 });
  const [tab, setTab] = useState('goals');
  if (error) return <div className="alert err">{error}</div>;
  if (!ov) return <Loading />;
  return (
    <div>
      <PageHead title="Goals & rewards" sub={ov.can_set ? 'Set daily and monthly goals, track every agent and keep them motivated' : 'Your targets, your progress and the leads waiting for you'}>
        <PushToggle compact />
      </PageHead>
      <div className="top-tabs"><button className={`chip ${tab === 'goals' ? 'active' : ''}`} onClick={() => setTab('goals')}>{ov.can_set ? 'Team goals' : 'My goals'}</button><button className={`chip ${tab === 'alerts' ? 'active' : ''}`} onClick={() => setTab('alerts')}>Goal reminders {alerts.data?.unread ? `(${alerts.data.unread})` : ''}</button></div>
      {tab === 'goals' && (ov.me ? <AgentView me={ov.me} leaderboard={ov.leaderboard} userId={user.id} /> : ov.can_set ? <ManagerView ov={ov} reload={reload} /> : <Empty>Goals are for sales agents and their managers.</Empty>)}
      {tab === 'alerts' && (
        <Card title="Goal reminders & messages" actions={<button className="btn sm" onClick={async () => { await api.post('/api/notifications/read'); alerts.reload(); }}>Mark all read</button>} flush>
          {!alerts.data ? <Loading /> : !alerts.data.rows.length ? <Empty>No goal reminders yet. They arrive each morning, midday and evening.</Empty> : (
            <table className="t"><tbody>{alerts.data.rows.map((n) => <tr key={n.id} style={{ background: n.read ? undefined : 'var(--primary-l)' }}><td><b>{n.title}</b><div className="muted">{n.body}</div></td><td className="muted nowrap">{n.created_at?.slice(0, 16)}</td></tr>)}</tbody></table>
          )}
        </Card>
      )}
    </div>
  );
}
