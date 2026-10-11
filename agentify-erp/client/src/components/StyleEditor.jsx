import { DEVICES, STYLE_FIELDS, resolveStyle } from '../../../shared/sectionStyle.js';
import { Toggle } from './ui.jsx';

const GROUPS = [
  ['Visibility', ['hide']],
  ['Spacing', ['pad_top', 'pad_bottom', 'pad_x', 'margin_top', 'margin_bottom']],
  ['Size', ['max_width', 'min_height', 'scale']],
  ['Layout', ['align', 'cols', 'gap', 'reverse']],
  ['Background', ['bg_color', 'bg_image', 'overlay']],
];
const LABEL = { desktop: 'Desktop', tablet: 'Tablet (≤ 768 px)', mobile: 'Mobile (≤ 480 px)' };
const ICON = { desktop: '🖥', tablet: '📱', mobile: '📲' };

/**
 * Per-device layout settings for one section. Desktop values cascade down to tablet and mobile until a smaller device
 * overrides them, so a mobile tweak never changes the desktop layout.
 */
export default function StyleEditor({ style = {}, device, setDevice, onChange, ImagePicker }) {
  const own = style[device] || {};
  const set = (key, value) => {
    const next = { ...style, [device]: { ...own } };
    if (value === undefined) delete next[device][key]; else next[device][key] = value;
    if (!Object.keys(next[device]).length) delete next[device];
    onChange(Object.keys(next).length ? next : undefined);
  };
  const setAnchor = (v) => { const next = { ...style }; if (v) next.anchor = v; else delete next.anchor; onChange(Object.keys(next).length ? next : undefined); };
  const overrides = (d) => Object.keys(style[d] || {}).length;

  const control = (key) => {
    const def = STYLE_FIELDS[key];
    const mine = own[key];
    const inh = resolveStyle(style, device, key);
    const inherited = mine === undefined && inh.value !== undefined && inh.from !== device;
    const reset = mine !== undefined && <button type="button" className="se-reset" title={device === 'desktop' ? 'Remove this setting' : 'Go back to the larger device’s setting'} onClick={() => set(key, undefined)}>↺</button>;
    const note = inherited && <span className="se-inh">from {inh.from}</span>;
    let input;
    if (def[1] === 'bool') {
      const val = mine !== undefined ? mine : inh.value;
      input = <Toggle value={!!val} onChange={(v) => set(key, v)} />;
    } else if (def[1] === 'num') {
      input = (
        <span className="se-num">
          <input type="range" min={def[2]} max={def[3]} value={mine ?? inh.value ?? (key === 'scale' ? 100 : def[2])} onChange={(e) => set(key, Number(e.target.value))} />
          <input className="input" type="number" min={def[2]} max={def[3]} placeholder={inh.value !== undefined ? String(inh.value) : 'auto'} value={mine ?? ''} onChange={(e) => (e.target.value === '' ? set(key, undefined) : set(key, Number(e.target.value)))} />
          <em>{def[4]}</em>
        </span>
      );
    } else if (def[1] === 'align') {
      input = <span className="seg2s">{[['left', '⯇'], ['center', '≡'], ['right', '⯈']].map(([v, ic]) => <button key={v} type="button" className={(mine ?? inh.value) === v ? 'on' : ''} onClick={() => set(key, v)} aria-label={v}>{ic}</button>)}</span>;
    } else if (def[1] === 'color') {
      const v = mine ?? inh.value;
      input = <span className="row" style={{ gap: 6 }}><input type="color" value={/^#[0-9a-f]{6}$/i.test(v || '') ? v : '#ffffff'} onChange={(e) => set(key, e.target.value)} style={{ width: 40, height: 30 }} /><span className="muted" style={{ fontSize: 12 }}>{v || 'none'}</span></span>;
    } else if (def[1] === 'image') {
      input = ImagePicker ? <ImagePicker value={mine ?? inh.value ?? ''} onChange={(v) => set(key, v || undefined)} /> : null;
    }
    return (
      <div key={key} className={`se-row ${mine !== undefined ? 'set' : ''}`}>
        <label>{def[0]} {note}</label>
        <div className="se-in">{input}{reset}</div>
      </div>
    );
  };

  const quick = [
    ['Hide on ' + device, () => set('hide', true), device !== 'desktop'],
    ['Reverse stacking', () => set('reverse', !(own.reverse ?? resolveStyle(style, device, 'reverse').value ?? false)), true],
    ['Smaller text (85%)', () => set('scale', 85), device !== 'desktop'],
    ['Tighter spacing', () => { const n = { ...style, [device]: { ...own, pad_top: 28, pad_bottom: 28, pad_x: 16 } }; onChange(n); }, device !== 'desktop'],
    ['One column', () => set('cols', 1), device !== 'desktop'],
  ].filter((q) => q[2]);

  return (
    <div className="se">
      <div className="se-devs" role="tablist">{DEVICES.map((d) => <button key={d} type="button" role="tab" className={device === d ? 'on' : ''} onClick={() => setDevice(d)}>{ICON[d]} {LABEL[d].split(' ')[0]}{overrides(d) ? <i>{overrides(d)}</i> : null}</button>)}</div>
      <p className="se-help">{device === 'desktop' ? 'Desktop settings apply to every screen size unless tablet or mobile overrides them.' : `Editing ${LABEL[device]}. These settings apply only at this width and smaller; anything you leave empty follows the larger screen.`}</p>
      {device !== 'desktop' && <div className="se-quick">{quick.map(([l, fn]) => <button key={l} type="button" className="btn sm" onClick={fn}>{l}</button>)}</div>}
      {GROUPS.map(([title, keys]) => <div key={title} className="se-group"><h5>{title}</h5>{keys.map(control)}</div>)}
      {device === 'desktop' && <div className="se-group"><h5>Link target</h5><div className="se-row"><label>Anchor name (for links like /site#about)</label><input className="input" value={style.anchor || ''} onChange={(e) => setAnchor(e.target.value)} placeholder="e.g. our-projects" /></div></div>}
      {overrides(device) > 0 && <button type="button" className="btn sm ghost danger" onClick={() => onChange((() => { const n = { ...style }; delete n[device]; return Object.keys(n).length ? n : undefined; })())}>Reset all {device} settings</button>}
    </div>
  );
}
