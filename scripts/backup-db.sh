#!/usr/bin/env sh
set -eu

ENV_FILE="${1:-.env.production}"
COMPOSE_FILE="compose.production.yml"
BACKUP_DIR="${BACKUP_DIR:-backups}"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"

mkdir -p "$BACKUP_DIR"
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T postgres \
  pg_dump -U brown_chat -d brown_chat | gzip > "$BACKUP_DIR/brown-chat-$TIMESTAMP.sql.gz"

echo "Saved $BACKUP_DIR/brown-chat-$TIMESTAMP.sql.gz"
