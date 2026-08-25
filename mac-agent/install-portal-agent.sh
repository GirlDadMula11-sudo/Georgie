#!/bin/zsh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)";cd "$ROOT"
NODE="$(command -v node)";[[ -n "$NODE" ]]||{ echo "Node.js required";exit 1; }
ENV_FILE="$ROOT/.env";value(){ [[ -f "$ENV_FILE" ]]&&grep -E "^$1=" "$ENV_FILE"|tail -1|cut -d= -f2-||true; }
SERVER_URL="${GEORGIE_SERVER_URL:-$(value GEORGIE_SERVER_URL)}";TOKEN="${GEORGIE_MAC_AGENT_TOKEN:-$(value GEORGIE_MAC_AGENT_TOKEN)}";[[ "$SERVER_URL" == https://* ]]||{ echo "GEORGIE_SERVER_URL must use https";exit 1; };(( ${#TOKEN} >= 32 ))||{ echo "Valid pairing token required";exit 1; }
"$NODE" --check mac-agent/portal-agent.js;"$NODE" --check mac-agent/lender-portal.js
PLIST="$HOME/Library/LaunchAgents/com.georgie.portal-agent.plist";LOG="$HOME/Library/Logs";mkdir -p "${PLIST:h}" "$LOG"
cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict><key>Label</key><string>com.georgie.portal-agent</string><key>ProgramArguments</key><array><string>$NODE</string><string>$ROOT/mac-agent/portal-agent.js</string></array><key>WorkingDirectory</key><string>$ROOT</string><key>RunAtLoad</key><true/><key>KeepAlive</key><true/><key>ThrottleInterval</key><integer>5</integer><key>StandardOutPath</key><string>$LOG/georgie-portal-agent.log</string><key>StandardErrorPath</key><string>$LOG/georgie-portal-agent-error.log</string></dict></plist>
PLIST
plutil -lint "$PLIST";DOMAIN="gui/$(id -u)";TARGET="$DOMAIN/com.georgie.portal-agent";launchctl bootout "$TARGET" >/dev/null 2>&1||true;launchctl bootstrap "$DOMAIN" "$PLIST";launchctl enable "$TARGET";launchctl kickstart -k "$TARGET" >/dev/null 2>&1||true
HEALTH="$HOME/Library/Application Support/Georgie/portal-agent-health.json";for _ in {1..20};do if [[ -f "$HEALTH" ]]&&"$NODE" -e 'const f=require("fs"),h=JSON.parse(f.readFileSync(process.argv[1]));if(h.deviceId!=="primary-mac-portal"||h.workerVersion!=="1.0.0"||h.lastPollOk!==true||Date.now()-Date.parse(h.successfulCycleAt)>15000)process.exit(1)' "$HEALTH";then echo "Governed portal worker installed and polling proven.";exit 0;fi;sleep 1;done
echo "Portal worker heartbeat proof failed";tail -40 "$LOG/georgie-portal-agent-error.log" 2>/dev/null||true;exit 1
