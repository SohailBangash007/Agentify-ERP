// Wipes the database and re-seeds base configuration + clearly-flagged demo data.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const dataDir = process.env.ERP_DATA_DIR || path.join(here, '..', 'data');
for (const f of ['erp.db', 'erp.db-wal', 'erp.db-shm']) fs.rmSync(path.join(dataDir, f), { force: true });

const { ensureBootstrapped } = await import('./seed.js');
ensureBootstrapped();
const { DEMO_PASSWORD } = await import('./seed.js');
console.log(`Database seeded. Demo password for all demo users: ${DEMO_PASSWORD}`);
