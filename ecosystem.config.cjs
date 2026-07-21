// PM2 process config for the always-on dashboard.
// Start with:  pm2 start ecosystem.config.cjs   (run from this folder)
const path = require('path');

module.exports = {
  apps: [
    {
      name: 'marketing-dashboard',
      script: 'server/index.js',
      // cwd must be this folder so dotenv loads .env (real credentials).
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
      // Wait 3s before restarting so port 4000 fully frees (avoids EADDRINUSE loop).
      restart_delay: 3000,
      // Must stay up 5s to count as a good start; stop after 50 rapid failures.
      min_uptime: 5000,
      max_restarts: 50,
      env: { NODE_ENV: 'production', PORT: '4000' },
    },
  ],
};
