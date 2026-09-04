import Foundation
import Speech

public actor OnDeviceTranscriber {
    public enum Failure: Error { case unsupported, emptyTranscript }
    private let recognizer: SFSpeechRecognizer?

    public init(locale: Locale = Locale(identifier: "en-US")) {
        recognizer = SFSpeechRecognizer(locale: locale)
    }

    public func transcribeActivatedAudio(at fileURL: URL, contextualVocabulary: [String]) async throws -> String {
        guard let recognizer, recognizer.supportsOnDeviceRecognition else { throw Failure.unsupported }
        let request = SFSpeechURLRecognitionRequest(url: fileURL)
        request.requiresOnDeviceRecognition = true
        request.contextualStrings = Array(contextualVocabulary.prefix(100))
        let text = try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<String, Error>) in
            var task: SFSpeechRecognitionTask?
            task = recognizer.recognitionTask(with: request) { result, error in
                if let error { task?.cancel(); continuation.resume(throwing: error); return }
                guard let result, result.isFinal else { return }
                task?.finish()
                continuation.resume(returning: result.bestTranscription.formattedString)
            }
        }
        guard !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { throw Failure.emptyTranscript }
        return text
    }
}
