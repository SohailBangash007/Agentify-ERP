// Small inline SVG flags. Windows does not draw flag emoji, so the flags are drawn here and work in every browser.
const FLAGS = {
  US: (
    <svg viewBox="0 0 30 20"><rect width="30" height="20" fill="#fff" />{Array.from({ length: 7 }, (_, i) => <rect key={i} y={i * 3.0769} width="30" height="1.5385" fill="#b22234" />)}<rect width="12" height="10.77" fill="#3c3b6e" />
      {Array.from({ length: 12 }, (_, i) => <circle key={i} cx={1.7 + (i % 4) * 3.1 + (Math.floor(i / 4) % 2) * 0.0} cy={1.9 + Math.floor(i / 4) * 3.2} r="0.55" fill="#fff" />)}</svg>
  ),
  UK: (
    <svg viewBox="0 0 60 40"><rect width="60" height="40" fill="#012169" /><path d="M0 0 60 40M60 0 0 40" stroke="#fff" strokeWidth="8" /><path d="M0 0 60 40M60 0 0 40" stroke="#c8102e" strokeWidth="2.6" />
      <rect x="25" width="10" height="40" fill="#fff" /><rect y="15" width="60" height="10" fill="#fff" /><rect x="27" width="6" height="40" fill="#c8102e" /><rect y="17" width="60" height="6" fill="#c8102e" /></svg>
  ),
  AE: (
    <svg viewBox="0 0 30 20"><rect width="30" height="6.67" fill="#00732f" /><rect y="6.67" width="30" height="6.67" fill="#fff" /><rect y="13.33" width="30" height="6.67" fill="#000" /><rect width="7.5" height="20" fill="#ff0000" /></svg>
  ),
  PK: (
    <svg viewBox="0 0 30 20"><rect width="30" height="20" fill="#01411c" /><rect width="7.5" height="20" fill="#fff" /><circle cx="19" cy="10" r="4.6" fill="#fff" /><circle cx="20.4" cy="9.2" r="3.9" fill="#01411c" />
      <polygon points="22.6,6.4 23.1,7.6 24.4,7.7 23.4,8.5 23.7,9.8 22.6,9.1 21.5,9.8 21.8,8.5 20.8,7.7 22.1,7.6" fill="#fff" /></svg>
  ),
  CA: (
    <svg viewBox="0 0 30 20"><rect width="30" height="20" fill="#fff" /><rect width="7.5" height="20" fill="#d52b1e" /><rect x="22.5" width="7.5" height="20" fill="#d52b1e" />
      <polygon points="15,3.5 16.4,6.5 18.8,5.6 18.2,9.2 20.4,8.2 19.7,10.4 22,11.6 18.9,13.6 19.3,15.1 15.6,14.6 15.6,17.5 14.4,17.5 14.4,14.6 10.7,15.1 11.1,13.6 8,11.6 10.3,10.4 9.6,8.2 11.8,9.2 11.2,5.6 13.6,6.5" fill="#d52b1e" /></svg>
  ),
};

export default function Flag({ code, height = 14 }) {
  const svg = FLAGS[code];
  if (!svg) return null;
  const ratio = code === 'UK' ? 1.5 : 1.5;
  return <span aria-hidden="true" style={{ display: 'inline-flex', width: height * ratio, height, borderRadius: 2, overflow: 'hidden', boxShadow: '0 0 0 1px rgba(0,0,0,.18)', flex: 'none', verticalAlign: 'middle' }}>{svg}</span>;
}
