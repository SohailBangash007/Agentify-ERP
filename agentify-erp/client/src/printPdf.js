/** Prints a server-made PDF (the proper A4 document) instead of the browser window, so paper output never includes page chrome. */
export async function printPdf(url, params = {}) {
  const q = new URLSearchParams({ ...params, inline: '1' }).toString();
  const res = await fetch(`${url}?${q}`, { credentials: 'same-origin', headers: { 'X-Requested-With': 'ERP' } });
  if (!res.ok) throw new Error('Could not prepare the print copy');
  const blobUrl = URL.createObjectURL(await res.blob());
  const f = document.createElement('iframe');
  f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
  f.src = blobUrl; document.body.appendChild(f);
  f.onload = () => { try { f.contentWindow.focus(); f.contentWindow.print(); } catch { window.open(blobUrl, '_blank'); } setTimeout(() => { f.remove(); URL.revokeObjectURL(blobUrl); }, 60_000); };
}
