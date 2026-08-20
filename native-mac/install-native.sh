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

echo "[Georgie] Preparing low-latency executive voice build..."
/usr/bin/sed \
  -e 's/speaker.delegate = self/speaker.delegate = self; configureGeorgieExecutiveVoice(speaker)/' \
  -e 's/withTimeInterval: 0.85/withTimeInterval: 0.60/' \
  -e 's/withTimeInterval: 0.7/withTimeInterval: 0.45/' \
  "$ROOT/native-mac/GeorgieNative.swift" > "$PATCHED_SOURCE"
/usr/bin/grep -q 'configureGeorgieExecutiveVoice(speaker)' "$PATCHED_SOURCE" || { echo "[Georgie] Voice profile injection failed."; exit 1; }

echo "[Georgie] Building fresh native Mac app with Hey Georgie wake mode..."
/usr/bin/swiftc "$PATCHED_SOURCE" "$ROOT/native-mac/VoiceProfile.swift" -o "$MACOS/Georgie" -framework AppKit -framework Carbon -framework Speech -framework AVFoundation
cp "$ROOT/public/georgie-avatar.jpg" "$RESOURCES/georgie-avatar.jpg"
cat > "$CONTENTS/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleName</key><string>Georgie</string>
<key>CFBundleDisplayName</key><string>Georgie</string>
<key>CFBundleIdentifier</key><string>com.georgie.native</string>
<key>CFBundleVersion</key><string>5</string>
<key>CFBundleShortVersionString</key><string>1.4</string>
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

echo "[Georgie] Fresh native Mac app installed (v1.4)."
echo "[Georgie] Executive male voice profile enabled with faster command completion."
echo "[Georgie] Say 'Hey Georgie' or use Option+Space to begin a conversation."
