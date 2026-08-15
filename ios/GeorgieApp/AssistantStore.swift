import Foundation
import SwiftUI

@MainActor
final class AssistantStore: ObservableObject {
    @Published var messages: [GeorgieMessage] = []
    @Published var tasks: [GeorgieTask] = []
    @Published var status = "Online"
    @Published var isBusy = false
    @Published var isReady = false
    @Published var textInput = ""
    @Published var errorMessage: String?
    let audio = AudioEngine()

    func refreshDashboard() async {
        do {
            async let readiness = GeorgieAPI.shared.readiness()
            async let openTasks = GeorgieAPI.shared.tasks()
            let (r, t) = try await (readiness, openTasks)
            isReady = r.ready ?? false
            tasks = t
            status = isReady ? "Online" : "Connecting"
        } catch {
            status = "Limited"
            errorMessage = error.localizedDescription
        }
    }

    func sendText(_ input: String? = nil) async {
        let text = (input ?? textInput).trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, !isBusy else { return }
        textInput = ""
        messages.append(GeorgieMessage(role: "user", content: text))
        isBusy = true; status = "Thinking"
        defer { isBusy = false; status = "Online" }
        do {
            let response = try await GeorgieAPI.shared.respond(text)
            messages.append(GeorgieMessage(role: "assistant", content: response.text))
        } catch { errorMessage = error.localizedDescription }
    }

    func startVoice() async {
        guard !isBusy else { return }
        do { try await audio.startRecording(); status = "Listening" }
        catch { errorMessage = error.localizedDescription }
    }

    func finishVoice() async {
        guard let url = audio.stopRecording() else { return }
        isBusy = true; status = "Thinking"
        defer { isBusy = false; status = "Online"; try? FileManager.default.removeItem(at: url) }
        do {
            let response = try await GeorgieAPI.shared.voiceTurn(fileURL: url)
            messages.append(GeorgieMessage(role: "user", content: response.transcript))
            messages.append(GeorgieMessage(role: "assistant", content: response.text))
            try audio.play(base64: response.audioBase64)
        } catch { errorMessage = error.localizedDescription }
    }

    func handleDeepLink(_ url: URL) async {
        guard url.scheme == "georgie" else { return }
        switch url.host {
        case "voice": await startVoice()
        case "tasks": await refreshDashboard()
        default: break
        }
    }
}
