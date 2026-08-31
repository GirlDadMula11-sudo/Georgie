# Dont mention detention

## Canonical project contract

`Dont mention detention` is the existing Roblox horror game created by Jason, Makayla, and Georgie. All engineering work must upgrade the existing project in place. Georgie must not create a replacement experience, duplicate project, parallel build identity, or renamed prototype unless Jason explicitly approves a migration.

Canonical local project:

- Root: `/Users/mac/Documents/Georgie Roblox Projects/makayla-horror-prototype`
- Current artifact: `Prototype.rbxlx`
- Current preserved play-test job: `idem-cb7e9b3ba3d078186977ba33a5a18acc371cb90f`
- Working title: `Dont mention detention`
- Audience: family-friendly suspense horror; tension and scares without graphic violence
- First product milestone: a polished, private, replayable 15–20 minute vertical slice

Makayla is the creative co-designer and primary play tester. Georgie owns bounded Mac, repository, build, Studio, test, and evidence execution. ChatGPT/Codex owns architecture, game design, implementation review, defect triage, and acceptance criteria.

## Creative north star

The player begins in after-school detention after the building should be empty. A routine punishment becomes an escape through a distorted school whose rooms react to the player’s progress. The player must understand what happened, recover three story-critical objects, survive an escalating pursuer, and unlock the final exit.

The game should feel original and recognizable within seconds:

- A decaying school after dark rather than a generic haunted house.
- Detention rules that become environmental warnings and puzzle clues.
- A pursuer whose behavior evolves as rules are broken.
- Strong contrast between familiar school spaces and impossible architecture.
- A memorable final escape that resolves the vertical slice while leaving a larger mystery.

Existing mechanics—spawning, three relics, The Watcher chase, exit-door unlock, lighting, and controls—are foundations to preserve and improve, not proof that the game is finished.

## Vertical-slice experience

### Opening

The player wakes or looks up in a detention classroom after the supervising adult has disappeared. The clock is stopped, the hallway lights cycle incorrectly, and the front doors are chained. A rules board establishes controls, objective language, and the first clue without a tutorial popup dump.

### Progression loop

1. Explore a compact, interconnected school wing.
2. Read environmental clues and solve a room-specific puzzle.
3. Recover one of three story objects.
4. Trigger a stronger phase of the pursuer and altered school layout.
5. Open a shortcut back toward the central corridor.
6. Use all three objects to unlock the final escape sequence.

### Three puzzle zones

Each object must require a distinct interaction pattern:

1. **Classroom / records puzzle** — infer a code or sequence from detention slips, seating, chalkboard notes, and the stopped clock.
2. **Library / media puzzle** — restore power or arrange catalog clues while sound gives advance warning of danger.
3. **Gym / maintenance puzzle** — manipulate breakers, keys, or equipment under active pursuit rather than solving from complete safety.

Puzzle solutions must be readable, deterministic, resettable, and impossible to permanently soft-lock.

### Pursuer

The current Watcher mechanic becomes a deliberate state machine:

- `Dormant`: atmosphere and distant evidence only.
- `Searching`: patrols authored routes and investigates player-generated sound.
- `Hunting`: gains line-of-sight pursuit with fair telegraphing and recovery windows.
- `Escalated`: unlocks after the second object and uses alternate routes or temporary environmental pressure.
- `Finale`: drives the last escape without invalidating the player’s learned rules.

The pursuer must never spawn directly on the player, trap the player without counterplay, see through solid geometry, or remain permanently stuck. Losing should restart from a recent checkpoint quickly.

### Ending

Using the three objects changes the detention room or front office, reveals the final exit condition, and begins a short authored chase. The player reaches safety, receives a clear completion beat, and sees one restrained hook for the next chapter.

## Presentation standard

### Environment

- Original modular school kit with classroom, corridor, library/media room, gym/maintenance space, office, bathrooms, and exterior exit framing.
- Intentional navigation landmarks and looping shortcuts.
- Environmental storytelling through props, notices, lockers, desks, damaged fixtures, and changing rule text.
- No unreviewed toolbox model or script may enter the project.

### Lighting and effects

- Authored darkness that preserves navigation and puzzle readability.
- Localized flicker, emergency lighting, fog, color grading, and restrained post-processing.
- Scares must be staged; random flashing cannot substitute for tension.
- Photosensitivity-safe defaults and a reduced-flashing option.

### Sound

- Layered room tone, electrical hum, distant school sounds, footsteps, chase music, puzzle confirmation, failure, and completion cues.
- Positional sound must communicate the pursuer’s location fairly.
- Audio assets require provenance and usage rights recorded in the evidence manifest.

### Interface and controls

- Minimal objective UI, interaction prompt, pause/settings, subtitle support, and readable feedback for collected objects.
- Keyboard/mouse and mobile controls are first-class acceptance targets.
- Interaction distances, prompt timing, camera behavior, and sensitivity must remain consistent.

## Engineering architecture

### Source of truth

- Rojo source files are canonical; `Prototype.rbxlx` is a generated artifact.
- Content and scripts are organized by systems, shared modules, server services, client controllers, and authored world data.
- Every build records source commit, artifact SHA-256, byte count, Rojo version, generation time, and exact output path.

### Studio bridge

Georgie must stop depending on nested macOS Open-dialog traversal for normal operation. The durable Studio bridge must:

1. Launch the exact artifact through a direct document-open mechanism.
2. Verify the active Studio document path before any play action.
3. Start and stop play through one bounded adapter.
4. Emit structured runtime markers containing build identity and test phase.
5. Return Studio logs, runtime errors, screenshots, and play-state evidence.
6. Fail closed without creating a replacement job or project.

The AppleScript accessibility path may remain only as a diagnosed fallback. It cannot be the primary production workflow.

### Game systems

- Explicit round/session state machine.
- Data-driven objective and puzzle definitions.
- Server-authoritative collection, door, checkpoint, and completion state.
- Pursuer state machine with navigation recovery and telemetry.
- Client controllers for interaction, camera, UI, audio, accessibility, and input mapping.
- Deterministic reset hooks for automated tests.

### Durable workflow

One versioned vertical-slice objective owns the stages below. Each stage checkpoints its receipts and resumes in place:

1. Existing-project inventory and immutable backup manifest.
2. Source normalization and deterministic build.
3. Direct Studio bridge certification.
4. Greybox environment and navigation.
5. Puzzle and progression implementation.
6. Pursuer AI and failure/checkpoint loop.
7. Art, lighting, effects, sound, and interface polish.
8. Automated functional and performance testing.
9. Makayla play-test defect pass.
10. Private release candidate and evidence package.

Publishing is not implied by build completion and requires a separate exact approval.

## Acceptance gates

The vertical slice is complete only when one release candidate proves all of the following:

- Exact existing project identity preserved.
- Clean deterministic build from committed source.
- Exact Studio document path verified.
- Zero runtime script errors during the acceptance run.
- Spawn and checkpoint behavior verified.
- All three puzzles independently completable and resettable.
- All three story objects collect exactly once.
- Pursuer patrol, search, hunt, loss, recovery, and finale states verified.
- Final exit remains locked until its complete condition and opens exactly once afterward.
- Full start-to-ending playthrough completed.
- Play mode stopped cleanly after automated verification.
- Keyboard/mouse and mobile control checks pass.
- Lighting remains navigable and reduced-flashing mode works.
- Audio cues and subtitles are present where required.
- No untrusted inserted scripts or unreviewed external assets.
- Performance budget passes on the target desktop and representative mobile profile.
- Makayla’s blocking play-test defects are closed or explicitly deferred by Jason.
- Evidence manifest contains source commit, artifact hash, runtime log, screenshots, timestamps, test results, defect list, and private release identity.

Static source inspection alone can never satisfy runtime or playability gates.

## Change-control rules

- Preserve the game title and existing project unless Jason explicitly changes either.
- Prefer permanent system capability over one-off UI coordinates or window-name patches.
- Never report a build as playable without runtime evidence.
- Never treat a completed wrapper job with an internally blocked result as success.
- Never publish, monetize, add paid items, or make the experience public without separate approval.
- Keep the private release recoverable and reproducible from source.
