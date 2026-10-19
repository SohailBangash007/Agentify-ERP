// Announcements and release notes inside a workspace (written by platform staff, targeted by product, plan, workspace and role).
import { Router } from 'express';
import { asyncH } from '../util.js';
import { requireStaff } from '../rbac.js';
import { forUser, markRead } from '../services/announcements.js';
import { versionInfo } from '../services/version.js';

const r = Router();
r.use(requireStaff);
r.get('/', (req, res) => res.json({ items: forUser(req.tenant, req.user), version: { version: versionInfo().version, commit: versionInfo().commit_short, deployed_at: versionInfo().deployed_at } }));
r.post('/:id/read', asyncH((req, res) => res.json(markRead(req.tenant, req.user, req.params.id))));
export default r;
