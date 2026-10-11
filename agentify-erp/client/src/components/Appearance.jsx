import { useEffect, useRef, useState } from 'react';
import Icon from './Icon.jsx';
import { ACCENTS, loadAppearance, saveAppearance } from '../theme.js';

/** Topbar popover: theme, density and accent colour — remembered per browser. */
export default function Appearance() {
  const [open, setOpen] = useState(false);
  const [a, setA] = useState(loadAppearance());
  const ref = useRef(null);
  useEffect(() => {
    const sync = () => setA(loadAppearance());
    const h = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    window.addEventListener('erp:appearance', sync); document.addEventListener('mousedown', h);
    return () => { window.removeEventListener('erp:appearance', sync); document.removeEventListener('mousedown', h); };
  }, []);
  const set = (patch) => setA(saveAppearance(patch));
  const seg = (key, opts) => <div className="seg3">{opts.map(([v, l]) => <button key={v} className={a[key] === v ? 'on' : ''} onClick={() => set({ [key]: v })}>{l}</button>)}</div>;
  return (
    <div style={{ position: 'relative' }} ref={ref} className="no-print">
      <button className="icon-btn" aria-label="Appearance" title="Appearance" aria-expanded={open} onClick={() => setOpen(!open)}><Icon name="palette" /></button>
      {open && (
        <div className="appearance" role="dialog" aria-label="Appearance settings">
          <h4>Theme</h4>{seg('theme', [['light', 'Light'], ['dark', 'Dark'], ['auto', 'Auto']])}
          <h4>Density</h4>{seg('density', [['compact', 'Compact'], ['comfortable', 'Cosy'], ['spacious', 'Roomy']])}
          <h4>Text size</h4>{seg('text', [['normal', 'Normal'], ['large', 'Larger']])}
          <h4>Accent colour</h4>
          <div className="swatches">{Object.entries(ACCENTS).map(([k, [c]]) => <button key={k} className={`swatch ${a.accent === k ? 'on' : ''}`} style={{ background: c }} aria-label={`${k} accent`} title={k} onClick={() => set({ accent: k })} />)}</div>
        </div>
      )}
    </div>
  );
}
