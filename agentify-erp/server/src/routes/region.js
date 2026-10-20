// Region-specific data for the current workspace: extra typed fields on contacts/properties and identity numbers.
import { Router } from 'express';
import { asyncH, bad, notFound, forbidden } from '../util.js';
import { can, hasPerm } from '../rbac.js';
import { get } from '../db.js';
import { getExt, saveExt, entityExists } from '../regions/extFields.js';
import { saveIdentity, maskedIdentity, revealIdentity } from '../regions/identity.js';
import { currentRegion } from '../regions/runtime.js';

const r = Router();
const ENTITY = { contact: 'crm', property: 'properties' };

function guardEntity(req, mode) {
  const entity = req.params.entity, id = Number(req.params.id);
  const mod = ENTITY[entity];
  if (!mod) throw bad('Unknown entity');
  if (!hasPerm(req.user, mod, mode === 'write' ? 'edit' : 'view')) throw forbidden('You do not have permission for this');
  if (!entityExists(entity, id)) throw notFound('Not found');
  if (entity === 'contact' && req.user.own_scope && get('SELECT agent_id FROM contacts WHERE id=?', id)?.agent_id !== req.user.id) throw forbidden('This contact is not assigned to you');
  return { entity, id };
}

r.get('/ext/:entity/:id', asyncH((req, res) => { const { entity, id } = guardEntity(req, 'read'); res.json(getExt(entity, id)); }));
r.put('/ext/:entity/:id', asyncH((req, res) => { const { entity, id } = guardEntity(req, 'write'); res.json(saveExt(req, entity, id, req.body?.values || {})); }));

// identity numbers: encrypted at rest, masked in the app; only an administrator can reveal one and every reveal is audited
const idGuard = (req, mode) => {
  req.params.entity = 'contact';
  return guardEntity(req, mode).id;
};
r.get('/identity/:id', asyncH((req, res) => {
  const id = idGuard(req, 'read');
  res.json({ label: currentRegion().config.identity?.national_id?.label || 'ID number', stored: maskedIdentity(id) });
}));
r.put('/identity/:id', asyncH((req, res) => { const id = idGuard(req, 'write'); res.json(saveIdentity(req, id, req.body?.number)); }));
r.post('/identity/:id/reveal', asyncH((req, res) => {
  const id = idGuard(req, 'read');
  if (!req.user.isSuper) throw forbidden('Only an administrator can view the full number');
  const number = revealIdentity(req, id);
  if (number === null) throw notFound('No number stored');
  res.json({ number });
}));
export default r;
