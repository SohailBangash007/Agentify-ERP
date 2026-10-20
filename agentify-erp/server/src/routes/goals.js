import { Router } from 'express';
import { all, get, run } from '../db.js';
import { can, hasPerm, requireStaff, requireAuth } from '../rbac.js';
import { audit, notify } from '../audit.js';
import { asyncH, bad, forbidden, int, now, curCode } from '../util.js';
import { overview, leaderboard, teamView, salesAgents, goalFor, progress, METRICS, DEFAULTS, runGoalReminders } from '../services/goals.js';
import { vapidPublicKey, saveSubscription, removeSubscription, hasSubscription, pushTo } from '../services/push.js';

const r = Router();
r.use(requireStaff);

const isAgent = (u) => u.role === 'Sales Agent' || u.own_scope;

/** One call for the Goals screen: my progress (agents), the team (managers) and the leaderboard. */
r.get('/overview', can('crm', 'view'), asyncH((req, res) => {
  const out = { metrics: METRICS.map(({ key, label, short, money }) => ({ key, label, short, money: !!money })), can_set: hasPerm(req.user, 'crm', 'approve') && !req.user.own_scope };
  if (isAgent(req.user)) out.me = overview(req.user.id);
  if (out.can_set) {
    out.team = teamView();
    out.defaults = { daily: goalFor(null, 'daily'), monthly: goalFor(null, 'monthly') };
    out.agents = salesAgents().map((a) => ({ ...a, daily: goalFor(a.id, 'daily'), monthly: goalFor(a.id, 'monthly') }));
  }
  out.leaderboard = leaderboard().slice(0, 10);
  res.json(out);
}));

/** A manager drilling into one agent. */
r.get('/agent/:id(\\d+)', can('crm', 'approve'), asyncH((req, res) => {
  if (req.user.own_scope) throw forbidden();
  const a = get("SELECT u.id,u.name FROM users u JOIN roles r ON r.id=u.role_id WHERE u.id=? AND r.name='Sales Agent'", req.params.id);
  if (!a) throw bad('Agent not found');
  res.json({ agent: a, ...overview(a.id) });
}));

/**
 * Set a goal. user_id omitted/null = the team default (applies to every agent without a personal goal).
 * Allowed for Super Admin, Admin, Sales Manager and anyone with CRM "approve".
 */
r.put('/', can('crm', 'approve'), asyncH((req, res) => {
  if (req.user.own_scope) throw forbidden('Agents cannot change goals');
  const { user_id, period } = req.body;
  if (!['daily', 'monthly'].includes(period)) throw bad('Period must be daily or monthly');
  const v = Object.fromEntries(METRICS.map((m) => [m.key, int(req.body[m.key])]));
  for (const k of Object.keys(v)) if (v[k] < 0) throw bad('Targets cannot be negative');
  if (Object.values(v).every((x) => x === 0)) throw bad('Set at least one target');
  const uid = user_id ? Number(user_id) : null;
  if (uid && !get("SELECT 1 FROM users u JOIN roles r ON r.id=u.role_id WHERE u.id=? AND r.name='Sales Agent'", uid)) throw bad('Goals can only be set for sales agents');
  const existing = uid ? get('SELECT id FROM agent_goals WHERE user_id=? AND period=?', uid, period) : get('SELECT id FROM agent_goals WHERE user_id IS NULL AND period=?', period);
  if (existing) run('UPDATE agent_goals SET leads=?,followups=?,conversions=?,sales_value=?,set_by=?,updated_at=? WHERE id=?', v.leads, v.followups, v.conversions, v.sales_value, req.user.id, now(), existing.id);
  else run('INSERT INTO agent_goals(user_id,period,leads,followups,conversions,sales_value,set_by,updated_at) VALUES(?,?,?,?,?,?,?,?)', uid, period, v.leads, v.followups, v.conversions, v.sales_value, req.user.id, now());
  const who = uid ? get('SELECT name FROM users WHERE id=?', uid).name : 'all agents';
  audit(req, 'Set sales goal', 'goal', uid, `${period} goal for ${who}: ${JSON.stringify(v)}`);
  const targets = uid ? [uid] : salesAgents().filter((a) => !get('SELECT 1 FROM agent_goals WHERE user_id=? AND period=?', a.id, period)).map((a) => a.id);
  notify(targets, 'goal', `Your ${period} goal was updated`, `${req.user.name} set: ${METRICS.filter((m) => v[m.key]).map((m) => `${m.money ? curCode() + ' ' : ''}${v[m.key].toLocaleString('en-PK')} ${m.short.toLowerCase()}`).join(', ')}`, '/goals');
  res.json({ ok: true });
}));
r.delete('/:uid(\\d+)/:period', can('crm', 'approve'), asyncH((req, res) => {
  if (req.user.own_scope) throw forbidden();
  run('DELETE FROM agent_goals WHERE user_id=? AND period=?', req.params.uid, req.params.period);
  audit(req, 'Reset sales goal to team default', 'goal', req.params.uid, req.params.period);
  res.json({ ok: true });
}));

/** A motivational message from a manager to an agent (arrives as a notification + phone push). */
r.post('/nudge', can('crm', 'approve'), asyncH((req, res) => {
  if (req.user.own_scope) throw forbidden();
  const { user_id, message } = req.body;
  if (!message?.trim()) throw bad('Write a message');
  if (!get("SELECT 1 FROM users u JOIN roles r ON r.id=u.role_id WHERE u.id=? AND r.name='Sales Agent'", user_id)) throw bad('Agent not found');
  notify(Number(user_id), 'goal', `Message from ${req.user.name}`, message.trim().slice(0, 300), '/goals');
  audit(req, 'Sent motivation message', 'goal', user_id, message.slice(0, 80));
  res.json({ ok: true });
}));
r.post('/remind-now', can('settings', 'edit'), asyncH((req, res) => res.json(runGoalReminders(true))));

// ---- Phone / browser push subscriptions (any signed-in user)
export const push = Router();
push.get('/key', requireAuth, (req, res) => res.json({ key: vapidPublicKey(), subscribed: hasSubscription(req.user.id) }));
push.post('/subscribe', requireAuth, asyncH((req, res) => {
  try { saveSubscription(req.user.id, req.body.subscription); } catch (e) { throw bad(e.message); }
  res.json({ ok: true });
}));
push.post('/unsubscribe', requireAuth, (req, res) => { removeSubscription(req.user.id, req.body.endpoint); res.json({ ok: true }); });
push.post('/test', requireAuth, (req, res) => {
  notify(req.user.id, 'system', 'Notifications are on 🎉', 'You will receive goal reminders and alerts on this device.', '/');
  res.json({ ok: true });
});

export default r;
