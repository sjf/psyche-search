#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2025 Nicotine+ Contributors
# SPDX-License-Identifier: GPL-3.0-or-later
#
# Build the PsycheSeek desktop app (web UI + pywebview) into a .app and .dmg.
# No GTK required. Output lands in build-aux/macos/build/.
#
# Usage: build-aux/macos/build-desktop.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
BUILD_DIR="$SCRIPT_DIR/build"
APP_NAME="PsycheSeek"

echo "==> Building React UI"
( cd "$PROJECT_ROOT/psyche-seek" && npm install && npm run build )

echo "==> Setting up build virtualenv"
VENV="$BUILD_DIR/venv"
python3 -m venv "$VENV"
"$VENV/bin/pip" install --quiet --upgrade pip
"$VENV/bin/pip" install --quiet \
    fastapi uvicorn python-multipart pywebview pyobjc-framework-WebKit pyinstaller

echo "==> Running PyInstaller"
"$VENV/bin/pyinstaller" --noconfirm --clean \
    --distpath "$BUILD_DIR/dist" --workpath "$BUILD_DIR/work" \
    "$SCRIPT_DIR/psyche-seek.spec"

echo "==> Creating DMG"
STAGE="$BUILD_DIR/dmg-stage"
rm -rf "$STAGE"; mkdir -p "$STAGE"
cp -R "$BUILD_DIR/dist/$APP_NAME.app" "$STAGE/"
ln -s /Applications "$STAGE/Applications"
DMG="$BUILD_DIR/$APP_NAME.dmg"
rm -f "$DMG"
hdiutil create -volname "$APP_NAME" -srcfolder "$STAGE" -ov -format UDZO "$DMG"

echo "==> Done: $DMG"
