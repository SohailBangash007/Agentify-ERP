import Icon from './Icon.jsx';

const OPS = {
  select: [['eq', 'is'], ['neq', 'is not'], ['in', 'is any of']],
  text: [['contains', 'contains'], ['eq', 'equals'], ['empty', 'is empty'], ['not_empty', 'is not empty']],
  number: [['eq', '='], ['gt', '>'], ['gte', '≥'], ['lt', '<'], ['lte', '≤'], ['between', 'between']],
  date: [['eq', 'is'], ['gt', 'after'], ['lt', 'before'], ['between', 'between'], ['last_days', 'in the last (days)']],
  tags: [['contains', 'has tag']],
};

/**
 * Advanced AND/OR rule builder. `fields`: [{key,label,type,options:[{value,label}]}].
 * value: {logic:'AND'|'OR', rules:[{field,op,value}]}
 */
export default function FilterPanel({ fields, value, onChange, onApply, onSave, onClear }) {
  const rules = value.rules || [];
  const fieldOf = (k) => fields.find((f) => f.key === k) || fields[0];
  const update = (i, patch) => onChange({ ...value, rules: rules.map((r, j) => (j === i ? { ...r, ...patch } : r)) });
  const add = () => { const f = fields[0]; onChange({ ...value, rules: [...rules, { field: f.key, op: OPS[f.type][0][0], value: '' }] }); };
  return (
    <div className="card" style={{ margin: '0 12px 12px', padding: 14, background: 'var(--surface-2)' }}>
      <div className="row wrap" style={{ marginBottom: 10 }}>
        <b>Match</b>
        <select className="select" style={{ width: 90 }} value={value.logic || 'AND'} onChange={(e) => onChange({ ...value, logic: e.target.value })} aria-label="Match logic">
          <option value="AND">ALL (AND)</option><option value="OR">ANY (OR)</option>
        </select>
        <span className="muted">of the following conditions</span>
      </div>
      {rules.map((r, i) => {
        const f = fieldOf(r.field);
        const ops = OPS[f.type] || OPS.text;
        const noValue = ['empty', 'not_empty'].includes(r.op);
        const between = r.op === 'between';
        const [a = '', b = ''] = between ? String(r.value || '').split(',') : [];
        const inputType = f.type === 'date' || ['last_days'].includes(r.op) ? (r.op === 'last_days' ? 'number' : 'date') : f.type === 'number' ? 'number' : 'text';
        return (
          <div className="filter-rule" key={i}>
            <select className="select" value={r.field} onChange={(e) => { const nf = fieldOf(e.target.value); update(i, { field: nf.key, op: OPS[nf.type][0][0], value: '' }); }} aria-label="Field">
              {fields.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
            </select>
            <select className="select" value={r.op} onChange={(e) => update(i, { op: e.target.value, value: '' })} aria-label="Operator">{ops.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
            {noValue ? <span /> : f.type === 'select' && r.op !== 'in' ? (
              <select className="select" value={r.value ?? ''} onChange={(e) => update(i, { value: e.target.value })} aria-label="Value"><option value="">Select…</option>{f.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
            ) : f.type === 'select' && r.op === 'in' ? (
              <select className="select" multiple value={String(r.value || '').split(',').filter(Boolean)} onChange={(e) => update(i, { value: [...e.target.selectedOptions].map((o) => o.value).join(',') })} style={{ height: 72 }} aria-label="Values">{f.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
            ) : between ? (
              <div className="row"><input className="input" type={inputType} value={a} onChange={(e) => update(i, { value: `${e.target.value},${b}` })} /><input className="input" type={inputType} value={b} onChange={(e) => update(i, { value: `${a},${e.target.value}` })} /></div>
            ) : (
              <input className="input" type={inputType} value={r.value ?? ''} placeholder={f.type === 'date' ? 'YYYY-MM-DD or "today"' : ''} onChange={(e) => update(i, { value: e.target.value })} aria-label="Value" />
            )}
            <button className="icon-btn" onClick={() => onChange({ ...value, rules: rules.filter((_, j) => j !== i) })} aria-label="Remove condition"><Icon name="x" size={14} /></button>
          </div>
        );
      })}
      <div className="row wrap" style={{ marginTop: 8 }}>
        <button className="btn sm" onClick={add}><Icon name="plus" size={13} />Add condition</button>
        <div className="grow" />
        {onClear && <button className="btn sm ghost" onClick={onClear}>Clear</button>}
        {onSave && <button className="btn sm" onClick={onSave}>Save as Smart List</button>}
        <button className="btn sm primary" onClick={onApply}>Apply filters</button>
      </div>
    </div>
  );
}
