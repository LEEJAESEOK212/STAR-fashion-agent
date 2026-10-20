#!/usr/bin/env sh
set -eu

ENV_FILE="${1:-.env.production}"

if [ ! -f "$ENV_FILE" ]; then
  echo "Missing $ENV_FILE. Copy .env.production.example and fill in the production values." >&2
  exit 1
fi

if ! command -v tailscale >/dev/null 2>&1; then
  echo "Tailscale is not installed on this server." >&2
  exit 1
fi

if ! tailscale status >/dev/null 2>&1; then
  echo "Tailscale is not connected. Run 'sudo tailscale up' first." >&2
  exit 1
fi

docker compose \
  --env-file "$ENV_FILE" \
  -f compose.production.yml \
  -f compose.tailscale.yml \
  config --quiet

docker compose \
  --env-file "$ENV_FILE" \
  -f compose.production.yml \
  -f compose.tailscale.yml \
  build --pull api web

docker compose \
  --env-file "$ENV_FILE" \
  -f compose.production.yml \
  -f compose.tailscale.yml \
  up -d --remove-orphans

if ! tailscale funnel --bg http://127.0.0.1:8081; then
  echo "Warning: containers are deployed, but Funnel could not be changed without operator permission." >&2
  echo "Run once: sudo tailscale set --operator=\"$USER\"" >&2
fi

docker compose \
  --env-file "$ENV_FILE" \
  -f compose.production.yml \
  -f compose.tailscale.yml \
  ps

tailscale funnel status
