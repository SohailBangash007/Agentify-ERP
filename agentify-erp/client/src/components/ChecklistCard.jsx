// Compliance checklist(s) for a sale, contact or property. Renders nothing unless the region has checklists switched on.
import { useCallback, useEffect, useState } from 'react';
import { Card } from './ui.jsx';
import { api } from '../api.js';
import { useToast } from '../context.jsx';
import { getRegion } from '../format.js';

export default function ChecklistCard({ entity, id }) {
  const toast = useToast();
  const on = !!getRegion().config.flags?.compliance;
  const [runs, setRuns] = useState(null);
  const load = useCallback(() => api.get(`/api/documents/checklists/run?entity=${entity}&id=${id}`).then(setRuns).catch(() => setRuns([])), [entity, id]);
  useEffect(() => { if (on) load(); }, [on, load]);
  if (!on || !runs?.length) return null;
  const tick = async (run, item) => { try { await api.post(`/api/documents/checklists/run/${run.run_id}/item`, { key: item.key, done: !item.done }); load(); } catch (e) { toast(e.message, 'err'); } };
  const complete = async (run) => { try { await api.post(`/api/documents/checklists/run/${run.run_id}/complete`); toast('Checklist completed'); load(); } catch (e) { toast(e.message, 'err'); } };
  return runs.map((run) => (
    <Card key={run.run_id} title={run.name} actions={<span className="pill grey">{run.status.required_done}/{run.status.required} required done</span>}>
      {run.needs_legal_review ? <div className="muted" style={{ marginBottom: 8 }}>Sample checklist. Have it reviewed by a licensed professional for your area before relying on it.</div> : null}
      <div className="stack">
        {run.items.map((i) => (
          <label key={i.key} className="check">
            <input type="checkbox" checked={!!i.done} disabled={!!run.completed_at} onChange={() => tick(run, i)} />
            {i.label}{i.required ? ' *' : ''}{i.done && i.by ? <span className="muted"> · {i.by}</span> : null}
          </label>))}
        {run.completed_at ? <div className="alert info">Completed {run.completed_at}</div> : <div><button className="btn primary sm" disabled={!run.status.complete} onClick={() => complete(run)}>Mark completed</button></div>}
      </div>
    </Card>));
}
