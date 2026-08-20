import AVFoundation
import Foundation

final class GeorgieRealtimeVoice: NSObject {
    private let endpoint = URL(string: "wss://georgie.onrender.com/api/realtime?userId=primary")!
    private let session = URLSession(configuration: .default)
    private var socket: URLSessionWebSocketTask?
    private let captureEngine = AVAudioEngine()
    private let playbackEngine = AVAudioEngine()
    private let player = AVAudioPlayerNode()
    private var converter: AVAudioConverter?
    private var running = false
    private var playbackReady = false

    var onReady: (() -> Void)?
    var onUserTranscript: ((String) -> Void)?
    var onAssistantTranscript: ((String) -> Void)?
    var onError: ((String) -> Void)?
    var onSpeakingChanged: ((Bool) -> Void)?

    override init() {
        super.init()
        playbackEngine.attach(player)
        let format = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: 24000, channels: 1, interleaved: false)!
        playbackEngine.connect(player, to: playbackEngine.mainMixerNode, format: format)
        playbackEngine.prepare()
        do {
            try playbackEngine.start()
            playbackReady = true
        } catch {
            playbackReady = false
        }
    }

    var isActive: Bool { running }
    var isSpeaking: Bool { player.isPlaying }

    @discardableResult
    func start() -> Bool {
        if running { return true }
        running = true
        var request = URLRequest(url: endpoint)
        request.timeoutInterval = 20
        request.setValue("primary", forHTTPHeaderField: "X-Georgie-User")
        let task = session.webSocketTask(with: request)
        socket = task
        task.resume()
        receiveNext()
        return true
    }

    func stop() {
        running = false
        stopCapture()
        stopPlayback()
        socket?.cancel(with: .goingAway, reason: nil)
        socket = nil
    }

    func sendText(_ text: String) {
        sendJSON(["type": "text", "text": text])
    }

    private func receiveNext() {
        guard running, let socket = socket else { return }
        socket.receive { [weak self] result in
            guard let self = self, self.running else { return }
            switch result {
            case .failure(let error):
                DispatchQueue.main.async { self.onError?(error.localizedDescription) }
                self.stop()
            case .success(let message):
                let text: String
                switch message {
                case .string(let value): text = value
                case .data(let data): text = String(data: data, encoding: .utf8) ?? ""
                @unknown default: text = ""
                }
                self.handleServerMessage(text)
                self.receiveNext()
            }
        }
    }

    private func handleServerMessage(_ text: String) {
        guard let data = text.data(using: .utf8),
              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let type = obj["type"] as? String else { return }

        switch type {
        case "georgie.realtime.ready", "session.updated":
            if !captureEngine.isRunning { startCapture() }
            DispatchQueue.main.async { self.onReady?() }

        case "input_audio_buffer.speech_started":
            stopPlayback()
            DispatchQueue.main.async { self.onSpeakingChanged?(false) }

        case "response.output_audio.delta":
            if let delta = obj["delta"] as? String, let audio = Data(base64Encoded: delta) {
                playPCM16(audio)
            }

        case "response.output_audio_transcript.delta":
            if let delta = obj["delta"] as? String, !delta.isEmpty {
                DispatchQueue.main.async { self.onAssistantTranscript?(delta) }
            }

        case "conversation.item.input_audio_transcription.completed", "conversation.item.input_audio_transcription.done":
            if let transcript = obj["transcript"] as? String, !transcript.isEmpty {
                DispatchQueue.main.async { self.onUserTranscript?(transcript) }
            }

        case "response.output_audio.done", "response.done":
            DispatchQueue.main.async { self.onSpeakingChanged?(false) }

        case "error", "georgie.error":
            let message: String
            if let error = obj["error"] as? [String: Any] { message = error["message"] as? String ?? "Realtime error" }
            else { message = obj["error"] as? String ?? "Realtime error" }
            DispatchQueue.main.async { self.onError?(message) }

        default:
            break
        }
    }

    private func startCapture() {
        guard running, !captureEngine.isRunning else { return }
        let input = captureEngine.inputNode
        let sourceFormat = input.outputFormat(forBus: 0)
        guard sourceFormat.sampleRate > 0 else {
            DispatchQueue.main.async { self.onError?("Microphone format unavailable") }
            return
        }
        guard let targetFormat = AVAudioFormat(commonFormat: .pcmFormatInt16, sampleRate: 24000, channels: 1, interleaved: false),
              let converter = AVAudioConverter(from: sourceFormat, to: targetFormat) else {
            DispatchQueue.main.async { self.onError?("Could not prepare realtime audio conversion") }
            return
        }
        self.converter = converter

        input.removeTap(onBus: 0)
        input.installTap(onBus: 0, bufferSize: 960, format: sourceFormat) { [weak self] buffer, _ in
            self?.convertAndSend(buffer, converter: converter, targetFormat: targetFormat)
        }
        captureEngine.prepare()
        do {
            try captureEngine.start()
        } catch {
            DispatchQueue.main.async { self.onError?("Microphone start failed: \(error.localizedDescription)") }
        }
    }

    private func stopCapture() {
        if captureEngine.isRunning { captureEngine.stop() }
        captureEngine.inputNode.removeTap(onBus: 0)
        converter = nil
    }

    private func convertAndSend(_ input: AVAudioPCMBuffer, converter: AVAudioConverter, targetFormat: AVAudioFormat) {
        let ratio = targetFormat.sampleRate / input.format.sampleRate
        let capacity = AVAudioFrameCount(max(1, Int(Double(input.frameLength) * ratio) + 64))
        guard let output = AVAudioPCMBuffer(pcmFormat: targetFormat, frameCapacity: capacity) else { return }
        var supplied = false
        var conversionError: NSError?
        let status = converter.convert(to: output, error: &conversionError) { _, outStatus in
            if supplied {
                outStatus.pointee = .noDataNow
                return nil
            }
            supplied = true
            outStatus.pointee = .haveData
            return input
        }
        guard status != .error, conversionError == nil, output.frameLength > 0,
              let channel = output.int16ChannelData?[0] else { return }
        let bytes = Data(bytes: channel, count: Int(output.frameLength) * MemoryLayout<Int16>.size)
        sendJSON(["type": "audio", "audio": bytes.base64EncodedString()])
    }

    private func sendJSON(_ obj: [String: Any]) {
        guard running, let socket = socket,
              let data = try? JSONSerialization.data(withJSONObject: obj),
              let string = String(data: data, encoding: .utf8) else { return }
        socket.send(.string(string)) { [weak self] error in
            if let error = error {
                DispatchQueue.main.async { self?.onError?(error.localizedDescription) }
            }
        }
    }

    private func playPCM16(_ data: Data) {
        guard playbackReady, !data.isEmpty else { return }
        let sampleCount = data.count / MemoryLayout<Int16>.size
        guard sampleCount > 0,
              let format = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: 24000, channels: 1, interleaved: false),
              let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(sampleCount)),
              let floats = buffer.floatChannelData?[0] else { return }
        buffer.frameLength = AVAudioFrameCount(sampleCount)
        data.withUnsafeBytes { raw in
            let samples = raw.bindMemory(to: Int16.self)
            for i in 0..<sampleCount { floats[i] = Float(samples[i]) / 32768.0 }
        }
        if !player.isPlaying {
            player.play()
            DispatchQueue.main.async { self.onSpeakingChanged?(true) }
        }
        player.scheduleBuffer(buffer, completionHandler: nil)
    }

    private func stopPlayback() {
        if player.isPlaying {
            player.stop()
            player.play()
        }
    }
}
