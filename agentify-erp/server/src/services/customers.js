import { all, get, run, nextNo } from '../db.js';

/** A contact that becomes a customer receives its customer ID once (CUS-0001…). */
export function ensureCustomerCode(contactId) {
  const c = get('SELECT id,is_customer,customer_code FROM contacts WHERE id=?', contactId);
  if (c?.is_customer && !c.customer_code) run('UPDATE contacts SET customer_code=? WHERE id=?', nextNo('CUS', 'CUS', 4), contactId);
}

const strip = (col) => `replace(replace(replace(replace(replace(${col},'-',''),' ',''),'+',''),'(',''),')','')`;

/**
 * WHERE fragment that finds a customer by name, customer ID, e-mail, CNIC or phone — however the number is typed
 * (0300-5551350, +92 300 5551350, 03005551350 all match; CNIC with or without dashes).
 */
export function customerSearchClause(q, a = 'c') {
  const text = String(q || '').trim();
  const like = `%${text.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`; // % and _ typed by the user are ordinary characters, not wildcards
  const digits = text.replace(/\D/g, '');
  const parts = ['full_name', 'customer_code', 'email', 'cnic', 'phone'].map((col) => `${a}.${col} LIKE ? ESCAPE '\\'`);
  const params = [like, like, like, like, like];
  if (digits.length >= 4) {
    const tail = digits.length >= 10 ? digits.slice(-10) : digits; // 0300… and +92 300… are the same number
    parts.push(`${strip(`${a}.phone`)} LIKE ?`, `${strip(`${a}.cnic`)} LIKE ?`);
    params.push(`%${tail}%`, `%${digits}%`);
  }
  return { sql: `(${parts.join(' OR ')})`, params };
}

/**
 * Everything a receipt voucher states about the customer and the plot / file it is paid against.
 * Used by the receipt screen, the live preview, the PDFs and the customer portal — one source.
 */
export function receiptRecord(contactId, saleId) {
  const c = get('SELECT customer_code, full_name, cnic, phone, email, address, city FROM contacts WHERE id=?', contactId) || {};
  let sale = saleId ? get('SELECT * FROM sales WHERE id=?', saleId) : null;
  // a construction contract points at the customer's plot sale: the plot is what the file/registration refer to
  const plotSale = sale?.kind === 'construction' && sale.linked_sale_id ? get('SELECT * FROM sales WHERE id=?', sale.linked_sale_id) : sale;
  const pid = plotSale?.property_id || sale?.property_id;
  const p = pid ? get(`SELECT p.*, pr.name project_name, pr.location project_location FROM properties p LEFT JOIN projects pr ON pr.id=p.project_id WHERE p.id=?`, pid) : null;
  const address = p ? [p.address || p.location, p.area_name, p.city].filter(Boolean).filter((x, i, a) => a.indexOf(x) === i).join(', ') || p.project_location || '' : '';
  return {
    customer_code: c.customer_code || null, customer_name: c.full_name || null, cnic: c.cnic || null, phone: c.phone || null, email: c.email || null, customer_address: [c.address, c.city].filter(Boolean).join(', ') || null,
    sale_no: (plotSale || sale)?.sale_no || null, booking_date: (plotSale || sale)?.sale_date || null,
    registration_no: p?.registration_no || null, file_no: p?.file_no || null, file_status: p?.file_status || null, file_notes: p?.file_notes || null,
    property_type: p?.property_type || null, plot_no: p?.plot_no || null, block: p?.block || null, project_name: p?.project_name || null,
    plot_size: p?.area_size ? `${p.area_size} ${p.unit || ''}`.trim() : null, address: address || null,
  };
}

/**
 * Contacts that already use the same phone / alternate phone / WhatsApp / e-mail / CNIC — however it is typed.
 * (0311-1234321 and +92 311 1234321 are the same number.)
 */
export function findDuplicateContacts({ phone, alt_phone, whatsapp, email, cnic } = {}, excludeId = 0) {
  const tail = (v) => { const d = String(v || '').replace(/\D/g, ''); return d.length >= 7 ? d.slice(-10) : ''; };
  const nums = [...new Set([phone, alt_phone, whatsapp].map(tail).filter(Boolean))];
  const mail = String(email || '').trim().toLowerCase();
  const id = String(cnic || '').replace(/\D/g, '');
  const where = [], params = [];
  for (const n of nums) for (const col of ['phone', 'alt_phone', 'whatsapp']) { where.push(`${strip(col)} LIKE ?`); params.push(`%${n}`); }
  if (mail) { where.push('lower(email)=?'); params.push(mail); }
  if (id.length === 13) { where.push(`${strip('cnic')}=?`); params.push(id); }
  if (!where.length) return [];
  return all(`SELECT id, full_name, phone, email, cnic, agent_id, created_by, is_customer, customer_code FROM contacts WHERE id<>? AND (${where.join(' OR ')}) LIMIT 5`, excludeId, ...params);
}
