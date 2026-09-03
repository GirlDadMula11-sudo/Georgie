import Foundation

public enum GeorgieVoiceState: String, Sendable, Codable {
    case off, calibrating, standby, hearing, awake, listening, thinking
    case speaking, working, approvalNeeded, completed, blocked, paused
}

public struct WakeDecision: Sendable, Equatable {
    public let detected: Bool
    public let confidence: Float
    public let phrase: String

    public init(detected: Bool, confidence: Float, phrase: String = "hey georgie") {
        self.detected = detected
        self.confidence = min(max(confidence, 0), 1)
        self.phrase = phrase
    }
}

public protocol WakePhraseDetecting: Sendable {
    /// Must execute locally. Implementations may not perform network I/O.
    func evaluate(pcm16: Data, sampleRate: Double) async throws -> WakeDecision
}

public protocol SpeakerVerifying: Sendable {
    /// Must execute locally against an enrollment held in Keychain-protected storage.
    func verifyOwner(pcm16: Data, sampleRate: Double) async throws -> Float
}

public struct VerifiedVoiceCommand: Sendable, Codable, Equatable {
    public let transcript: String
    public let wakeConfidence: Float
    public let speakerConfidence: Float
    public let activatedAt: Date

    public init(transcript: String, wakeConfidence: Float, speakerConfidence: Float, activatedAt: Date = .init()) {
        self.transcript = transcript
        self.wakeConfidence = wakeConfidence
        self.speakerConfidence = speakerConfidence
        self.activatedAt = activatedAt
    }
}
