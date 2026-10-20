// Region-specific fields for a contact or property (listed by the workspace's region pack) and, for contacts,
// the encrypted identity number. Renders nothing for regions that define neither (Pakistan).
import { useCallback, useEffect, useState } from 'react';
import { Card, Field, CurrencyInput } from './ui.jsx';
import { api } from '../api.js';
import { useToast } from '../context.jsx';
import { getRegion } from '../format.js';

export default function RegionFields({ entity, id, canEdit = true }) {
  const toast = useToast();
  const region = getRegion().config;
  const [data, setData] = useState(null);
  const [vals, setVals] = useState({});
  const [idInfo, setIdInfo] = useState(null);
  const [idInput, setIdInput] = useState('');
  const load = useCallback(async () => {
    try {
      const d = await api.get(`/api/region/ext/${entity}/${id}`);
      setData(d); setVals(d.values);
      if (entity === 'contact' && region.region !== 'PK') setIdInfo(await api.get(`/api/region/identity/${id}`));
    } catch { setData({ fields: [], values: {} }); }
  }, [entity, id, region.region]);
  useEffect(() => { load(); }, [load]);
  const showId = entity === 'contact' && region.region !== 'PK' && idInfo;
  if (!data || (!data.fields.length && !showId)) return null;
  const save = async () => { try { await api.put(`/api/region/ext/${entity}/${id}`, { values: vals }); toast('Saved'); load(); } catch (e) { toast(e.message, 'err'); } };
  const saveId = async () => { try { await api.put(`/api/region/identity/${id}`, { number: idInput }); setIdInput(''); toast('Saved'); load(); } catch (e) { toast(e.message, 'err'); } };
  const set = (k, v) => setVals((s) => ({ ...s, [k]: v }));
  return (
    <Card title={`${region.name} details`}>
      <div className="stack">
        {data.fields.map((f) => (
          <Field key={f.key} label={f.label}>
            {f.type === 'select'
              ? <select className="input" disabled={!canEdit} value={vals[f.key] ?? ''} onChange={(e) => set(f.key, e.target.value)}><option value="">—</option>{f.options.map((o) => <option key={o}>{o}</option>)}</select>
              : f.type === 'money'
                ? <CurrencyInput value={vals[f.key] == null || vals[f.key] === '' ? '' : Number(vals[f.key])} onChange={(v) => set(f.key, v)} disabled={!canEdit} />
                : <input className="input" type={f.type === 'number' ? 'number' : 'text'} disabled={!canEdit} value={vals[f.key] ?? ''} onChange={(e) => set(f.key, e.target.value)} />}
          </Field>
        ))}
        {data.fields.length > 0 && canEdit && <div><button className="btn primary sm" onClick={save}>Save details</button></div>}
        {showId && (
          <Field label={idInfo.label} hint="Stored encrypted. Only the last 4 characters are shown.">
            <div className="row">
              <span className="mono">{idInfo.stored?.masked || 'Not provided'}</span>
              {canEdit && <><input className="input" style={{ maxWidth: 220 }} value={idInput} onChange={(e) => setIdInput(e.target.value)} placeholder="Enter or replace" autoComplete="off" /><button className="btn sm" disabled={!idInput} onClick={saveId}>Save</button></>}
            </div>
          </Field>
        )}
      </div>
    </Card>
  );
}
