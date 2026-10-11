import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import Icon from './Icon.jsx';
import { ProgressBar } from './ui.jsx';
import { useAuth } from '../context.jsx';

const read = (k) => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } };
const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } };

/** Short first-run checklist, different per role; steps tick off when opened and the whole card can be hidden for good. */
export default function Onboarding() {
  const { user, can } = useAuth();
  const key = `onboard:${user.id}`;
  const [state, setState] = useState(() => read(key) || { done: [], hidden: false });
  const [open, setOpen] = useState(false);
  useEffect(() => { write(key, state); }, [key, state]);
  const steps = useMemo(() => {
    const S = [];
    if (user.own_scope) S.push({ id: 'lead', label: 'Add your first lead', to: '/contacts?new=1' }, { id: 'goals', label: 'Open your daily goals and streak', to: '/goals' }, { id: 'followup', label: 'Check today’s follow-ups', to: '/tasks' });
    if (can('payments', 'create')) S.push({ id: 'receipt', label: 'Record a payment and watch the live voucher preview', to: '/receipts/new' });
    if (can('accounting', 'create')) S.push({ id: 'expense', label: 'Create an expense voucher (try the asset option)', to: '/expenses/new' }, { id: 'assets', label: 'Look at the Asset Library', to: '/assets' });
    if (can('hrm', 'create')) S.push({ id: 'attendance', label: 'Mark today’s attendance', to: '/hrm/attendance' }, { id: 'leave', label: 'Review leave requests', to: '/hrm/leave' });
    if (can('properties', 'view') && !user.own_scope) S.push({ id: 'map', label: 'Explore the plot map', to: '/projects/map' });
    S.push({ id: 'space', label: 'Open My Space — your profile, attendance and tasks', to: '/my/profile' });
    return S;
  }, [user, can]);
  const done = steps.filter((s) => state.done.includes(s.id)).length;
  if (state.hidden || !steps.length) return null;
  const mark = (id) => setState((s) => (s.done.includes(id) ? s : { ...s, done: [...s.done, id] }));
  return (
    <div className="onboard" aria-label="Getting started">
      <div className="row between wrap" style={{ gap: 12 }}>
        <div className="row" style={{ gap: 12, flex: 1, minWidth: 220 }}>
          <span className="ic-tile sm ic-teal"><Icon name="flag" size={14} /></span>
          <div style={{ flex: 1 }}><b>Getting started</b> <span className="muted">· {done} of {steps.length} done</span><div style={{ marginTop: 6, maxWidth: 320 }}><ProgressBar value={Math.round((done / steps.length) * 100)} tone="green" /></div></div>
        </div>
        <div className="row">
          <button className="btn sm" onClick={() => setOpen(!open)} aria-expanded={open}>{open ? 'Hide steps' : 'Show steps'}</button>
          <button className="btn sm ghost" onClick={() => setState((s) => ({ ...s, hidden: true }))} title="Dismiss for good">Dismiss</button>
        </div>
      </div>
      {open && <div style={{ marginTop: 8 }}>
        {steps.map((s) => {
          const d = state.done.includes(s.id);
          return (
            <div key={s.id} className={`onboard-step ${d ? 'done' : ''}`}>
              <span className="dot">{d ? '✓' : ''}</span>
              <Link className="tx" to={s.to} onClick={() => mark(s.id)}>{s.label}</Link>
              {!d && <button className="btn sm ghost" style={{ marginLeft: 'auto' }} onClick={() => mark(s.id)}>Mark done</button>}
            </div>
          );
        })}
        <div className="muted kbd-hint" style={{ marginTop: 6 }}>Tip: press <span className="kbd">Ctrl</span> + <span className="kbd">K</span> anywhere to jump or act</div>
      </div>}
    </div>
  );
}
