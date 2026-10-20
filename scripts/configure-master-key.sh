#!/usr/bin/env sh
set -eu

ENV_FILE="${1:-.env.production}"

if [ ! -f "$ENV_FILE" ]; then
  echo "Missing $ENV_FILE." >&2
  exit 1
fi

if [ -t 0 ]; then
  printf "Master access key: " >&2
  stty -echo
  IFS= read -r MASTER_ACCESS_KEY
  stty echo
  printf "\n" >&2
else
  IFS= read -r MASTER_ACCESS_KEY
fi

# PowerShell pipelines can append a CRLF line ending. `read` removes LF but keeps CR.
MASTER_ACCESS_KEY="$(printf %s "$MASTER_ACCESS_KEY" | tr -d '\r')"

if [ "${#MASTER_ACCESS_KEY}" -lt 12 ]; then
  echo "Master access key must be at least 12 characters." >&2
  exit 1
fi

MASTER_ACCESS_KEY_HASH="$(printf %s "$MASTER_ACCESS_KEY" | sha256sum | awk '{print $1}')"
unset MASTER_ACCESS_KEY

TEMP_FILE="$(mktemp "${ENV_FILE}.master-key.XXXXXX")"
trap 'rm -f "$TEMP_FILE"' EXIT HUP INT TERM

awk -v hash="$MASTER_ACCESS_KEY_HASH" '
  BEGIN { replaced = 0 }
  /^MASTER_ACCESS_KEY_HASH=/ {
    print "MASTER_ACCESS_KEY_HASH=" hash
    replaced = 1
    next
  }
  { print }
  END {
    if (!replaced) print "MASTER_ACCESS_KEY_HASH=" hash
  }
' "$ENV_FILE" > "$TEMP_FILE"

chmod --reference="$ENV_FILE" "$TEMP_FILE"
mv "$TEMP_FILE" "$ENV_FILE"
trap - EXIT HUP INT TERM
echo "Master access key hash configured in $ENV_FILE."
