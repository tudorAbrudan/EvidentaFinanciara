#!/usr/bin/env bash
# Build Release .app pentru iOS Simulator cu JS bundle-uit din ultima versiune de cod.
# Output: ios/build-dist/.../FinanePersonale.app
#
# Folosire:
#   npm run ios:dist:sim
#   xcrun simctl install booted ios/build-dist/Build/Products/Release-iphonesimulator/FinanePersonale.app
#   xcrun simctl launch booted com.ax.finante
#
# Pentru Xcode UI: deschide ios/FinanePersonale.xcworkspace, setează destinația
# „Any iOS Simulator Device", Product → Archive, apoi Organizer → Distribute App
# → Custom → Copy App.

set -euo pipefail

cd "$(dirname "$0")/.."

WORKSPACE="ios/FinanePersonale.xcworkspace"
SCHEME="FinanePersonale"
DERIVED="ios/build-dist"

if [[ ! -d "$WORKSPACE" ]]; then
  echo "Eroare: $WORKSPACE nu există. Rulează: npm run prebuild" >&2
  exit 1
fi

rm -rf "$DERIVED"

xcodebuild \
  -workspace "$WORKSPACE" \
  -scheme "$SCHEME" \
  -configuration Release \
  -sdk iphonesimulator \
  -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath "$DERIVED" \
  CODE_SIGNING_ALLOWED=NO \
  build

APP_PATH="$(find "$DERIVED/Build/Products/Release-iphonesimulator" -maxdepth 1 -name '*.app' -print -quit)"

if [[ -z "${APP_PATH:-}" || ! -d "$APP_PATH" ]]; then
  echo "Eroare: nu am găsit .app în $DERIVED/Build/Products/Release-iphonesimulator" >&2
  exit 1
fi

echo
echo "✓ Build OK: $APP_PATH"
echo
echo "Instalare pe simulatorul pornit:"
echo "  xcrun simctl install booted \"$APP_PATH\""
echo "  xcrun simctl launch booted com.ax.finante"
