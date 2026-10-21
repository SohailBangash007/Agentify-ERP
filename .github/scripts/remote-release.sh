#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${1:-/opt/agentify-erp}"
SERVICE="${2:-agentify-erp}"
NODE=/opt/node22/bin/node
NPM=/opt/node22/bin/npm

if [ ! -x "$NODE" ]; then
  echo "Node 22 not found at $NODE (bootstrap did not run?)"
  exit 1
fi

start_service() {
  cd "$APP_DIR/server"
  "$NPM" install --omit=dev --no-audit --no-fund
  pm2 delete "$SERVICE" >/dev/null 2>&1 || true
  pm2 start src/index.js --name "$SERVICE" \
    --interpreter "$NODE" --node-args "--disable-warning=ExperimentalWarning"
  pm2 save
}

healthy() {
  for _ in 1 2 3 4 5 6; do
    sleep 5
    if curl -fsS http://127.0.0.1:4000/health >/dev/null; then return 0; fi
  done
  return 1
}

start_service

if ! healthy; then
  echo "health check failed"
  pm2 logs "$SERVICE" --lines 60 --nostream || true
  if [ -d "$APP_DIR/server.prev/src" ]; then
    echo "restoring the previous release"
    rsync -a --delete --exclude node_modules --exclude data --exclude uploads --exclude .env "$APP_DIR/server.prev/" "$APP_DIR/server/"
    start_service || true
    if healthy; then echo "previous release restored and healthy"; else echo "previous release did not start either; see pm2 logs"; fi
  fi
  exit 1
fi

# start again after a reboot of the server (installs the system service once; harmless to repeat)
pm2 startup systemd -u "$(id -un)" --hp "$HOME" >/dev/null 2>&1 || true
pm2 save >/dev/null 2>&1 || true

curl -fsS http://127.0.0.1:4000/health
echo
echo "release ok: $SERVICE healthy on port 4000"
