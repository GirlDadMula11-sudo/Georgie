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
launchctl bootout "gui/$(id -u)/com.georgie.native" >/dev/null 2>&1 || true
pkill -x Georgie >/dev/null 2>&1 || true
sleep 1

echo "[Georgie] Preparing v2.1 long-form conversational voice build..."
/usr/bin/sed \
  -e 's/speaker.delegate = self/speaker.delegate = self; configureGeorgieExecutiveVoice(speaker)/' \
  -e 's/bufferSize: 1024/bufferSize: 512/' \
  "$ROOT/native-mac/GeorgieNative.swift" > "$PATCHED_SOURCE"

/usr/bin/python3 - "$PATCHED_SOURCE" <<'PY'
from pathlib import Path
import sys
p=Path(sys.argv[1]); s=p.read_text()
s=s.replace('    private let speaker = NSSpeechSynthesizer()\n','    private let speaker = NSSpeechSynthesizer()\n    private let cloudVoice = GeorgieCloudVoice()\n',1)
s=s.replace('guard permissionsReady, !speaker.isSpeaking else { return }','guard permissionsReady, !speaker.isSpeaking, !cloudVoice.isSpeaking else { return }')
# Remove the old fixed command timeout. Apple Speech supports much longer recognition sessions;
# completion is driven by a natural pause instead of an arbitrary ~5-9 second wall clock.
start='''        commandTimeoutTimer = Timer.scheduledTimer(withTimeInterval: 8.0, repeats: false) { [weak self] _ in
            guard let self = self, self.voiceMode == .command else { return }
            if self.lastTranscript.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                self.endConversation()
            } else {
                self.finishCommand()
            }
        }
'''
s=s.replace(start,'')
# Give natural mid-sentence pauses room. Long dictation now ends after 1.35s of no new speech,
# not after a fixed total duration.
s=s.replace('withTimeInterval: 0.85','withTimeInterval: 1.35')
old='''    private func say(_ text: String) {
        stopCapture()
        speaker.stopSpeaking()
        speaker.startSpeaking(text)
    }
'''
new='''    private func say(_ text: String) {
        stopCapture()
        cloudVoice.stop()
        speaker.stopSpeaking()
        if text.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() == "yes?" {
            speaker.startSpeaking("Yes?")
            return
        }
        cloudVoice.speak(text) { [weak self] success in
            guard let self = self else { return }
            if success {
                if self.conversationActive { self.startCommandListening() } else { self.startWakeListening() }
            } else {
                self.speaker.startSpeaking(text)
            }
        }
    }
'''
if old not in s: raise SystemExit('[Georgie] say replacement target missing')
s=s.replace(old,new,1)
oldwake='''                        if remainder.isEmpty {
                            self.responseLabel.stringValue = "Listening…"
                            self.startCommandListening()
'''
newwake='''                        if remainder.isEmpty {
                            self.responseLabel.stringValue = "Yes?"
                            self.say("Yes?")
'''
if oldwake not in s: raise SystemExit('[Georgie] wake target missing')
s=s.replace(oldwake,newwake,1)
p.write_text(s)
PY

/usr/bin/swiftc "$PATCHED_SOURCE" "$ROOT/native-mac/VoiceProfile.swift" "$ROOT/native-mac/CloudVoice.swift" -o "$MACOS/Georgie" -framework AppKit -framework Carbon -framework Speech -framework AVFoundation
cp "$ROOT/public/georgie-avatar.jpg" "$RESOURCES/georgie-avatar.jpg"
cat > "$CONTENTS/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleName</key><string>Georgie</string>
<key>CFBundleDisplayName</key><string>Georgie</string>
<key>CFBundleIdentifier</key><string>com.georgie.native</string>
<key>CFBundleVersion</key><string>21</string>
<key>CFBundleShortVersionString</key><string>2.1</string>
<key>CFBundleExecutable</key><string>Georgie</string>
<key>LSUIElement</key><true/>
<key>NSHighResolutionCapable</key><true/>
<key>NSMicrophoneUsageDescription</key><string>Georgie listens locally for your Hey Georgie wake phrase and conversational voice commands.</string>
<key>NSSpeechRecognitionUsageDescription</key><string>Georgie converts your wake phrase and long-form spoken requests into assistant requests.</string>
</dict></plist>
PLIST
chmod +x "$MACOS/Georgie"
plutil -lint "$CONTENTS/Info.plist" >/dev/null
rm -rf "$APP"; mv "$BUILD_APP" "$APP"
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
echo "[Georgie] Native Mac app installed (v2.1)."
echo "[Georgie] Fixed-duration dictation cutoff removed; long-form conversational speech enabled."
echo "[Georgie] Pause naturally when finished, or press the talk button to submit immediately."
