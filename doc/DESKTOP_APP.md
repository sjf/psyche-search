<!--
  SPDX-FileCopyrightText: 2025 Nicotine+ Contributors
  SPDX-License-Identifier: GPL-3.0-or-later
-->

# Desktop app (macOS & Windows)

PsycheSeek also ships as a native desktop app. It is **the same web app** — the
FastAPI daemon serving the built React UI — wrapped in a native window by
[pywebview](https://pywebview.flowrl.com/) (WebKit on macOS, WebView2 on Windows).
No GTK is involved.

## How it runs

`pseek --desktop` (or `-D`) dispatches to `pynicotine/desktop/`, which:

1. Checks the port is free and config exists.
2. Starts the daemon (`Application(local_files=True)`) on a background thread.
3. Waits for the web server, then opens a pywebview window at `http://127.0.0.1:<port>`.
4. Watches the daemon; any startup/runtime failure is shown as a native error
   dialog instead of crashing silently.

`local_files=True` enables the desktop-only `/api/files/reveal` and
`/api/files/open` endpoints (off in plain `--daemon`/remote-web mode).

## Key files

| File | Role |
|------|------|
| `pynicotine/desktop/__init__.py` | Launcher: daemon thread, window, error dialogs, crash watcher. |
| `build-aux/macos/desktop-launcher.py` | Frozen-app entry point. Calls `multiprocessing.freeze_support()` **before** touching `sys.argv`, then forces `--desktop`. |
| `build-aux/macos/psyche-seek.spec` | Cross-platform PyInstaller spec (macOS `.app` / Windows `.exe`). Bundles `psyche-seek/dist` + pynicotine data; excludes GTK. |
| `build-aux/macos/build-desktop.sh` | Local macOS build → `.app` + `.dmg`. |
| `.github/workflows/desktop-release.yml` | CI: builds both OSes and cuts a draft release. |

## Building

**Local (macOS only):**

```bash
build-aux/macos/build-desktop.sh    # → build-aux/macos/build/PsycheSeek.dmg
```

**Release (both OSes):** push a version tag (e.g. `1.0`, `v1.2`). CI builds the
macOS dmg and Windows zip on GitHub's runners and attaches them to a **draft**
release. Windows **cannot** be built on macOS (PyInstaller does not
cross-compile), which is why the Windows binary only comes from CI.

## Gotchas (learned the hard way)

- **`freeze_support()` must run first.** In a frozen app, `multiprocessing`
  re-launches the executable for share-scan workers; if `sys.argv` is rewritten
  before `freeze_support()`, each worker boots a full app window → fork bomb.
- **Frozen UI path.** The daemon serves the UI from a frozen-aware path
  (`sys._MEIPASS` when frozen) — see `_web_ui_root()` in `pynicotine/daemon/api.py`.
- **Builds are unsigned.** macOS needs right-click → Open (or clear the
  quarantine attribute); Windows SmartScreen needs "More info → Run anyway".
