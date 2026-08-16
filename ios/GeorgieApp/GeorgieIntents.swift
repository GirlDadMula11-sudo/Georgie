import AppIntents
import Foundation

struct AskGeorgieIntent: AppIntent {
    static var title: LocalizedStringResource = "Ask Georgie"
    static var description = IntentDescription("Ask Georgie something without hunting for the app.")
    static var openAppWhenRun = false

    @Parameter(title: "Question") var question: String

    func perform() async throws -> some IntentResult & ProvidesDialog {
        let response = try await GeorgieAPI.shared.respond(question)
        return .result(dialog: IntentDialog(stringLiteral: response.text))
    }
}

struct OpenGeorgieVoiceIntent: AppIntent {
    static var title: LocalizedStringResource = "Talk to Georgie"
    static var description = IntentDescription("Open Georgie directly in voice mode.")
    static var openAppWhenRun = true

    func perform() async throws -> some IntentResult {
        UserDefaults.standard.set(true, forKey: "georgie:startVoiceOnLaunch")
        return .result()
    }
}

struct GeorgiePrioritiesIntent: AppIntent {
    static var title: LocalizedStringResource = "Georgie Priorities"
    static var description = IntentDescription("Have Georgie summarize your open priorities.")

    func perform() async throws -> some IntentResult & ProvidesDialog {
        let tasks = try await GeorgieAPI.shared.tasks()
        if tasks.isEmpty { return .result(dialog: "You have no open Georgie tasks right now.") }
        let summary = tasks.prefix(5).enumerated().map { "\($0.offset + 1). \($0.element.title)" }.joined(separator: ". ")
        return .result(dialog: IntentDialog(stringLiteral: "Your top priorities are: \(summary)"))
    }
}

struct GeorgieShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(intent: AskGeorgieIntent(), phrases: ["Ask \(.applicationName)", "Talk to \(.applicationName)"], shortTitle: "Ask Georgie", systemImageName: "bubble.left.and.waveform")
        AppShortcut(intent: OpenGeorgieVoiceIntent(), phrases: ["Open \(.applicationName) voice", "Wake \(.applicationName)"], shortTitle: "Talk to Georgie", systemImageName: "mic.fill")
        AppShortcut(intent: GeorgiePrioritiesIntent(), phrases: ["What are my \(.applicationName) priorities", "Ask \(.applicationName) what needs attention"], shortTitle: "Priorities", systemImageName: "checklist")
    }
}
