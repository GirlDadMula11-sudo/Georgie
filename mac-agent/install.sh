#!/bin/zsh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 20+ is required before installing the Georgie Mac Agent."
  exit 1
fi

NODE="$(command -v node)"
ENV_FILE="$ROOT/.env"
PLIST="$HOME/Library/LaunchAgents/com.georgie.mac-agent.plist"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing $ENV_FILE"
  echo "Create it from .env.example and set GEORGIE_SERVER_URL, GEORGIE_MAC_AGENT_TOKEN, and GEORGIE_MAC_DEVICE_ID first."
  exit 1
fi

if ! grep -q '^GEORGIE_SERVER_URL=https://' "$ENV_FILE"; then
  echo "GEORGIE_SERVER_URL must be an https:// URL in .env"
  exit 1
fi

if ! grep -q '^GEORGIE_MAC_AGENT_TOKEN=.' "$ENV_FILE"; then
  echo "GEORGIE_MAC_AGENT_TOKEN is missing from .env"
  exit 1
fi

npm install
mkdir -p "$HOME/Library/LaunchAgents"

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
  <key>StandardOutPath</key><string>$HOME/Library/Logs/georgie-mac-agent.log</string>
  <key>StandardErrorPath</key><string>$HOME/Library/Logs/georgie-mac-agent-error.log</string>
</dict>
</plist>
PLIST

plutil -lint "$PLIST"
launchctl bootout "gui/$(id -u)/com.georgie.mac-agent" >/dev/null 2>&1 || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
launchctl enable "gui/$(id -u)/com.georgie.mac-agent"

echo "Georgie Mac Agent installed and started."
echo "For screen capture: System Settings > Privacy & Security > Screen Recording."
echo "For typing/key control: System Settings > Privacy & Security > Accessibility."
echo "Logs: $HOME/Library/Logs/georgie-mac-agent.log"
