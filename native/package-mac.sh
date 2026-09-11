#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
swift build --package-path native -c release
bundle="native/build/Acoustic Lab.app"
mkdir -p "$bundle/Contents/MacOS"
cp native/.build/release/acoustic-lab "$bundle/Contents/MacOS/acoustic-lab"
cp native/Info-macOS.plist "$bundle/Contents/Info.plist"
codesign --force --sign - "$bundle"
printf '%s\n' "Built $bundle (local ad-hoc signature)."
