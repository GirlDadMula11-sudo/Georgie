import AppKit
import Foundation
import Carbon.HIToolbox

final class GeorgieWindowController: NSWindowController, NSTextFieldDelegate {
    private let server = URL(string: "https://georgie.onrender.com")!
    private let responseLabel = NSTextField(labelWithString: "Ready.")
    private let input = NSTextField(string: "")
    private let avatar = NSImageView()

    init() {
        let window = NSPanel(contentRect: NSRect(x: 0, y: 0, width: 420, height: 560), styleMask: [.titled, .closable, .utilityWindow], backing: .buffered, defer: false)
        window.title = "Georgie"
        window.isReleasedWhenClosed = false
        super.init(window: window)
        buildUI()
    }

    required init?(coder: NSCoder) { fatalError() }

    private func buildUI() {
        guard let content = window?.contentView else { return }
        content.wantsLayer = true
        content.layer?.backgroundColor = NSColor(calibratedWhite: 0.05, alpha: 1).cgColor

        avatar.frame = NSRect(x: 135, y: 330, width: 150, height: 150)
        avatar.imageScaling = .scaleProportionallyUpOrDown
        avatar.wantsLayer = true
        avatar.layer?.cornerRadius = 75
        avatar.layer?.masksToBounds = true
        if let resource = Bundle.main.path(forResource: "georgie-avatar", ofType: "jpg"), let image = NSImage(contentsOfFile: resource) { avatar.image = image }
        content.addSubview(avatar)

        let title = NSTextField(labelWithString: "GEORGIE")
        title.font = NSFont.systemFont(ofSize: 30, weight: .semibold)
        title.textColor = NSColor(calibratedRed: 0.94, green: 0.80, blue: 0.45, alpha: 1)
        title.alignment = .center
        title.frame = NSRect(x: 40, y: 290, width: 340, height: 42)
        content.addSubview(title)

        responseLabel.frame = NSRect(x: 34, y: 145, width: 352, height: 130)
        responseLabel.maximumNumberOfLines = 7
        responseLabel.lineBreakMode = .byWordWrapping
        responseLabel.textColor = .white
        responseLabel.font = NSFont.systemFont(ofSize: 15)
        content.addSubview(responseLabel)

        input.frame = NSRect(x: 34, y: 78, width: 270, height: 38)
        input.placeholderString = "Ask Georgie…"
        input.delegate = self
        content.addSubview(input)

        let send = NSButton(title: "Send", target: self, action: #selector(sendPressed))
        send.frame = NSRect(x: 312, y: 78, width: 74, height: 38)
        content.addSubview(send)

        let hint = NSTextField(labelWithString: "⌥ Space opens Georgie anywhere on your Mac")
        hint.frame = NSRect(x: 34, y: 34, width: 352, height: 22)
        hint.alignment = .center
        hint.textColor = .secondaryLabelColor
        content.addSubview(hint)
    }

    func show() {
        NSApp.activate(ignoringOtherApps: true)
        window?.center()
        showWindow(nil)
        input.becomeFirstResponder()
    }

    func control(_ control: NSControl, textView: NSTextView, doCommandBy commandSelector: Selector) -> Bool {
        if commandSelector == #selector(NSResponder.insertNewline(_:)) { sendPressed(); return true }
        return false
    }

    @objc private func sendPressed() {
        let text = input.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        input.stringValue = ""
        responseLabel.stringValue = "Working…"
        if executeLocalCommand(text) { return }
        askCloud(text)
    }

    private func executeLocalCommand(_ raw: String) -> Bool {
        let text = raw.lowercased().replacingOccurrences(of: "georgie,", with: "").trimmingCharacters(in: .whitespacesAndNewlines)
        let apps: [String:String] = ["safari":"Safari", "chrome":"Google Chrome", "notes":"Notes", "mail":"Mail", "finder":"Finder", "calendar":"Calendar", "messages":"Messages", "preview":"Preview", "system settings":"System Settings", "excel":"Microsoft Excel", "word":"Microsoft Word"]
        for prefix in ["open ", "launch ", "start "] where text.hasPrefix(prefix) {
            let requested = String(text.dropFirst(prefix.count)).trimmingCharacters(in: .whitespacesAndNewlines)
            if let app = apps[requested] {
                let ok = NSWorkspace.shared.launchApplication(app)
                responseLabel.stringValue = ok ? "\(app) is open." : "I couldn't open \(app)."
                return true
            }
        }
        return false
    }

    private func askCloud(_ text: String) {
        var req = URLRequest(url: server.appendingPathComponent("api/respond"))
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.setValue("primary", forHTTPHeaderField: "X-Georgie-User")
        req.setValue("native-mac", forHTTPHeaderField: "X-Georgie-Session")
        req.httpBody = try? JSONSerialization.data(withJSONObject: ["input": text, "history": []])
        URLSession.shared.dataTask(with: req) { [weak self] data, response, error in
            DispatchQueue.main.async {
                if let error = error { self?.responseLabel.stringValue = "Georgie cloud error: \(error.localizedDescription)"; return }
                guard let data = data, let obj = try? JSONSerialization.jsonObject(with: data) as? [String:Any] else { self?.responseLabel.stringValue = "Georgie returned an unreadable response."; return }
                if let text = obj["text"] as? String { self?.responseLabel.stringValue = text }
                else if let err = obj["error"] as? String { self?.responseLabel.stringValue = err }
                else { self?.responseLabel.stringValue = "Georgie did not return a response." }
            }
        }.resume()
    }
}

final class AppDelegate: NSObject, NSApplicationDelegate {
    let windowController = GeorgieWindowController()
    var statusItem: NSStatusItem!
    var hotKeyRef: EventHotKeyRef?

    func applicationDidFinishLaunching(_ notification: Notification) {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        statusItem.button?.image = NSImage(systemSymbolName: "person.crop.circle.fill", accessibilityDescription: "Georgie")
        let menu = NSMenu()
        menu.addItem(NSMenuItem(title: "Open Georgie", action: #selector(showGeorgie), keyEquivalent: ""))
        menu.addItem(NSMenuItem.separator())
        menu.addItem(NSMenuItem(title: "Quit Georgie", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q"))
        statusItem.menu = menu
        registerHotKey()
    }

    private func registerHotKey() {
        var id = EventHotKeyID(signature: OSType(0x47454F52), id: 1)
        RegisterEventHotKey(UInt32(kVK_Space), UInt32(optionKey), id, GetApplicationEventTarget(), 0, &hotKeyRef)
        InstallEventHandler(GetApplicationEventTarget(), { _, event, userData in
            guard let userData = userData else { return noErr }
            let app = Unmanaged<AppDelegate>.fromOpaque(userData).takeUnretainedValue()
            app.showGeorgie()
            return noErr
        }, 1, [EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyPressed))], Unmanaged.passUnretained(self).toOpaque(), nil)
    }

    @objc func showGeorgie() { windowController.show() }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.accessory)
app.run()
