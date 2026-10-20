#!/usr/bin/env sh
set -eu

DOMAIN="${1:?Usage: $0 <tailscale-domain> [api-env-import]}"
IMPORT_FILE="${2:-}"
OUTPUT_FILE=".env.production"

if [ -e "$OUTPUT_FILE" ]; then
  echo "$OUTPUT_FILE already exists; refusing to overwrite production secrets." >&2
  exit 1
fi

read_value() {
  if [ -n "$IMPORT_FILE" ] && [ -f "$IMPORT_FILE" ]; then
    sed -n "s/^$1=//p" "$IMPORT_FILE" | tail -n 1
  fi
}

POSTGRES_PASSWORD="$(openssl rand -hex 32)"
JWT_SECRET_KEY="$(openssl rand -hex 64)"
KAKAO_CLIENT_ID="$(read_value KAKAO_CLIENT_ID)"
KAKAO_CLIENT_SECRET="$(read_value KAKAO_CLIENT_SECRET)"

umask 077
{
  printf 'DOMAIN=%s\n' "$DOMAIN"
  printf 'CLOUDFLARE_TUNNEL_TOKEN=\n'
  printf 'POSTGRES_PASSWORD=%s\n' "$POSTGRES_PASSWORD"
  printf 'DATABASE_URL=postgresql+asyncpg://brown_chat:%s@postgres:5432/brown_chat\n' "$POSTGRES_PASSWORD"
  printf 'JWT_SECRET_KEY=%s\n' "$JWT_SECRET_KEY"
  printf 'ACCESS_TOKEN_EXPIRE_MINUTES=480\n'
  printf 'KAKAO_CLIENT_ID=%s\n' "$KAKAO_CLIENT_ID"
  printf 'KAKAO_CLIENT_SECRET=%s\n' "$KAKAO_CLIENT_SECRET"
  printf 'CHAT_API_BASE_URL=http://host.docker.internal:7510\n'
  printf 'CHAT_API_KEY=\n'
  printf 'CHAT_API_MODEL=google/gemma-4-26B-A4B-it\n'
  printf 'CHAT_API_TIMEOUT_SECONDS=180\n'
  printf 'CHAT_API_TEMPERATURE=0.7\n'
  printf 'CHAT_CONTEXT_MESSAGE_LIMIT=3\n'
  printf 'CHAT_SYSTEM_PROMPT=당신은 Brown-Chat의 친절하고 사려 깊은 AI 어시스턴트입니다. 사용자가 다른 언어로 답해 달라고 명시적으로 요청하지 않는 한, 모든 답변은 자연스러운 한국어로만 작성하세요. 답변은 GitHub Flavored Markdown으로 작성하고 제목, 목록, 표, 인용문, 인라인 코드와 코드 블록은 내용을 더 명확하게 만들 때만 사용하세요.\n'
  printf 'WEB_CONCURRENCY=2\n'
} > "$OUTPUT_FILE"

if [ -n "$IMPORT_FILE" ]; then
  rm -f "$IMPORT_FILE"
fi
chmod 600 "$OUTPUT_FILE"
echo "Created $OUTPUT_FILE for $DOMAIN."
