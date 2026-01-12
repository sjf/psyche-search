# SPDX-FileCopyrightText: 2025 Nicotine+ Contributors
# SPDX-License-Identifier: GPL-3.0-or-later

import sys
import threading
import time

from pynicotine.config import config
from pynicotine.core import core
from pynicotine.daemon.state import DaemonState
from pynicotine.daemon.state import compute_share_counts
from pynicotine.daemon.web import DaemonRequestHandler
from pynicotine.daemon.web import TemplateRenderer
from pynicotine.daemon.web import ThreadingHTTPServer
from pynicotine.events import events
from pynicotine.logfacility import log


class Application:
    __slots__ = ("_state", "_web_server", "_web_thread")

    def __init__(self):
        self._state = DaemonState()
        self._web_server = None
        self._web_thread = None

        sys.excepthook = self.on_critical_error

        events.connect("shares-preparing", self._on_shares_preparing)
        events.connect("shares-ready", self._on_shares_ready)
        events.connect("log-message", self._on_log_message)
        events.connect("download-finished", self._on_download_finished)
        events.connect("upload-finished", self._on_upload_finished)
        events.connect("say-chat-room", self._on_room_message)
        events.connect("global-room-message", self._on_global_room_message)
        events.connect("message-user", self._on_private_message)
        events.connect("add-search", self._on_add_search)
        events.connect("remove-search", self._on_remove_search)
        events.connect("file-search-response", self._on_file_search_response)
        events.connect("shared-file-list-response", self._on_shared_file_list_response)
        events.connect("watch-user", self._on_watch_user)
        events.connect("quit", self._on_quit)

    def run(self):
        if config.need_config():
            log.add("Daemon mode requires username/password in the config file.")
            return 1

        core.start()
        core.connect()
        if not self._start_web_server():
            return 1

        # Main loop, process events from threads 10 times per second
        while events.process_thread_events():
            time.sleep(0.1)

        config.write_configuration()
        return 0

    def on_critical_error(self, _exc_type, exc_value, _exc_traceback):
        sys.excepthook = None
        core.quit()
        events.emit("quit")
        raise exc_value

    def _start_web_server(self):
        host = config.sections["daemon"]["web_host"]
        port = config.sections["daemon"]["web_port"]

        try:
            self._web_server = ThreadingHTTPServer((host, port), DaemonRequestHandler)
        except OSError as error:
            log.add("Failed to start daemon web UI on %s:%s: %s", (host, port, error))
            return False

        self._web_server.state = self._state
        self._web_server.renderer = TemplateRenderer()
        self._web_thread = threading.Thread(
            target=self._web_server.serve_forever,
            name="DaemonWebServer",
            daemon=True
        )
        self._web_thread.start()
        log.add("Daemon web UI listening on http://%s:%s", (host, port))
        return True

    def _on_quit(self):
        if self._web_server is None:
            return

        self._web_server.shutdown()
        self._web_server.server_close()
        self._web_server = None

    def _on_shares_preparing(self):
        self._state.set_shares_scanning()

    def _on_shares_ready(self, successful):
        if not successful:
            return

        share_files, share_folders = compute_share_counts()
        self._state.set_share_counts(share_files, share_folders)

    def _on_log_message(self, timestamp_format, msg, _title, _level):
        if timestamp_format:
            timestamp = time.strftime(timestamp_format)
            line = f"[{timestamp}] {msg}"
        else:
            line = msg

        if "Connected to server" in msg or "Disconnected from server" in msg:
            self._state.set_connection_info(msg)
        elif "External port" in msg:
            self._state.set_portmap_info(msg)

        try:
            print(line, flush=True)
        except OSError:
            pass

    def _on_download_finished(self, username, virtual_path, real_path):
        log.add("Download finished: user %s, file %s, path %s", (username, virtual_path, real_path))

    def _on_upload_finished(self, username, virtual_path, real_path):
        log.add("Upload finished: user %s, file %s, path %s", (username, virtual_path, real_path))

    def _on_room_message(self, msg):
        entry = {
            "timestamp": int(time.time()),
            "kind": "room",
            "room": msg.room,
            "user": msg.user,
            "message": msg.message
        }
        self._state.record_chat(entry)

    def _on_global_room_message(self, msg):
        entry = {
            "timestamp": int(time.time()),
            "kind": "global",
            "room": msg.room or "Global",
            "user": msg.user,
            "message": msg.message
        }
        self._state.record_chat(entry)

    def _on_private_message(self, msg, queued_message=False):
        entry = {
            "timestamp": int(time.time()),
            "kind": "pm",
            "room": "",
            "user": msg.user,
            "message": msg.message,
            "direction": "out" if msg.message_id is None else "in"
        }
        if queued_message:
            entry["queued"] = True
        self._state.record_chat(entry)

    def _on_add_search(self, token, search, _switch_page):
        self._state.add_search(token, search.term)

    def _on_remove_search(self, token):
        self._state.remove_search(token)

    def _on_file_search_response(self, msg):
        self._state.add_search_results(
            msg.token,
            msg.username,
            msg.list,
            msg.freeulslots,
            msg.ulspeed,
            msg.inqueue
        )

    def _on_shared_file_list_response(self, msg):
        if msg.username:
            self._state.notify_user_browse(msg.username)

    def _on_watch_user(self, msg):
        if msg.user and msg.userexists is False:
            self._state.notify_user_browse_not_found(msg.user)
