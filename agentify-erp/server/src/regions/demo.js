// Demo data for a workspace outside Pakistan: a handful of local-looking contacts and listings so a trial can be explored.
// Names, streets and prices are invented. Amounts are minor units (cents, pence, fils).
import { run, get } from '../db.js';
import { now, addMonths, today } from '../util.js';
import { currentRegion } from './runtime.js';

const DEMO = {
  US: { city: 'Austin', state: 'Texas', phone: (n) => `+1 512 555 01${n}`, contacts: ['Jordan Miller', 'Priya Patel', 'Carlos Alvarez', 'Emily Chen'],
    props: [['Maple Street Family Home', 'House', 'Austin', '1204 Maple Street', 1850, 42500000], ['Downtown Loft 5B', 'Apartment', 'Austin', '88 Congress Ave', 980, 61000000], ['Lakeview Townhouse', 'House', 'Round Rock', '17 Lakeview Dr', 1520, 38900000]] },
  CA: { city: 'Toronto', state: 'Ontario', phone: (n) => `+1 416 555 01${n}`, contacts: ['Liam Tremblay', 'Aisha Khan', 'Noah Gagnon', 'Sofia Rossi'],
    props: [['Queen West Condo', 'Apartment', 'Toronto', '455 Queen St W', 760, 74900000], ['Oakville Detached', 'House', 'Oakville', '23 Lakeshore Rd', 2300, 142500000], ['Plateau Duplex', 'House', 'Montreal', '3450 Rue Saint-Denis', 1650, 88000000]] },
  UK: { city: 'London', state: 'England', phone: (n) => `+44 20 7946 09${n}`, contacts: ['Oliver Hughes', 'Amelia Singh', 'George Evans', 'Isla Murray'],
    props: [['Victorian Terrace', 'House', 'London', '14 Albert Road', 1350, 65000000], ['Canalside Flat', 'Apartment', 'Manchester', '2 Dock Quay', 720, 24500000], ['Cotswold Cottage', 'House', 'Cheltenham', '5 Mill Lane', 1100, 41500000]] },
  AE: { city: 'Dubai', state: 'Dubai', phone: (n) => `+971 4 555 01${n}`, contacts: ['Omar Al Falasi', 'Layla Haddad', 'Raj Mehta', 'Anna Petrova'],
    props: [['Marina View 2BR', 'Apartment', 'Dubai', 'Dubai Marina, Tower 3', 1250, 240000000], ['Palm Villa', 'Villa', 'Dubai', 'Palm Jumeirah, Frond M', 5200, 1850000000], ['Business Bay Studio', 'Apartment', 'Dubai', 'Business Bay, Executive Towers', 520, 95000000]] },
};

export function seedRegionDemo() {
  const cfg = currentRegion().config;
  const d = DEMO[cfg.region];
  if (!d) return false;
  if (get('SELECT COUNT(*) n FROM contacts').n > 0) return false;
  const area = cfg.area_units?.includes('sqft') ? 'Sq Ft' : 'Sq M';
  d.contacts.forEach((name, i) => {
    run(`INSERT INTO contacts(full_name, phone, email, country, province, city, lead_source, priority, budget, followup_date, is_demo, created_at) VALUES(?,?,?,?,?,?,?,?,?,?,1,?)`,
      name, d.phone(10 + i), `${name.toLowerCase().replace(/[^a-z]+/g, '.')}@example.com`, cfg.name, d.state, d.city, ['Walk-in', 'Website', 'Referral', 'Social media'][i % 4], ['High', 'Medium', 'Medium', 'Low'][i % 4],
      d.props[i % d.props.length][5], addMonths(today(), 0).slice(0, 10), now());
  });
  d.props.forEach(([title, type, city, address, size, price], i) => {
    run(`INSERT INTO properties(code, title, purpose, property_type, city, address, area_size, unit, total_price, net_price, status, review_state, published, is_demo, created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,1,?)`,
      `DEMO-${i + 1}`, title, 'Sell', type, city, address, size, area, price, price, 'available', 'published', 1, now());
  });
  return true;
}
