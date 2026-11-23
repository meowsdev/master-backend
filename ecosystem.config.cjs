// PM2 process of the API on the EC2 server (scripts/deploy.sh starts or reloads it). Settings come from .env.
module.exports = {
  apps: [
    {
      name: 'master-backend',
      cwd: __dirname,
      script: 'dist/main.js',
      env: { NODE_ENV: 'production' },
      instances: 1,
      autorestart: true,
      max_memory_restart: '700M',
      time: true,
    },
  ],
};
