# Georgie native device activation

The iOS app uses a one-time enrollment code to exchange for a random device credential. The credential and stable device identifier are stored in iPhone Keychain with `ThisDeviceOnly` accessibility. Native API calls require the bearer credential, and the backend resolves native requests to the server-side primary Georgie identity rather than trusting a client-supplied user identifier.

After enrollment the app verifies the credential against `GET /api/mobile/device` before treating the phone as activated. A 401 response clears the local bearer credential so a revoked phone cannot remain locally marked as active.

Voice launch uses App Intents/Shortcuts. `Talk to Georgie` opens the app and marks a pending voice start; the app consumes that marker only after the scene is active and the device credential has been verified. iOS does not permit a third-party app to run an unrestricted always-listening custom hotword in the background, so the supported system-level wake path is Siri/Shortcuts, the Action Button/Lock Screen shortcut where configured, or the in-app microphone control.
