const path = require('node:path');
const root = __dirname;
require(path.join(root, 'backend', 'node_modules', 'dotenv')).config({
  path: path.join(root, '.env.production')
});

module.exports = {
  apps: [
    {
      name: 'pixx-task-manager-api',
      cwd: path.join(root, 'backend'),
      script: 'src/server.js',
      instances: 'max',
      exec_mode: 'cluster',
      autorestart: true,
      max_restarts: 10,
      min_uptime: '10s',
      max_memory_restart: '500M',
      merge_logs: true,
      out_file: path.join(root, 'logs', 'backend-out.log'),
      error_file: path.join(root, 'logs', 'backend-error.log'),
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      env_production: {
        NODE_ENV: 'production'
      }
    }
  ]
};
