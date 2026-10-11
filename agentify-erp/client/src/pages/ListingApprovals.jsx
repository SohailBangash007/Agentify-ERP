import { useState } from 'react';
import { Link } from 'react-router-dom';
import Icon from '../components/Icon.jsx';
import { Card, ConfirmDialog, Empty, Loading, PageHead, Stat } from '../components/ui.jsx';
import { api, fileUrl } from '../api.js';
import { useAuth, useFetch, useToast } from '../context.jsx';
import { date, money } from '../format.js';

/** The Listing Manager's queue: properties and projects that sales agents want on the website. */
export default function ListingApprovals() {
  const { can } = useAuth();
  const toast = useToast();
  const { data, loading, reload } = useFetch('/api/listings/queue');
  const [ask, setAsk] = useState(null); // { kind:'property'|'project', item, mode:'approve'|'reject'|'bulk' }
  const [sel, setSel] = useState([]);
  const canApprove = can('listings', 'approve');
  if (loading && !data) return <Loading />;
  const props = data?.properties || [], projects = data?.projects || [], decided = data?.decided || [];

  const act = async (fn, msg) => {
    try { const r = await fn(); toast(msg(r), 'ok'); setAsk(null); setSel([]); reload(); window.dispatchEvent(new Event('erp:data-changed')); } catch (e) { toast(e.message, 'err'); }
  };
  const run = (text) => {
    const { kind, item, mode } = ask;
    const base = kind === 'property' ? `/api/listings/properties/${item?.id}` : `/api/listings/projects/${item?.id}`;
    if (mode === 'bulk') return act(() => api.post('/api/listings/properties/approve-all', { ids: sel }), (r) => `${r.approved} listing(s) approved and featured${r.failed.length ? `, ${r.failed.length} need attention` : ''}`);
    if (mode === 'approve') return act(() => api.post(`${base}/approve`), () => `${item.title || item.name} is live and featured on the website`);
    return act(() => api.post(`${base}/reject`, { note: text }), () => 'Sent back to the agent');
  };
  const toggle = (id) => setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  return (
    <div className="stack">
      <PageHead title="Listing approvals" sub="Properties and projects added by sales agents. Approving puts them live on the website, featured.">
        {canApprove && sel.length > 0 && <button className="btn primary" onClick={() => setAsk({ kind: 'property', mode: 'bulk' })}><Icon name="check" size={14} />Approve {sel.length} selected</button>}
      </PageHead>
      <div className="grid cols-3">
        <Stat label="Waiting for approval" value={data?.pending || 0} tone={data?.pending ? 'amber' : undefined} icon="clock" />
        <Stat label="Properties" value={props.length} icon="building" />
        <Stat label="Projects" value={projects.length} icon="hardhat" />
      </div>

      <Card title={`Properties (${props.length})`}>
        {!props.length ? <Empty icon="check" title="Nothing waiting" hint="When an agent submits a property it appears here." /> : (
          <div className="stack">
            {props.map((p) => (
              <div key={p.id} className="row wrap" style={{ gap: 14, alignItems: 'flex-start', padding: '10px 0', borderBottom: '1px solid var(--line)' }}>
                {canApprove && <input type="checkbox" checked={sel.includes(p.id)} onChange={() => toggle(p.id)} aria-label={`Select ${p.title}`} style={{ marginTop: 6 }} />}
                {p.cover ? <img src={fileUrl(p.cover)} alt="" style={{ width: 96, height: 72, objectFit: 'cover', borderRadius: 8 }} /> : <div style={{ width: 96, height: 72, borderRadius: 8, background: 'var(--grey-bg)', display: 'grid', placeItems: 'center' }}><Icon name="image" size={20} /></div>}
                <div style={{ flex: 1, minWidth: 220 }}>
                  <Link to={`/properties/${p.id}`} className="cell-main">{p.title}</Link>
                  <div className="cell-sub">{p.code} · {[p.project_name, p.area_name, p.city].filter(Boolean).join(' · ')} · {p.area_size} {p.unit}</div>
                  <div className="cell-sub">Added by <b>{p.agent_name || 'an agent'}</b> · {date(p.updated_at)}</div>
                  <div className="row wrap" style={{ gap: 6, marginTop: 6 }}>{p.checks.map((c) => <span key={c.label} className={`pill ${c.ok ? 'green' : 'amber'}`}>{c.ok ? '✓' : '!'} {c.label}</span>)}</div>
                </div>
                <div style={{ textAlign: 'right' }}><div className="mono" style={{ fontWeight: 600 }}>{money(p.net_price)}</div>
                  {canApprove && <div className="row" style={{ gap: 6, marginTop: 8, justifyContent: 'flex-end' }}>
                    <button className="btn sm" onClick={() => setAsk({ kind: 'property', item: p, mode: 'reject' })}>Send back</button>
                    <button className="btn sm primary" onClick={() => setAsk({ kind: 'property', item: p, mode: 'approve' })}>Approve &amp; feature</button></div>}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card title={`Projects requested for the website (${projects.length})`}>
        {!projects.length ? <Empty icon="check" title="No project requests" /> : (
          <div className="stack">
            {projects.map((p) => (
              <div key={p.id} className="row wrap" style={{ gap: 14, padding: '10px 0', borderBottom: '1px solid var(--line)' }}>
                <div style={{ flex: 1, minWidth: 220 }}>
                  <Link to={`/projects/${p.id}`} className="cell-main">{p.name}</Link>
                  <div className="cell-sub">{p.code} · {p.location || '—'} · {p.total_units || 0} units</div>
                  <div className="cell-sub">Requested by <b>{p.requested_by || 'an agent'}</b> · {date(p.site_requested_at)}</div>
                </div>
                {canApprove && <div className="row" style={{ gap: 6 }}>
                  <button className="btn sm" onClick={() => setAsk({ kind: 'project', item: p, mode: 'reject' })}>Decline</button>
                  <button className="btn sm primary" onClick={() => setAsk({ kind: 'project', item: p, mode: 'approve' })}>Approve &amp; feature</button></div>}
              </div>
            ))}
          </div>
        )}
      </Card>

      {decided.length > 0 && (
        <Card title="Recently decided">
          {decided.map((d) => (
            <div key={`${d.kind}${d.id}`} className="row wrap" style={{ gap: 10, padding: '6px 0' }}>
              <span className={`pill ${d.state === 'published' ? 'green' : 'amber'}`}>{d.state === 'published' ? 'Approved' : 'Sent back'}</span>
              <Link to={`/properties/${d.id}`}>{d.name}</Link><span className="cell-sub">{d.note || ''} {d.by_name ? `· ${d.by_name}` : ''} · {date(d.at)}</span>
            </div>
          ))}
        </Card>
      )}

      {ask && (
        <ConfirmDialog
          title={ask.mode === 'bulk' ? 'Approve selected listings?' : ask.mode === 'approve' ? 'Approve and feature?' : 'Send back to the agent?'}
          message={ask.mode === 'bulk' ? `${sel.length} listing(s) will go live and be featured on the website.` : ask.mode === 'approve' ? `“${ask.item.title || ask.item.name}” will go live on the public website and be featured.` : `Tell the agent what to fix on “${ask.item.title || ask.item.name}”.`}
          confirmLabel={ask.mode === 'reject' ? 'Send back' : 'Approve'} danger={ask.mode === 'reject'} reason={ask.mode === 'reject'}
          onConfirm={run} onCancel={() => setAsk(null)} />
      )}
    </div>
  );
}
