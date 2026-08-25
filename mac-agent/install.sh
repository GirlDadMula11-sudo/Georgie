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
HEALTH_FILE="$HOME/Library/Application Support/Georgie/mac-agent-health.json"
EXPECTED_AGENT_VERSION="2.2.33"
RUNTIME_AGENT="$ROOT/mac-agent/agent.runtime.js"

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

say_step "Installing daemon-owned polling health instrumentation..."
"$NODE" mac-agent/install-daemon-health.mjs

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

say_step "Building deterministic governed Mac runtime..."
rm -f "$RUNTIME_AGENT"
"$NODE" mac-agent/build-runtime.mjs "$EXPECTED_AGENT_VERSION"
"$NODE" --check "$RUNTIME_AGENT"
if [[ ! -f "$RUNTIME_AGENT" ]]; then
  echo "Generated Mac runtime was not created."
  exit 1
fi
if ! grep -q 'browser.wordpress_enable_application_passwords' "$RUNTIME_AGENT"; then
  echo "Generated Mac runtime is missing the governed WordPress Application Password capability."
  exit 1
fi

mkdir -p "$HOME/Library/LaunchAgents" "$LOG_DIR" "$(dirname "$HEALTH_FILE")"
rm -f "$HEALTH_FILE"

cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.georgie.mac-agent</string>
  <key>ProgramArguments</key>
  <array><string>$NODE</string><string>$RUNTIME_AGENT</string></array>
  <key>WorkingDirectory</key><string>$ROOT</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>5</integer>
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

say_step "Checking LaunchAgent registration..."
sleep 1
if ! launchctl print "$SERVICE_TARGET" >/dev/null 2>&1; then
  echo "The LaunchAgent is not registered after restart."
  exit 1
fi

say_step "Waiting for daemon-owned heartbeat + poll receipt..."
DAEMON_OK=0
for _attempt in {1..20}; do
  if [[ -f "$HEALTH_FILE" ]]; then
    if "$NODE" -e '
      const fs=require("fs");
      const p=process.argv[1], expectedDevice=process.argv[2], expectedVersion=process.argv[3], expectedOrigin=new URL(process.argv[4]).origin;
      const h=JSON.parse(fs.readFileSync(p,"utf8"));
      const age=Date.now()-Date.parse(h.successfulCycleAt||0);
      if(h.deviceId!==expectedDevice||h.agentVersion!==expectedVersion||h.serverOrigin!==expectedOrigin||h.lastPollOk!==true||!Number.isInteger(h.pid)||h.pid<=1||!Number.isFinite(age)||age<0||age>15000) process.exit(1);
    ' "$HEALTH_FILE" "$DEVICE_ID" "$EXPECTED_AGENT_VERSION" "$SERVER_URL"; then
      DAEMON_OK=1
      break
    fi
  fi
  sleep 1
done

if (( DAEMON_OK != 1 )); then
  echo "Georgie's LaunchAgent is registered, but the daemon did not prove a fresh authenticated heartbeat + poll cycle."
  echo "LaunchAgent state:"
  launchctl print "$SERVICE_TARGET" 2>&1 | tail -40 || true
  echo "Recent stdout:"
  tail -40 "$LOG_DIR/georgie-mac-agent.log" 2>/dev/null || true
  echo "Recent stderr:"
  tail -40 "$LOG_DIR/georgie-mac-agent-error.log" 2>/dev/null || true
  exit 1
fi

echo "Georgie Mac Agent is installed and the LaunchAgent itself proved a fresh authenticated heartbeat + job-poll cycle."
echo "Daemon health receipt: $HEALTH_FILE"
echo "Agent version: $EXPECTED_AGENT_VERSION"

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
