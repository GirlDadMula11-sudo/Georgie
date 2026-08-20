#!/bin/zsh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP="$HOME/Applications/Georgie.app"
PLIST="$HOME/Library/LaunchAgents/com.georgie.native.plist"
BUILD_ROOT="$(mktemp -d /tmp/georgie-native.XXXXXX)"
BUILD_APP="$BUILD_ROOT/Georgie.app"
CONTENTS="$BUILD_APP/Contents"
MACOS="$CONTENTS/MacOS"
RESOURCES="$CONTENTS/Resources"
PATCHED_SOURCE="$BUILD_ROOT/GeorgieNative.swift"
trap 'rm -rf "$BUILD_ROOT"' EXIT

mkdir -p "$MACOS" "$RESOURCES" "$HOME/Library/LaunchAgents" "$HOME/Applications"

echo "[Georgie] Stopping any older native Georgie build..."
launchctl bootout "gui/$(id -u)/com.georgie.native" >/dev/null 2>&1 || true
pkill -x Georgie >/dev/null 2>&1 || true
sleep 1

echo "[Georgie] Preparing ultra-low-latency executive voice build..."
/usr/bin/sed \
  -e 's/speaker.delegate = self/speaker.delegate = self; configureGeorgieExecutiveVoice(speaker)/' \
  -e 's/bufferSize: 1024/bufferSize: 512/' \
  -e 's/withTimeInterval: 0.85/withTimeInterval: 0.40/' \
  -e 's/withTimeInterval: 0.7/withTimeInterval: 0.20/' \
  -e 's/withTimeInterval: 8.0/withTimeInterval: 5.0/' \
  -e 's/self.responseLabel.stringValue = "Listening…"/self.responseLabel.stringValue = "Yes?"/' \
  -e 's/self.startCommandListening()/self.say("Yes?")/' \
  "$ROOT/native-mac/GeorgieNative.swift" > "$PATCHED_SOURCE"

# The broad startCommandListening replacement above also touches delegate paths; restore those so only
# the wake acknowledgement speaks "Yes?" before transitioning into command capture.
/usr/bin/python3 - "$PATCHED_SOURCE" <<'PY'
from pathlib import Path
import sys
p=Path(sys.argv[1])
s=p.read_text()
# Restore normal command starts everywhere first.
s=s.replace('if self.conversationActive { self.say("Yes?") }\n            else { self.startWakeListening() }', 'if self.conversationActive { self.startCommandListening() }\n            else { self.startWakeListening() }')
s=s.replace('conversationActive = true\n        self.say("Yes?")', 'conversationActive = true\n        startCommandListening()')
# Make only the empty wake remainder acknowledge immediately, then the speech delegate starts listening.
old='self.responseLabel.stringValue = "Yes?"\n                            self.say("Yes?")'
if old not in s:
    raise SystemExit('[Georgie] Wake acknowledgement patch failed.')
p.write_text(s)
PY

/usr/bin/grep -q 'configureGeorgieExecutiveVoice(speaker)' "$PATCHED_SOURCE" || { echo "[Georgie] Voice profile injection failed."; exit 1; }
/usr/bin/grep -q 'bufferSize: 512' "$PATCHED_SOURCE" || { echo "[Georgie] Low latency audio patch failed."; exit 1; }

echo "[Georgie] Building fresh native Mac app with immediate Hey Georgie response..."
/usr/bin/swiftc "$PATCHED_SOURCE" "$ROOT/native-mac/VoiceProfile.swift" -o "$MACOS/Georgie" -framework AppKit -framework Carbon -framework Speech -framework AVFoundation
cp "$ROOT/public/georgie-avatar.jpg" "$RESOURCES/georgie-avatar.jpg"
cat > "$CONTENTS/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleName</key><string>Georgie</string>
<key>CFBundleDisplayName</key><string>Georgie</string>
<key>CFBundleIdentifier</key><string>com.georgie.native</string>
<key>CFBundleVersion</key><string>6</string>
<key>CFBundleShortVersionString</key><string>1.5</string>
<key>CFBundleExecutable</key><string>Georgie</string>
<key>LSUIElement</key><true/>
<key>NSHighResolutionCapable</key><true/>
<key>NSMicrophoneUsageDescription</key><string>Georgie listens locally for your Hey Georgie wake phrase and voice commands.</string>
<key>NSSpeechRecognitionUsageDescription</key><string>Georgie converts your wake phrase and spoken commands into assistant requests.</string>
</dict></plist>
PLIST
chmod +x "$MACOS/Georgie"
plutil -lint "$CONTENTS/Info.plist" >/dev/null

rm -rf "$APP"
mv "$BUILD_APP" "$APP"

cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>com.georgie.native</string>
<key>ProgramArguments</key><array><string>$APP/Contents/MacOS/Georgie</string></array>
<key>RunAtLoad</key><true/>
<key>KeepAlive</key><true/>
<key>ProcessType</key><string>Interactive</string>
<key>StandardOutPath</key><string>$HOME/Library/Logs/georgie-native.log</string>
<key>StandardErrorPath</key><string>$HOME/Library/Logs/georgie-native-error.log</string>
</dict></plist>
PLIST
plutil -lint "$PLIST" >/dev/null

launchctl bootstrap "gui/$(id -u)" "$PLIST"
launchctl kickstart -k "gui/$(id -u)/com.georgie.native" >/dev/null 2>&1 || true
sleep 1
open "$APP" || true

echo "[Georgie] Fresh native Mac app installed (v1.5)."
echo "[Georgie] Immediate wake acknowledgement, faster audio capture, and executive male voice enabled."
echo "[Georgie] Say 'Hey Georgie' or use Option+Space to begin a conversation."
