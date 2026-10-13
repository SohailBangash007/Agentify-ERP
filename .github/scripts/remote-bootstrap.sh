#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${1:-/opt/agentify-erp}"
SERVICE="${2:-agentify-erp}"

export DEBIAN_FRONTEND=noninteractive

have() { command -v "$1" >/dev/null 2>&1; }

if ! have curl || ! have rsync || ! have git; then
  apt-get update -y -qq
  apt-get install -y -qq curl rsync git ca-certificates
fi

install_node=0
if ! have node; then
  install_node=1
else
  NODE_MAJOR="$(node -v | sed 's/^v//' | cut -d. -f1)"
  if [ "${NODE_MAJOR:-0}" -lt 22 ]; then
    install_node=1
  fi
fi

if [ "$install_node" = "1" ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y -qq nodejs
fi

if ! have pm2; then
  npm install -g pm2
fi

mkdir -p "$APP_DIR/server" "$APP_DIR/client"

if [ ! -f "$APP_DIR/server/.env" ]; then
  : "${JWT_SECRET:?JWT_SECRET is required to create server/.env}"
  {
    echo "PORT=4000"
    echo "NODE_ENV=production"
    echo "ERP_BASE_DOMAIN=${ERP_BASE_DOMAIN:-}"
    echo "JWT_SECRET=${JWT_SECRET}"
    echo "ERP_SECRETS_KEY=${ERP_SECRETS_KEY:-}"
    if [ -n "${PLATFORM_ADMIN_EMAIL:-}" ]; then
      echo "PLATFORM_ADMIN_EMAIL=${PLATFORM_ADMIN_EMAIL}"
    fi
    if [ -n "${PLATFORM_ADMIN_PASSWORD:-}" ]; then
      echo "PLATFORM_ADMIN_PASSWORD=${PLATFORM_ADMIN_PASSWORD}"
    fi
  } > "$APP_DIR/server/.env"
  chmod 600 "$APP_DIR/server/.env"
  echo "created $APP_DIR/server/.env"
else
  echo "keeping existing $APP_DIR/server/.env"
fi

echo "bootstrap ok: node $(node -v), npm $(npm -v), pm2 $(pm2 -v)"
