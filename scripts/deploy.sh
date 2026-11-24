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

# Always regenerate the Prisma client from the schema just pulled. `pnpm install` skips its work (and the postinstall
# `prisma generate`) when the lockfile has not changed, which left the server building against an old client.
echo "==> Prisma client"
pnpm exec prisma generate

echo "==> Build"
pnpm build

echo "==> Reload PM2"
# PM2 keeps an app's original script on reload. If master-backend was started some other way (e.g. `npm start`), reloading
# would mix that script with this file's arguments; start it fresh from ecosystem.config.cjs instead (a few seconds down).
expected="$(readlink -f "$(pwd)/dist/main.js")"
current="$(pm2 jlist 2>/dev/null | node -e '
  let raw = ""; process.stdin.on("data", (c) => (raw += c)).on("end", () => {
    try { const app = JSON.parse(raw).find((p) => p.name === process.argv[1]); process.stdout.write(app ? app.pm2_env.pm_exec_path : ""); }
    catch { process.stdout.write(""); }
  });' "master-backend")"
# Compare real paths: with pnpm, node_modules/next is a symlink.
if [ -n "$current" ] && [ "$(readlink -f "$current")" != "$expected" ]; then
  echo "master-backend runs $current, not $expected: starting it fresh."
  pm2 delete master-backend
  pm2 start ecosystem.config.cjs --update-env
else
  pm2 startOrReload ecosystem.config.cjs --update-env
fi
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
