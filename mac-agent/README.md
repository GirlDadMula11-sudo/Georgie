# Georgie Mac Agent

The Mac Agent gives Georgie a secure, outbound-only connection to a trusted macOS desktop. It does **not** expose an inbound remote-control port to the internet and it does not provide an unrestricted shell.

## Current capabilities

- Heartbeat / online presence
- System information
- Open and activate allowlisted applications
- Open HTTP/HTTPS URLs
- Read and write clipboard text
- Show local notifications
- Read text files from Desktop, Documents, and Downloads
- Capture the current screen for visual reasoning
- Type text into the focused application
- Send a constrained set of navigation/editing keys and modifiers
- Return execution results and failures to Georgie
- Persistent job history on the Georgie server

Sensitive UI actions and screen capture are classified separately from low-risk actions so Georgie's server policy can require stronger authorization.

## Security model

The agent initiates HTTPS requests to the Georgie server. Server and Mac share a long random `GEORGIE_MAC_AGENT_TOKEN`. The server compares the bearer token using a timing-safe comparison. No arbitrary shell-command endpoint exists. File access is limited to the signed-in user's Desktop, Documents, and Downloads directories, and app launches are allowlisted.

## Install on the Mac

1. Clone the Georgie repository onto the Mac and run `npm install`.
2. Create a local `.env` file that contains:

```env
GEORGIE_SERVER_URL=https://YOUR-LIVE-GEORGIE-HOST
GEORGIE_MAC_AGENT_TOKEN=THE-SAME-LONG-RANDOM-SECRET-AS-THE-SERVER
GEORGIE_MAC_DEVICE_ID=primary-mac
GEORGIE_MAC_POLL_MS=5000
```

3. Test with `npm run mac-agent`.
4. For screen capture, enable **System Settings → Privacy & Security → Screen Recording** for the terminal/runtime that launches Georgie.
5. For typing/key automation, enable **System Settings → Privacy & Security → Accessibility** for the runtime.
6. For approved page-content inspection, enable **Develop → Allow JavaScript from Apple Events** in Safari and **View → Developer → Allow JavaScript from Apple Events** in Chrome. Georgie inventories every tab's title/URL, but extracts page text only from the approved Sierra operating domains. URL credentials, displayed credential patterns, password fields, and form values are excluded or redacted.
7. Once tested, install the LaunchAgent described below so Georgie starts automatically when the user logs in.

## LaunchAgent

Create `~/Library/LaunchAgents/com.georgie.mac-agent.plist` using the template in `mac-agent/com.georgie.mac-agent.plist.example`, replacing the Node and repository paths with the actual paths on the Mac. Then run:

```bash
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.georgie.mac-agent.plist
launchctl enable gui/$(id -u)/com.georgie.mac-agent
```

The Mac must be awake and logged in for GUI automation. macOS does not allow normal user applications to control a locked login screen, and Georgie intentionally does not bypass that security boundary.
