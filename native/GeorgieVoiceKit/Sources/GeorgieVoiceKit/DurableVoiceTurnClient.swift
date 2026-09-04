import Foundation

public struct DurableVoiceTurnClient: Sendable {
    private let baseURL: URL
    private let deviceToken: String
    private let deviceID: String
    private let sessionID: String

    public init(baseURL: URL, deviceToken: String, deviceID: String, sessionID: String) {
        self.baseURL = baseURL
        self.deviceToken = deviceToken
        self.deviceID = deviceID
        self.sessionID = sessionID
    }

    public func submit(_ command: VerifiedVoiceCommand) async throws -> (Data, HTTPURLResponse) {
        var request = URLRequest(url: baseURL.appending(path: "api/mobile/respond/stream"))
        request.httpMethod = "POST"
        request.setValue("Bearer \(deviceToken)", forHTTPHeaderField: "Authorization")
        request.setValue(deviceID, forHTTPHeaderField: "X-Georgie-Device")
        request.setValue(sessionID, forHTTPHeaderField: "X-Georgie-Session")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(UUID().uuidString, forHTTPHeaderField: "Idempotency-Key")
        request.httpBody = try JSONEncoder().encode(["input": command.transcript])
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw URLError(.badServerResponse) }
        return (data, http)
    }
}
