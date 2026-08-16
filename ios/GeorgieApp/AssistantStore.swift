import Foundation
import SwiftUI

@MainActor
final class AssistantStore: ObservableObject {
    @Published var messages: [GeorgieMessage] = []
    @Published var tasks: [GeorgieTask] = []
    @Published var sierraDeals: [SierraDealSummary] = []
    @Published var sierraHealthStatus = "Connecting"
    @Published var status = "Online"
    @Published var isBusy = false
    @Published var isReady = false
    @Published var isEnrolled = KeychainStore.read(account: GeorgieConfig.deviceTokenKey) != nil
    @Published var enrollmentCode = ""
    @Published var textInput = ""
    @Published var errorMessage: String?
    let audio = AudioEngine()
    private let pendingVoiceKey = "georgie:startVoiceOnLaunch"

    func enroll() async {
        let code = enrollmentCode.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !code.isEmpty, !isBusy else { return }
        isBusy = true
        status = "Activating"
        defer { isBusy = false }
        do {
            try await GeorgieAPI.shared.enroll(code: code)
            enrollmentCode = ""
            isEnrolled = true
            status = "Secured"
            await refreshDashboard()
        } catch {
            isEnrolled = KeychainStore.read(account: GeorgieConfig.deviceTokenKey) != nil
            status = "Activation needed"
            errorMessage = error.localizedDescription
        }
    }

    func refreshDashboard() async {
        do {
            let r = try await GeorgieAPI.shared.readiness()
            isReady = r.ready ?? false
            if KeychainStore.read(account: GeorgieConfig.deviceTokenKey) != nil {
                _ = try await GeorgieAPI.shared.verifyEnrollment()
                isEnrolled = true
                async let taskRequest = GeorgieAPI.shared.tasks()
                async let sierraRequest = GeorgieAPI.shared.sierraPortfolio()
                async let healthRequest = GeorgieAPI.shared.sierraHealth()
                tasks = try await taskRequest
                sierraDeals = try await sierraRequest
                let health = try await healthRequest
                sierraHealthStatus = (health.healthStatus ?? "Connected").replacingOccurrences(of: "_", with: " ").capitalized
            } else {
                isEnrolled = false
                tasks = []
                sierraDeals = []
                sierraHealthStatus = "Secure activation required"
            }
            status = !isEnrolled ? "Activation needed" : (isReady ? "Online" : "Connecting")
        } catch {
            isEnrolled = KeychainStore.read(account: GeorgieConfig.deviceTokenKey) != nil
            if !isEnrolled {
                tasks = []
                sierraDeals = []
                sierraHealthStatus = "Secure activation required"
            } else {
                sierraHealthStatus = "Limited"
            }
            status = isEnrolled ? "Limited" : "Activation needed"
            errorMessage = error.localizedDescription
        }
    }

    func askAboutSierraDeal(_ deal: SierraDealSummary) async {
        await sendText("Give me the complete Sierra desk brief for \(deal.referenceNumber). Explain what matters, blockers, underwriting evidence, lender activity, offers, and the next best action.")
    }

    func sendText(_ input: String? = nil) async {
        guard isEnrolled else { errorMessage = "Activate this iPhone to use Georgie."; return }
        let text = (input ?? textInput).trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, !isBusy else { return }
        textInput = ""
        messages.append(GeorgieMessage(role: "user", content: text))
        isBusy = true
        status = "Thinking"
        defer { isBusy = false; status = "Online" }
        do {
            let response = try await GeorgieAPI.shared.respond(text)
            messages.append(GeorgieMessage(role: "assistant", content: response.text))
        } catch {
            isEnrolled = KeychainStore.read(account: GeorgieConfig.deviceTokenKey) != nil
            errorMessage = error.localizedDescription
        }
    }

    func startVoice() async {
        guard isEnrolled else { errorMessage = "Activate this iPhone to use Georgie."; return }
        guard !isBusy, !audio.isRecording else { return }
        do {
            try await audio.startRecording()
            status = "Listening"
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func finishVoice() async {
        guard let url = audio.stopRecording() else { return }
        isBusy = true
        status = "Thinking"
        defer {
            isBusy = false
            status = "Online"
            try? FileManager.default.removeItem(at: url)
        }
        do {
            let response = try await GeorgieAPI.shared.voiceTurn(fileURL: url)
            messages.append(GeorgieMessage(role: "user", content: response.transcript))
            messages.append(GeorgieMessage(role: "assistant", content: response.text))
            try audio.play(base64: response.audioBase64)
        } catch {
            isEnrolled = KeychainStore.read(account: GeorgieConfig.deviceTokenKey) != nil
            errorMessage = error.localizedDescription
        }
    }

    func consumePendingVoiceLaunch() async {
        guard UserDefaults.standard.bool(forKey: pendingVoiceKey) else { return }
        UserDefaults.standard.set(false, forKey: pendingVoiceKey)
        if !isEnrolled { await refreshDashboard() }
        guard isEnrolled else {
            errorMessage = "Activate this iPhone before using the Georgie voice shortcut."
            return
        }
        await startVoice()
    }

    func handleDeepLink(_ url: URL) async {
        guard url.scheme == "georgie" else { return }
        switch url.host {
        case "voice":
            UserDefaults.standard.set(true, forKey: pendingVoiceKey)
            await consumePendingVoiceLaunch()
        case "tasks":
            await refreshDashboard()
        case "sierra":
            await refreshDashboard()
        default:
            break
        }
    }
}
