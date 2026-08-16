import Foundation
import UIKit

struct GeorgieMessage: Codable, Identifiable, Equatable {
    let id: UUID
    let role: String
    let content: String
    init(id: UUID = UUID(), role: String, content: String) { self.id = id; self.role = role; self.content = content }
}

struct GeorgieTask: Codable, Identifiable {
    let id: String
    let title: String
    let notes: String?
    let dueAt: String?
    let priority: String?
    let status: String
}

struct ReadinessEnvelope: Codable { let ok: Bool; let ready: Bool?; let activationState: String?; let blockers: [String]? }
struct TasksEnvelope: Codable { let ok: Bool; let tasks: [GeorgieTask] }
struct EnrollmentEnvelope: Codable { let ok: Bool; let token: String }
struct TextTurnEnvelope: Codable { let ok: Bool; let text: String; let responseId: String?; let remembered: Int? }
struct VoiceTurnEnvelope: Codable { let ok: Bool; let transcript: String; let text: String; let responseId: String?; let audioBase64: String?; let audioMimeType: String? }

enum GeorgieAPIError: LocalizedError {
    case invalidResponse
    case server(String)
    var errorDescription: String? { switch self { case .invalidResponse: "Georgie returned an invalid response."; case .server(let message): message } }
}

actor GeorgieAPI {
    static let shared = GeorgieAPI()
    private let decoder = JSONDecoder()
    nonisolated var isEnrolled: Bool { KeychainStore.read(account: GeorgieConfig.deviceTokenKey) != nil }

    private func request(path: String, method: String = "GET", body: Data? = nil, contentType: String? = "application/json", authenticated: Bool = true) -> URLRequest {
        var request = URLRequest(url: GeorgieConfig.baseURL.appendingPathComponent(path))
        request.httpMethod = method
        request.timeoutInterval = 60
        request.setValue(GeorgieConfig.deviceID, forHTTPHeaderField: GeorgieConfig.userHeader)
        request.setValue(GeorgieConfig.sessionID, forHTTPHeaderField: GeorgieConfig.sessionHeader)
        request.setValue("ios-native", forHTTPHeaderField: "X-Georgie-Client")
        if let contentType { request.setValue(contentType, forHTTPHeaderField: "Content-Type") }
        if authenticated, let token = KeychainStore.read(account: GeorgieConfig.deviceTokenKey) { request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        request.httpBody = body
        return request
    }

    private func run<T: Decodable>(_ request: URLRequest, as type: T.Type) async throws -> T {
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw GeorgieAPIError.invalidResponse }
        guard 200..<300 ~= http.statusCode else {
            let object = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
            throw GeorgieAPIError.server(object?["error"] as? String ?? "Georgie request failed (\(http.statusCode)).")
        }
        return try decoder.decode(T.self, from: data)
    }

    func readiness() async throws -> ReadinessEnvelope { try await run(request(path: "api/readiness", contentType: nil, authenticated: false), as: ReadinessEnvelope.self) }

    func enroll(code: String) async throws {
        let data = try JSONSerialization.data(withJSONObject: ["code": code, "deviceId": GeorgieConfig.deviceID, "deviceName": await UIDevice.current.name])
        let result = try await run(request(path: "api/mobile/enroll", method: "POST", body: data, authenticated: false), as: EnrollmentEnvelope.self)
        KeychainStore.save(result.token, account: GeorgieConfig.deviceTokenKey)
    }

    func tasks() async throws -> [GeorgieTask] {
        guard isEnrolled else { return [] }
        let envelope = try await run(request(path: "api/mobile/tasks", contentType: nil), as: TasksEnvelope.self)
        return envelope.tasks
    }

    func respond(_ input: String) async throws -> TextTurnEnvelope {
        guard isEnrolled else { throw GeorgieAPIError.server("This iPhone must be securely activated first.") }
        let data = try JSONSerialization.data(withJSONObject: ["input": input])
        return try await run(request(path: "api/mobile/respond", method: "POST", body: data), as: TextTurnEnvelope.self)
    }

    func voiceTurn(fileURL: URL) async throws -> VoiceTurnEnvelope {
        guard isEnrolled else { throw GeorgieAPIError.server("This iPhone must be securely activated first.") }
        let audio = try Data(contentsOf: fileURL), boundary = "Boundary-\(UUID().uuidString)"
        var body = Data()
        body.append("--\(boundary)\r\nContent-Disposition: form-data; name=\"audio\"; filename=\"voice.m4a\"\r\nContent-Type: audio/mp4\r\n\r\n".data(using: .utf8)!)
        body.append(audio); body.append("\r\n--\(boundary)--\r\n".data(using: .utf8)!)
        return try await run(request(path: "api/mobile/voice-turn", method: "POST", body: body, contentType: "multipart/form-data; boundary=\(boundary)"), as: VoiceTurnEnvelope.self)
    }
}
