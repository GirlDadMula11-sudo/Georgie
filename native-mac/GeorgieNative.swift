import AppKit
import Foundation
import Carbon.HIToolbox
import Speech
import AVFoundation

enum GeorgieVoiceMode {
    case idle
    case wake
    case command
}

final class GeorgieWindowController: NSWindowController, NSTextFieldDelegate, NSSpeechSynthesizerDelegate {
    private let server = URL(string: "https://georgie.onrender.com")!
    private let responseLabel = NSTextField(labelWithString: "Ready.")
    private let input = NSTextField(string: "")
    private let avatar = NSImageView()
    private let talkButton = NSButton()
    private let recognizer = SFSpeechRecognizer(locale: Locale(identifier: "en-US"))
    private let audioEngine = AVAudioEngine()
    private var recognitionTask: SFSpeechRecognitionTask?
    private var recognitionRequest: SFSpeechAudioBufferRecognitionRequest?
    private let speaker = NSSpeechSynthesizer()
    private var voiceMode: GeorgieVoiceMode = .idle
    private var permissionsReady = false
    private var conversationActive = false
    private var silenceTimer: Timer?
    private var commandTimeoutTimer: Timer?
    private var restartTimer: Timer?
    private var lastTranscript = ""

    private let midnight = NSColor(calibratedRed: 0.035, green: 0.055, blue: 0.09, alpha: 1)
    private let graphite = NSColor(calibratedRed: 0.065, green: 0.085, blue: 0.12, alpha: 1)
    private let teal = NSColor(calibratedRed: 0.16, green: 0.72, blue: 0.65, alpha: 1)
    private let tealSoft = NSColor(calibratedRed: 0.43, green: 0.90, blue: 0.84, alpha: 1)
    private let ivory = NSColor(calibratedRed: 0.94, green: 0.95, blue: 0.93, alpha: 1)

    init() {
        let window = NSPanel(contentRect: NSRect(x: 0, y: 0, width: 440, height: 620), styleMask: [.titled, .closable, .utilityWindow], backing: .buffered, defer: false)
        window.title = "Georgie"
        window.isReleasedWhenClosed = false
        window.appearance = NSAppearance(named: .darkAqua)
        super.init(window: window)
        speaker.delegate = self
        buildUI()
        requestVoicePermissions()
    }

    required init?(coder: NSCoder) { fatalError() }

    private func loadAvatarImage() -> NSImage? {
        let fm = FileManager.default
        var candidates: [String] = []
        if let p = Bundle.main.resourcePath { candidates.append((p as NSString).appendingPathComponent("georgie-avatar.jpg")) }
        if let e = Bundle.main.executablePath {
            let c = ((e as NSString).deletingLastPathComponent as NSString).deletingLastPathComponent
            candidates.append((c as NSString).appendingPathComponent("Resources/georgie-avatar.jpg"))
        }
        if let h = ProcessInfo.processInfo.environment["HOME"] { candidates.append("\(h)/Applications/Georgie.app/Contents/Resources/georgie-avatar.jpg") }
        return candidates.compactMap { fm.fileExists(atPath: $0) ? NSImage(contentsOfFile: $0) : nil }.first
    }

    private func buildUI() {
        guard let content = window?.contentView else { return }
        content.wantsLayer = true
        content.layer?.backgroundColor = midnight.cgColor
        let halo = NSView(frame: NSRect(x: 133, y: 370, width: 174, height: 174))
        halo.wantsLayer = true
        halo.layer?.cornerRadius = 87
        halo.layer?.backgroundColor = teal.withAlphaComponent(0.08).cgColor
        halo.layer?.borderWidth = 1
        halo.layer?.borderColor = teal.withAlphaComponent(0.22).cgColor
        content.addSubview(halo)
        avatar.frame = NSRect(x: 145, y: 382, width: 150, height: 150)
        avatar.imageScaling = .scaleAxesIndependently
        avatar.wantsLayer = true
        avatar.layer?.cornerRadius = 75
        avatar.layer?.masksToBounds = true
        avatar.layer?.borderWidth = 3
        avatar.layer?.borderColor = teal.cgColor
        avatar.layer?.backgroundColor = graphite.cgColor
        avatar.image = loadAvatarImage() ?? NSImage(systemSymbolName: "person.crop.circle.fill", accessibilityDescription: "Georgie")
        content.addSubview(avatar)
        let title = NSTextField(labelWithString: "GEORGIE")
        title.font = .systemFont(ofSize: 30, weight: .semibold)
        title.textColor = ivory
        title.alignment = .center
        title.frame = NSRect(x: 40, y: 337, width: 360, height: 42)
        content.addSubview(title)
        let state = NSTextField(labelWithString: "●  ONLINE & READY")
        state.font = .systemFont(ofSize: 12, weight: .medium)
        state.textColor = tealSoft
        state.alignment = .center
        state.frame = NSRect(x: 40, y: 316, width: 360, height: 22)
        content.addSubview(state)
        responseLabel.frame = NSRect(x: 34, y: 180, width: 372, height: 120)
        responseLabel.maximumNumberOfLines = 6
        responseLabel.lineBreakMode = .byWordWrapping
        responseLabel.textColor = ivory
        responseLabel.font = .systemFont(ofSize: 15)
        content.addSubview(responseLabel)
        talkButton.title = "🎙  TALK TO GEORGIE"
        talkButton.target = self
        talkButton.action = #selector(toggleVoice)
        talkButton.frame = NSRect(x: 34, y: 128, width: 372, height: 42)
        talkButton.bezelStyle = .rounded
        talkButton.contentTintColor = tealSoft
        content.addSubview(talkButton)
        input.frame = NSRect(x: 34, y: 78, width: 280, height: 38)
        input.placeholderString = "Ask Georgie…"
        input.delegate = self
        input.backgroundColor = graphite
        input.textColor = ivory
        input.focusRingType = .none
        content.addSubview(input)
        let send = NSButton(title: "Send", target: self, action: #selector(sendPressed))
        send.frame = NSRect(x: 322, y: 78, width: 84, height: 38)
        send.bezelStyle = .rounded
        send.contentTintColor = tealSoft
        content.addSubview(send)
        let hint = NSTextField(labelWithString: "Say “Hey Georgie” or press ⌥ Space")
        hint.frame = NSRect(x: 34, y: 32, width: 372, height: 22)
        hint.alignment = .center
        hint.textColor = tealSoft.withAlphaComponent(0.72)
        content.addSubview(hint)
    }

    private func requestVoicePermissions() {
        SFSpeechRecognizer.requestAuthorization { [weak self] status in
            AVCaptureDevice.requestAccess(for: .audio) { granted in
                DispatchQueue.main.async {
                    guard let self = self else { return }
                    self.permissionsReady = status == .authorized && granted
                    if self.permissionsReady {
                        self.responseLabel.stringValue = "Wake voice ready. Say “Hey Georgie”."
                        self.startWakeListening()
                    } else {
                        self.responseLabel.stringValue = "Enable Microphone and Speech Recognition for Hey Georgie."
                    }
                }
            }
        }
    }

    func show() {
        NSApp.activate(ignoringOtherApps: true)
        window?.center()
        showWindow(nil)
        input.becomeFirstResponder()
    }

    func beginConversation() {
        show()
        conversationActive = true
        startCommandListening()
    }

    func control(_ control: NSControl, textView: NSTextView, doCommandBy commandSelector: Selector) -> Bool {
        if commandSelector == #selector(NSResponder.insertNewline(_:)) { sendPressed(); return true }
        return false
    }

    @objc private func toggleVoice() {
        if voiceMode == .command && audioEngine.isRunning {
            finishCommand()
        } else {
            beginConversation()
        }
    }

    private func stopCapture() {
        silenceTimer?.invalidate()
        silenceTimer = nil
        commandTimeoutTimer?.invalidate()
        commandTimeoutTimer = nil
        restartTimer?.invalidate()
        restartTimer = nil
        if audioEngine.isRunning {
            audioEngine.stop()
            audioEngine.inputNode.removeTap(onBus: 0)
        }
        recognitionRequest?.endAudio()
        recognitionTask?.cancel()
        recognitionRequest = nil
        recognitionTask = nil
        voiceMode = .idle
    }

    private func makeRecognitionRequest() -> SFSpeechAudioBufferRecognitionRequest {
        let req = SFSpeechAudioBufferRecognitionRequest()
        req.shouldReportPartialResults = true
        if #available(macOS 13.0, *) {
            req.requiresOnDeviceRecognition = recognizer?.supportsOnDeviceRecognition ?? false
        }
        return req
    }

    private func startAudio(_ request: SFSpeechAudioBufferRecognitionRequest) -> Bool {
        let node = audioEngine.inputNode
        let format = node.outputFormat(forBus: 0)
        node.removeTap(onBus: 0)
        node.installTap(onBus: 0, bufferSize: 1024, format: format) { [weak self] buffer, _ in
            self?.recognitionRequest?.append(buffer)
        }
        audioEngine.prepare()
        do {
            try audioEngine.start()
            return true
        } catch {
            responseLabel.stringValue = "Microphone error: \(error.localizedDescription)"
            return false
        }
    }

    private func extractWakeRemainder(_ text: String) -> String? {
        let lower = text.lowercased()
        let phrases = ["hey georgie", "hey georgy", "hey george"]
        for phrase in phrases {
            if let range = lower.range(of: phrase) {
                let remainder = String(text[range.upperBound...]).trimmingCharacters(in: CharacterSet(charactersIn: " ,.!?"))
                return remainder
            }
        }
        return nil
    }

    private func startWakeListening() {
        guard permissionsReady, !speaker.isSpeaking else { return }
        stopCapture()
        conversationActive = false
        input.stringValue = ""
        lastTranscript = ""
        let req = makeRecognitionRequest()
        recognitionRequest = req
        voiceMode = .wake
        guard startAudio(req) else { return }
        talkButton.title = "●  HEY GEORGIE READY"
        recognitionTask = recognizer?.recognitionTask(with: req) { [weak self] result, error in
            guard let self = self else { return }
            if let result = result {
                let transcript = result.bestTranscription.formattedString
                if let remainder = self.extractWakeRemainder(transcript) {
                    DispatchQueue.main.async {
                        guard self.voiceMode == .wake else { return }
                        self.stopCapture()
                        self.conversationActive = true
                        self.show()
                        if remainder.isEmpty {
                            self.responseLabel.stringValue = "Listening…"
                            self.startCommandListening()
                        } else {
                            self.input.stringValue = remainder
                            self.handle(remainder)
                        }
                    }
                    return
                }
                if result.isFinal {
                    DispatchQueue.main.async { self.restartWakeSoon() }
                }
            } else if error != nil {
                DispatchQueue.main.async { self.restartWakeSoon() }
            }
        }
    }

    private func restartWakeSoon() {
        guard !conversationActive else { return }
        stopCapture()
        restartTimer = Timer.scheduledTimer(withTimeInterval: 0.7, repeats: false) { [weak self] _ in
            self?.startWakeListening()
        }
    }

    private func startCommandListening() {
        guard permissionsReady, !speaker.isSpeaking else { return }
        stopCapture()
        conversationActive = true
        input.stringValue = ""
        lastTranscript = ""
        let req = makeRecognitionRequest()
        recognitionRequest = req
        voiceMode = .command
        guard startAudio(req) else { return }
        talkButton.title = "■  LISTENING…"
        responseLabel.stringValue = "Listening…"
        commandTimeoutTimer = Timer.scheduledTimer(withTimeInterval: 8.0, repeats: false) { [weak self] _ in
            guard let self = self, self.voiceMode == .command else { return }
            if self.lastTranscript.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                self.endConversation()
            } else {
                self.finishCommand()
            }
        }
        recognitionTask = recognizer?.recognitionTask(with: req) { [weak self] result, error in
            guard let self = self else { return }
            if let result = result {
                let transcript = result.bestTranscription.formattedString
                DispatchQueue.main.async {
                    guard self.voiceMode == .command else { return }
                    self.lastTranscript = transcript
                    self.input.stringValue = transcript
                    self.silenceTimer?.invalidate()
                    if !transcript.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                        self.silenceTimer = Timer.scheduledTimer(withTimeInterval: 0.85, repeats: false) { [weak self] _ in self?.finishCommand() }
                    }
                    if result.isFinal { self.finishCommand() }
                }
            } else if error != nil {
                DispatchQueue.main.async {
                    if self.voiceMode == .command {
                        if self.lastTranscript.isEmpty { self.endConversation() } else { self.finishCommand() }
                    }
                }
            }
        }
    }

    private func finishCommand() {
        guard voiceMode == .command else { return }
        let spoken = lastTranscript.trimmingCharacters(in: .whitespacesAndNewlines)
        stopCapture()
        talkButton.title = "🎙  TALK TO GEORGIE"
        if spoken.isEmpty {
            endConversation()
        } else {
            handle(spoken)
        }
    }

    private func endConversation() {
        conversationActive = false
        stopCapture()
        responseLabel.stringValue = "Ready. Say “Hey Georgie”."
        startWakeListening()
    }

    @objc private func sendPressed() {
        let text = input.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        conversationActive = true
        stopCapture()
        handle(text)
    }

    private func handle(_ text: String) {
        input.stringValue = ""
        responseLabel.stringValue = "Working…"
        if executeLocalCommand(text) { return }
        askCloud(text)
    }

    private func say(_ text: String) {
        stopCapture()
        speaker.stopSpeaking()
        speaker.startSpeaking(text)
    }

    func speechSynthesizer(_ sender: NSSpeechSynthesizer, didFinishSpeaking finishedSpeaking: Bool) {
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) {
            if self.conversationActive { self.startCommandListening() }
            else { self.startWakeListening() }
        }
    }

    private func executeLocalCommand(_ raw: String) -> Bool {
        let text = raw.lowercased().replacingOccurrences(of: "georgie,", with: "").replacingOccurrences(of: "georgie ", with: "").trimmingCharacters(in: .whitespacesAndNewlines)
        let apps: [String: String] = ["safari":"Safari","chrome":"Google Chrome","notes":"Notes","mail":"Mail","finder":"Finder","calendar":"Calendar","messages":"Messages","preview":"Preview","system settings":"System Settings","excel":"Microsoft Excel","word":"Microsoft Word"]
        for prefix in ["open ", "launch ", "start "] where text.hasPrefix(prefix) {
            let requested = String(text.dropFirst(prefix.count)).trimmingCharacters(in: .whitespacesAndNewlines)
            if let app = apps[requested] {
                let ok = NSWorkspace.shared.launchApplication(app)
                let reply = ok ? "\(app) is open." : "I couldn't open \(app)."
                responseLabel.stringValue = reply
                say(reply)
                return true
            }
        }
        if text == "what time is it" || text == "what's the time" {
            let f = DateFormatter()
            f.timeStyle = .short
            let reply = "It's \(f.string(from: Date()))."
            responseLabel.stringValue = reply
            say(reply)
            return true
        }
        return false
    }

    private func askCloud(_ text: String) {
        var req = URLRequest(url: server.appendingPathComponent("api/respond"))
        req.httpMethod = "POST"
        req.timeoutInterval = 20
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.setValue("primary", forHTTPHeaderField: "X-Georgie-User")
        req.setValue("native-mac", forHTTPHeaderField: "X-Georgie-Session")
        req.httpBody = try? JSONSerialization.data(withJSONObject: ["input": text, "history": []] as [String: Any])
        URLSession.shared.dataTask(with: req) { [weak self] data, _, error in
            DispatchQueue.main.async {
                guard let self = self else { return }
                if let error = error {
                    self.responseLabel.stringValue = "Cloud error: \(error.localizedDescription)"
                    self.endConversation()
                    return
                }
                guard let data = data, let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
                    self.responseLabel.stringValue = "Georgie returned an unreadable response."
                    self.endConversation()
                    return
                }
                let reply = (obj["text"] as? String) ?? (obj["error"] as? String) ?? "Georgie did not return a response."
                self.responseLabel.stringValue = reply
                self.say(reply)
            }
        }.resume()
    }
}

final class AppDelegate: NSObject, NSApplicationDelegate {
    let windowController = GeorgieWindowController()
    var statusItem: NSStatusItem!
    var hotKeyRef: EventHotKeyRef?

    func applicationDidFinishLaunching(_ notification: Notification) {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        statusItem.button?.image = NSImage(systemSymbolName: "waveform.circle.fill", accessibilityDescription: "Georgie")
        let menu = NSMenu()
        menu.addItem(NSMenuItem(title: "Open Georgie", action: #selector(showGeorgie), keyEquivalent: ""))
        menu.addItem(NSMenuItem.separator())
        menu.addItem(NSMenuItem(title: "Quit Georgie", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q"))
        statusItem.menu = menu
        registerHotKey()
    }

    private func registerHotKey() {
        var id = EventHotKeyID(signature: OSType(0x47454F52), id: 1)
        RegisterEventHotKey(UInt32(kVK_Space), UInt32(optionKey), id, GetApplicationEventTarget(), 0, &hotKeyRef)
        InstallEventHandler(GetApplicationEventTarget(), { _, _, userData in
            guard let userData = userData else { return noErr }
            Unmanaged<AppDelegate>.fromOpaque(userData).takeUnretainedValue().showGeorgie()
            return noErr
        }, 1, [EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyPressed))], Unmanaged.passUnretained(self).toOpaque(), nil)
    }

    @objc func showGeorgie() { windowController.beginConversation() }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.accessory)
app.run()
