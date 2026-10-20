// Document templates: plain text/HTML with {{placeholders}}. No code runs inside a template; a placeholder can only be
// replaced by a value from the context the caller passes in, and values are HTML-escaped by default.

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const PLACEHOLDER = /\{\{\s*([a-z][a-z0-9_.]*)\s*(?:\|\s*(raw|money|date))?\s*\}\}/gi;

/** Names a template uses, e.g. ['buyer.name', 'price']. */
export function placeholders(body) {
  return [...new Set([...String(body || '').matchAll(PLACEHOLDER)].map((m) => m[1]))];
}

const lookup = (ctx, path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), ctx);

/**
 * Fill a template. `fmt` supplies { money, date } formatters (the region's); a missing value is left visible as
 * "[name]" and reported in `missing` so a document is never silently sent with a blank where a figure belongs.
 */
export function render(body, ctx = {}, { fmt = {}, html = true } = {}) {
  const missing = [];
  const text = String(body || '').replace(PLACEHOLDER, (_m, name, filter) => {
    const v = lookup(ctx, name);
    if (v === undefined || v === null || v === '') { missing.push(name); return `[${name}]`; }
    let out;
    if (filter === 'money' && fmt.money) out = fmt.money(v);
    else if (filter === 'date' && fmt.date) out = fmt.date(v);
    else out = String(v);
    return filter === 'raw' || !html ? out : escapeHtml(out);
  });
  return { text, missing: [...new Set(missing)] };
}

/** Variables each kind of document may use (the editor lists these; unknown names are rejected on save). */
export const VARIABLES = {
  offer: ['company.name', 'buyer.name', 'seller.name', 'property.title', 'property.address', 'price', 'deposit', 'closing_date', 'today'],
  agency_agreement: ['company.name', 'client.name', 'property.title', 'property.address', 'commission_percent', 'start_date', 'end_date', 'today'],
  receipt_note: ['company.name', 'client.name', 'amount', 'method', 'reference', 'today'],
  disclosure: ['company.name', 'client.name', 'property.title', 'today'],
  letter: ['company.name', 'client.name', 'subject', 'today'],
};
export const KINDS = Object.keys(VARIABLES);

/** Checks a template body only uses allowed variables for its kind. Returns the list of unknown names. */
export const unknownVariables = (kind, body) => placeholders(body).filter((n) => !(VARIABLES[kind] || []).includes(n));

/** Checklist progress: required items must all be done before a checklist can be completed. */
export function checklistStatus(items, state = {}) {
  const required = items.filter((i) => i.required);
  const doneRequired = required.filter((i) => state[i.key]?.done).length;
  const done = items.filter((i) => state[i.key]?.done).length;
  return { total: items.length, done, required: required.length, required_done: doneRequired, complete: doneRequired === required.length };
}
