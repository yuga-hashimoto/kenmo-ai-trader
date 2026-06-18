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
  // Run the real binaries directly (NOT via `pnpm run`). A pnpm wrapper does not
  // forward pm2's stop/restart signals to its tsx/next grandchild, which orphans
  // the process on the port and breaks restarts. The API loads the root .env
  // itself (apps/api/src/loadEnv.ts), so a non-root cwd is fine.
  apps: [
    {
      name: 'kenmo-api',
      cwd: path.join(root, 'apps/api'),
      script: path.join(root, 'node_modules/.bin/tsx'),
      args: 'src/main.ts',
      interpreter: 'none',
      env: { NODE_ENV: 'production' },
      autorestart: true,
      max_restarts: 20,
      restart_delay: 3000,
      max_memory_restart: '2G',
      kill_timeout: 5000,
    },
    {
      name: 'kenmo-web',
      cwd: path.join(root, 'apps/web'),
      script: path.join(root, 'apps/web/node_modules/.bin/next'),
      args: 'dev -p 3000',
      interpreter: 'none',
      env: { NODE_ENV: 'development' },
      autorestart: true,
      max_restarts: 20,
      restart_delay: 3000,
      max_memory_restart: '2G',
      kill_timeout: 5000,
    },
  ],
};
