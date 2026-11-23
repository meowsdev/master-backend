#!/usr/bin/env bash
# Runs on the EC2 server, from the repo folder, after the code is at origin/main (the CI/CD workflow does that).
# Install, apply database migrations, build, then reload the PM2 app with no downtime, and check it answers.
set -euo pipefail

cd "$(dirname "$0")/.."

# Shells opened over SSH do not load nvm by themselves.
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

echo "==> Install"
pnpm install --frozen-lockfile

echo "==> Database migrations"
pnpm exec prisma migrate deploy

echo "==> Build"
pnpm build

echo "==> Reload PM2"
pm2 startOrReload ecosystem.config.cjs --update-env
pm2 save

echo "==> Health check"
PORT="$(grep -E '^PORT=' .env | cut -d= -f2 | tr -d '\r"' || true)"
PORT="${PORT:-3000}"
for attempt in $(seq 1 20); do
  if curl -fsS "http://127.0.0.1:${PORT}/api/v1" > /dev/null; then
    echo "Backend is up on port ${PORT}."
    exit 0
  fi
  sleep 3
done
echo "Backend did not answer on port ${PORT} after the deploy." >&2
pm2 logs master-backend --lines 50 --nostream || true
exit 1
