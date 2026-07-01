# SPDX-FileCopyrightText: 2025 Nicotine+ Contributors
# SPDX-License-Identifier: GPL-3.0-or-later

"""Run the daemon web UI inside a native desktop window (pywebview)."""

import socket
import subprocess
import sys
import threading
import time

from pynicotine.config import config
from pynicotine.core import core
from pynicotine.daemon.application import Application
from pynicotine.events import events
from pynicotine.logfacility import log

WINDOW_TITLE = "PsycheSeek"
_SERVER_WAIT_TIMEOUT = 20


class _StartupError(Exception):
    """A startup problem with a user-facing message (and, ideally, a recovery tip)."""


def _show_error_dialog(title, message):
    """Show a native error dialog, falling back to the log if none is available."""
    try:
        if sys.platform == "darwin":
            script = (
                "on run argv\n"
                "  display dialog (item 1 of argv) with title (item 2 of argv) "
                "buttons {\"OK\"} default button \"OK\" with icon stop\n"
                "end run"
            )
            subprocess.run(["osascript", "-e", script, message, title], check=False)
            return
        if sys.platform == "win32":
            import ctypes
            # MB_OK | MB_ICONERROR | MB_SETFOREGROUND
            ctypes.windll.user32.MessageBoxW(0, message, title, 0x10 | 0x10000)
            return
        for command in (
            ["zenity", "--error", "--title", title, "--text", message],
            ["kdialog", "--title", title, "--error", message],
        ):
            try:
                subprocess.run(command, check=False)
                return
            except FileNotFoundError:
                continue
    except Exception as error:
        log.add("Could not show error dialog: %s", (error,))

    log.add("%s: %s", (title, message))
    print(f"{title}: {message}", file=sys.stderr, flush=True)


def _port_in_use(host, port):
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
        probe.settimeout(0.5)
        return probe.connect_ex((host, port)) == 0


def _wait_for_server(host, port, daemon_thread, timeout=_SERVER_WAIT_TIMEOUT):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if not daemon_thread.is_alive():
            return False
        if _port_in_use(host, port):
            return True
        time.sleep(0.1)
    return False


def _watch_daemon(webview, daemon_thread, daemon_error, shutting_down):
    """If the daemon dies while the window is open, show a dialog and close it.

    Without this, a mid-session backend crash would leave the window open with a
    dead backend and no explanation. ``shutting_down`` is set during a normal
    teardown so this stays quiet then.
    """
    def watch():
        daemon_thread.join()
        if shutting_down.is_set():
            return
        shutting_down.set()
        detail = daemon_error["value"]
        _show_error_dialog(
            WINDOW_TITLE,
            "PsycheSeek's background service stopped unexpectedly, so the app will close."
            + (f"\n\n{detail}" if detail else "")
        )
        try:
            for window in list(webview.windows):
                window.destroy()
        except Exception as error:
            log.add("Could not close window after daemon exit: %s", (error,))

    threading.Thread(target=watch, name="DaemonWatcher", daemon=True).start()


def _launch():
    try:
        import webview
    except ModuleNotFoundError as error:
        raise _StartupError(
            "PsycheSeek desktop mode needs the 'pywebview' package, which isn't installed.\n\n"
            f"{error}"
        ) from error

    if config.need_config():
        log.add("Desktop mode requires username/password in the config file.")
        return 1

    host = config.sections["daemon"]["web_host"]
    port = config.sections["daemon"]["web_port"]

    if _port_in_use(host, port):
        raise _StartupError(
            f"PsycheSeek can't start because port {port} is already in use.\n\n"
            "PsycheSeek may already be running, or another program is using this port. "
            "Close the other instance (or free the port) and try again."
        )

    application = Application(local_files=True)
    exit_code = {"value": 0}
    daemon_error = {"value": None}
    shutting_down = threading.Event()

    def run_daemon():
        try:
            exit_code["value"] = application.run()
        except Exception as error:
            daemon_error["value"] = error
            exit_code["value"] = 1

    daemon_thread = threading.Thread(target=run_daemon, name="DaemonMain", daemon=True)
    daemon_thread.start()

    try:
        if not _wait_for_server(host, port, daemon_thread):
            detail = daemon_error["value"]
            raise _StartupError(
                "PsycheSeek's background service didn't start."
                + (f"\n\n{detail}" if detail else "")
            )
        webview.create_window(WINDOW_TITLE, f"http://{host}:{port}", width=1280, height=860)
        _watch_daemon(webview, daemon_thread, daemon_error, shutting_down)
        webview.start()
    finally:
        # Always shut the daemon down and flush config — whether the window closed
        # normally, startup failed, or the watcher closed it after a daemon crash.
        shutting_down.set()
        events.invoke_main_thread(core.quit)
        daemon_thread.join(timeout=10)

    return exit_code["value"]


def run():
    """Launch the desktop app. Any failure becomes a dialog, never a bare crash.

    Common, actionable problems raise _StartupError with a friendly, specific
    message; the final handler is a global catch-all so an unexpected exception
    still reaches the user as a dialog instead of a silent crash or a raw traceback.
    """
    try:
        return _launch()
    except _StartupError as error:
        _show_error_dialog(WINDOW_TITLE, str(error))
        return 1
    except Exception as error:
        _show_error_dialog(
            WINDOW_TITLE,
            "PsycheSeek hit an unexpected error and can't continue.\n\n"
            f"{type(error).__name__}: {error}"
        )
        return 1
