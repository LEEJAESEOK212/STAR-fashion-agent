#!/usr/bin/env sh
set -eu

ENV_FILE="${1:-.env.production}"
IMPORT_FILE="$(mktemp .kakao-env.XXXXXX)"
OUTPUT_FILE="$(mktemp .production-env.XXXXXX)"

cleanup() {
  rm -f "$IMPORT_FILE" "$OUTPUT_FILE"
}
trap cleanup EXIT HUP INT TERM

umask 077
cat > "$IMPORT_FILE"

if [ "$(grep -Ec '^KAKAO_CLIENT_(ID|SECRET)=' "$IMPORT_FILE")" -ne 2 ]; then
  echo "Expected exactly KAKAO_CLIENT_ID and KAKAO_CLIENT_SECRET." >&2
  exit 1
fi

if ! grep -Eq '^KAKAO_CLIENT_ID=.+$' "$IMPORT_FILE" || \
   ! grep -Eq '^KAKAO_CLIENT_SECRET=.+$' "$IMPORT_FILE"; then
  echo "Kakao credentials must not be empty." >&2
  exit 1
fi

awk -F= '
  FNR == NR {
    values[$1] = substr($0, index($0, "=") + 1)
    next
  }
  $1 in values {
    $0 = $1 "=" values[$1]
  }
  { print }
' "$IMPORT_FILE" "$ENV_FILE" > "$OUTPUT_FILE"

chmod 600 "$OUTPUT_FILE"
mv "$OUTPUT_FILE" "$ENV_FILE"
echo "Updated Kakao credentials in $ENV_FILE."
