#!/bin/zsh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

say_step() { printf '\n[Georgie] %s\n' "$1"; }

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 20+ is required before installing the Georgie Mac Agent."
  echo "Install Node.js, then run the Georgie bootstrap command again."
  exit 1
fi

NODE="$(command -v node)"
NODE_VERSION="$($NODE -p 'process.versions.node')"
NODE_MAJOR="${NODE_VERSION%%.*}"
if (( NODE_MAJOR < 20 )); then
  echo "Georgie requires Node.js 20 or newer. Current version: $NODE_VERSION"
  exit 1
fi

ENV_FILE="$ROOT/.env"
PLIST="$HOME/Library/LaunchAgents/com.georgie.mac-agent.plist"
LOG_DIR="$HOME/Library/Logs"

existing_value() {
  local key="$1"
  [[ -f "$ENV_FILE" ]] || return 0
  grep -E "^${key}=" "$ENV_FILE" | tail -1 | cut -d= -f2-
}

SERVER_URL="${GEORGIE_SERVER_URL:-$(existing_value GEORGIE_SERVER_URL)}"
TOKEN="${GEORGIE_MAC_AGENT_TOKEN:-$(existing_value GEORGIE_MAC_AGENT_TOKEN)}"
DEVICE_ID="${GEORGIE_MAC_DEVICE_ID:-$(existing_value GEORGIE_MAC_DEVICE_ID)}"
POLL_MS="${GEORGIE_MAC_POLL_MS:-$(existing_value GEORGIE_MAC_POLL_MS)}"

if [[ -z "$SERVER_URL" ]]; then
  printf "Georgie server URL (must start with https://): "
  read -r SERVER_URL
fi
if [[ "$SERVER_URL" != https://* ]]; then
  echo "GEORGIE_SERVER_URL must use https://"
  exit 1
fi

if [[ -z "$TOKEN" ]]; then
  printf "Mac pairing token: "
  read -rs TOKEN
  printf '\n'
fi
if (( ${#TOKEN} < 32 )); then
  echo "The pairing token must be at least 32 characters."
  exit 1
fi

if [[ -z "$DEVICE_ID" ]]; then
  DEVICE_ID="primary-mac"
fi
if [[ -z "$POLL_MS" ]]; then
  POLL_MS="2000"
fi

say_step "Saving Mac-only configuration..."
umask 077
TMP_ENV="$(mktemp)"
if [[ -f "$ENV_FILE" ]]; then
  grep -Ev '^(GEORGIE_SERVER_URL|GEORGIE_MAC_AGENT_TOKEN|GEORGIE_MAC_DEVICE_ID|GEORGIE_MAC_POLL_MS)=' "$ENV_FILE" > "$TMP_ENV" || true
fi
{
  cat "$TMP_ENV"
  printf 'GEORGIE_SERVER_URL=%s\n' "$SERVER_URL"
  printf 'GEORGIE_MAC_AGENT_TOKEN=%s\n' "$TOKEN"
  printf 'GEORGIE_MAC_DEVICE_ID=%s\n' "$DEVICE_ID"
  printf 'GEORGIE_MAC_POLL_MS=%s\n' "$POLL_MS"
} > "$ENV_FILE"
rm -f "$TMP_ENV"
chmod 600 "$ENV_FILE"

say_step "Installing Georgie dependencies..."
npm install --omit=dev

mkdir -p "$HOME/Library/LaunchAgents" "$LOG_DIR"

cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.georgie.mac-agent</string>
  <key>ProgramArguments</key>
  <array><string>$NODE</string><string>$ROOT/mac-agent/agent.js</string></array>
  <key>WorkingDirectory</key><string>$ROOT</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ProcessType</key><string>Background</string>
  <key>StandardOutPath</key><string>$LOG_DIR/georgie-mac-agent.log</string>
  <key>StandardErrorPath</key><string>$LOG_DIR/georgie-mac-agent-error.log</string>
</dict>
</plist>
PLIST

plutil -lint "$PLIST"
GUI_DOMAIN="gui/$(id -u)"
SERVICE_TARGET="$GUI_DOMAIN/com.georgie.mac-agent"

say_step "Registering Georgie with the current Mac user session..."
# A previous installer or interrupted launchctl operation can leave the label
# registered after the process has stopped. Clear both label and plist forms,
# then wait briefly for launchd to finish removing the old registration.
launchctl bootout "$SERVICE_TARGET" >/dev/null 2>&1 || true
launchctl bootout "$GUI_DOMAIN" "$PLIST" >/dev/null 2>&1 || true
for _attempt in {1..20}; do
  if ! launchctl print "$SERVICE_TARGET" >/dev/null 2>&1; then
    break
  fi
  sleep 0.1
done

BOOTSTRAP_ERROR="$(mktemp)"
if ! launchctl bootstrap "$GUI_DOMAIN" "$PLIST" 2>"$BOOTSTRAP_ERROR"; then
  # launchctl can report an error after accepting a registration. Trust a
  # direct read-back of the exact service over the command's exit text.
  if launchctl print "$SERVICE_TARGET" >/dev/null 2>&1; then
    echo "Georgie's LaunchAgent was already registered; continuing with verified service state."
  else
    echo "Georgie's LaunchAgent could not be registered in $GUI_DOMAIN."
    cat "$BOOTSTRAP_ERROR"
    echo "Do not run this installer with sudo. Diagnostic logs:"
    echo "  $LOG_DIR/georgie-mac-agent.log"
    echo "  $LOG_DIR/georgie-mac-agent-error.log"
    rm -f "$BOOTSTRAP_ERROR"
    exit 1
  fi
fi
rm -f "$BOOTSTRAP_ERROR"
launchctl enable "$SERVICE_TARGET"
launchctl kickstart -k "$SERVICE_TARGET" >/dev/null 2>&1 || true

say_step "Checking Georgie..."
sleep 2
if launchctl print "$SERVICE_TARGET" >/dev/null 2>&1; then
  echo "Georgie Mac Agent is installed and running."
else
  echo "The LaunchAgent was installed but did not report as running yet."
fi

echo
printf '%s\n' "NEXT: macOS must approve Georgie's local permissions." \
  "1. System Settings > Privacy & Security > Accessibility" \
  "2. Allow the Terminal app / Node runtime used to launch Georgie" \
  "3. System Settings > Privacy & Security > Screen Recording" \
  "4. Allow the Terminal app / Node runtime used to launch Georgie" \
  "5. Safari: Develop > Allow JavaScript from Apple Events" \
  "6. Chrome: View > Developer > Allow JavaScript from Apple Events" \
  "7. If macOS asks, quit/reopen the browser and Terminal, then run this installer once more."

echo
printf 'Logs: %s\n' "$LOG_DIR/georgie-mac-agent.log"
printf 'Device ID: %s\n' "$DEVICE_ID"
