import SwiftUI
import Speech
import AVFoundation

@main
struct GeorgieApp: App {
    var body: some Scene { WindowGroup { GeorgieHome() } }
}

private enum GeorgieTheme {
    static let midnight = Color(red: 0.035, green: 0.055, blue: 0.09)
    static let graphite = Color(red: 0.065, green: 0.085, blue: 0.12)
    static let teal = Color(red: 0.16, green: 0.72, blue: 0.65)
    static let tealSoft = Color(red: 0.43, green: 0.90, blue: 0.84)
    static let ivory = Color(red: 0.94, green: 0.95, blue: 0.93)
}

@MainActor
final class GeorgieVoice: NSObject, ObservableObject, SFSpeechRecognizerDelegate {
    @Published var transcript = ""
    @Published var response = "Ready."
    @Published var listening = false
    @Published var busy = false

    private let recognizer = SFSpeechRecognizer(locale: Locale(identifier: "en-US"))!
    private let audioEngine = AVAudioEngine()
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var task: SFSpeechRecognitionTask?
    private let speaker = AVSpeechSynthesizer()
    private let server = URL(string: "https://georgie.onrender.com/api/respond")!
    private var systemWakeObserver: NSObjectProtocol?

    override init() {
        super.init(); recognizer.delegate = self
        SFSpeechRecognizer.requestAuthorization { _ in }
        AVAudioApplication.requestRecordPermission { _ in }
        systemWakeObserver = NotificationCenter.default.addObserver(forName: .georgieStartListening, object: nil, queue: .main) { [weak self] _ in
            Task { @MainActor in self?.startFromSystemInvocation() }
        }
    }

    deinit {
        if let systemWakeObserver { NotificationCenter.default.removeObserver(systemWakeObserver) }
    }

    func toggle() { listening ? stop(process: true) : start() }

    func startFromSystemInvocation() {
        guard !listening, !busy else { return }
        UserDefaults.standard.removeObject(forKey: "georgie.startListeningOnLaunch")
        transcript = ""
        response = "I'm listening."
        start()
    }

    func start() {
        guard !audioEngine.isRunning else { return }
        task?.cancel(); task = nil
        let req = SFSpeechAudioBufferRecognitionRequest(); req.shouldReportPartialResults = true
        if recognizer.supportsOnDeviceRecognition { req.requiresOnDeviceRecognition = true }
        request = req
        let session = AVAudioSession.sharedInstance()
        do { try session.setCategory(.record, mode: .measurement, options: .duckOthers); try session.setActive(true, options: .notifyOthersOnDeactivation) }
        catch { response = "Microphone setup failed."; return }
        let node = audioEngine.inputNode; let format = node.outputFormat(forBus: 0); node.removeTap(onBus: 0)
        node.installTap(onBus: 0, bufferSize: 1024, format: format) { [weak self] buffer, _ in self?.request?.append(buffer) }
        audioEngine.prepare()
        do { try audioEngine.start(); listening = true; response = "Listening…" }
        catch { response = "I couldn't start listening."; return }
        task = recognizer.recognitionTask(with: req) { [weak self] result, error in
            guard let self else { return }
            Task { @MainActor in
                if let result { self.transcript = result.bestTranscription.formattedString; if result.isFinal { self.stop(process: true) } }
                if error != nil && self.listening { self.stop(process: false) }
            }
        }
    }

    func stop(process: Bool) {
        if audioEngine.isRunning { audioEngine.stop(); audioEngine.inputNode.removeTap(onBus: 0) }
        request?.endAudio(); task?.cancel(); request = nil; task = nil; listening = false
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        if process { let text = transcript.trimmingCharacters(in: .whitespacesAndNewlines); if !text.isEmpty { submit(text) } }
    }

    func submit(_ raw: String) {
        transcript = raw; busy = true
        if handleFastIntent(raw) { busy = false; return }
        Task { await askCloud(raw) }
    }

    private func handleFastIntent(_ raw: String) -> Bool {
        let text = raw.lowercased().replacingOccurrences(of: "hey georgie", with: "").replacingOccurrences(of: "georgie,", with: "").replacingOccurrences(of: "georgie ", with: "").trimmingCharacters(in: .whitespacesAndNewlines)
        if text == "what time is it" || text == "what's the time" {
            let f = DateFormatter(); f.timeStyle = .short; reply("It's \(f.string(from: Date()))."); return true
        }
        if text.hasPrefix("open ") {
            let target = String(text.dropFirst(5)).trimmingCharacters(in: .whitespacesAndNewlines)
            let urls: [String:String] = ["safari":"https://www.google.com", "calendar":"calshow://", "settings":"App-Prefs:", "mail":"message://", "maps":"maps://"]
            if let rawURL = urls[target], let url = URL(string: rawURL) { UIApplication.shared.open(url); reply("Opening \(target)."); return true }
        }
        return false
    }

    private func askCloud(_ text: String) async {
        var req = URLRequest(url: server); req.httpMethod = "POST"; req.timeoutInterval = 20
        req.setValue("application/json", forHTTPHeaderField: "Content-Type"); req.setValue("primary", forHTTPHeaderField: "X-Georgie-User"); req.setValue("native-ios", forHTTPHeaderField: "X-Georgie-Session")
        req.httpBody = try? JSONSerialization.data(withJSONObject: ["input": text, "history": []] as [String:Any])
        do {
            let (data, _) = try await URLSession.shared.data(for: req)
            let obj = try JSONSerialization.jsonObject(with: data) as? [String:Any]
            reply((obj?["text"] as? String) ?? (obj?["error"] as? String) ?? "I couldn't complete that request.")
        } catch { response = "Cloud connection error: \(error.localizedDescription)" }
        busy = false
    }

    private func reply(_ text: String) {
        response = text
        let utterance = AVSpeechUtterance(string: text); utterance.rate = 0.49; utterance.voice = AVSpeechSynthesisVoice(language: "en-US"); speaker.stopSpeaking(at: .immediate); speaker.speak(utterance)
    }
}

struct GeorgieHome: View {
    @StateObject private var voice = GeorgieVoice()
    @State private var typed = ""
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        ZStack {
            LinearGradient(colors: [GeorgieTheme.midnight, Color.black], startPoint: .top, endPoint: .bottom).ignoresSafeArea()
            ScrollView {
                VStack(spacing: 18) {
                    HStack { Image(systemName: "waveform.circle.fill").foregroundStyle(GeorgieTheme.teal); Text("GEORGIE").font(.title2.weight(.semibold)).tracking(5).foregroundStyle(GeorgieTheme.ivory); Spacer() }
                    .padding(.top, 10)

                    ZStack {
                        Circle().fill(GeorgieTheme.teal.opacity(0.08)).frame(width: 230, height: 230)
                        Circle().stroke(GeorgieTheme.teal, lineWidth: 3).frame(width: 205, height: 205)
                        if let image = UIImage(named: "georgie-avatar") { Image(uiImage: image).resizable().scaledToFill().frame(width: 196, height: 196).clipShape(Circle()) }
                        else { Image(systemName: "person.crop.circle.fill").resizable().scaledToFit().frame(width: 180, height: 180).foregroundStyle(GeorgieTheme.tealSoft) }
                    }
                    Text("Georgie").font(.largeTitle.weight(.semibold)).foregroundStyle(GeorgieTheme.ivory)
                    Text("●  ONLINE & READY").font(.caption.weight(.semibold)).foregroundStyle(GeorgieTheme.tealSoft)

                    VStack(alignment: .leading, spacing: 8) {
                        Text("VOICE-FIRST ASSISTANT").font(.caption.weight(.bold)).foregroundStyle(GeorgieTheme.teal)
                        Text(voice.response).font(.body).foregroundStyle(GeorgieTheme.ivory).frame(maxWidth: .infinity, alignment: .leading)
                        if !voice.transcript.isEmpty { Text("You: \(voice.transcript)").font(.caption).foregroundStyle(.secondary) }
                    }.padding(18).background(GeorgieTheme.graphite.opacity(0.92)).clipShape(RoundedRectangle(cornerRadius: 20))

                    Button(action: voice.toggle) {
                        HStack(spacing: 12) { Image(systemName: voice.listening ? "stop.circle.fill" : "mic.circle.fill").font(.system(size: 30)); Text(voice.listening ? "LISTENING…" : "TALK TO GEORGIE").font(.headline) }
                        .frame(maxWidth: .infinity).padding(.vertical, 15)
                    }
                    .buttonStyle(.plain).foregroundStyle(GeorgieTheme.midnight).background(GeorgieTheme.tealSoft).clipShape(Capsule())

                    HStack {
                        TextField("Ask Georgie anything…", text: $typed).textFieldStyle(.plain).foregroundStyle(GeorgieTheme.ivory).padding(14).background(GeorgieTheme.graphite).clipShape(RoundedRectangle(cornerRadius: 16))
                        Button("Send") { let t = typed; typed = ""; voice.submit(t) }.buttonStyle(.borderedProminent).tint(GeorgieTheme.teal)
                    }

                    HStack(spacing: 10) {
                        quick("Safari", "safari")
                        quick("Calendar", "calendar")
                        quick("Maps", "maps")
                    }
                }.padding(20)
            }
        }
        .onAppear { consumeSystemWakeIfNeeded() }
        .onChange(of: scenePhase) { _, phase in if phase == .active { consumeSystemWakeIfNeeded() } }
    }

    private func consumeSystemWakeIfNeeded() {
        guard UserDefaults.standard.bool(forKey: "georgie.startListeningOnLaunch") else { return }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) { voice.startFromSystemInvocation() }
    }

    private func quick(_ label: String, _ app: String) -> some View {
        Button(label) { voice.submit("open \(app)") }.font(.caption.weight(.semibold)).foregroundStyle(GeorgieTheme.ivory).padding(.horizontal, 14).padding(.vertical, 10).background(GeorgieTheme.graphite).clipShape(Capsule())
    }
}
