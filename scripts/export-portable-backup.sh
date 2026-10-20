#!/usr/bin/env sh
set -eu

ENV_FILE="${1:-.env.production}"
COMPOSE_PROJECT="${COMPOSE_PROJECT_NAME:-brown-chat}"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
OUTPUT_ROOT="${BACKUP_DIR:-backups}"
OUTPUT_DIR="$OUTPUT_ROOT/portable-$TIMESTAMP"

if [ ! -f "$ENV_FILE" ]; then
  echo "Missing $ENV_FILE" >&2
  exit 1
fi

mkdir -p "$OUTPUT_DIR"
OUTPUT_DIR_ABS="$(cd "$OUTPUT_DIR" && pwd)"

compose() {
  docker compose \
    --env-file "$ENV_FILE" \
    -f compose.production.yml \
    "$@"
}

find_volume() {
  logical_name="$1"
  docker volume ls \
    --filter "label=com.docker.compose.project=$COMPOSE_PROJECT" \
    --filter "label=com.docker.compose.volume=$logical_name" \
    --format '{{.Name}}' | head -n 1
}

backup_volume() {
  logical_name="$1"
  output_name="$2"
  volume_name="$(find_volume "$logical_name")"

  if [ -z "$volume_name" ]; then
    echo "Could not find Docker volume for $logical_name in project $COMPOSE_PROJECT" >&2
    exit 1
  fi

  echo "$logical_name=$volume_name" >> "$OUTPUT_DIR/manifest.txt"
  docker run --rm \
    -v "$volume_name:/source:ro" \
    -v "$OUTPUT_DIR_ABS:/backup" \
    alpine:3.20 \
    sh -c "cd /source && tar -czf /backup/$output_name ."
}

echo "created_at=$(date -Is)" > "$OUTPUT_DIR/manifest.txt"
echo "compose_project=$COMPOSE_PROJECT" >> "$OUTPUT_DIR/manifest.txt"
if git rev-parse HEAD >/dev/null 2>&1; then
  echo "git_commit=$(git rev-parse HEAD)" >> "$OUTPUT_DIR/manifest.txt"
else
  echo "git_commit=unavailable" >> "$OUTPUT_DIR/manifest.txt"
fi

compose ps > "$OUTPUT_DIR/compose-ps.txt"
docker image ls --digests > "$OUTPUT_DIR/docker-images.txt"

compose exec -T postgres \
  pg_dump -U brown_chat -d brown_chat | gzip > "$OUTPUT_DIR/postgres.sql.gz"

backup_volume brown_chat_qdrant_data qdrant-volume.tar.gz
backup_volume brown_chat_uploads uploads-volume.tar.gz

(
  cd "$OUTPUT_DIR"
  sha256sum \
    postgres.sql.gz \
    qdrant-volume.tar.gz \
    uploads-volume.tar.gz \
    manifest.txt \
    compose-ps.txt \
    docker-images.txt > SHA256SUMS
)

echo "Portable backup created at $OUTPUT_DIR"
echo "Copy this directory to two encrypted locations and verify SHA256SUMS."
