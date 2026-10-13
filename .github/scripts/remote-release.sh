#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${1:-/opt/agentify-erp}"
SERVICE="${2:-agentify-erp}"

cd "$APP_DIR/server"
npm install --omit=dev --no-audit --no-fund

pm2 delete "$SERVICE" >/dev/null 2>&1 || true
pm2 start src/index.js --name "$SERVICE" --time
pm2 save

PM2_USER="$(id -un)"
pm2 startup systemd -u "$PM2_USER" --hp "$HOME" >/dev/null 2>&1 || true

sleep 4
STATUS="$(pm2 jlist 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const a=JSON.parse(s);const p=a.find(x=>x.name===process.argv[1]);console.log(p?p.pm2_env.status:"missing")}catch(e){console.log("unknown")}})' "$SERVICE")"

if [ "$STATUS" != "online" ]; then
  echo "service '$SERVICE' is '$STATUS' (expected online)"
  pm2 logs "$SERVICE" --lines 60 --nostream || true
  exit 1
fi

echo "release ok: $SERVICE is online"
