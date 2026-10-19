// What is actually running: package version, git commit and deployment time. Nothing here is typed in by hand:
// the deploy workflow writes server/release.json ({commit, ref, deployed_at}); in development the commit is read from
// the local git checkout. Unknown values are reported as unknown, never guessed.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const serverDir = path.resolve(here, '..', '..');
const startedAt = new Date().toISOString();
let cached = null;

function gitCommit() {
  try {
    let dir = serverDir;
    for (let i = 0; i < 4; i += 1) {
      const head = path.join(dir, '.git', 'HEAD');
      if (fs.existsSync(head)) {
        const ref = fs.readFileSync(head, 'utf8').trim();
        if (!ref.startsWith('ref: ')) return { commit: ref.slice(0, 40), ref: null };
        const name = ref.slice(5);
        const file = path.join(dir, '.git', name);
        if (fs.existsSync(file)) return { commit: fs.readFileSync(file, 'utf8').trim().slice(0, 40), ref: name.replace('refs/heads/', '') };
        const packed = path.join(dir, '.git', 'packed-refs');
        const line = fs.existsSync(packed) && fs.readFileSync(packed, 'utf8').split('\n').find((l) => l.endsWith(` ${name}`));
        return { commit: line ? line.split(' ')[0] : null, ref: name.replace('refs/heads/', '') };
      }
      dir = path.dirname(dir);
    }
  } catch { /* not a checkout */ }
  return { commit: null, ref: null };
}

export function versionInfo() {
  if (cached) return cached;
  let pkg = {};
  try { pkg = JSON.parse(fs.readFileSync(path.join(serverDir, 'package.json'), 'utf8')); } catch { pkg = {}; }
  let rel = null;
  try { rel = JSON.parse(fs.readFileSync(path.join(serverDir, 'release.json'), 'utf8')); } catch { rel = null; }
  const git = rel ? { commit: rel.commit || null, ref: rel.ref || null } : gitCommit();
  cached = { version: pkg.version || null, commit: git.commit, commit_short: git.commit ? git.commit.slice(0, 7) : null, ref: git.ref,
    deployed_at: rel?.deployed_at || null, source: rel ? 'deployment record' : git.commit ? 'local git checkout' : 'unknown', server_started_at: startedAt, node: process.version };
  return cached;
}
