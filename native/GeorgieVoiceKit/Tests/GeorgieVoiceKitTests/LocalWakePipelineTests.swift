import XCTest
@testable import GeorgieVoiceKit

private struct WakeStub: WakePhraseDetecting {
    let decision: WakeDecision
    func evaluate(pcm16: Data, sampleRate: Double) async throws -> WakeDecision { decision }
}

private struct SpeakerStub: SpeakerVerifying {
    let confidence: Float
    func verifyOwner(pcm16: Data, sampleRate: Double) async throws -> Float { confidence }
}

final class LocalWakePipelineTests: XCTestCase {
    func testRejectsUnverifiedSpeakerAfterWake() async throws {
        let pipeline = LocalWakePipeline(
            detector: WakeStub(decision: .init(detected: true, confidence: 0.99)),
            verifier: SpeakerStub(confidence: 0.2)
        )
        let event = try await pipeline.ingestStandbyAudio(Data(repeating: 7, count: 1_024), sampleRate: 16_000)
        XCTAssertEqual(event, .rejected(reason: "speaker_not_verified"))
    }

    func testVerifiedOwnerActivatesExactlyOncePerAudioWindow() async throws {
        let pipeline = LocalWakePipeline(
            detector: WakeStub(decision: .init(detected: true, confidence: 0.97)),
            verifier: SpeakerStub(confidence: 0.95)
        )
        let event = try await pipeline.ingestStandbyAudio(Data(repeating: 9, count: 1_024), sampleRate: 16_000)
        XCTAssertEqual(event, .ownerVerified(.init(detected: true, confidence: 0.97), speakerConfidence: 0.95))
    }

    func testSubthresholdWakeRemainsStandby() async throws {
        let pipeline = LocalWakePipeline(
            detector: WakeStub(decision: .init(detected: true, confidence: 0.5)),
            verifier: SpeakerStub(confidence: 1)
        )
        let event = try await pipeline.ingestStandbyAudio(Data(repeating: 3, count: 1_024), sampleRate: 16_000)
        XCTAssertEqual(event, .standby)
    }
}
