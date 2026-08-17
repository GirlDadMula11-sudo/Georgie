#!/bin/zsh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="$ROOT/.env"
if [[ ! -f "$ENV_FILE" ]]; then echo "Missing $ENV_FILE"; exit 1; fi
set -a
source "$ENV_FILE"
set +a
BASE="${GEORGIE_SERVER_URL%/}"
DEVICE="${GEORGIE_MAC_DEVICE_ID:-primary-mac}"
TOKEN="${GEORGIE_MAC_AGENT_TOKEN:-}"
if [[ -z "$BASE" || -z "$TOKEN" ]]; then echo "Georgie server URL or pairing token is missing."; exit 1; fi
RESPONSE="$(curl -fsS -X POST "$BASE/api/mac/$DEVICE/test" -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' --data '{"message":"Georgie is connected to this Mac."}')"
JOB_ID="$(printf '%s' "$RESPONSE" | /usr/bin/python3 -c 'import json,sys; print(json.load(sys.stdin).get("jobId", ""))')"
if [[ -z "$JOB_ID" ]]; then echo "Could not queue test: $RESPONSE"; exit 1; fi
echo "Georgie test queued. Waiting for Mac round-trip..."
for i in {1..12}; do
  sleep 2
  STATUS="$(curl -fsS "$BASE/api/mac/$DEVICE/jobs/$JOB_ID/status" -H "Authorization: Bearer $TOKEN")"
  STATE="$(printf '%s' "$STATUS" | /usr/bin/python3 -c 'import json,sys; d=json.load(sys.stdin); print((d.get("job") or {}).get("status", "unknown"))')"
  if [[ "$STATE" == "completed" ]]; then echo "SUCCESS: Georgie completed the round-trip Mac test."; exit 0; fi
  if [[ "$STATE" == "failed" ]]; then echo "FAILED: $STATUS"; exit 1; fi
done
echo "Test was queued but did not complete within 24 seconds. Check ~/Library/Logs/georgie-mac-agent.log"
exit 2
