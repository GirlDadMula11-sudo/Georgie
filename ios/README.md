# Georgie Native iPhone App

This directory contains the native SwiftUI layer for Georgie. The native app does not duplicate Georgie's intelligence; it securely connects the iPhone experience to the existing Georgie backend.

## Native capabilities

- SwiftUI premium Georgie interface using the canonical Georgie portrait
- Native microphone capture and spoken response playback
- Durable Georgie tasks/memory through the production backend
- Siri / App Intents / Shortcuts integration
- Shortcut-compatible Action Button launch into Georgie
- URL scheme: `georgie://voice`
- Native local/remote notification registration
- Keychain storage path for a future enrolled device token
- Deep-link routing and native task dashboard
- Simulator CI validation on every iOS change

## Generate the Xcode project

Install Xcode and XcodeGen on a Mac, then:

```bash
cd ios
brew install xcodegen
xcodegen generate
open Georgie.xcodeproj
```

Select the Georgie target and set Sierra's Apple Development Team under Signing & Capabilities. Xcode can then install Georgie directly onto an authorized iPhone.

## Apple-account activation still required

Source code can be built without Apple credentials, but a real iPhone install, Siri entitlement, APNs push notifications, TestFlight/App Store distribution, and production signing require an Apple Developer team and provisioning profile. Those account/device actions intentionally are not committed to the repository.

The bundle identifier is `com.sierramarketinginc.georgie`.
