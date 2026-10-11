import { useRef, useState } from 'react';
import Icon from '../components/Icon.jsx';
import { Card, ConfirmDialog, Empty, Field, Loading, Modal, PageHead, Select, StatusBadge, Toggle } from '../components/ui.jsx';
import { api, fileUrl } from '../api.js';
import { useAuth, useFetch, useLookups, useToast, useUndoDelete } from '../context.jsx';
import { date } from '../format.js';

/** Promotions shown to customers in their portal (Offers tab). Properties on sale are listed there automatically. */
export default function Promos() {
  const { can } = useAuth();
  const toast = useToast();
  const { projects } = useLookups();
  const { data: all, reload } = useFetch('/api/promos');
  const { hidden, remove } = useUndoDelete('promos');
  const data = all?.filter((p) => !hidden.has(p.id));
  const props = useFetch('/api/properties', { limit: 200, status: 'available' });
  const [edit, setEdit] = useState(null);
  const [del, setDel] = useState(null);
  const [file, setFile] = useState(null);
  const ref = useRef(null);
  const open = (p) => { setFile(null); setEdit(p || { title: '', description: '', price_label: '', valid_until: '', active: 1, sort_order: 0 }); };
  const save = async () => {
    if (!edit.title?.trim()) return toast('Give the promotion a title', 'err');
    try {
      const fd = new FormData();
      for (const k of ['title', 'description', 'price_label', 'valid_until', 'project_id', 'property_id']) fd.append(k, edit[k] ?? '');
      fd.append('active', edit.active ? '1' : '0'); fd.append('sort_order', edit.sort_order ?? 0);
      if (file) fd.append('image', file);
      await api.upload(edit.id ? `/api/promos/${edit.id}` : '/api/promos', fd);
      toast('Saved — customers see it in their portal', 'ok'); setEdit(null); reload();
    } catch (e) { toast(e.message, 'err'); }
  };
  return (
    <div>
      <PageHead title="Portal promotions" sub="Offers and promotional images shown in every customer’s portal under “Offers”. Properties that are currently on sale are added there automatically.">
        {can('customers', 'create') && <button className="btn primary" onClick={() => open()}><Icon name="plus" size={14} />New promotion</button>}
      </PageHead>
      {!data ? <Loading /> : !data.length ? <Card><Empty>No promotions yet. Add an offer or banner image to upsell plots and projects to your existing customers.</Empty></Card> : (
        <div className="grid g3">{data.map((p) => (
          <Card key={p.id} flush>
            {p.image ? <img src={fileUrl(p.image)} alt={p.title} style={{ width: '100%', height: 150, objectFit: 'cover', display: 'block' }} /> : <div style={{ height: 150, background: 'linear-gradient(135deg,#dbeafe,#bfdbfe)', display: 'grid', placeItems: 'center', color: '#3b82f6' }}><Icon name="tag" size={34} /></div>}
            <div style={{ padding: 12 }}>
              <div className="row between"><b>{p.title}</b><StatusBadge status={p.active ? 'active' : 'inactive'} /></div>
              <div className="muted" style={{ fontSize: 13, margin: '4px 0' }}>{p.description}</div>
              <div className="cell-sub">{p.price_label}{p.valid_until ? ` · until ${date(p.valid_until)}` : ''}{p.project_name ? ` · ${p.project_name}` : ''}</div>
              <div className="row" style={{ marginTop: 8 }}>{can('customers', 'edit') && <button className="btn sm" onClick={() => open(p)}>Edit</button>}{can('customers', 'delete') && <button className="btn sm ghost danger" onClick={() => setDel(p)}>Delete</button>}</div>
            </div>
          </Card>))}</div>
      )}
      {edit && (
        <Modal title={edit.id ? 'Edit promotion' : 'New promotion'} onClose={() => setEdit(null)} footer={<><button className="btn" onClick={() => setEdit(null)}>Cancel</button><button className="btn primary" onClick={save}>Save</button></>}>
          <div className="stack">
            <Field label="Title" required><input className="input" autoFocus value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} placeholder="e.g. Eid booking offer" /></Field>
            <Field label="Description"><textarea className="textarea" rows={3} value={edit.description || ''} onChange={(e) => setEdit({ ...edit, description: e.target.value })} /></Field>
            <div className="form-grid">
              <Field label="Highlight (price / saving)"><input className="input" value={edit.price_label || ''} onChange={(e) => setEdit({ ...edit, price_label: e.target.value })} placeholder="e.g. Save up to PKR 150,000" /></Field>
              <Field label="Valid until"><input type="date" className="input" value={edit.valid_until || ''} onChange={(e) => setEdit({ ...edit, valid_until: e.target.value })} /></Field>
              <Field label="Project (optional)"><Select value={edit.project_id || ''} onChange={(v) => setEdit({ ...edit, project_id: v ? Number(v) : '' })} options={projects.map((p) => ({ value: p.id, label: p.name }))} /></Field>
              <Field label="Property (optional)"><Select value={edit.property_id || ''} onChange={(v) => setEdit({ ...edit, property_id: v ? Number(v) : '' })} options={(props.data?.rows || []).map((p) => ({ value: p.id, label: p.title }))} /></Field>
              <Field label="Display order"><input type="number" className="input" value={edit.sort_order ?? 0} onChange={(e) => setEdit({ ...edit, sort_order: e.target.value })} /></Field>
              <Field label="Visible to customers"><Toggle value={!!edit.active} onChange={(v) => setEdit({ ...edit, active: v ? 1 : 0 })} /></Field>
            </div>
            <Field label="Promotional image (optional)">
              <div className="row" style={{ gap: 10 }}>
                {(file || edit.image) && <img alt="" src={file ? URL.createObjectURL(file) : fileUrl(edit.image)} style={{ width: 96, height: 64, objectFit: 'cover', borderRadius: 6 }} />}
                <button type="button" className="btn" onClick={() => ref.current?.click()}><Icon name="upload" size={14} />{edit.image || file ? 'Change image' : 'Choose image'}</button>
                <input ref={ref} type="file" accept="image/*" hidden onChange={(e) => setFile(e.target.files?.[0] || null)} />
              </div>
            </Field>
          </div>
        </Modal>)}
      {del && <ConfirmDialog danger title="Delete promotion" message={`Delete “${del.title}”?`} confirmLabel="Delete" onCancel={() => setDel(null)} onConfirm={async () => { const p = del; setDel(null); remove(p.id, `“${p.title}” deleted`, () => api.del(`/api/promos/${p.id}`), { onDone: reload }); }} />}
    </div>
  );
}
