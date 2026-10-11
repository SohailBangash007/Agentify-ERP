// Loads server/.env (if present) before anything reads process.env. Real environment variables win over the file.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

try { process.loadEnvFile(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.env')); } catch { /* no .env file — use the environment as is */ }
