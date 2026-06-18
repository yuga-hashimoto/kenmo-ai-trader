import * as fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

/**
 * Load the monorepo-root `.env` into process.env before anything else runs.
 *
 * The app is started by process managers (pm2) and tsx with a working directory
 * that is not guaranteed to be the repo root, so we cannot rely on the shell or
 * Prisma's cwd-based dotenv. We walk up from this file until we find a `.env` and
 * load any keys that are not already set (real environment variables win).
 *
 * Imported first in main.ts so DATABASE_URL etc. exist before @kenmo/db loads.
 */
function loadRootEnv(): void {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i++) {
    const candidate = join(dir, '.env');
    if (fs.existsSync(candidate)) {
      applyEnvFile(candidate);
      return;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
}

function applyEnvFile(path: string): void {
  const text = fs.readFileSync(path, 'utf-8');
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    if (!key || key in process.env) continue;
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

loadRootEnv();
