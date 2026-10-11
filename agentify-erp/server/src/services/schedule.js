import { all } from '../db.js';
import { today, addDays } from '../util.js';

const dayDiff = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
const maxDate = (a, b) => (a > b ? a : b);
/** An activity that has passed its due date but has not been confirmed complete stops at this %. */
export const OVERDUE_CAP = 95;

/**
 * SQL: weighted % complete of a project's shared activities, derived from dates only
 * (0 before start, linear between start and due, capped at 95 until marked complete, 100 when completed).
 * Falls back to the legacy checklist for projects that never used activities.
 */
export const progressSql = (projectIdExpr) => {
  const pkt = "date('now','+5 hours')";
  const pct = `(CASE WHEN t.actual_end IS NOT NULL OR t.progress>=100 THEN 100
      WHEN ${pkt} < t.planned_start THEN 0
      WHEN ${pkt} >= t.planned_end THEN ${OVERDUE_CAP}
      ELSE (julianday(${pkt})-julianday(t.planned_start)+1)*100.0/(julianday(t.planned_end)-julianday(t.planned_start)+1) END)`;
  const dur = '(julianday(t.planned_end)-julianday(t.planned_start)+1)';
  return `COALESCE(
  (SELECT ROUND(SUM(${pct}*t.weight*${dur})/SUM(t.weight*${dur})) FROM project_tasks t
     WHERE t.project_id=${projectIdExpr} AND t.sale_id IS NULL AND NOT EXISTS(SELECT 1 FROM project_tasks c WHERE c.parent_id=t.id)),
  (SELECT ROUND(AVG(progress)) FROM dev_items WHERE project_id=${projectIdExpr}))`;
};

/**
 * Primavera-style analysis. Nobody types a percentage:
 *   planned %  = share of the activity's start→due window that has elapsed
 *   progress   = that same date-driven figure, 100 once someone marks it completed (even early),
 *                and held at 95 if it is past due but not yet confirmed — that is how a delay shows up
 *   forecast   = when it will really finish: a late predecessor pushes every successor out, an overdue
 *                activity is expected "any day now"
 * Overall % is the duration×weight average of all activities, so one slipping activity drags the whole project.
 */
export function computeSchedule(rawTasks, asOf = today()) {
  const tasks = rawTasks.map((t) => ({ ...t }));
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const hasChildren = new Set(tasks.filter((t) => t.parent_id).map((t) => t.parent_id));
  const memo = new Map();

  const done = (t) => !!t.actual_end || t.progress >= 100;

  const analyse = (t, stack = new Set()) => {
    if (memo.has(t.id)) return memo.get(t.id);
    if (stack.has(t.id)) return { start: t.planned_start, end: t.planned_end }; // dependency loop guard
    stack.add(t.id);
    const dur = Math.max(1, dayDiff(t.planned_start, t.planned_end) + 1);
    t.duration = dur;
    t.planned_pct = asOf < t.planned_start ? 0 : asOf >= t.planned_end ? 100 : Math.round(((dayDiff(t.planned_start, asOf) + 1) / dur) * 100);
    t.completed = done(t);
    t.progress = t.completed ? 100 : Math.min(t.planned_pct, OVERDUE_CAP);
    let fs, fe;
    if (t.completed) {
      fs = t.actual_start || t.planned_start; fe = t.actual_end || (asOf < t.planned_end ? asOf : t.planned_end);
    } else {
      const pred = t.predecessor_id ? byId.get(t.predecessor_id) : null;
      const predEnd = pred ? analyse(pred, stack).end : null;
      const baseStart = predEnd ? maxDate(t.planned_start, addDays(predEnd, 1)) : t.planned_start;
      if (asOf > t.planned_end) { fs = t.actual_start || t.planned_start; fe = addDays(asOf, Math.max(1, Math.ceil(dur * 0.05))); } // overdue
      else { fs = baseStart; fe = addDays(baseStart, dur - 1); }
      if (fe < t.planned_end) fe = t.planned_end;
    }
    t.forecast_start = fs; t.forecast_end = fe;
    t.forecast_delay_days = Math.max(0, dayDiff(t.planned_end, fe));
    memo.set(t.id, { start: fs, end: fe });
    stack.delete(t.id);
    return { start: fs, end: fe };
  };

  const warnings = [];
  for (const t of tasks) {
    if (hasChildren.has(t.id)) continue;
    analyse(t);
    t.is_group = false;
    if (t.completed) {
      t.status = 'completed';
      t.delay_days = t.actual_end && t.actual_end > t.planned_end ? dayDiff(t.planned_end, t.actual_end) : 0;
      if (t.delay_days) warnings.push({ task_id: t.id, type: 'finished_late', days: t.delay_days, message: `${t.name} finished ${t.delay_days} day(s) after its due date` });
    } else if (asOf > t.planned_end) {
      t.status = 'delayed'; t.delay_days = dayDiff(t.planned_end, asOf);
      warnings.push({ task_id: t.id, type: 'overdue', days: t.delay_days, message: `${t.name} is ${t.delay_days} day(s) past its due date (${t.planned_end}) and not yet completed` });
    } else if (t.forecast_delay_days > 0) {
      t.status = 'at_risk'; t.delay_days = 0;
      warnings.push({ task_id: t.id, type: 'projected_delay', days: t.forecast_delay_days, message: `${t.name} will start/finish about ${t.forecast_delay_days} day(s) late because an earlier activity is delayed (new finish ${t.forecast_end})` });
    } else if (asOf >= t.planned_start) { t.status = 'on_track'; t.delay_days = 0; }
    else { t.status = 'not_started'; t.delay_days = 0; }
  }
  // group (summary) rows roll up from their children
  const rollup = (g, kids) => {
    g.is_group = true;
    if (!kids.length) { g.progress = 0; g.status = 'not_started'; g.planned_pct = 0; g.forecast_end = g.planned_end; g.forecast_delay_days = 0; return; }
    const w = kids.reduce((a, k) => a + k.duration * k.weight, 0) || 1;
    g.planned_start = kids.map((k) => k.planned_start).sort()[0]; g.planned_end = kids.map((k) => k.planned_end).sort().reverse()[0];
    g.progress = Math.round(kids.reduce((a, k) => a + k.progress * k.duration * k.weight, 0) / w);
    g.planned_pct = Math.round(kids.reduce((a, k) => a + k.planned_pct * k.duration * k.weight, 0) / w);
    g.forecast_end = kids.map((k) => k.forecast_end).sort().reverse()[0]; g.forecast_start = kids.map((k) => k.forecast_start).sort()[0];
    g.forecast_delay_days = Math.max(0, dayDiff(g.planned_end, g.forecast_end));
    g.status = kids.every((k) => k.status === 'completed') ? 'completed' : kids.some((k) => k.status === 'delayed') ? 'delayed' : kids.some((k) => k.status === 'at_risk') ? 'at_risk' : kids.some((k) => k.progress > 0) ? 'on_track' : 'not_started';
    g.delay_days = Math.max(0, ...kids.map((k) => k.delay_days || 0));
    g.completed = g.status === 'completed';
  };
  for (const g of tasks.filter((t) => hasChildren.has(t.id))) rollup(g, tasks.filter((k) => k.parent_id === g.id && !hasChildren.has(k.id)));

  const leaves = tasks.filter((t) => !t.is_group);
  const W = leaves.reduce((a, t) => a + t.duration * t.weight, 0);
  const planned = W ? Math.round(leaves.reduce((a, t) => a + t.planned_pct * t.duration * t.weight, 0) / W) : 0;
  const actual = W ? Math.round(leaves.reduce((a, t) => a + t.progress * t.duration * t.weight, 0) / W) : 0;
  const plannedEnd = leaves.length ? leaves.map((t) => t.planned_end).sort().reverse()[0] : null;
  const forecastEnd = leaves.length ? leaves.map((t) => t.forecast_end).sort().reverse()[0] : null;
  const projectedDelay = plannedEnd ? Math.max(0, dayDiff(plannedEnd, forecastEnd)) : 0;
  const delayed = leaves.filter((t) => t.status === 'delayed').length;
  const spi = planned > 0 ? Math.round((actual / planned) * 100) : (actual > 0 ? 100 : null);
  const summary = {
    as_of: asOf, tasks: leaves.length, completed: leaves.filter((t) => t.status === 'completed').length,
    in_progress: leaves.filter((t) => t.status === 'on_track').length, delayed, not_started: leaves.filter((t) => ['not_started', 'at_risk'].includes(t.status)).length,
    planned_pct: planned, actual_pct: actual, performance_pct: spi,
    planned_start: leaves.length ? leaves.map((t) => t.planned_start).sort()[0] : null, planned_end: plannedEnd, forecast_end: forecastEnd, projected_delay_days: projectedDelay,
    health: !leaves.length ? 'none' : projectedDelay > 0 || delayed > 0 ? (projectedDelay > 14 || delayed > 1 ? 'delayed' : 'at_risk') : 'on_track',
  };
  return { tasks, summary, warnings: warnings.sort((a, b) => b.days - a.days) };
}

/**
 * Load and analyse one project's schedule.
 * scope: 'project' = shared tasks (no contract), number = one customer's contract, undefined = everything.
 */
export function scheduleFor(projectId, { scope, clientOnly, asOf } = {}) {
  const where = ['project_id=?']; const params = [projectId];
  if (scope === 'project') where.push('sale_id IS NULL'); else if (scope) { where.push('sale_id=?'); params.push(Number(scope)); }
  if (clientOnly) where.push('client_visible=1');
  const rows = all(`SELECT * FROM project_tasks WHERE ${where.join(' AND ')} ORDER BY sort_order, planned_start, id`, ...params);
  return computeSchedule(rows, asOf);
}
