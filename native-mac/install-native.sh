#!/bin/zsh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP="$HOME/Applications/Georgie.app"
CONTENTS="$APP/Contents"
MACOS="$CONTENTS/MacOS"
RESOURCES="$CONTENTS/Resources"
PLIST="$HOME/Library/LaunchAgents/com.georgie.native.plist"
mkdir -p "$MACOS" "$RESOURCES" "$HOME/Library/LaunchAgents"

echo "[Georgie] Building native Mac app..."
/usr/bin/swiftc "$ROOT/native-mac/GeorgieNative.swift" -o "$MACOS/Georgie" -framework AppKit -framework Carbon
cp "$ROOT/public/georgie-avatar.jpg" "$RESOURCES/georgie-avatar.jpg"
cat > "$CONTENTS/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleName</key><string>Georgie</string>
<key>CFBundleDisplayName</key><string>Georgie</string>
<key>CFBundleIdentifier</key><string>com.georgie.native</string>
<key>CFBundleVersion</key><string>1</string>
<key>CFBundleShortVersionString</key><string>1.0</string>
<key>CFBundleExecutable</key><string>Georgie</string>
<key>LSUIElement</key><true/>
<key>NSHighResolutionCapable</key><true/>
</dict></plist>
PLIST
chmod +x "$MACOS/Georgie"
cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>com.georgie.native</string>
<key>ProgramArguments</key><array><string>$MACOS/Georgie</string></array>
<key>RunAtLoad</key><true/>
<key>KeepAlive</key><true/>
<key>ProcessType</key><string>Interactive</string>
<key>StandardOutPath</key><string>$HOME/Library/Logs/georgie-native.log</string>
<key>StandardErrorPath</key><string>$HOME/Library/Logs/georgie-native-error.log</string>
</dict></plist>
PLIST
plutil -lint "$CONTENTS/Info.plist" >/dev/null
plutil -lint "$PLIST" >/dev/null
launchctl bootout "gui/$(id -u)/com.georgie.native" >/dev/null 2>&1 || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
launchctl kickstart -k "gui/$(id -u)/com.georgie.native" >/dev/null 2>&1 || true
open -a "$APP" || true

echo "[Georgie] Native Mac app installed."
echo "[Georgie] Use Option+Space anywhere to summon Georgie, or click his menu-bar icon."
