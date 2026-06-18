/**
 * PM2 process definitions for always-on operation of the kenmo-ai-trader stack.
 *
 *   pm2 start ecosystem.config.cjs   # start API + Web
 *   pm2 save                         # persist across reboots (after `pm2 startup`)
 *   pm2 logs                         # tail logs
 *
 * Secrets (DATABASE_URL, AI_API_KEY, …) are NOT stored here — they load from the
 * project .env (gitignored) via the app's dotenv path. This file only sets the
 * non-secret bits needed to launch each process.
 */
const path = require('path');
const root = __dirname;

module.exports = {
  // Run from the repo root so the root .env (DATABASE_URL, AI_API_KEY,
  // ENABLE_REALTIME_SCHEDULER, …) loads exactly like `pnpm dev`.
  apps: [
    {
      name: 'kenmo-api',
      cwd: root,
      script: 'pnpm',
      args: '--filter @kenmo/api start',
      interpreter: 'none',
      env: { NODE_ENV: 'production' },
      autorestart: true,
      max_restarts: 20,
      restart_delay: 3000,
      max_memory_restart: '1G',
    },
    {
      name: 'kenmo-web',
      cwd: root,
      script: 'pnpm',
      args: '--filter @kenmo/web dev',
      interpreter: 'none',
      env: { NODE_ENV: 'development' },
      autorestart: true,
      max_restarts: 20,
      restart_delay: 3000,
      max_memory_restart: '1G',
    },
  ],
};
