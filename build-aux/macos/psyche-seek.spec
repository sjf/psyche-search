# -*- mode: python ; coding: utf-8 -*-
# SPDX-FileCopyrightText: 2025 Nicotine+ Contributors
# SPDX-License-Identifier: GPL-3.0-or-later

"""Cross-platform PyInstaller spec for the PsycheSeek desktop app.

Produces a macOS .app bundle on darwin and a windowed .exe folder on Windows.
The web UI (React) and pynicotine data are bundled; the native window is drawn
by pywebview (WebKit on macOS, WebView2 on Windows)."""

import os
import sys

from PyInstaller.utils.hooks import collect_all, collect_submodules

SPEC_DIR = os.path.dirname(os.path.abspath(SPEC))
PROJECT_ROOT = os.path.abspath(os.path.join(SPEC_DIR, "..", ".."))
sys.path.insert(0, PROJECT_ROOT)

import pynicotine  # noqa: E402

APP_NAME = "PsycheSeek"
IS_MAC = sys.platform == "darwin"
IS_WIN = sys.platform == "win32"

ICON = os.path.join(SPEC_DIR, "icon.icns") if IS_MAC \
    else os.path.join(PROJECT_ROOT, "build-aux", "windows", "icon.ico")

datas = [(os.path.join(PROJECT_ROOT, "psyche-seek", "dist"), "psyche-seek/dist")]
binaries = []
hiddenimports = (
    collect_submodules("uvicorn")
    + collect_submodules("pynicotine")
    + collect_submodules("webview")
)

packages = ["pynicotine", "fastapi", "starlette", "webview"]
if IS_MAC:
    packages += ["WebKit", "objc"]
if IS_WIN:
    packages += ["clr_loader", "pythonnet"]
    hiddenimports += ["clr", "webview.platforms.edgechromium", "webview.platforms.winforms"]

for package in packages:
    try:
        pkg_datas, pkg_binaries, pkg_hidden = collect_all(package)
        datas += pkg_datas
        binaries += pkg_binaries
        hiddenimports += pkg_hidden
    except Exception:
        # A platform-specific optional package that isn't installed here.
        pass

analysis = Analysis(
    [os.path.join(SPEC_DIR, "desktop-launcher.py")],
    pathex=[PROJECT_ROOT],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    excludes=["gi", "pynicotine.gtkgui", "tkinter", "PyQt5", "PyQt6", "PySide2", "PySide6"],
    noarchive=False,
)

pyz = PYZ(analysis.pure)

exe = EXE(
    pyz,
    analysis.scripts,
    [],
    exclude_binaries=True,
    name=APP_NAME,
    console=False,
    icon=ICON,
)

coll = COLLECT(
    exe,
    analysis.binaries,
    analysis.datas,
    name=APP_NAME,
)

if IS_MAC:
    app = BUNDLE(
        coll,
        name=f"{APP_NAME}.app",
        icon=ICON,
        bundle_identifier=pynicotine.__application_id__,
        version=pynicotine.__version__,
        info_plist={
            "CFBundleName": APP_NAME,
            "CFBundleDisplayName": APP_NAME,
            "CFBundleShortVersionString": pynicotine.__version__,
            "NSHighResolutionCapable": True,
            "LSApplicationCategoryType": "public.app-category.music",
        },
    )
