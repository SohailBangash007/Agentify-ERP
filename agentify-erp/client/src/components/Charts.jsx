import { Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { month, moneyShort, money } from '../format.js';

const PALETTE = ['#14b8a6', '#fb7185', '#f59e0b', '#8b5cf6', '#38bdf8', '#34d399', '#94a3b8', '#f472b6'];
const axis = { fontSize: 11, fill: 'var(--muted)' };

function Empty() { return <div className="empty" style={{ paddingTop: 70 }}>No data for this period.</div>; }

/** series: [{key,label,color?}], data rows keyed by `x`. */
export function BarsChart({ data, x = 'month', series, stacked, isMonth = true, isMoney = true, height = 240, layout }) {
  if (!data?.length) return <Empty />;
  const tickX = (v) => (isMonth ? month(v) : String(v).length > 12 ? String(v).slice(0, 11) + '…' : v);
  const fmt = (v) => (isMoney ? money(v) : v);
  const horizontal = layout === 'vertical';
  return (
    <div className="chart-box" style={{ height }}>
      <ResponsiveContainer>
        <BarChart data={data} layout={horizontal ? 'vertical' : 'horizontal'} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={horizontal} horizontal={!horizontal} />
          {horizontal
            ? (<><XAxis type="number" tick={axis} tickFormatter={isMoney ? moneyShort : undefined} axisLine={false} tickLine={false} /><YAxis type="category" dataKey={x} tick={axis} width={110} tickFormatter={tickX} axisLine={false} tickLine={false} /></>)
            : (<><XAxis dataKey={x} tick={axis} tickFormatter={tickX} axisLine={false} tickLine={false} /><YAxis tick={axis} tickFormatter={isMoney ? moneyShort : undefined} axisLine={false} tickLine={false} width={46} /></>)}
          <Tooltip formatter={(v, n) => [fmt(v), n]} labelFormatter={(l) => (isMonth ? month(l) : l)} cursor={{ fill: 'var(--hover)' }} />
          {series.length > 1 && <Legend iconType="circle" wrapperStyle={{ fontSize: 11 }} />}
          {series.map((s, i) => <Bar key={s.key} dataKey={s.key} name={s.label} fill={s.color || PALETTE[i]} stackId={stacked ? 'a' : undefined} radius={stacked ? 0 : [8, 8, 2, 2]} maxBarSize={30} />)}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function LinesChart({ data, x = 'month', series, isMoney = true, height = 240 }) {
  if (!data?.length) return <Empty />;
  return (
    <div className="chart-box" style={{ height }}>
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
          <XAxis dataKey={x} tick={axis} tickFormatter={month} axisLine={false} tickLine={false} />
          <YAxis tick={axis} tickFormatter={isMoney ? moneyShort : undefined} axisLine={false} tickLine={false} width={46} />
          <Tooltip formatter={(v, n) => [isMoney ? money(v) : v, n]} labelFormatter={month} />
          {series.length > 1 && <Legend iconType="circle" wrapperStyle={{ fontSize: 11 }} />}
          {series.map((s, i) => <Line key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={s.color || PALETTE[i]} strokeWidth={2} dot={{ r: 3 }} />)}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export function DonutChart({ data, nameKey = 'name', valueKey = 'value', isMoney = true, height = 240, colors }) {
  const rows = (data || []).filter((d) => Number(d[valueKey]) > 0);
  if (!rows.length) return <Empty />;
  return (
    <div className="chart-box" style={{ height }}>
      <ResponsiveContainer>
        <PieChart>
          <Pie data={rows} dataKey={valueKey} nameKey={nameKey} innerRadius="52%" outerRadius="82%" paddingAngle={2} stroke="none">
            {rows.map((r, i) => <Cell key={i} fill={r.color || colors?.[i] || PALETTE[i % PALETTE.length]} />)}
          </Pie>
          <Tooltip formatter={(v, n) => [isMoney ? money(v) : v, n]} />
          <Legend iconType="circle" wrapperStyle={{ fontSize: 11 }} />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}
