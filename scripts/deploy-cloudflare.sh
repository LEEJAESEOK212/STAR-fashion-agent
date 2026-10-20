#!/usr/bin/env sh
set -eu

ENV_FILE="${1:-.env.production}"

if [ ! -f "$ENV_FILE" ]; then
  echo "Missing $ENV_FILE. Copy .env.production.example and fill in the production values." >&2
  exit 1
fi

docker compose \
  --env-file "$ENV_FILE" \
  -f compose.production.yml \
  -f compose.cloudflare.yml \
  config --quiet

docker compose \
  --env-file "$ENV_FILE" \
  -f compose.production.yml \
  -f compose.cloudflare.yml \
  build --pull api web

docker compose \
  --env-file "$ENV_FILE" \
  -f compose.production.yml \
  -f compose.cloudflare.yml \
  up -d --remove-orphans

docker compose \
  --env-file "$ENV_FILE" \
  -f compose.production.yml \
  -f compose.cloudflare.yml \
  ps
