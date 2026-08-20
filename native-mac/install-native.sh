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

echo "[Georgie] Preparing v3 persistent realtime voice build..."
/usr/bin/sed \
  -e 's/speaker.delegate = self/speaker.delegate = self; configureGeorgieExecutiveVoice(speaker)/' \
  -e 's/bufferSize: 1024/bufferSize: 512/' \
  "$ROOT/native-mac/GeorgieNative.swift" > "$PATCHED_SOURCE"

/usr/bin/python3 - "$PATCHED_SOURCE" <<'PY'
from pathlib import Path
import sys
p=Path(sys.argv[1]); s=p.read_text()

s=s.replace('    private let speaker = NSSpeechSynthesizer()\n', '    private let speaker = NSSpeechSynthesizer()\n    private let cloudVoice = GeorgieCloudVoice()\n    private let realtimeVoice = GeorgieRealtimeVoice()\n    private var realtimeReply = ""\n', 1)
s=s.replace('        buildUI()\n        requestVoicePermissions()', '        buildUI()\n        setupRealtimeVoice()\n        requestVoicePermissions()', 1)

anchor='''    private func requestVoicePermissions() {\n'''
setup='''    private func setupRealtimeVoice() {\n        realtimeVoice.onReady = { [weak self] in\n            guard let self = self else { return }\n            self.realtimeReply = ""\n            self.responseLabel.stringValue = "Listening — speak naturally. Interrupt anytime."\n            self.talkButton.title = "■  REALTIME LIVE"\n        }\n        realtimeVoice.onUserTranscript = { [weak self] text in\n            self?.input.stringValue = text\n        }\n        realtimeVoice.onAssistantTranscript = { [weak self] delta in\n            guard let self = self else { return }\n            self.realtimeReply += delta\n            self.responseLabel.stringValue = self.realtimeReply\n        }\n        realtimeVoice.onSpeakingChanged = { [weak self] speaking in\n            guard let self = self else { return }\n            self.talkButton.title = speaking ? "●  GEORGIE SPEAKING" : "■  REALTIME LIVE"\n        }\n        realtimeVoice.onError = { [weak self] message in\n            guard let self = self else { return }\n            self.responseLabel.stringValue = "Realtime fallback: \\(message)"\n            self.realtimeVoice.stop()\n            if self.conversationActive {\n                DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) { self.startCommandListening() }\n            }\n        }\n    }\n\n'''
if anchor not in s: raise SystemExit('[Georgie] realtime setup anchor missing')
s=s.replace(anchor, setup+anchor, 1)

old_begin='''    func beginConversation() {\n        show()\n        conversationActive = true\n        startCommandListening()\n    }\n'''
new_begin='''    func beginConversation() {\n        show()\n        conversationActive = true\n        stopCapture()\n        responseLabel.stringValue = "Connecting realtime…"\n        if !realtimeVoice.start() { startCommandListening() }\n    }\n'''
if old_begin not in s: raise SystemExit('[Georgie] beginConversation target missing')
s=s.replace(old_begin,new_begin,1)

s=s.replace('guard permissionsReady, !speaker.isSpeaking else { return }','guard permissionsReady, !speaker.isSpeaking, !cloudVoice.isSpeaking, !realtimeVoice.isSpeaking else { return }')

old_toggle='''    @objc private func toggleVoice() {\n        if voiceMode == .command && audioEngine.isRunning {\n            finishCommand()\n        } else {\n            beginConversation()\n        }\n    }\n'''
new_toggle='''    @objc private func toggleVoice() {\n        if realtimeVoice.isActive {\n            endConversation()\n        } else if voiceMode == .command && audioEngine.isRunning {\n            finishCommand()\n        } else {\n            beginConversation()\n        }\n    }\n'''
if old_toggle in s: s=s.replace(old_toggle,new_toggle,1)

old_wake='''                        if remainder.isEmpty {\n                            self.responseLabel.stringValue = "Listening…"\n                            self.startCommandListening()\n                        } else {\n                            self.input.stringValue = remainder\n                            self.handle(remainder)\n                        }\n'''
new_wake='''                        if remainder.isEmpty {\n                            self.responseLabel.stringValue = "Yes?"\n                            self.say("Yes?")\n                        } else {\n                            self.input.stringValue = remainder\n                            self.responseLabel.stringValue = "Connecting realtime…"\n                            if self.realtimeVoice.start() { self.realtimeVoice.sendText(remainder) }\n                            else { self.handle(remainder) }\n                        }\n'''
if old_wake not in s: raise SystemExit('[Georgie] wake target missing')
s=s.replace(old_wake,new_wake,1)

old_end='''    private func endConversation() {\n        conversationActive = false\n        stopCapture()\n        responseLabel.stringValue = "Ready. Say “Hey Georgie”."\n        startWakeListening()\n    }\n'''
new_end='''    private func endConversation() {\n        conversationActive = false\n        realtimeVoice.stop()\n        stopCapture()\n        responseLabel.stringValue = "Ready. Say “Hey Georgie”."\n        startWakeListening()\n    }\n'''
if old_end not in s: raise SystemExit('[Georgie] endConversation target missing')
s=s.replace(old_end,new_end,1)

old_say='''    private func say(_ text: String) {\n        stopCapture()\n        speaker.stopSpeaking()\n        speaker.startSpeaking(text)\n    }\n'''
new_say='''    private func say(_ text: String) {\n        stopCapture()\n        cloudVoice.stop()\n        speaker.stopSpeaking()\n        if text.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() == "yes?" {\n            speaker.startSpeaking("Yes?")\n            return\n        }\n        cloudVoice.speak(text) { [weak self] success in\n            guard let self = self else { return }\n            if success {\n                if self.conversationActive { self.beginConversation() } else { self.startWakeListening() }\n            } else {\n                self.speaker.startSpeaking(text)\n            }\n        }\n    }\n'''
if old_say not in s: raise SystemExit('[Georgie] say target missing')
s=s.replace(old_say,new_say,1)

old_delegate='''    func speechSynthesizer(_ sender: NSSpeechSynthesizer, didFinishSpeaking finishedSpeaking: Bool) {\n        DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) {\n            if self.conversationActive { self.startCommandListening() }\n            else { self.startWakeListening() }\n        }\n    }\n'''
new_delegate='''    func speechSynthesizer(_ sender: NSSpeechSynthesizer, didFinishSpeaking finishedSpeaking: Bool) {\n        DispatchQueue.main.asyncAfter(deadline: .now() + 0.08) {\n            if self.conversationActive {\n                self.responseLabel.stringValue = "Connecting realtime…"\n                if !self.realtimeVoice.start() { self.startCommandListening() }\n            } else {\n                self.startWakeListening()\n            }\n        }\n    }\n'''
if old_delegate not in s: raise SystemExit('[Georgie] speech delegate target missing')
s=s.replace(old_delegate,new_delegate,1)

p.write_text(s)
PY

/usr/bin/grep -q 'GeorgieRealtimeVoice' "$PATCHED_SOURCE" || { echo "[Georgie] Realtime voice injection failed."; exit 1; }
/usr/bin/swiftc "$PATCHED_SOURCE" "$ROOT/native-mac/VoiceProfile.swift" "$ROOT/native-mac/CloudVoice.swift" "$ROOT/native-mac/RealtimeVoice.swift" -o "$MACOS/Georgie" -framework AppKit -framework Carbon -framework Speech -framework AVFoundation
cp "$ROOT/public/georgie-avatar.jpg" "$RESOURCES/georgie-avatar.jpg"
cat > "$CONTENTS/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleName</key><string>Georgie</string>
<key>CFBundleDisplayName</key><string>Georgie</string>
<key>CFBundleIdentifier</key><string>com.georgie.native</string>
<key>CFBundleVersion</key><string>30</string>
<key>CFBundleShortVersionString</key><string>3.0</string>
<key>CFBundleExecutable</key><string>Georgie</string>
<key>LSUIElement</key><true/>
<key>NSHighResolutionCapable</key><true/>
<key>NSMicrophoneUsageDescription</key><string>Georgie uses the microphone for persistent realtime conversation and the local Hey Georgie wake phrase.</string>
<key>NSSpeechRecognitionUsageDescription</key><string>Georgie uses local speech recognition only for the Hey Georgie wake phrase and fallback dictation.</string>
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
echo "[Georgie] Native Mac app installed (v3.0)."
echo "[Georgie] Persistent realtime voice, semantic turn detection, interruption, streamed audio and governed Sierra reads enabled."
echo "[Georgie] Say 'Hey Georgie' once, then speak naturally without a fixed dictation timer."
