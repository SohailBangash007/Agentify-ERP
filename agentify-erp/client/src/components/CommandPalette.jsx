import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Icon from './Icon.jsx';
import { api } from '../api.js';
import { useAuth, useToast } from '../context.jsx';
import { loadAppearance, saveAppearance } from '../theme.js';

/** Ctrl+K palette: jump to pages, run common actions, find records — all from the keyboard. */
export default function CommandPalette({ nav, allowed, onClose }) {
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const [found, setFound] = useState([]);
  const go = useNavigate();
  const { can, user, logout } = useAuth();
  const toast = useToast();
  const inputRef = useRef(null);
  const listRef = useRef(null);
  useEffect(() => { inputRef.current?.focus(); }, []);

  const actions = useMemo(() => {
    const A = [];
    const add = (label, icon, run, perm, hint) => { if (!perm || can(perm[0], perm[1])) A.push({ group: 'Actions', label, icon, run, hint }); };
    add('New lead / contact', 'plus', () => go('/contacts?new=1'), ['crm', 'create'], 'Add someone to the CRM');
    add('New receipt voucher', 'receipt', () => go('/receipts/new'), ['payments', 'create'], 'Record a payment received');
    add('New expense voucher', 'wallet', () => go('/expenses/new'), ['accounting', 'create'], 'Record money spent / buy an asset');
    add('New sale / booking', 'badge', () => go('/sales/new'), ['sales', 'create']);
    add('Add property', 'building', () => go('/properties/new'), ['properties', 'create']);
    add('Open plot map', 'grid', () => go('/projects/map'), ['projects', 'view'], 'See every plot by status');
    add('Open Asset Library', 'layers', () => go('/assets'), null);
    add('My tasks', 'check', () => go('/my/tasks'));
    add('Apply for leave', 'calendar', () => go('/my/leave'));
    add('My attendance', 'clock', () => go('/my/attendance'));
    add('Ask the data assistant', 'chat', () => window.dispatchEvent(new Event('erp:assistant')), null, 'Questions answered from live data');
    const a = loadAppearance();
    add(a.theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode', 'moon', () => saveAppearance({ theme: a.theme === 'dark' ? 'light' : 'dark' }));
    add(a.density === 'compact' ? 'Comfortable density' : 'Compact density', 'list', () => saveAppearance({ density: a.density === 'compact' ? 'comfortable' : 'compact' }));
    add('Sign out', 'logout', () => logout());
    return A;
  }, [can, go, logout]);

  const pages = useMemo(() => nav.flatMap((g) => {
    if (!g.children) return allowed(null, g.module) || g.always ? [{ group: 'Go to', label: g.label, icon: g.icon, run: () => go(g.to) }] : [];
    return g.children.filter((c) => g.always || allowed(c[2], g.module)).filter((c) => g.always || allowed(null, g.module)).map((c) => ({ group: 'Go to', label: c[0], hint: g.label, icon: g.icon, run: () => go(c[1]) }));
  }), [nav, allowed, go]);

  // "receipt for ali" / "sale for ali" / "open ali": find the person, then jump straight into the form
  const intent = useMemo(() => {
    const m = q.trim().match(/^(receipt|new receipt|sale|new sale|statement|ledger|open)\s*(?:for|of)?\s+(.{2,})$/i);
    return m ? { verb: m[1].toLowerCase().replace('new ', ''), term: m[2] } : null;
  }, [q]);

  useEffect(() => {
    const term = (intent?.term || q).trim();
    if (term.length < 2) { setFound([]); return undefined; }
    const t = setTimeout(async () => { try { setFound(await api.get('/api/search', { q: term })); } catch { setFound([]); } }, 180);
    return () => clearTimeout(t);
  }, [q, intent]);

  const items = useMemo(() => {
    const needle = (intent ? '' : q).trim().toLowerCase();
    const match = (x) => !needle || `${x.label} ${x.hint || ''}`.toLowerCase().includes(needle);
    const out = [];
    if (intent) {
      for (const r of found.filter((x) => x.type === 'contact' || x.type === 'customer' || /contact|customer/i.test(x.type)).slice(0, 5)) {
        const id = String(r.link).match(/\/(\d+)/)?.[1];
        if (!id) continue;
        const to = intent.verb === 'receipt' ? `/receipts/new?contact=${id}` : intent.verb === 'sale' ? `/sales/new?contact=${id}` : intent.verb === 'open' ? r.link : `/customers/${id}/statement`;
        const label = intent.verb === 'open' ? `Open ${r.title}` : `${intent.verb[0].toUpperCase()}${intent.verb.slice(1)} for ${r.title}`;
        out.push({ group: 'Suggested', label, hint: r.subtitle, icon: intent.verb === 'receipt' ? 'receipt' : intent.verb === 'sale' ? 'badge' : 'user', run: () => go(to) });
      }
    }
    out.push(...actions.filter(match).slice(0, needle ? 8 : 12), ...pages.filter(match).slice(0, needle ? 8 : 6));
    if (!intent) out.push(...found.slice(0, 8).map((r) => ({ group: 'Records', label: r.title, hint: `${r.type} · ${r.subtitle || ''}`, icon: 'search', run: () => go(r.link) })));
    return out;
  }, [q, actions, pages, found, intent, go]);

  useEffect(() => { setSel(0); }, [q]);
  useEffect(() => { listRef.current?.querySelector('.sel')?.scrollIntoView({ block: 'nearest' }); }, [sel]);
  const run = (it) => { onClose(); try { it?.run(); } catch (e) { toast(e.message, 'err'); } };
  const onKey = (e) => {
    if (e.key === 'Escape') onClose();
    else if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(items.length - 1, s + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); }
    else if (e.key === 'Enter') { e.preventDefault(); run(items[sel]); }
  };
  let last = '';
  return (
    <div className="palette-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="palette" role="dialog" aria-modal="true" aria-label="Command palette">
        <div className="palette-input"><Icon name="search" size={18} />
          <input ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKey} placeholder={`Type a command or search… try “receipt for ali”`} aria-label="Command palette search" /></div>
        <div className="palette-list" ref={listRef} role="listbox">
          {!items.length && <div className="empty" style={{ padding: 22 }}>Nothing matches “{q}”.</div>}
          {items.map((it, i) => {
            const head = it.group !== last ? <div className="palette-group" key={`g${it.group}${i}`}>{it.group}</div> : null;
            last = it.group;
            return (
              <div key={`${it.group}${it.label}${i}`}>
                {head}
                <button role="option" aria-selected={i === sel} className={`palette-item ${i === sel ? 'sel' : ''}`} onMouseEnter={() => setSel(i)} onClick={() => run(it)}>
                  <span className="pi-ic"><Icon name={it.icon || 'file'} size={15} /></span>
                  <span style={{ minWidth: 0 }}>{it.label}{it.hint && <small>{it.hint}</small>}</span>
                  {i === sel && <kbd>↵</kbd>}
                </button>
              </div>
            );
          })}
        </div>
        <div className="palette-foot"><span><span className="kbd">↑</span> <span className="kbd">↓</span> move</span><span><span className="kbd">↵</span> open</span><span><span className="kbd">Esc</span> close</span><span style={{ marginLeft: 'auto' }}>{user?.name}</span></div>
      </div>
    </div>
  );
}
