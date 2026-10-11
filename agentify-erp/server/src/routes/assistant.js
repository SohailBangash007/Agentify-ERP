import { Router } from 'express';
import { all, run } from '../db.js';
import { can, requireStaff } from '../rbac.js';
import { audit } from '../audit.js';
import { ask } from '../services/assistant.js';
import { sendPdf } from '../services/pdf.js';
import { asyncH, bad, now } from '../util.js';

const r = Router();
r.use(requireStaff);

const plain = (s) => String(s).replace(/\*\*/g, '');

r.post('/ask', asyncH((req, res) => {
  const q = String(req.body.question || '').slice(0, 500);
  if (!q.trim()) throw bad('Ask a question');
  const out = ask(q, req.user);
  run('INSERT INTO chat_log(user_id,question,intent,ok,created_at) VALUES(?,?,?,?,?)', req.user.id, q, out.intent, out.intent === 'unknown' ? 0 : 1, now());
  res.json(out);
}));

/** The answer re-computed server-side (never trusting client-supplied data) and rendered as a PDF report. */
r.post('/pdf', asyncH((req, res) => {
  const q = String(req.body.question || '').slice(0, 500);
  if (!q.trim()) throw bad('Ask a question');
  const out = ask(q, req.user);
  if (out.intent === 'denied') throw bad(plain(out.answer));
  audit(req, 'Assistant PDF report', 'assistant', null, q.slice(0, 120));
  const sections = [{ heading: 'Answer', text: plain(out.answer) }, ...out.tables.map((t) => ({ heading: t.title, columns: t.columns, rows: t.rows, totals: t.totals }))];
  sendPdf(res, `report-${out.intent}`, { title: 'ASSISTANT REPORT', subtitle: `Question: ${q}\nRequested by ${req.user.name}`, sections });
}));

/** Unanswered questions — shows administrators where the assistant needs new intents. */
r.get('/log', can('settings', 'view'), (req, res) => {
  res.json({
    unanswered: all('SELECT question, COUNT(*) n, MAX(created_at) last FROM chat_log WHERE ok=0 GROUP BY question ORDER BY n DESC, last DESC LIMIT 50'),
    popular: all('SELECT intent, COUNT(*) n FROM chat_log GROUP BY intent ORDER BY n DESC LIMIT 12'),
  });
});

export default r;
