import { useMemo, useState } from 'react';
import { DEFAULT_TOOLS, estimateCost, estimateMaterials, paymentPlan } from '../../../shared/constructionTools.js';
import { InstallmentCalculator } from './Calculators.jsx';
import { MoneyBox, fullPrice, priceText, useSite, waLink, minorOf, curCode } from './siteCore.jsx';
import { MortgageCalculator, PurchaseCostCalculator, AffordabilityCalculator, UnitConverter } from './RegionCalculators.jsx';
import { getRegion } from '../format.js';

const isPK = () => getRegion().config.region === 'PK';
// calculators work in whole currency units; the site shows them in the stored unit (cents outside Pakistan)
const fp = (v) => fullPrice(minorOf(v));
const pt = (v) => priceText(minorOf(v));
const stripCur = (t) => (getRegion().config.price_style === 'south_asian' ? t.replace(`${curCode()} `, '') : t);
const exAmt = (pk) => `e.g. ${(isPK() ? pk : Math.round(pk / 20)).toLocaleString(getRegion().config.locale)}`;

/** Pakistan keeps the website's own rates. Other regions use the region pack's rates (per sq ft, in the local currency). */
const toolsOf = (config) => {
  if (isPK()) return { ...DEFAULT_TOOLS, ...(config.calculators?.tools || {}) };
  const k = getRegion().config.calculators?.construction || {};
  return { ...DEFAULT_TOOLS, rates: k.rates || DEFAULT_TOOLS.rates, scopes: k.scopes || DEFAULT_TOOLS.scopes, location_factor: k.location_factor || { Standard: 1 }, materials: [], ...(config.calculators?.tools_override || {}) };
};
const PLOTS = [[5, '5 Marla'], [7, '7 Marla'], [10, '10 Marla'], [20, '1 Kanal']];

/** "Talk to us about this estimate": WhatsApp (pre-filled with the figures) and the contact page. */
function EstimateCta({ summary }) {
  const { config } = useSite();
  const wa = config.contact?.whatsapp;
  return (
    <div className="calc-cta">
      {wa && <a className="btn sm" target="_blank" rel="noreferrer" href={waLink(wa, `Hello, I used the website calculator. ${summary} Please share a detailed proposal.`)}>Get a proposal on WhatsApp</a>}
      <a className="btn sm ghost" href="/site/contact">Request a callback</a>
    </div>
  );
}

function PlotPicker({ marla, setMarla, floors, setFloors, basement, setBasement }) {
  const area = isPK() ? null : (
    <label>Floor area per storey (sq ft)
      <input type="number" min="200" step="50" value={marla} onChange={(e) => setMarla(Number(e.target.value))} aria-label="Floor area in square feet" />
      <small className="money-words">{Math.round(marla * 0.092903).toLocaleString(getRegion().config.locale)} sq m</small>
    </label>);
  return (
    <>
      {area}
      {isPK() && <label>Plot size
        <div className="seg">{PLOTS.map(([m, l]) => <button type="button" key={m} className={Number(marla) === m ? 'on' : ''} onClick={() => setMarla(m)}>{l}</button>)}</div>
        <input type="range" min="2" max="40" step="1" value={marla} onChange={(e) => setMarla(Number(e.target.value))} aria-label="Plot size in marla" />
        <small className="money-words">{marla} marla · 1 kanal = 20 marla</small>
      </label>}
      <label>Storeys<div className="seg2"><button type="button" className={Number(floors) <= 1 ? 'on' : ''} onClick={() => setFloors(1)}>Single</button><button type="button" className={Number(floors) === 2 ? 'on' : ''} onClick={() => setFloors(2)}>Double</button><button type="button" className={Number(floors) >= 3 ? 'on' : ''} onClick={() => setFloors(3)}>Triple</button></div></label>
      <label className="chk"><input type="checkbox" checked={basement} onChange={(e) => setBasement(e.target.checked)} /> Include a basement</label>
    </>
  );
}

/** 1 — Cost calculator: PKR range by plot size, scope and finish. */
export function CostCalculator() {
  const { config } = useSite();
  const t = toolsOf(config);
  const [marla, setMarla] = useState(isPK() ? 10 : 1200), [floors, setFloors] = useState(2), [basement, setBasement] = useState(false);
  const [scope, setScope] = useState('grey'), [finish, setFinish] = useState('Premium');
  const locs = Object.keys(t.location_factor || {});
  const [location, setLocation] = useState(locs[0]);
  const r = useMemo(() => estimateCost(isPK() ? { marla, floors, scope, finish, location, basement } : { area: marla * Math.max(1, floors) + (basement ? marla : 0), floors, scope, finish, location, basement }, t), [marla, floors, scope, finish, location, basement, t]);
  const summary = `${isPK() ? `${marla} marla` : `${marla} sq ft per storey`}, ${Number(floors) <= 1 ? 'single' : `${floors} storey`}${basement ? ' with basement' : ''}, ${t.scopes[scope]} (${finish}) — estimate ${pt(r.low)} to ${pt(r.high)}.`;
  return (
    <div className="calc">
      <div className="calc-form">
        <PlotPicker {...{ marla, setMarla, floors, setFloors, basement, setBasement }} />
        {locs.length > 1 && <label>Location<select value={location} onChange={(e) => setLocation(e.target.value)}>{locs.map((l) => <option key={l}>{l}</option>)}</select></label>}
        <label>Construction scope<div className="seg">{Object.entries(t.scopes).map(([k, l]) => <button type="button" key={k} className={scope === k ? 'on' : ''} onClick={() => setScope(k)}>{l}</button>)}</div></label>
        <label>Finish level<div className="seg">{t.finishes.map((f) => <button type="button" key={f} className={finish === f ? 'on' : ''} onClick={() => setFinish(f)}>{f}<small>{fp(t.rates?.[scope]?.[f])}/sq ft</small></button>)}</div></label>
      </div>
      <div className="calc-result">
        <div className="calc-big"><span>Estimated construction cost</span><b>{pt(r.low)} – {stripCur(pt(r.high))}</b><small>≈ {pt(r.total)} · {r.area.toLocaleString(getRegion().config.locale)} sq ft covered · {fp(r.perSqft)} per sq ft</small></div>
        <dl>{r.parts.map((p) => <div key={p.label}><dt>{p.label} <small>({p.pct}%)</small></dt><dd>{fp(p.amount)}</dd></div>)}
          <div><dt>Estimated duration</dt><dd>{r.months[0]}–{r.months[1]} months</dd></div></dl>
        <p className="note">{t.note}</p>
        <EstimateCta summary={summary} />
      </div>
    </div>
  );
}

/** 2 — Material estimator: steel, cement, bricks, sand and crush quantities with cost. */
export function MaterialEstimator() {
  const { config } = useSite();
  const t = toolsOf(config);
  const [marla, setMarla] = useState(10), [floors, setFloors] = useState(2), [basement, setBasement] = useState(false);
  const [scope, setScope] = useState('grey'), [finish, setFinish] = useState('Standard');
  const [override, setOverride] = useState('');
  const auto = useMemo(() => estimateCost({ marla, floors, scope, finish, basement }, t).area, [marla, floors, scope, finish, basement, t]);
  const sqft = override ? Number(override) : auto;
  const m = useMemo(() => estimateMaterials({ sqft, scope, finish, floors }, t), [sqft, scope, finish, floors, t]);
  return (
    <div className="calc">
      <div className="calc-form">
        <PlotPicker {...{ marla, setMarla, floors, setFloors, basement, setBasement }} />
        <label>Covered area (sq ft)<input type="number" min="0" value={override} placeholder={`Suggested: ${auto.toLocaleString('en-PK')}`} onChange={(e) => setOverride(e.target.value)} />
          <small className="money-words">Enter the total from your drawings (all floors including basement) for a closer estimate.</small></label>
        <label>Construction scope<div className="seg">{Object.entries(t.scopes).map(([k, l]) => <button type="button" key={k} className={scope === k ? 'on' : ''} onClick={() => setScope(k)}>{l}</button>)}</div></label>
        {scope !== 'grey' && <label>Finish level<div className="seg">{t.finishes.map((f) => <button type="button" key={f} className={finish === f ? 'on' : ''} onClick={() => setFinish(f)}>{f}</button>)}</div></label>}
      </div>
      <div className="calc-result">
        <div className="calc-big"><span>Estimated total with {t.contingency_pct}% contingency</span><b>{pt(m.total)}</b><small>{Math.round(sqft).toLocaleString('en-PK')} sq ft · {fp(m.perSqft)} per sq ft</small></div>
        <dl>
          {m.lines.map((l) => <div key={l.label}><dt>{l.label} <small>{l.qty.toLocaleString('en-PK')} {l.unit} @ {l.rate}</small></dt><dd>{fp(l.amount)}</dd></div>)}
          {m.allowances.map((a) => <div key={a.label}><dt>{a.label}</dt><dd>{fp(a.amount)}</dd></div>)}
          <div><dt>Contingency ({t.contingency_pct}%)</dt><dd>{fp(m.contingency)}</dd></div>
          <div><dt>Concrete <small>(informational)</small></dt><dd>{m.concrete.toLocaleString('en-PK')} cft</dd></div>
        </dl>
        <p className="note">Indicative quantities for planning only — not a Bill of Quantities. {t.note}</p>
        <EstimateCta summary={`${Math.round(sqft)} sq ft ${t.scopes[scope]} — materials estimate ${pt(m.total)}.`} />
      </div>
    </div>
  );
}

/** 3 — Milestone payment plan: split a project price across progress milestones. */
export function MilestonePlanner() {
  const { config } = useSite();
  const t = toolsOf(config);
  const [price, setPrice] = useState('');
  const kinds = (isPK() ? [['grey', 'Grey Structure'], ['finishing', 'Finishing'], ['semi', 'Semi-Furnished'], ['turnkey', 'Turnkey']] : [['grey', t.scopes.grey], ['finishing', 'Finishing'], ['semi', t.scopes.semi], ['turnkey', t.scopes.turnkey]]).filter(([k]) => t.plans?.[k]?.length);
  const [kind, setKind] = useState(kinds[0]?.[0] || 'grey');
  const plan = useMemo(() => paymentPlan({ total: price, plan: kind }, t), [price, kind, t]);
  return (
    <div className="calc">
      <div className="calc-form">
        <label>Total project price ({curCode()})<MoneyBox value={price} onChange={setPrice} placeholder={exAmt(15000000)} /></label>
        <label>Construction type<div className="seg">{kinds.map(([k, l]) => <button type="button" key={k} className={kind === k ? 'on' : ''} onClick={() => setKind(k)}>{l}</button>)}</div></label>
        <p className="note">Not sure of your price? Use the <b>Cost calculator</b> first, then return here for the milestone breakdown.</p>
      </div>
      <div className="calc-result">
        {!plan.total ? <p className="note">Enter a project price to see the amount due at each milestone.</p> : (
          <>
            <div className="calc-big"><span>Milestone payment plan</span><b>{fp(plan.total)}</b><small>{plan.rows.length} milestones · {plan.pctTotal}%</small></div>
            <dl>{plan.rows.map((x, i) => <div key={x.label}><dt>{i + 1}. {x.label} <small>({x.pct}%)</small></dt><dd>{fp(x.amount)}</dd></div>)}</dl>
            <EstimateCta summary={`Milestone plan for ${fp(plan.total)} (${kinds.find(([k]) => k === kind)?.[1]}).`} />
          </>
        )}
      </div>
    </div>
  );
}

const PK_TABS = [['cost', 'Cost calculator', CostCalculator], ['materials', 'Material estimator', MaterialEstimator], ['milestones', 'Payment milestones', MilestonePlanner]];
const REGION_TABS = (c, product) => [
  ...(product !== 'construction' && c.calculators?.mortgage ? [['mortgage', 'Mortgage calculator', MortgageCalculator]] : []),
  ...(product !== 'construction' && c.calculators?.purchase_costs ? [['costs', c.calculators.purchase_costs === 'sdlt' ? 'Stamp Duty' : c.calculators.purchase_costs === 'dld' ? 'Purchase fees' : 'Closing costs', PurchaseCostCalculator]] : []),
  ...(product !== 'construction' && c.calculators?.affordability ? [['afford', 'How much can I afford?', AffordabilityCalculator]] : []),
  ...(c.calculators?.installments ? [['installment', 'Payment plan', InstallmentCalculator]] : []),
  ['cost', 'Build cost', CostCalculator], ['milestones', 'Payment milestones', MilestonePlanner],
  ...(c.calculators?.unit_converter ? [['units', 'Area converter', UnitConverter]] : []),
];

/** The website calculators. The older installment generator stays available behind the `show_installment` setting. */
export function CalculatorTabs({ defaultTab = 'cost' }) {
  const { config } = useSite();
  const rc = getRegion().config;
  const tabs = isPK() ? (config.calculators?.show_installment ? [...PK_TABS, ['installment', 'Installment plan', InstallmentCalculator]] : PK_TABS) : REGION_TABS(rc, config.product);
  const first = tabs[0][0];
  const [tab, setTab] = useState(tabs.some(([k]) => k === defaultTab) && (isPK() || defaultTab !== 'cost' || first === 'cost') ? defaultTab : first);
  const Active = tabs.find(([k]) => k === tab)?.[2] || tabs[0][2];
  return (
    <div>
      <div className="tabs-pill">{tabs.map(([k, l]) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>)}</div>
      <Active />
    </div>
  );
}
