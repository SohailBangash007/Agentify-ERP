import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const dir = new URL('../../client/src/locales/', import.meta.url);
const load = (l) => JSON.parse(fs.readFileSync(new URL(`${l}.json`, dir), 'utf8'));

test('every translation has exactly the keys of the English source', () => {
  const en = Object.keys(load('en')).sort();
  for (const l of ['fr', 'ar']) assert.deepEqual(Object.keys(load(l)).sort(), en, `${l} keys differ from en`);
});
