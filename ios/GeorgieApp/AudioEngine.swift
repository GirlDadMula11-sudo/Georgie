import Foundation
import AVFoundation

@MainActor
final class AudioEngine: NSObject, ObservableObject, AVAudioPlayerDelegate {
    @Published private(set) var isRecording = false
    @Published private(set) var isSpeaking = false
    private var recorder: AVAudioRecorder?
    private var player: AVAudioPlayer?
    var onPlaybackFinished: (() -> Void)?

    func requestPermission() async -> Bool {
        await withCheckedContinuation { continuation in
            AVAudioApplication.requestRecordPermission { allowed in continuation.resume(returning: allowed) }
        }
    }

    func startRecording() async throws {
        guard await requestPermission() else { throw NSError(domain: "GeorgieAudio", code: 1, userInfo: [NSLocalizedDescriptionKey: "Microphone access is required."]) }
        stopPlayback()
        let session = AVAudioSession.sharedInstance()
        try session.setCategory(.playAndRecord, mode: .voiceChat, options: [.defaultToSpeaker, .allowBluetooth])
        try session.setActive(true)
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("georgie-\(UUID().uuidString).m4a")
        let settings: [String: Any] = [
            AVFormatIDKey: Int(kAudioFormatMPEG4AAC),
            AVSampleRateKey: 44_100,
            AVNumberOfChannelsKey: 1,
            AVEncoderAudioQualityKey: AVAudioQuality.high.rawValue
        ]
        let nextRecorder = try AVAudioRecorder(url: url, settings: settings)
        nextRecorder.isMeteringEnabled = true
        guard nextRecorder.prepareToRecord(), nextRecorder.record() else {
            throw NSError(domain: "GeorgieAudio", code: 2, userInfo: [NSLocalizedDescriptionKey: "Georgie could not start the microphone."])
        }
        recorder = nextRecorder
        isRecording = true
    }

    func voiceLevel() -> Float {
        guard let recorder, recorder.isRecording else { return -160 }
        recorder.updateMeters()
        return recorder.averagePower(forChannel: 0)
    }

    var recordingDuration: TimeInterval { recorder?.currentTime ?? 0 }

    func stopRecording() -> URL? {
        guard let recorder else { return nil }
        recorder.stop()
        self.recorder = nil
        isRecording = false
        return recorder.url
    }

    func play(base64: String?) throws {
        guard let base64, let data = Data(base64Encoded: base64) else { return }
        stopPlayback()
        let session = AVAudioSession.sharedInstance()
        try session.setCategory(.playback, mode: .spokenAudio)
        try session.setActive(true)
        player = try AVAudioPlayer(data: data)
        player?.delegate = self
        player?.prepareToPlay()
        player?.play()
        isSpeaking = true
    }

    func stopPlayback() {
        player?.stop()
        player = nil
        isSpeaking = false
    }

    nonisolated func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
        Task { @MainActor in
            self.isSpeaking = false
            if flag { self.onPlaybackFinished?() }
        }
    }
}
