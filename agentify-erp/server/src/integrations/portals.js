// Property portals and MLS feeds by country. Each portal gets a feed address (XML, JSON or CSV) that the workspace owner
// gives to the portal or uploads there, plus a record of which listings are published to which portal and whether they are
// ready (the fields each portal requires). Portals that accept pushed listings over an API need an agreement with the portal
// (Zillow, Rightmove, Bayut, Property Finder and most MLS boards approve brokers one by one), so the CRM keeps the
// workspace's own API settings for them and posts to the endpoint they give you; it never pretends an approval exists.
import crypto from 'node:crypto';
import { all, get, run, getSetting, setSetting } from '../db.js';
import { currentRegion } from '../regions/runtime.js';
import { now } from '../util.js';

export const PORTALS = [
  { id: 'zillow', name: 'Zillow and Trulia', countries: ['US'], mode: 'Feed or partner API', requires: ['title', 'price', 'address', 'city', 'bedrooms', 'bathrooms', 'photo'], apply: 'https://www.zillow.com/z/rental-manager/list-on-zillow/', note: 'Zillow Group accepts listing feeds from approved brokerages and partners. Apply with Zillow, then give them your feed address.' },
  { id: 'realtor_com', name: 'Realtor.com', countries: ['US'], mode: 'Through your MLS', requires: ['title', 'price', 'address', 'city', 'photo'], apply: 'https://www.realtor.com/', note: 'Realtor.com receives listings from your local MLS. Add the listing to your MLS first, or send them the feed if you are a data partner.' },
  { id: 'mls_reso', name: 'MLS (RESO Web API)', countries: ['US', 'CA'], mode: 'Your board\'s RESO API', requires: ['title', 'price', 'address', 'city', 'bedrooms', 'bathrooms', 'photo'], apply: 'https://www.reso.org/', note: 'Most US and Canadian MLS boards give licensed brokers a RESO Web API. Enter the endpoint and token your board issued and the CRM posts listings to it.', api: true },
  { id: 'realtor_ca', name: 'REALTOR.ca (CREA DDF)', countries: ['CA'], mode: 'Data Distribution Facility', requires: ['title', 'price', 'address', 'city', 'bedrooms', 'bathrooms', 'photo'], apply: 'https://ddfcrea.org/', note: 'REALTOR.ca is fed through CREA\'s Data Distribution Facility by your board or a data partner.' },
  { id: 'rightmove', name: 'Rightmove', countries: ['UK'], mode: 'Real-time data feed', requires: ['title', 'price', 'address', 'city', 'bedrooms', 'bathrooms', 'photo', 'tenure'], apply: 'https://www.rightmove.co.uk/estate-agents/join-rightmove.html', note: 'Rightmove connects agents through its real-time data feed after you become a member.' },
  { id: 'zoopla', name: 'Zoopla', countries: ['UK'], mode: 'Real-time data feed', requires: ['title', 'price', 'address', 'city', 'bedrooms', 'bathrooms', 'photo', 'tenure'], apply: 'https://www.zoopla.co.uk/', note: 'Zoopla accepts feeds from agents who are members.' },
  { id: 'onthemarket', name: 'OnTheMarket', countries: ['UK'], mode: 'Feed', requires: ['title', 'price', 'address', 'city', 'bedrooms', 'photo'], apply: 'https://www.onthemarket.com/', note: 'OnTheMarket accepts feeds from member agents.' },
  { id: 'bayut', name: 'Bayut and dubizzle', countries: ['AE'], mode: 'Feed or API', requires: ['title', 'price', 'address', 'city', 'bedrooms', 'bathrooms', 'photo', 'permit_no'], apply: 'https://www.bayut.com/', note: 'Bayut accepts bulk and API listings from agencies. A valid advertising permit number is required on every listing.' },
  { id: 'property_finder', name: 'Property Finder', countries: ['AE'], mode: 'Feed or API', requires: ['title', 'price', 'address', 'city', 'bedrooms', 'bathrooms', 'photo', 'permit_no'], apply: 'https://www.propertyfinder.ae/', note: 'Property Finder accepts agency feeds and API listings. A valid advertising permit number is required.' },
  { id: 'zameen', name: 'Zameen.com', countries: ['PK'], mode: 'Feed', requires: ['title', 'price', 'city'], apply: 'https://www.zameen.com/', note: 'Zameen accepts listings from agencies; ask your account manager about feed upload.' },
  { id: 'lamudi', name: 'Lamudi', countries: ['PK', 'AE'], mode: 'Feed', requires: ['title', 'price', 'city'], apply: 'https://www.lamudi.com.pk/', note: 'Lamudi accepts agency feeds.' },
];
export const portalsFor = (region) => PORTALS.filter((p) => p.countries.includes(region));

/** A secret address segment per workspace so a feed is not guessable. */
export function feedToken() {
  let t = getSetting('portal_feed_token');
  if (!t) { t = crypto.randomBytes(18).toString('base64url'); setSetting('portal_feed_token', t); }
  return t;
}
export const rotateFeedToken = () => { setSetting('portal_feed_token', crypto.randomBytes(18).toString('base64url')); return feedToken(); };

const extOf = (id) => Object.fromEntries(all("SELECT key, value FROM region_ext_values WHERE entity='property' AND entity_id=?", id).map((r) => [r.key, r.value]));
function listing(p, base) {
  const f = (() => { try { return JSON.parse(p.features || '{}'); } catch { return {}; } })();
  const ext = extOf(p.id);
  const photos = all("SELECT path FROM media WHERE entity_type='property' AND entity_id=? AND kind IN ('image','photo','cover') ORDER BY sort_order, id", p.id).map((m) => (/^https?:/.test(m.path) ? m.path : `${base}/uploads/${m.path}`));
  return {
    id: p.id, reference: p.code, title: p.title, description: p.description || p.short_desc || '', purpose: p.purpose, type: p.property_type, status: p.status,
    price_minor: p.net_price, currency: currentRegion().config.currency, price: p.net_price / 10 ** currentRegion().config.money_scale,
    area: p.area_size, area_unit: p.unit, bedrooms: f.bedrooms ?? null, bathrooms: f.bathrooms ?? null,
    address: p.address || p.location || '', city: p.city || '', area_name: p.area_name || '', country: currentRegion().config.name, lat: p.lat, lng: p.lng,
    tenure: ext.tenure || null, epc_rating: ext.epc_rating || null, council_tax_band: ext.council_tax_band || null, permit_no: ext.rera_permit_no || null, title_deed_no: ext.title_deed_no || null, parcel_number: ext.parcel_number || null,
    photos, url: `${base}/site/property/${p.id}`, updated_at: p.updated_at || p.created_at,
  };
}
export const listingFor = listing;

/** What is missing before a listing can go to a portal. */
export function readiness(l, portal) {
  const has = { title: !!l.title, price: l.price_minor > 0, address: !!l.address, city: !!l.city, bedrooms: l.bedrooms != null && l.bedrooms !== '', bathrooms: l.bathrooms != null && l.bathrooms !== '', photo: l.photos.length > 0, tenure: !!l.tenure, permit_no: !!l.permit_no };
  const label = { title: 'a title', price: 'a price', address: 'an address', city: 'a city', bedrooms: 'the number of bedrooms', bathrooms: 'the number of bathrooms', photo: 'at least one photo', tenure: 'the tenure (freehold or leasehold)', permit_no: 'the advertising permit number' };
  return portal.requires.filter((k) => !has[k]).map((k) => label[k]);
}

const xml = (s) => String(s ?? '').replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]));
export function feedXml(portalId, listings) {
  const items = listings.map((l) => `  <listing>
    <id>${l.id}</id><reference>${xml(l.reference)}</reference><status>${xml(l.status)}</status><purpose>${xml(l.purpose)}</purpose><type>${xml(l.type)}</type>
    <title>${xml(l.title)}</title><description>${xml(l.description)}</description>
    <price currency="${xml(l.currency)}">${l.price}</price>
    <area unit="${xml(l.area_unit)}">${l.area ?? ''}</area><bedrooms>${l.bedrooms ?? ''}</bedrooms><bathrooms>${l.bathrooms ?? ''}</bathrooms>
    <address><street>${xml(l.address)}</street><area>${xml(l.area_name)}</area><city>${xml(l.city)}</city><country>${xml(l.country)}</country><latitude>${l.lat ?? ''}</latitude><longitude>${l.lng ?? ''}</longitude></address>
    ${l.tenure ? `<tenure>${xml(l.tenure)}</tenure>` : ''}${l.epc_rating ? `<epc_rating>${xml(l.epc_rating)}</epc_rating>` : ''}${l.council_tax_band ? `<council_tax_band>${xml(l.council_tax_band)}</council_tax_band>` : ''}${l.permit_no ? `<permit_number>${xml(l.permit_no)}</permit_number>` : ''}
    <photos>${l.photos.map((u) => `<photo>${xml(u)}</photo>`).join('')}</photos><url>${xml(l.url)}</url><updated>${xml(l.updated_at)}</updated>
  </listing>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<listings portal="${xml(portalId)}" generated="${xml(now())}">\n${items}\n</listings>\n`;
}
export function feedCsv(listings) {
  const cols = ['reference', 'title', 'purpose', 'type', 'price', 'currency', 'area', 'area_unit', 'bedrooms', 'bathrooms', 'address', 'city', 'country', 'tenure', 'permit_no', 'url'];
  const esc = (v) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return [cols.join(','), ...listings.map((l) => cols.map((c) => esc(l[c])).join(','))].join('\r\n');
}

export function publishedListings(portalId, base) {
  const rows = all(`SELECT p.* FROM properties p JOIN portal_publications pp ON pp.property_id=p.id WHERE pp.portal=? AND pp.status='published' AND p.published=1 AND p.status IN ('available','featured','reserved')`, portalId);
  return rows.map((p) => listing(p, base));
}
export const publicationsFor = (propertyId) => all('SELECT portal, status, error, published_at FROM portal_publications WHERE property_id=?', propertyId);
export function setPublication(propertyId, portal, status, error = null) {
  run(`INSERT INTO portal_publications(property_id, portal, status, error, published_at, updated_at) VALUES(?,?,?,?,?,?)
       ON CONFLICT(property_id, portal) DO UPDATE SET status=excluded.status, error=excluded.error, published_at=COALESCE(excluded.published_at, published_at), updated_at=excluded.updated_at`,
  propertyId, portal, status, error, status === 'published' ? now() : null, now());
}
export { get };
