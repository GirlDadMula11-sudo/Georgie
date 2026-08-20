import AppKit

/// Georgie's Mac voice profile: composed, male-first, fast enough for an executive assistant,
/// while staying entirely local to macOS speech synthesis.
func configureGeorgieExecutiveVoice(_ speaker: NSSpeechSynthesizer) {
    // Prefer natural-sounding English male system voices when they exist on the Mac.
    // Alex is the primary US voice; the remaining names provide graceful fallbacks across macOS versions.
    let preferred = ["alex", "daniel", "aaron", "reed", "evan", "tom"]
    let voices = NSSpeechSynthesizer.availableVoices

    for name in preferred {
        if let voice = voices.first(where: { $0.rawValue.lowercased().contains(name) }) {
            _ = speaker.setVoice(voice)
            break
        }
    }

    // Slightly quicker than a default conversational voice without sounding rushed.
    speaker.rate = 188.0
    speaker.volume = 1.0
}
