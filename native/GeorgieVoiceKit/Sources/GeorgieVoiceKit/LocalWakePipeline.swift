import Foundation

public actor LocalWakePipeline {
    public enum Event: Sendable, Equatable {
        case standby
        case woke(WakeDecision)
        case ownerVerified(WakeDecision, speakerConfidence: Float)
        case rejected(reason: String)
    }

    private let detector: any WakePhraseDetecting
    private let verifier: any SpeakerVerifying
    private let buffer: EncryptedStandbyBuffer
    private let wakeThreshold: Float
    private let speakerThreshold: Float

    public init(
        detector: any WakePhraseDetecting,
        verifier: any SpeakerVerifying,
        buffer: EncryptedStandbyBuffer = .init(),
        wakeThreshold: Float = 0.88,
        speakerThreshold: Float = 0.86
    ) {
        self.detector = detector
        self.verifier = verifier
        self.buffer = buffer
        self.wakeThreshold = wakeThreshold
        self.speakerThreshold = speakerThreshold
    }

    public func ingestStandbyAudio(_ pcm16: Data, sampleRate: Double) async throws -> Event {
        try await buffer.append(pcm16)
        let localWindow = try await buffer.localSnapshotForDetection()
        let wake = try await detector.evaluate(pcm16: localWindow, sampleRate: sampleRate)
        guard wake.detected, wake.confidence >= wakeThreshold else { return .standby }
        let speaker = try await verifier.verifyOwner(pcm16: localWindow, sampleRate: sampleRate)
        guard speaker >= speakerThreshold else {
            await buffer.discard()
            return .rejected(reason: "speaker_not_verified")
        }
        await buffer.discard()
        return .ownerVerified(wake, speakerConfidence: speaker)
    }
}
