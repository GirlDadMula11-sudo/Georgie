import Foundation

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

struct ReadinessEnvelope: Codable {
    let ok: Bool
    let ready: Bool?
    let activationState: String?
    let blockers: [String]?
}

struct TasksEnvelope: Codable { let ok: Bool; let tasks: [GeorgieTask] }
struct TextTurnEnvelope: Codable { let ok: Bool; let text: String; let responseId: String?; let remembered: Int? }
struct VoiceTurnEnvelope: Codable {
    let ok: Bool
    let transcript: String
    let text: String
    let responseId: String?
    let audioBase64: String?
    let audioMimeType: String?
}

enum GeorgieAPIError: LocalizedError {
    case invalidResponse
    case server(String)
    var errorDescription: String? { switch self { case .invalidResponse: "Georgie returned an invalid response."; case .server(let message): message } }
}

actor GeorgieAPI {
    static let shared = GeorgieAPI()
    private let decoder = JSONDecoder()

    private func request(path: String, method: String = "GET", body: Data? = nil, contentType: String? = "application/json") -> URLRequest {
        var request = URLRequest(url: GeorgieConfig.baseURL.appendingPathComponent(path))
        request.httpMethod = method
        request.timeoutInterval = 60
        request.setValue(GeorgieConfig.deviceID, forHTTPHeaderField: GeorgieConfig.userHeader)
        request.setValue(GeorgieConfig.sessionID, forHTTPHeaderField: GeorgieConfig.sessionHeader)
        request.setValue("ios-native", forHTTPHeaderField: "X-Georgie-Client")
        if let contentType { request.setValue(contentType, forHTTPHeaderField: "Content-Type") }
        if let token = KeychainStore.read(account: GeorgieConfig.deviceTokenKey) {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
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

    func readiness() async throws -> ReadinessEnvelope {
        try await run(request(path: "api/readiness", contentType: nil), as: ReadinessEnvelope.self)
    }

    func tasks() async throws -> [GeorgieTask] {
        let envelope = try await run(request(path: "api/tasks?status=open&limit=20", contentType: nil), as: TasksEnvelope.self)
        return envelope.tasks
    }

    func respond(_ input: String) async throws -> TextTurnEnvelope {
        let data = try JSONSerialization.data(withJSONObject: ["input": input])
        return try await run(request(path: "api/respond", method: "POST", body: data), as: TextTurnEnvelope.self)
    }

    func voiceTurn(fileURL: URL) async throws -> VoiceTurnEnvelope {
        let audio = try Data(contentsOf: fileURL)
        let boundary = "Boundary-\(UUID().uuidString)"
        var body = Data()
        body.append("--\(boundary)\r\nContent-Disposition: form-data; name=\"audio\"; filename=\"voice.m4a\"\r\nContent-Type: audio/mp4\r\n\r\n".data(using: .utf8)!)
        body.append(audio)
        body.append("\r\n--\(boundary)--\r\n".data(using: .utf8)!)
        let request = request(path: "api/voice-turn", method: "POST", body: body, contentType: "multipart/form-data; boundary=\(boundary)")
        return try await run(request, as: VoiceTurnEnvelope.self)
    }
}
