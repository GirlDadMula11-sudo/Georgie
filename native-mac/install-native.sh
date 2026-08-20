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

echo "[Georgie] Stopping older native Georgie build..."
launchctl bootout "gui/$(id -u)/com.georgie.native" >/dev/null 2>&1 || true
pkill -x Georgie >/dev/null 2>&1 || true
sleep 1

echo "[Georgie] Preparing v2 realtime-feel neural executive voice build..."
/usr/bin/sed \
  -e 's/speaker.delegate = self/speaker.delegate = self; configureGeorgieExecutiveVoice(speaker)/' \
  -e 's/bufferSize: 1024/bufferSize: 512/' \
  -e 's/withTimeInterval: 0.85/withTimeInterval: 0.40/' \
  -e 's/withTimeInterval: 0.7/withTimeInterval: 0.20/' \
  -e 's/withTimeInterval: 8.0/withTimeInterval: 5.0/' \
  "$ROOT/native-mac/GeorgieNative.swift" > "$PATCHED_SOURCE"

/usr/bin/python3 - "$PATCHED_SOURCE" <<'PY'
from pathlib import Path
import sys
p=Path(sys.argv[1])
s=p.read_text()

speaker='    private let speaker = NSSpeechSynthesizer()\n'
if speaker not in s:
    raise SystemExit('[Georgie] speaker property not found')
s=s.replace(speaker, speaker + '    private let cloudVoice = GeorgieCloudVoice()\n', 1)

s=s.replace('guard permissionsReady, !speaker.isSpeaking else { return }', 'guard permissionsReady, !speaker.isSpeaking, !cloudVoice.isSpeaking else { return }')

old='''    private func say(_ text: String) {\n        stopCapture()\n        speaker.stopSpeaking()\n        speaker.startSpeaking(text)\n    }\n'''
new='''    private func say(_ text: String) {\n        stopCapture()\n        cloudVoice.stop()\n        speaker.stopSpeaking()\n\n        // Keep wake acknowledgement entirely local so it is immediate.\n        if text.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() == "yes?" {\n            speaker.startSpeaking("Yes?")\n            return\n        }\n\n        // Full answers use Georgie's neural executive voice. Fall back to the local\n        // voice only if the network/TTS path is unavailable.\n        cloudVoice.speak(text) { [weak self] success in\n            guard let self = self else { return }\n            if success {\n                if self.conversationActive { self.startCommandListening() }\n                else { self.startWakeListening() }\n            } else {\n                self.speaker.startSpeaking(text)\n            }\n        }\n    }\n'''
if old not in s:
    raise SystemExit('[Georgie] say() replacement target not found')
s=s.replace(old,new,1)

# Wake with a spoken acknowledgement before opening the command microphone.
oldwake='''                        if remainder.isEmpty {\n                            self.responseLabel.stringValue = "Listening…"\n                            self.startCommandListening()\n'''
newwake='''                        if remainder.isEmpty {\n                            self.responseLabel.stringValue = "Yes?"\n                            self.say("Yes?")\n'''
if oldwake not in s:
    raise SystemExit('[Georgie] wake acknowledgement target not found')
s=s.replace(oldwake,newwake,1)

p.write_text(s)
PY

/usr/bin/grep -q 'configureGeorgieExecutiveVoice(speaker)' "$PATCHED_SOURCE" || { echo "[Georgie] Voice profile injection failed."; exit 1; }
/usr/bin/grep -q 'GeorgieCloudVoice' "$PATCHED_SOURCE" || { echo "[Georgie] Neural voice injection failed."; exit 1; }
/usr/bin/grep -q 'bufferSize: 512' "$PATCHED_SOURCE" || { echo "[Georgie] Low latency audio patch failed."; exit 1; }

echo "[Georgie] Building v2 native Mac app..."
/usr/bin/swiftc "$PATCHED_SOURCE" "$ROOT/native-mac/VoiceProfile.swift" "$ROOT/native-mac/CloudVoice.swift" -o "$MACOS/Georgie" -framework AppKit -framework Carbon -framework Speech -framework AVFoundation
cp "$ROOT/public/georgie-avatar.jpg" "$RESOURCES/georgie-avatar.jpg"
cat > "$CONTENTS/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleName</key><string>Georgie</string>
<key>CFBundleDisplayName</key><string>Georgie</string>
<key>CFBundleIdentifier</key><string>com.georgie.native</string>
<key>CFBundleVersion</key><string>20</string>
<key>CFBundleShortVersionString</key><string>2.0</string>
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

echo "[Georgie] Native Mac app installed (v2.0)."
echo "[Georgie] Instant local wake + neural executive male answer voice enabled."
echo "[Georgie] Say 'Hey Georgie' or use Option+Space."
