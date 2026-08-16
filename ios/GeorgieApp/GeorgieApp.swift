import SwiftUI
import AppIntents

@main
struct GeorgieApp: App {
    @StateObject private var store = AssistantStore()
    @Environment(\.scenePhase) private var scenePhase

    init() {
        GeorgieShortcuts.updateAppShortcutParameters()
    }

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(store)
                .preferredColorScheme(.dark)
                .onOpenURL { url in
                    Task { await store.handleDeepLink(url) }
                }
                .task {
                    await NotificationManager.shared.requestAuthorization()
                    await store.refreshDashboard()
                    await store.consumePendingVoiceLaunch()
                }
        }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active {
                Task {
                    await store.refreshDashboard()
                    await store.consumePendingVoiceLaunch()
                }
            }
        }
    }
}
