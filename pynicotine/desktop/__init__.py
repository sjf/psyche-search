# SPDX-FileCopyrightText: 2025 Nicotine+ Contributors
# SPDX-License-Identifier: GPL-3.0-or-later

"""Run the daemon web UI inside a native desktop window (pywebview)."""

import socket
import threading
import time

from pynicotine.config import config
from pynicotine.core import core
from pynicotine.daemon.application import Application
from pynicotine.events import events
from pynicotine.logfacility import log

WINDOW_TITLE = "PsycheSeek"
_SERVER_WAIT_TIMEOUT = 20


def _wait_for_server(host, port, timeout=_SERVER_WAIT_TIMEOUT):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
            probe.settimeout(0.5)
            if probe.connect_ex((host, port)) == 0:
                return True
        time.sleep(0.1)
    return False


def run():
    try:
        import webview
    except ModuleNotFoundError as error:
        log.add("Desktop mode requires pywebview (pip install pywebview): %s", (error,))
        return 1

    if config.need_config():
        log.add("Desktop mode requires username/password in the config file.")
        return 1

    application = Application(local_files=True)
    exit_code = {"value": 0}

    def run_daemon():
        exit_code["value"] = application.run()

    daemon_thread = threading.Thread(target=run_daemon, name="DaemonMain", daemon=True)
    daemon_thread.start()

    host = config.sections["daemon"]["web_host"]
    port = config.sections["daemon"]["web_port"]

    if not _wait_for_server(host, port):
        log.add("Desktop mode timed out waiting for the web UI to start.")
        events.invoke_main_thread(core.quit)
        daemon_thread.join(timeout=5)
        return 1

    webview.create_window(WINDOW_TITLE, f"http://{host}:{port}", width=1280, height=860)
    webview.start()

    # The window has closed; ask the daemon loop to shut down and flush config.
    events.invoke_main_thread(core.quit)
    daemon_thread.join(timeout=10)
    return exit_code["value"]
