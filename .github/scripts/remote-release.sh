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

cd "$APP_DIR/server"
"$NPM" install --omit=dev --no-audit --no-fund

pm2 delete "$SERVICE" >/dev/null 2>&1 || true
pm2 start src/index.js --name "$SERVICE" \
  --interpreter "$NODE" --node-args "--disable-warning=ExperimentalWarning"
pm2 save

sleep 5
if ! curl -fsS http://127.0.0.1:4000/health; then
  echo "health check failed"
  pm2 logs "$SERVICE" --lines 60 --nostream || true
  exit 1
fi

echo
echo "release ok: $SERVICE healthy on port 4000"
