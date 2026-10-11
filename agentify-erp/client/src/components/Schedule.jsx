import { Fragment, useMemo, useState } from 'react';
import Icon from './Icon.jsx';
import { FormModal } from './ResourcePage.jsx';
import { Card, ConfirmDialog, CurrencyInput, Empty, Field, Loading, Modal, ProgressBar, Select } from './ui.jsx';
import { api } from '../api.js';
import { useAuth, useFetch, useLookups, useMeta, useToast, useUndoDelete } from '../context.jsx';
import { date, month, todayPK } from '../format.js';

export const STATUS = {
  completed: ['Completed', '#16a34a'], on_track: ['In progress', '#2563eb'], behind: ['Behind plan', '#d97706'], delayed: ['Delayed', '#dc2626'],
  at_risk: ['At risk', '#d97706'], not_started: ['Not started', '#94a3b8'],
};
const HEALTH = { on_track: ['On track', 'green'], at_risk: ['At risk', 'amber'], delayed: ['Delayed', 'red'], none: ['No schedule', 'grey'] };
const day = (d) => Date.parse(d + 'T00:00:00Z') / 86400000;
const addD = (d, n) => new Date((day(d) + n) * 86400000).toISOString().slice(0, 10);

export function StatusPill({ status }) {
  const [label, color] = STATUS[status] || STATUS.not_started;
  return <span className="pill" style={{ background: color + '1f', color }}><i />{label}</span>;
}

/** Timeline bars: planned window, progress fill, forecast overrun hatch and a "today" marker. */
export function Gantt({ tasks, onSelect }) {
  const t0 = todayPK();
  const range = useMemo(() => {
    if (!tasks.length) return null;
    const starts = tasks.flatMap((t) => [t.planned_start, t.actual_start, t.forecast_start].filter(Boolean)).sort();
    const ends = tasks.flatMap((t) => [t.planned_end, t.actual_end, t.forecast_end].filter(Boolean)).sort().reverse();
    const from = addD(starts[0] < t0 ? starts[0] : t0, -3), to = addD(ends[0] > t0 ? ends[0] : t0, 4);
    return { from, to, span: Math.max(1, day(to) - day(from)) };
  }, [tasks, t0]);
  if (!range) return <Empty>No activities scheduled yet.</Empty>;
  const pct = (d) => ((day(d) - day(range.from)) / range.span) * 100;
  const ticks = [];
  for (let d = range.from.slice(0, 7) + '-01'; d <= range.to; d = new Date(Date.UTC(+d.slice(0, 4), +d.slice(5, 7), 1)).toISOString().slice(0, 10)) if (d >= range.from) ticks.push(d);
  return (
    <div style={{ overflowX: 'auto' }}>
      <div style={{ minWidth: 760, position: 'relative' }}>
        <div className="row" style={{ borderBottom: '1px solid var(--border)', height: 26, background: 'var(--surface-2)' }}>
          <div style={{ width: 210, flexShrink: 0, padding: '0 10px', fontWeight: 600, fontSize: 12 }}>Activity</div>
          <div style={{ position: 'relative', flex: 1, height: '100%' }}>{ticks.map((d) => <span key={d} style={{ position: 'absolute', left: `${pct(d)}%`, fontSize: 10.5, color: 'var(--muted)', paddingLeft: 3, borderLeft: '1px solid var(--border)', height: '100%', lineHeight: '26px' }}>{month(d)}</span>)}</div>
        </div>
        {tasks.map((t) => {
          const [, color] = STATUS[t.status] || STATUS.not_started;
          const left = pct(t.planned_start), width = Math.max(0.8, pct(addD(t.planned_end, 1)) - left);
          const over = !t.is_group && t.status !== 'completed' && t.forecast_end > t.planned_end;
          return (
            <div key={t.id} className="row" style={{ height: 30, borderBottom: '1px solid var(--border)', cursor: onSelect ? 'pointer' : 'default' }} onClick={() => onSelect?.(t)}
              title={`${t.name}\nStart ${date(t.planned_start)} → due ${date(t.planned_end)}\nCompletion ${t.progress}%${t.forecast_end ? `\nForecast finish ${date(t.forecast_end)}` : ''}`}>
              <div style={{ width: 210, flexShrink: 0, padding: `0 10px 0 ${10 + (t.parent_id ? 16 : 0)}px`, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontWeight: t.is_group ? 600 : 400, fontSize: 12.5 }}>{t.name}</div>
              <div style={{ position: 'relative', flex: 1, height: '100%' }}>
                {ticks.map((d) => <span key={d} style={{ position: 'absolute', left: `${pct(d)}%`, top: 0, bottom: 0, borderLeft: '1px solid #f0f2f6' }} />)}
                <div style={{ position: 'absolute', left: `${left}%`, width: `${width}%`, top: t.is_group ? 11 : 8, height: t.is_group ? 8 : 14, background: t.is_group ? '#475467' : '#dbe4f5', borderRadius: t.is_group ? 2 : 4, overflow: 'hidden' }}>
                  <div style={{ width: `${t.progress}%`, height: '100%', background: t.is_group ? '#1f2937' : color }} />
                </div>
                {over && <div style={{ position: 'absolute', left: `${pct(addD(t.planned_end, 1))}%`, width: `${Math.max(0.6, pct(addD(t.forecast_end, 1)) - pct(addD(t.planned_end, 1)))}%`, top: 8, height: 14, borderRadius: 4, background: 'repeating-linear-gradient(45deg,#fca5a5,#fca5a5 4px,#fee2e2 4px,#fee2e2 8px)', border: '1px solid #f87171' }} />}
              </div>
            </div>
          );
        })}
        <div style={{ position: 'absolute', top: 26, bottom: 0, left: `calc(210px + (100% - 210px) * ${pct(t0) / 100})`, borderLeft: '2px solid #ef4444', pointerEvents: 'none' }} />
      </div>
      <div className="row wrap" style={{ gap: 14, padding: '8px 10px', fontSize: 11.5, color: 'var(--muted)' }}>
        <span><b style={{ color: '#2563eb' }}>■</b> Completed so far</span><span><b style={{ color: '#dbe4f5' }}>■</b> Start → due window</span><span><b style={{ color: '#f87171' }}>▨</b> Forecast overrun</span><span><b style={{ color: '#ef4444' }}>|</b> Today</span>
      </div>
    </div>
  );
}

/** Headline numbers: completion, planned-by-today, performance, forecast finish. */
export function ScheduleKpis({ s }) {
  const [hl, tone] = HEALTH[s.health] || HEALTH.none;
  const perf = s.performance_pct;
  return (
    <div className="grid g4">
      <div className="card stat"><span className="label">Overall completion</span><span className="value">{s.actual_pct}%</span><ProgressBar value={s.actual_pct} /><span className="sub-v">{s.completed} of {s.tasks} activities complete</span></div>
      <div className="card stat"><span className="label">Planned by today</span><span className="value">{s.planned_pct}%</span><ProgressBar value={s.planned_pct} /><span className="sub-v">as of {date(s.as_of)}</span></div>
      <div className="card stat"><span className="label">Schedule performance</span><span className={`value ${perf != null && perf < 90 ? 'neg' : 'pos'}`}>{perf == null ? '—' : `${perf}%`}</span><span className="sub-v">completion ÷ planned · 100% = on plan</span></div>
      <div className="card stat"><span className="label">Forecast finish</span><span className="value" style={{ fontSize: 16 }}>{s.forecast_end ? date(s.forecast_end) : '—'}</span><span className="sub-v">planned {s.planned_end ? date(s.planned_end) : '—'} · <span className={`pill ${tone}`}>{hl}</span>{s.projected_delay_days > 0 && <b className="neg"> +{s.projected_delay_days}d</b>}</span></div>
    </div>
  );
}

export function Warnings({ warnings }) {
  if (!warnings?.length) return null;
  return (
    <div className="alert warn stack" style={{ gap: 4 }}>
      <b><Icon name="clock" size={14} /> {warnings.length} schedule alert{warnings.length > 1 ? 's' : ''}</b>
      {warnings.slice(0, 8).map((w, i) => <div key={i} style={{ color: w.type === 'overdue' ? 'var(--red)' : undefined }}>• {w.message}</div>)}
      {warnings.length > 8 && <div className="muted">…and {warnings.length - 8} more</div>}
    </div>
  );
}

/** Project commencement → deadline banner. */
export function TimelineBar({ t }) {
  if (!t) return null;
  return (
    <div className="card" style={{ padding: '10px 14px' }}>
      <div className="row between wrap" style={{ marginBottom: 6 }}>
        <span><b>Commencement</b> {date(t.commencement)} → <b>Deadline</b> {date(t.deadline)}</span>
        <span className="muted">{t.total_days} days · {t.elapsed_days} elapsed · <b className={t.remaining_days < 0 ? 'neg' : ''}>{t.remaining_days < 0 ? `${-t.remaining_days} days past deadline` : `${t.remaining_days} days left`}</b></span>
      </div>
      <ProgressBar value={t.time_pct} />
    </div>
  );
}

/** Read-only schedule for customers. */
export function ScheduleView({ schedule: raw }) {
  const { hidden } = useUndoDelete('schedule');
  const schedule = { ...raw, tasks: raw.tasks.filter((t) => !hidden.has(t.id)) };
  if (!schedule || !schedule.tasks.length) return <Empty>No schedule has been published yet.</Empty>;
  return (
    <div className="stack">
      <ScheduleKpis s={schedule.summary} />
      <Warnings warnings={schedule.warnings} />
      <Card title="Timeline" flush><Gantt tasks={schedule.tasks} /></Card>
      <Card flush>
        <div className="table-wrap"><table className="t"><thead><tr><th>Activity</th><th>Start → due</th><th>Forecast finish</th><th>Completion</th><th>Status</th></tr></thead>
          <tbody>{schedule.tasks.map((t) => (
            <tr key={t.id} style={t.is_group ? { background: 'var(--surface-2)', fontWeight: 600 } : undefined}>
              <td style={{ paddingLeft: t.parent_id ? 28 : 12 }}>{t.name}{t.notes && !t.is_group && <div className="cell-sub">{t.notes}</div>}</td>
              <td className="nowrap">{date(t.planned_start)} → {date(t.planned_end)}</td>
              <td className="nowrap">{t.status === 'completed' ? (t.actual_end ? date(t.actual_end) : '—') : date(t.forecast_end)}{t.status !== 'completed' && t.forecast_delay_days > 0 && <span className="neg"> (+{t.forecast_delay_days}d)</span>}</td>
              <td style={{ minWidth: 130 }}><div className="row"><div className="grow"><ProgressBar value={t.progress} tone={t.progress >= 100 ? 'green' : ''} /></div><b>{t.progress}%</b></div></td>
              <td><StatusPill status={t.status} />{t.delay_days > 0 && t.status === 'delayed' && <span className="neg" style={{ marginLeft: 6 }}>{t.delay_days}d late</span>}</td>
            </tr>))}</tbody></table></div>
      </Card>
    </div>
  );
}

const activityFields = (tasks, contracts, editing) => [
  { name: 'name', label: 'Activity', required: true, full: true, type: 'activity' },
  { name: 'planned_start', label: 'Start date', type: 'date', required: true }, { name: 'planned_end', label: 'Due date', type: 'date', required: true, hint: 'Completion % is calculated automatically from these two dates' },
  { name: 'parent_id', label: 'Group under (optional)', type: 'select', number: true, options: tasks.filter((t) => t.id !== editing?.id && !t.parent_id).map((t) => ({ value: t.id, label: t.name })) },
  { name: 'predecessor_id', label: 'Starts after (optional)', type: 'select', number: true, options: tasks.filter((t) => t.id !== editing?.id).map((t) => ({ value: t.id, label: t.name })), hint: 'If that activity runs late, this one is forecast late too' },
  { name: 'weight', label: 'Impact on overall completion', type: 'number', min: 0.1, step: 0.1, hint: 'Bigger = counts more (weighted by duration)' },
  { name: 'sale_id', label: 'Applies to', type: 'select', number: true, options: [{ value: '', label: 'Whole project (all customers)' }, ...contracts.map((c) => ({ value: c.id, label: `${c.customer} — ${c.title || c.sale_no}` }))], allowEmpty: false },
  { name: 'client_visible', label: 'Visible to customers in their portal', type: 'bool', full: true },
  { name: 'notes', label: 'Notes (shown to customers)', type: 'textarea' },
];

/** Quick plan: pick activities from the library and spread them across the commencement → deadline window. */
const DAYMS = 86400000;
const isoOf = (ms) => new Date(ms).toISOString().slice(0, 10);
const defaultDays = (n) => (/slab|roof/i.test(n) ? 15 : /footing|foundation|structure|column/i.test(n) ? 14 : /masonry|brick/i.test(n) ? 20 : /plaster|flooring|tile|finishing|paint/i.test(n) ? 12 : /clearing|marking|excavation|scaffold/i.test(n) ? 5 : 7);

/** Quick plan: choose activities, type the number of days each one takes — dates are worked out in order. */
function QuickPlan({ projectId, timeline, library, scope, onClose, onDone }) {
  const toast = useToast();
  const [start, setStart] = useState(timeline?.commencement || todayPK());
  const [rows, setRows] = useState(() => library.slice(0, 16).map((n, i) => ({ name: n, on: i < 8, days: defaultDays(n), subs: [], open: false })));
  const [custom, setCustom] = useState('');
  const [busy, setBusy] = useState(false);
  const upd = (i, patch) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const move = (i, d) => setRows((rs) => { const a = [...rs]; const j = i + d; if (j < 0 || j >= a.length) return rs; [a[i], a[j]] = [a[j], a[i]]; return a; });
  const subSum = (r) => r.subs.reduce((t, x) => t + (Number(x.days) || 0), 0);
  const daysOf = (r) => (r.subs.length ? subSum(r) : Math.max(0, Math.round(Number(r.days) || 0)));
  // live schedule: each activity starts the day after the previous one ends
  const plan = useMemo(() => {
    let cur = Date.parse(start || todayPK());
    return rows.map((r) => {
      if (!r.on) return { ...r, from: null, to: null };
      const d = Math.max(1, daysOf(r));
      const from = cur, to = cur + (d - 1) * DAYMS; cur += d * DAYMS;
      return { ...r, from: isoOf(from), to: isoOf(to), d };
    });
  }, [rows, start]); // eslint-disable-line react-hooks/exhaustive-deps
  const chosen = plan.filter((r) => r.on);
  const total = chosen.reduce((t, r) => t + r.d, 0);
  const finish = chosen.length ? chosen[chosen.length - 1].to : null;
  const late = timeline?.deadline && finish && finish > timeline.deadline ? Math.round((Date.parse(finish) - Date.parse(timeline.deadline)) / DAYMS) : 0;
  const fit = () => {
    if (!timeline?.deadline || !chosen.length) return;
    const span = Math.round((Date.parse(timeline.deadline) - Date.parse(start)) / DAYMS) + 1;
    if (span < chosen.length) return toast('The deadline is too close for that many activities', 'err');
    const each = Math.floor(span / chosen.length), extra = span - each * chosen.length;
    let k = 0;
    setRows((rs) => rs.map((r) => { if (!r.on || r.subs.length) return r; const d = each + (k === chosen.length - 1 ? extra : 0); k++; return { ...r, days: d }; }));
  };
  const submit = async () => {
    if (chosen.some((r) => r.d < 1)) return toast('Every activity needs at least 1 day', 'err');
    setBusy(true);
    try {
      const items = chosen.map((c) => ({ name: c.name, days: c.subs.length ? undefined : c.d, subs: c.subs.filter((x) => x.name.trim()).map((x) => ({ name: x.name.trim(), days: Number(x.days) || 1 })) }));
      const r = await api.post(`/api/projects/${projectId}/tasks/plan`, { items, start, sale_id: scope !== 'project' && scope !== 'all' ? Number(scope) : undefined });
      toast(`${r.created} activities created — finishing ${date(r.end)}`, 'ok'); onDone();
    } catch (e) { toast(e.message, 'err'); } finally { setBusy(false); }
  };
  const addCustom = () => { if (custom.trim()) { setRows([...rows, { name: custom.trim(), on: true, days: defaultDays(custom), subs: [], open: false }]); setCustom(''); } };
  return (
    <Modal title="Quick plan" size="lg" onClose={onClose}
      footer={<><span className="muted" style={{ marginRight: 'auto', fontSize: 13 }}>{chosen.length} activities · <b>{total} days</b>{finish ? ` · finishes ${date(finish)}` : ''}</span><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy || !chosen.length} onClick={submit}>{busy ? 'Creating…' : `Create ${chosen.length} activities`}</button></>}>
      <div className="stack">
        <ol className="muted" style={{ margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: 1.6 }}>
          <li><b>Tick</b> the activities this project needs (add your own at the bottom).</li>
          <li>Type the <b>number of days</b> each one takes — start and finish dates fill in by themselves, one after another.</li>
          <li>Need smaller steps? Press <b>＋ Sub-activities</b> on an activity (e.g. Footing → Excavation, Rebar, Concrete). You can fine-tune every date afterwards.</li>
        </ol>
        <div className="form-grid">
          <Field label="Work starts on" required><input className="input" type="date" value={start} onChange={(e) => setStart(e.target.value)} /></Field>
          <Field label="Project deadline" hint={timeline?.deadline ? (late ? `⚠ This plan finishes ${late} day(s) after the deadline` : finish ? '✓ Within the deadline' : '') : 'No deadline set on the project'}>
            <div className="row"><input className="input" readOnly value={timeline?.deadline ? date(timeline.deadline) : '—'} />{timeline?.deadline && <button className="btn sm" type="button" onClick={fit} title="Give every activity an equal share of the time up to the deadline">Fit to deadline</button>}</div>
          </Field>
        </div>
        <div className="card" style={{ maxHeight: 400, overflow: 'auto' }}>
          <table className="t"><thead><tr><th style={{ width: 28 }} /><th>Activity</th><th style={{ width: 86 }}>Days</th><th style={{ width: 108 }}>Starts</th><th style={{ width: 108 }}>Ends</th><th style={{ width: 118 }} /></tr></thead>
            <tbody>{plan.map((r, i) => (
              <Fragment key={r.name + i}>
                <tr style={{ opacity: r.on ? 1 : 0.55 }}>
                  <td><input type="checkbox" aria-label={`Include ${r.name}`} checked={r.on} onChange={(e) => upd(i, { on: e.target.checked })} /></td>
                  <td><b>{r.name}</b></td>
                  <td>{r.subs.length ? <span className="muted" title="Sum of the sub-activities">{subSum(r)}</span> : <input className="input" style={{ height: 28, textAlign: 'center' }} type="number" min="1" disabled={!r.on} value={r.days} onChange={(e) => upd(i, { days: e.target.value })} aria-label={`Days for ${r.name}`} />}</td>
                  <td className="muted nowrap">{r.from ? date(r.from) : '—'}</td><td className="muted nowrap">{r.to ? date(r.to) : '—'}</td>
                  <td className="right nowrap">
                    <button className="btn sm ghost" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move up">↑</button><button className="btn sm ghost" disabled={i === rows.length - 1} onClick={() => move(i, 1)} aria-label="Move down">↓</button>
                    <button className="btn sm ghost" disabled={!r.on} onClick={() => upd(i, { open: !r.open, subs: r.subs.length ? r.subs : [{ name: '', days: 3 }] })} title="Break this activity into smaller steps">{r.subs.length ? `${r.subs.length} sub` : '＋ Sub'}</button>
                  </td>
                </tr>
                {r.on && r.open && (
                  <tr><td /><td colSpan={5} style={{ background: 'var(--surface-2)' }}>
                    <div className="stack" style={{ gap: 6, padding: '4px 0' }}>
                      {r.subs.map((x, k) => (
                        <div key={k} className="row" style={{ gap: 6 }}><span className="muted">└</span>
                          <input className="input" style={{ height: 28 }} placeholder="Sub-activity, e.g. Excavation" list="activity-library" value={x.name} onChange={(e) => upd(i, { subs: r.subs.map((y, m) => (m === k ? { ...y, name: e.target.value } : y)) })} />
                          <input className="input" style={{ height: 28, width: 70, textAlign: 'center' }} type="number" min="1" value={x.days} onChange={(e) => upd(i, { subs: r.subs.map((y, m) => (m === k ? { ...y, days: e.target.value } : y)) })} aria-label="Days" /><span className="muted" style={{ fontSize: 12 }}>days</span>
                          <button className="btn sm ghost danger" onClick={() => upd(i, { subs: r.subs.filter((_, m) => m !== k) })} aria-label="Remove sub-activity">×</button></div>))}
                      <button className="btn sm" style={{ width: 'fit-content' }} onClick={() => upd(i, { subs: [...r.subs, { name: '', days: 3 }] })}>＋ Add sub-activity</button>
                    </div></td></tr>)}
              </Fragment>))}</tbody></table>
        </div>
        <div className="row"><input className="input" placeholder="Add another activity (it joins the library)…" value={custom} onChange={(e) => setCustom(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') addCustom(); }} /><button className="btn" onClick={addCustom}>Add</button></div>
      </div>
    </Modal>
  );
}

/** Admin schedule editor: add activities with start/due dates, mark them complete — everything else is calculated. */
export function ScheduleManager({ projectId, contracts = [], defaultScope = 'project' }) {
  const { remove: removeActivity } = useUndoDelete('schedule');
  const { can } = useAuth();
  const toast = useToast();
  const { list } = useLookups();
  const { reload: reloadMeta } = useMeta();
  const [scope, setScope] = useState(defaultScope);
  const { data, loading, reload } = useFetch(`/api/projects/${projectId}/schedule`, { scope });
  const [edit, setEdit] = useState(null);
  const [del, setDel] = useState(null);
  const [copy, setCopy] = useState(null);
  const [plan, setPlan] = useState(false);
  const [done, setDone] = useState(null);
  const canEdit = can('projects', 'edit');
  if (!data) return <Loading />;
  const tasks = data.tasks;
  const library = list('construction_activity');
  const save = async (f) => {
    const body = { ...f, sale_id: f.sale_id || (scope === 'project' || scope === 'all' ? null : Number(scope)), client_visible: f.client_visible ? 1 : 0 };
    if (f.id) await api.put(`/api/project-tasks/${f.id}`, body); else await api.post(`/api/projects/${projectId}/tasks`, body);
    toast('Activity saved', 'ok'); setEdit(null); reload(); reloadMeta();
  };
  const act = async (url, msg) => { try { await api.post(url, {}); toast(msg, 'ok'); reload(); } catch (e) { toast(e.message, 'err'); } };
  const scopeSale = scope !== 'project' && scope !== 'all' ? Number(scope) : '';
  return (
    <div className="stack" style={{ opacity: loading ? 0.7 : 1 }}>
      <TimelineBar t={data.timeline} />
      {!data.timeline && <div className="alert info">Set the project's <b>start date</b> and <b>expected completion</b> (Project → Edit) to see the commencement-to-deadline timeline.</div>}
      <div className="row wrap between">
        <div className="row"><span className="muted">Schedule for</span>
          <div style={{ width: 300 }}><Select allowEmpty={false} value={scope} onChange={setScope} options={[{ value: 'project', label: 'Whole project (shared with all customers)' }, ...contracts.map((c) => ({ value: c.id, label: `Contract: ${c.customer} — ${c.title || c.sale_no}` })), { value: 'all', label: 'Everything' }]} /></div></div>
        {canEdit && <div className="row">
          {scope !== 'project' && scope !== 'all' && <button className="btn sm" onClick={() => setCopy({ to_sale_id: Number(scope), start_date: todayPK() })}>Copy from template…</button>}
          <button className="btn sm" onClick={() => setPlan(true)}>Quick plan</button>
          <button className="btn primary sm" onClick={() => setEdit({ planned_start: data.timeline?.commencement || todayPK(), planned_end: '', weight: 1, client_visible: 1, sale_id: scopeSale })}><Icon name="plus" size={13} />Add activity</button></div>}
      </div>
      {!tasks.length ? <Empty>No activities yet. Click <b>Add activity</b> (footing work, slab work, scaffolding, masonry…) and give each a start and due date — or use <b>Quick plan</b> to spread a list of activities across the project window. Completion % is calculated automatically and shared with customers.</Empty> : (
        <>
          <ScheduleKpis s={data.summary} />
          <Warnings warnings={data.warnings} />
          <Card title="Timeline" flush><Gantt tasks={tasks} onSelect={canEdit ? (t) => !t.is_group && setEdit({ ...tasks.find((x) => x.id === t.id), parent_id: t.parent_id ?? '', predecessor_id: t.predecessor_id ?? '', sale_id: t.sale_id ?? '' }) : undefined} /></Card>
          <Card flush>
            <div className="table-wrap"><table className="t"><thead><tr><th>Activity</th><th>Start</th><th>Due</th><th style={{ minWidth: 130 }}>Completion (auto)</th><th>Forecast finish</th><th>Status</th><th /></tr></thead>
              <tbody>{tasks.map((t) => (
                <tr key={t.id} style={t.is_group ? { background: 'var(--surface-2)', fontWeight: 600 } : undefined}>
                  <td style={{ paddingLeft: t.parent_id ? 28 : 12 }}>{t.name}{t.sale_id && scope === 'all' && <span className="tag" style={{ marginLeft: 6 }}>contract</span>}{!t.client_visible && <span className="tag" style={{ marginLeft: 6 }}>internal</span>}</td>
                  <td className="nowrap">{date(t.planned_start)}</td><td className="nowrap">{date(t.planned_end)}</td>
                  <td><div className="row"><div className="grow"><ProgressBar value={t.progress} tone={t.progress >= 100 ? 'green' : ''} /></div><b>{t.progress}%</b></div></td>
                  <td className="nowrap">{t.status === 'completed' ? date(t.actual_end) : date(t.forecast_end)}{t.status !== 'completed' && t.forecast_delay_days > 0 && <span className="neg"> +{t.forecast_delay_days}d</span>}</td>
                  <td><StatusPill status={t.status} />{t.delay_days > 0 && t.status === 'delayed' && <span className="neg" style={{ marginLeft: 6 }}>{t.delay_days}d</span>}</td>
                  <td className="right nowrap">
                    {canEdit && !t.is_group && (t.completed ? <button className="btn sm ghost" onClick={() => act(`/api/project-tasks/${t.id}/reopen`, 'Reopened')}>Reopen</button> : <button className="btn sm success" onClick={() => setDone({ id: t.id, name: t.name, date: todayPK() })}>✓ Complete</button>)}
                    {canEdit && !t.is_group && <button className="btn sm ghost" onClick={() => setEdit({ ...t, parent_id: t.parent_id ?? '', predecessor_id: t.predecessor_id ?? '', sale_id: t.sale_id ?? '' })}>Edit</button>}
                    {can('projects', 'delete') && <button className="btn sm ghost danger" onClick={() => setDel(t)}>×</button>}</td>
                </tr>))}</tbody></table></div>
          </Card>
        </>
      )}
      {edit && (
        <FormModal title={edit.id ? `Edit — ${edit.name}` : 'Add activity'} fields={activityFields(tasks, contracts, edit)} initial={edit} onClose={() => setEdit(null)} onSave={save}
          extra={<datalist id="activity-library">{library.map((n) => <option key={n} value={n} />)}</datalist>} />
      )}
      {done && (
        <FormModal title={`Mark “${done.name}” complete`} size="sm" initial={done} submitLabel="Confirm completed" fields={[{ name: 'date', label: 'Completed on', type: 'date', required: true, hint: 'Completing before the due date counts as ahead of schedule' }]}
          onClose={() => setDone(null)} onSave={async (f) => { await api.post(`/api/project-tasks/${done.id}/complete`, { date: f.date }); toast('Marked complete', 'ok'); setDone(null); reload(); }} />
      )}
      {del && <ConfirmDialog danger title="Delete activity" message={`Delete “${del.name}”? Activities that follow it lose their predecessor.`} confirmLabel="Delete" onCancel={() => setDel(null)} onConfirm={async () => { const a = del; setDel(null); removeActivity(a.id, `“${a.name}” deleted`, () => api.del(`/api/project-tasks/${a.id}`), { onDone: reload }); }} />}
      {copy && (
        <FormModal title="Copy the project schedule into this contract" size="sm" initial={copy} submitLabel="Copy activities"
          fields={[{ name: 'start_date', label: 'Contract start date', type: 'date', required: true, hint: 'All dates shift so the first activity starts here' }]}
          onClose={() => setCopy(null)} onSave={async (f) => { const r = await api.post(`/api/projects/${projectId}/tasks/copy`, { ...copy, ...f }); toast(`${r.copied} activities copied`, 'ok'); setCopy(null); reload(); }} />
      )}
      {plan && <QuickPlan projectId={projectId} timeline={data.timeline} library={library} scope={scope} onClose={() => setPlan(false)} onDone={() => { setPlan(false); reload(); reloadMeta(); }} />}
    </div>
  );
}
