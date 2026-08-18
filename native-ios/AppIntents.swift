import AppIntents
import Foundation

struct TalkToGeorgieIntent: AppIntent {
    static var title: LocalizedStringResource = "Talk to Georgie"
    static var description = IntentDescription("Open Georgie and immediately begin a voice conversation.")
    static var openAppWhenRun: Bool = true

    @MainActor
    func perform() async throws -> some IntentResult {
        UserDefaults.standard.set(true, forKey: "georgie.startListeningOnLaunch")
        NotificationCenter.default.post(name: .georgieStartListening, object: nil)
        return .result()
    }
}

struct GeorgieAppShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: TalkToGeorgieIntent(),
            phrases: [
                "Talk to \(.applicationName)",
                "Ask \(.applicationName)",
                "Open \(.applicationName) and listen"
            ],
            shortTitle: "Talk to Georgie",
            systemImageName: "waveform.circle.fill"
        )
    }
}

extension Notification.Name {
    static let georgieStartListening = Notification.Name("georgie.startListening")
}
