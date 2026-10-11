import { all, get, run } from '../db.js';
import { now, today, addDays, dateRange } from '../util.js';
import { notify } from '../audit.js';
import { tierFor } from '../routes/agents.js';

export const METRICS = [
  { key: 'leads', label: 'New leads added', short: 'Leads' },
  { key: 'followups', label: 'Follow-ups completed', short: 'Follow-ups' },
  { key: 'conversions', label: 'Customers converted', short: 'Conversions' },
  { key: 'sales_value', label: 'Sales value', short: 'Sales', money: true },
];
export const DEFAULTS = {
  daily: { leads: 5, followups: 10, conversions: 0, sales_value: 0 },
  monthly: { leads: 100, followups: 200, conversions: 4, sales_value: 20_000_000 },
};
const POINTS = { lead: 10, followup: 5, conversion: 100 };

/** Target for a user: their own goal if a manager set one, otherwise the team default, otherwise the built-in default. */
export function goalFor(userId, period) {
  const own = get('SELECT * FROM agent_goals WHERE user_id=? AND period=?', userId, period);
  const def = get('SELECT * FROM agent_goals WHERE user_id IS NULL AND period=?', period);
  const g = own || def;
  const base = DEFAULTS[period];
  return { leads: g?.leads ?? base.leads, followups: g?.followups ?? base.followups, conversions: g?.conversions ?? base.conversions, sales_value: g?.sales_value ?? base.sales_value, source: own ? 'personal' : def ? 'team' : 'default' };
}

export function actuals(userId, from, to) {
  return {
    leads: get(`SELECT COUNT(*) n FROM contacts WHERE (agent_id=? OR created_by=?) AND date(created_at) BETWEEN ? AND ?`, userId, userId, from, to).n,
    followups: get(`SELECT COUNT(*) n FROM activities WHERE user_id=? AND action IN ('Follow-up completed','Task completed') AND date(created_at) BETWEEN ? AND ?`, userId, from, to).n,
    conversions: get(`SELECT COUNT(*) n FROM sales WHERE agent_id=? AND status='confirmed' AND sale_date BETWEEN ? AND ?`, userId, from, to).n,
    sales_value: get(`SELECT COALESCE(SUM(net_price),0) n FROM sales WHERE agent_id=? AND status='confirmed' AND sale_date BETWEEN ? AND ?`, userId, from, to).n,
  };
}

/** Per-metric and overall % of goal achieved for one period. Metrics with a target of 0 are not part of the goal. */
export function progress(userId, period, asOf) {
  const range = period === 'daily' ? { from: asOf || today(), to: asOf || today() } : dateRange('this_month');
  const target = goalFor(userId, period), act = actuals(userId, range.from, range.to);
  const metrics = METRICS.filter((m) => target[m.key] > 0).map((m) => {
    const pct = Math.min(100, Math.round((act[m.key] / target[m.key]) * 100));
    return { ...m, target: target[m.key], actual: act[m.key], pct, remaining: Math.max(0, target[m.key] - act[m.key]) };
  });
  const overall = metrics.length ? Math.round(metrics.reduce((a, m) => a + m.pct, 0) / metrics.length) : 0;
  return { period, from: range.from, to: range.to, source: target.source, target, actual: act, metrics, overall_pct: overall, achieved: metrics.length > 0 && overall >= 100 };
}

/** Leads still open in the funnel — the people to convert. */
export function opportunities(userId) {
  const t = today();
  const stage = (name) => get(`SELECT COUNT(*) n FROM contacts c JOIN lookups s ON s.id=c.stage_id WHERE c.agent_id=? AND c.is_customer=0 AND s.value=?`, userId, name).n;
  const followUp = stage('Follow Up'), interested = stage('Interested'), contacted = stage('Contacted'), fresh = stage('Non Contacted');
  const hot = all(`SELECT c.id,c.full_name,c.phone,c.budget,c.followup_date,s.value stage,s.color stage_color,c.priority,
      (SELECT title FROM properties WHERE id=c.property_id) property_title
    FROM contacts c JOIN lookups s ON s.id=c.stage_id WHERE c.agent_id=? AND c.is_customer=0 AND s.value IN ('Interested','Follow Up')
    ORDER BY (s.value='Interested') DESC, (c.followup_date IS NULL), c.followup_date, c.budget DESC LIMIT 12`, userId);
  return {
    follow_up: followUp, interested, contacted, not_contacted: fresh, to_convert: followUp + interested,
    overdue_followups: get('SELECT COUNT(*) n FROM contacts WHERE agent_id=? AND is_customer=0 AND followup_date<?', userId, t).n,
    due_today: get('SELECT COUNT(*) n FROM contacts WHERE agent_id=? AND is_customer=0 AND followup_date=?', userId, t).n,
    pipeline_value: get(`SELECT COALESCE(SUM(c.budget),0) v FROM contacts c JOIN lookups s ON s.id=c.stage_id WHERE c.agent_id=? AND c.is_customer=0 AND s.value IN ('Interested','Follow Up')`, userId).v,
    leads: hot,
  };
}

/** Consecutive days (ending today or yesterday) on which the daily goal was fully met. */
export function streak(userId) {
  const target = goalFor(userId, 'daily');
  const active = METRICS.filter((m) => target[m.key] > 0);
  if (!active.length) return { days: 0, best: 0 };
  const from = addDays(today(), -59);
  const byDay = {};
  const put = (rows, key) => rows.forEach((r) => { (byDay[r.d] ||= {})[key] = r.n; });
  put(all(`SELECT date(created_at) d, COUNT(*) n FROM contacts WHERE (agent_id=? OR created_by=?) AND date(created_at)>=? GROUP BY d`, userId, userId, from), 'leads');
  put(all(`SELECT date(created_at) d, COUNT(*) n FROM activities WHERE user_id=? AND action IN ('Follow-up completed','Task completed') AND date(created_at)>=? GROUP BY d`, userId, from), 'followups');
  put(all(`SELECT sale_date d, COUNT(*) n FROM sales WHERE agent_id=? AND status='confirmed' AND sale_date>=? GROUP BY d`, userId, from), 'conversions');
  put(all(`SELECT sale_date d, SUM(net_price) n FROM sales WHERE agent_id=? AND status='confirmed' AND sale_date>=? GROUP BY d`, userId, from), 'sales_value');
  const met = (d) => active.every((m) => (byDay[d]?.[m.key] || 0) >= target[m.key]);
  let days = 0, best = 0, run_ = 0;
  for (let i = 59; i >= 0; i--) { const d = addDays(today(), -i); if (met(d)) { run_++; best = Math.max(best, run_); } else run_ = 0; }
  let cursor = today(); if (!met(cursor)) cursor = addDays(cursor, -1);
  while (met(cursor) && days < 60) { days++; cursor = addDays(cursor, -1); }
  return { days, best };
}

export function points(userId, from, to) {
  const a = actuals(userId, from, to);
  return a.leads * POINTS.lead + a.followups * POINTS.followup + a.conversions * POINTS.conversion;
}

export function badgesFor(userId, daily, monthly, str) {
  const a = monthly.actual;
  const all_ = [
    { key: 'goal', icon: '🎯', name: 'Goal crusher', desc: "Hit today's goal", earned: daily.achieved },
    { key: 'streak3', icon: '🔥', name: 'On fire', desc: '3-day goal streak', earned: str.days >= 3 || str.best >= 3 },
    { key: 'streak7', icon: '⚡', name: 'Unstoppable', desc: '7-day goal streak', earned: str.best >= 7 },
    { key: 'first', icon: '🏁', name: 'First sale', desc: 'Close your first sale', earned: get("SELECT 1 FROM sales WHERE agent_id=? AND status='confirmed'", userId) != null },
    { key: 'closer', icon: '🤝', name: 'Closer', desc: '3 sales this month', earned: a.conversions >= 3 },
    { key: 'hero', icon: '📞', name: 'Follow-up hero', desc: '20 follow-ups this month', earned: a.followups >= 20 },
    { key: 'hunter', icon: '🧲', name: 'Lead hunter', desc: '30 leads this month', earned: a.leads >= 30 },
  ];
  return all_;
}

export function message(daily, opp) {
  const p = daily.overall_pct;
  const tail = opp.to_convert ? ` ${opp.to_convert} lead(s) in follow-up/interested are waiting to be converted.` : '';
  if (!daily.metrics.length) return `No daily goal is set yet — ask your sales manager.${tail}`;
  if (p >= 100) return `🏆 Goal smashed! You've hit 100% of today's goal. Keep the momentum.${tail}`;
  if (p >= 75) return `Almost there — ${100 - p}% to go today. One more push!${tail}`;
  if (p >= 40) return `Good progress — ${p}% of today's goal done. Keep following up.${tail}`;
  if (p > 0) return `You've started: ${p}% of today's goal. Call your interested leads first.${tail}`;
  return `Fresh day, fresh chances. Today's goal is at 0% — start with your follow-ups.${tail}`;
}

export const salesAgents = () => all(`SELECT u.id,u.name,u.email,u.phone FROM users u JOIN roles r ON r.id=u.role_id WHERE r.name='Sales Agent' AND u.active=1 ORDER BY u.name`);

/** Everything the agent's "My Goals" screen needs. */
export function overview(userId) {
  const daily = progress(userId, 'daily'), monthly = progress(userId, 'monthly');
  const opp = opportunities(userId), str = streak(userId);
  const m = dateRange('this_month');
  const pts = points(userId, m.from, m.to);
  return {
    daily, monthly, opportunities: opp, streak: str, points: { month: pts, today: points(userId, today(), today()) },
    badges: badgesFor(userId, daily, monthly, str), message: message(daily, opp),
    tier: tierFor(get("SELECT COUNT(*) n FROM sales WHERE agent_id=? AND status='confirmed'", userId).n),
  };
}

export function leaderboard() {
  const m = dateRange('this_month');
  const rows = salesAgents().map((a) => ({ id: a.id, name: a.name, points: points(a.id, m.from, m.to), daily_pct: progress(a.id, 'daily').overall_pct, monthly_pct: progress(a.id, 'monthly').overall_pct,
    sales: get("SELECT COUNT(*) n FROM sales WHERE agent_id=? AND status='confirmed' AND sale_date BETWEEN ? AND ?", a.id, m.from, m.to).n }));
  rows.sort((x, y) => y.points - x.points || y.monthly_pct - x.monthly_pct);
  rows.forEach((r, i) => { r.rank = i + 1; });
  return rows;
}

export function teamView() {
  const board = leaderboard();
  return board.map((b) => {
    const opp = opportunities(b.id), d = progress(b.id, 'daily'), mo = progress(b.id, 'monthly');
    return { ...b, daily: d, monthly: mo, to_convert: opp.to_convert, interested: opp.interested, follow_up: opp.follow_up, overdue_followups: opp.overdue_followups, streak: streak(b.id).days, goal_source: d.source };
  });
}

/**
 * Daily motivation. Safe to call every hour: each message is once-per-user-per-day via the dedupe key.
 *  09:00 morning goals + leads waiting · 14:00 midday nudge if under 60% · 18:00 evening result.
 */
export function runGoalReminders(force) {
  const nowStr = now(), hour = Number(nowStr.slice(11, 13)), d = today();
  let sent = 0;
  const agents = salesAgents();
  for (const a of agents) {
    const daily = progress(a.id, 'daily'), opp = opportunities(a.id);
    const bits = daily.metrics.map((m) => `${m.target.toLocaleString('en-PK')} ${m.short.toLowerCase()}`).join(', ');
    if (force || hour >= 9) {
      notify(a.id, 'goal', `Good morning ${a.name.split(' ')[0]} — today's goal`, `${bits || 'No goal set yet'}. You have ${opp.follow_up} lead(s) in follow-up and ${opp.interested} interested — convert them today!${opp.overdue_followups ? ` ${opp.overdue_followups} follow-up(s) are overdue.` : ''}`, '/goals', { dedupe: `goal-am-${d}` }); sent++;
    }
    if ((force || hour >= 14) && daily.overall_pct < 60 && daily.metrics.length) {
      notify(a.id, 'goal', `You're at ${daily.overall_pct}% of today's goal`, `${100 - daily.overall_pct}% to go. ${opp.interested} interested lead(s) are waiting for your call.`, '/goals', { dedupe: `goal-mid-${d}` }); sent++;
    }
    if ((force || hour >= 18) && daily.metrics.length) {
      notify(a.id, 'goal', daily.achieved ? '🏆 You hit today\'s goal!' : `Today's result: ${daily.overall_pct}% of goal`, daily.achieved ? `Great work — ${daily.overall_pct}% achieved. ${opp.to_convert} lead(s) still open to convert tomorrow.` : `${100 - daily.overall_pct}% short. ${opp.to_convert} lead(s) in follow-up/interested — plan your first calls for tomorrow.`, '/goals', { dedupe: `goal-pm-${d}` }); sent++;
    }
  }
  // managers: evening team summary
  if ((force || hour >= 18) && agents.length) {
    const board = teamView();
    const managers = all(`SELECT u.id FROM users u JOIN roles r ON r.id=u.role_id LEFT JOIN role_permissions p ON p.role_id=r.id AND p.module='crm' AND p.action='approve' WHERE u.active=1 AND r.portal=0 AND r.own_scope=0 AND (r.name='Super Admin' OR p.role_id IS NOT NULL)`);
    const hit = board.filter((b) => b.daily.achieved).length;
    const lag = board.filter((b) => b.daily.metrics.length && b.daily.overall_pct < 50).map((b) => b.name.split(' ')[0]);
    notify(managers.map((m) => m.id), 'goal', `Team goals today: ${hit}/${board.length} agents hit target`, `${lag.length ? `Below 50%: ${lag.join(', ')}. ` : 'Everyone is above 50%. '}Open Goals to review and coach.`, '/goals', { dedupe: `goal-team-${d}` });
    sent++;
  }
  return { sent };
}
