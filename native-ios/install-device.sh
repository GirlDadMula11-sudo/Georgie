#!/bin/zsh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

if ! command -v xcodebuild >/dev/null 2>&1; then
  echo "Xcode is required. Install/open Xcode once, then rerun this script."
  exit 1
fi

if ! command -v xcodegen >/dev/null 2>&1; then
  if command -v brew >/dev/null 2>&1; then
    brew install xcodegen
  else
    echo "XcodeGen is required. Install Homebrew/XcodeGen, then rerun."
    exit 1
  fi
fi

TEAM_ID="${GEORGIE_APPLE_TEAM_ID:-}"
if [[ -z "$TEAM_ID" ]]; then
  TEAM_ID="$(security find-identity -v -p codesigning 2>/dev/null | sed -n 's/.*(\([A-Z0-9][A-Z0-9]*\)).*/\1/p' | head -1 || true)"
fi

if [[ -z "$TEAM_ID" ]]; then
  echo "No Apple Development signing identity was found."
  echo "Open Xcode > Settings > Accounts and sign in with your Apple ID, then rerun."
  exit 1
fi

echo "[Georgie] Generating native iPhone project..."
xcodegen generate

DEVICE_ID="${GEORGIE_IOS_DEVICE_ID:-}"
if [[ -z "$DEVICE_ID" ]]; then
  DEVICE_ID="$(xcrun xctrace list devices 2>/dev/null | sed -n 's/^.*iPhone.*(\([0-9A-Fa-f-][0-9A-Fa-f-]*\)).*$/\1/p' | head -1 || true)"
fi

if [[ -z "$DEVICE_ID" ]]; then
  echo "No paired iPhone was detected. Unlock the iPhone, connect it to this Mac, tap Trust if asked, and rerun."
  exit 1
fi

DERIVED="$ROOT/.derived"
rm -rf "$DERIVED"

echo "[Georgie] Building for iPhone $DEVICE_ID..."
xcodebuild \
  -project Georgie.xcodeproj \
  -scheme Georgie \
  -configuration Debug \
  -destination "id=$DEVICE_ID" \
  -derivedDataPath "$DERIVED" \
  -allowProvisioningUpdates \
  DEVELOPMENT_TEAM="$TEAM_ID" \
  CODE_SIGN_STYLE=Automatic \
  build

APP="$DERIVED/Build/Products/Debug-iphoneos/Georgie.app"
if [[ ! -d "$APP" ]]; then
  echo "Build finished but Georgie.app was not found at the expected path."
  exit 1
fi

echo "[Georgie] Installing on iPhone..."
if xcrun devicectl help >/dev/null 2>&1; then
  xcrun devicectl device install app --device "$DEVICE_ID" "$APP"
else
  echo "Your Xcode version does not provide devicectl. Open Georgie.xcodeproj and press Run once to install."
  exit 1
fi

echo
 echo "Georgie is installed. On first launch approve Microphone and Speech Recognition."
 echo "Then add the 'Talk to Georgie' App Shortcut to the Action Button or invoke it through Siri/Spotlight."
