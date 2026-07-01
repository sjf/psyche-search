# SPDX-FileCopyrightText: 2025 Nicotine+ Contributors
# SPDX-License-Identifier: GPL-3.0-or-later

import hashlib
import hmac
import json
import os
import threading
import time

from collections import deque

from pynicotine.config import config
from pynicotine.core import core
from pynicotine.events import events
from pynicotine.slskmessages import FileListMessage
from pynicotine.slskmessages import UserStatus
from pynicotine.transfers import TransferStatus
from pynicotine.utils import clean_file
from pynicotine.utils import encode_path
from pynicotine.daemon.trees import build_search_tree
from pynicotine.daemon.trees import build_user_tree


USER_TREE_CACHE_TTL = 24 * 60 * 60  # keep a browsed user's listing for at least a day
USER_BROWSE_TIMEOUT = 45  # give up on an unresponsive user after this many seconds


class DaemonState:
    __slots__ = ("_lock", "share_files", "share_folders", "share_status", "chat_lines",
                 "searches", "search_results", "search_terms", "max_search_results",
                 "pending_requests", "_pending_request_id", "_pending_login",
                 "_user_browse_status", "_user_browse_progress", "_user_browse_started",
                 "_user_tree_cache", "connection_info", "portmap_info",
                 "download_path_overrides")

    def __init__(self):
        self._lock = threading.Lock()
        self.share_files = None
        self.share_folders = None
        self.share_status = "scanning"
        self.chat_lines = deque(maxlen=50)
        self.searches = {}
        self.search_results = {}
        self.search_terms = {}
        self.max_search_results = 500
        self.pending_requests = {}
        self._pending_request_id = 0
        self._pending_login = None
        self._user_browse_status = {}
        self._user_browse_progress = {}
        self._user_browse_started = {}
        self._user_tree_cache = {}
        self.connection_info = ""
        self.portmap_info = ""
        self.download_path_overrides = {}

    def set_connection_info(self, message):
        with self._lock:
            self.connection_info = message

    def set_portmap_info(self, message):
        with self._lock:
            self.portmap_info = message

    def set_shares_scanning(self):
        with self._lock:
            self.share_status = "scanning"

    def set_share_counts(self, share_files, share_folders):
        with self._lock:
            self.share_files = share_files
            self.share_folders = share_folders
            self.share_status = "ready"

    def record_chat(self, entry):
        with self._lock:
            self.chat_lines.appendleft(entry)

    def request_search(self, term):
        with self._lock:
            self._pending_request_id += 1
            request_id = self._pending_request_id
            pending = {"event": threading.Event(), "token": None}
            self.pending_requests[request_id] = pending

        events.invoke_main_thread(self._start_search_main_thread, request_id, term)
        pending["event"].wait(timeout=3)

        with self._lock:
            token = pending["token"]
            self.pending_requests.pop(request_id, None)

        return token

    def _start_search_main_thread(self, request_id, term):
        core.search.do_search(term, "global")
        token = core.search.token

        with self._lock:
            pending = self.pending_requests.get(request_id)
            if pending is None:
                return

            pending["token"] = token
            pending["event"].set()

    def begin_login(self, username, password):
        prev_login = config.sections["server"]["login"] or ""
        prev_pass = config.sections["server"]["passw"] or ""

        with self._lock:
            # Fast path: already logged into Soulseek as this user. The live
            # connection proves the saved password is valid, so matching it is a
            # genuine credential check, not a config-file shortcut.
            if core.users is not None and core.users.login_status == UserStatus.ONLINE \
                    and core.users.login_username == username \
                    and hmac.compare_digest(password, prev_pass):
                return {"success": True, "username": username}

            pending = {
                "event": threading.Event(),
                "result": None,
                "username": username,
                "password": password,
                "prev_login": prev_login,
                "prev_pass": prev_pass
            }
            self._pending_login = pending

        events.invoke_main_thread(self._start_login_main_thread, username, password)
        completed = pending["event"].wait(timeout=20)

        with self._lock:
            result = pending["result"]
            self._pending_login = None

        # resolve_login already persisted (success) or restored (failure) the
        # config on the main thread before signalling, so the file is settled.
        if completed and result is not None:
            return result

        # Timed out with no answer from the server: restore the last known-good
        # session and wait for it, so we never leave failed creds on disk.
        restore_done = threading.Event()
        events.invoke_main_thread(self._restore_previous_session, prev_login, prev_pass, restore_done)
        restore_done.wait(timeout=10)
        return {"success": False, "reason": "unreachable"}

    def _start_login_main_thread(self, username, password):
        config.sections["server"]["login"] = username
        config.sections["server"]["passw"] = password

        if core.users is not None and core.users.login_status != UserStatus.OFFLINE:
            core.reconnect()
        else:
            core.connect()

    def _restore_previous_session(self, prev_login, prev_pass, done=None):
        config.sections["server"]["login"] = prev_login
        config.sections["server"]["passw"] = prev_pass
        # Persist immediately so a failed attempt never lingers on disk, even if
        # the daemon quits before the restored session finishes logging back in.
        config.write_configuration()

        if not prev_login or not prev_pass:
            if core.users is not None and core.users.login_status != UserStatus.OFFLINE:
                core.disconnect()
        elif core.users is not None and core.users.login_status != UserStatus.OFFLINE:
            core.reconnect()
        else:
            core.connect()

        if done is not None:
            done.set()

    def resolve_login(self, success, username=None, reason=None, checksum=None):
        # Runs on the main thread. Settle the config here — persist the verified
        # creds on success, or roll back to the previous session on failure —
        # before signalling, so begin_login never returns with stale creds on disk.
        with self._lock:
            pending = self._pending_login
            if pending is None:
                return
            attempt_user = pending["username"]
            attempt_pass = pending["password"]
            prev_login = pending["prev_login"]
            prev_pass = pending["prev_pass"]

        if success:
            # The server echoes md5(password) of the login it accepted. Ignore any
            # login that isn't the one we attempted — e.g. a startup or auto-reconnect
            # already in flight with different credentials would otherwise be mistaken
            # for a successful web login.
            expected = hashlib.md5(attempt_pass.encode("utf-8")).hexdigest()
            if username != attempt_user or checksum != expected:
                return
            config.write_configuration()
        else:
            self._restore_previous_session(prev_login, prev_pass)

        with self._lock:
            pending = self._pending_login
            if pending is None:
                return
            if success:
                pending["result"] = {"success": True, "username": username}
            else:
                pending["result"] = {"success": False, "reason": reason or "failed"}
            pending["event"].set()

    def begin_logout(self):
        events.invoke_main_thread(self._logout_main_thread)

    def _logout_main_thread(self):
        if core.users is not None and core.users.login_status != UserStatus.OFFLINE:
            core.disconnect()

    def add_search(self, token, term):
        with self._lock:
            self.searches[token] = {
                "term": term,
                "started_at": int(time.time()),
                "results": 0
            }
            self.search_results.setdefault(token, [])
            if term:
                self.search_terms[term.casefold()] = token

    def remove_search(self, token):
        with self._lock:
            search = self.searches.pop(token, None)
            self.search_results.pop(token, None)
            if search:
                term = search.get("term") or ""
                if term:
                    self.search_terms.pop(term.casefold(), None)

    def remove_search_term(self, term):
        key = term.casefold()
        with self._lock:
            token = self.search_terms.get(key)
        if token is not None:
            self.remove_search(token)

    def ensure_search(self, term):
        clean_term = term.strip()
        if not clean_term:
            return None

        key = clean_term.casefold()
        with self._lock:
            token = self.search_terms.get(key)
            if token is not None:
                return token

        token = self.request_search(clean_term)
        if token is None:
            return None

        with self._lock:
            self.search_terms[key] = token
            if token not in self.searches:
                self.searches[token] = {
                    "term": clean_term,
                    "started_at": int(time.time()),
                    "results": 0
                }
                self.search_results.setdefault(token, [])

        return token

    def add_search_results(self, token, username, results, free_slots, speed, inqueue):
        if not results:
            return

        with self._lock:
            if token not in self.searches:
                return

            items = self.search_results.setdefault(token, [])
            remaining = self.max_search_results - len(items)
            if remaining <= 0:
                return

            for fileinfo in results[:remaining]:
                _code, name, size, _ext, file_attrs = fileinfo
                attributes_text = ""
                if file_attrs is not None:
                    h_quality, _bitrate, h_length, _length = FileListMessage.parse_audio_quality_length(
                        size, file_attrs
                    )
                    if h_quality and h_length:
                        attributes_text = f"{h_quality}, {h_length}"
                    elif h_quality:
                        attributes_text = h_quality
                    elif h_length:
                        attributes_text = h_length
                items.append({
                    "user": username,
                    "path": name,
                    "size": size,
                    "free_slots": free_slots,
                    "speed": speed,
                    "inqueue": inqueue,
                    "attributes": attributes_text
                })

            self.searches[token]["results"] = len(items)

    def get_search_snapshot(self, token):
        with self._lock:
            search = self.searches.get(token)
            results = list(self.search_results.get(token, []))

        return search, results

    def get_user_tree_state(self, username):
        """Current browse state for a user, without blocking.

        The frontend polls this quickly. A browse is kicked off on demand and its
        progress and resulting tree are reported as they become available. A built
        listing is cached (memory + disk) for at least a day, so repeat browses and
        prefetches return instantly.
        """
        if not username:
            return {"status": "error", "tree": None}

        now = time.time()

        with self._lock:
            cached = self._user_tree_cache.get(username)
            if cached and now - cached["cached_at"] < USER_TREE_CACHE_TTL:
                return {"status": "ready", "tree": cached["tree"], "cached": True}

            status = self._user_browse_status.get(username)
            if status == "loading":
                started = self._user_browse_started.get(username, now)
                if now - started <= USER_BROWSE_TIMEOUT:
                    return {
                        "status": "loading",
                        "tree": None,
                        "progress": self._progress_payload(self._user_browse_progress.get(username))
                    }
                self._user_browse_status[username] = "error"
                return {"status": "error", "tree": None}
            if status == "not_found":
                return {"status": "not_found", "tree": None}

        # No usable in-memory state: try a fresh-enough copy from disk before the network.
        disk_entry = self._load_cached_tree(username)
        if disk_entry is not None:
            with self._lock:
                self._user_tree_cache[username] = disk_entry
            return {"status": "ready", "tree": disk_entry["tree"], "cached": True}

        return self.start_user_browse(username)

    def start_user_browse(self, username):
        """Begin a browse unless one is already running or cached. Safe to fire-and-forget (prefetch)."""
        if not username:
            return {"status": "error", "tree": None}

        now = time.time()
        with self._lock:
            cached = self._user_tree_cache.get(username)
            if cached and now - cached["cached_at"] < USER_TREE_CACHE_TTL:
                return {"status": "ready", "tree": cached["tree"], "cached": True}

            if self._user_browse_status.get(username) == "loading":
                started = self._user_browse_started.get(username, now)
                if now - started <= USER_BROWSE_TIMEOUT:
                    return {
                        "status": "loading",
                        "tree": None,
                        "progress": self._progress_payload(self._user_browse_progress.get(username))
                    }

            self._user_browse_status[username] = "loading"
            self._user_browse_started[username] = now
            self._user_browse_progress.pop(username, None)

        events.invoke_main_thread(self._ensure_user_browse_main_thread, username)
        return {"status": "loading", "tree": None, "progress": None}

    def _ensure_user_browse_main_thread(self, username):
        if not username:
            return

        if username not in core.userbrowse.users:
            core.userbrowse.browse_user(username, new_request=True, switch_page=False)
        else:
            # Already browsed this session; the folder data is in memory, build the tree now.
            core.userbrowse.browse_user(username, new_request=False, switch_page=False)
            self.on_user_browse_complete(username)

    def record_user_browse_progress(self, username, position, total):
        if not username:
            return
        with self._lock:
            self._user_browse_progress[username] = (int(position or 0), int(total or 0))

    def on_user_browse_complete(self, username):
        if username:
            events.invoke_main_thread(self._build_user_tree_main_thread, username)

    def _build_user_tree_main_thread(self, username):
        tree = build_user_tree(username, hide_at_root=True)
        if tree is None:
            tree = {"name": "", "type": "root", "children": []}
        entry = {"tree": tree, "cached_at": time.time()}
        with self._lock:
            self._user_tree_cache[username] = entry
            self._user_browse_status[username] = "ready"
            self._user_browse_progress.pop(username, None)
        self._save_cached_tree(username, entry)

    @staticmethod
    def _progress_payload(progress):
        if not progress:
            return None
        position, total = progress
        if not total:
            return None
        return {"position": position, "total": total}

    @staticmethod
    def _user_cache_path(username):
        cache_dir = os.path.join(config.data_folder_path, "daemon-usercache")
        return os.path.join(cache_dir, clean_file(username) + ".json")

    def _load_cached_tree(self, username):
        path = self._user_cache_path(username)
        try:
            encoded = encode_path(path)
            if not os.path.isfile(encoded):
                return None
            if time.time() - os.path.getmtime(encoded) >= USER_TREE_CACHE_TTL:
                return None
            with open(encoded, "r", encoding="utf-8") as file_handle:
                data = json.load(file_handle)
        except (OSError, ValueError):
            return None

        tree = data.get("tree")
        if tree is None:
            return None
        return {"tree": tree, "cached_at": data.get("cached_at", time.time())}

    def _save_cached_tree(self, username, entry):
        try:
            cache_dir = os.path.join(config.data_folder_path, "daemon-usercache")
            os.makedirs(encode_path(cache_dir), exist_ok=True)
            with open(encode_path(self._user_cache_path(username)), "w", encoding="utf-8") as file_handle:
                json.dump({"cached_at": entry["cached_at"], "tree": entry["tree"]}, file_handle, ensure_ascii=False)
        except OSError:
            pass

    def build_search_tree(self, token):
        with self._lock:
            results = list(self.search_results.get(token, []))

        return build_search_tree(results)

    def request_download(self, username, virtual_path, size=0):
        events.invoke_main_thread(self._download_main_thread, username, virtual_path, size)

    def _download_main_thread(self, username, virtual_path, size):
        if not username or not virtual_path:
            return
        core.downloads.enqueue_download(username, virtual_path, size=size)

    def pause_download(self, username, virtual_path):
        events.invoke_main_thread(self._pause_download_main_thread, username, virtual_path)

    def _pause_download_main_thread(self, username, virtual_path):
        transfer = core.downloads.transfers.get(username + virtual_path)
        if transfer is None:
            return
        core.downloads.abort_downloads([transfer], status=TransferStatus.PAUSED)

    def cancel_download(self, username, virtual_path):
        events.invoke_main_thread(self._cancel_download_main_thread, username, virtual_path)

    def _cancel_download_main_thread(self, username, virtual_path):
        transfer = core.downloads.transfers.get(username + virtual_path)
        if transfer is None:
            return
        core.downloads.abort_downloads([transfer], status=TransferStatus.CANCELLED)

    def resume_download(self, username, virtual_path):
        events.invoke_main_thread(self._resume_download_main_thread, username, virtual_path)

    def _resume_download_main_thread(self, username, virtual_path):
        transfer = core.downloads.transfers.get(username + virtual_path)
        if transfer is None:
            return
        core.downloads.retry_downloads([transfer])

    def clear_download(self, username, virtual_path):
        events.invoke_main_thread(self._clear_download_main_thread, username, virtual_path)

    def _clear_download_main_thread(self, username, virtual_path):
        transfer = core.downloads.transfers.get(username + virtual_path)
        if transfer is None:
            return
        core.downloads.clear_downloads([transfer])

    def clear_completed_downloads(self):
        events.invoke_main_thread(self._clear_completed_downloads_main_thread)

    def _clear_completed_downloads_main_thread(self):
        core.downloads.clear_downloads(statuses=[TransferStatus.FINISHED])

    def set_download_override(self, username, virtual_path, local_path):
        key = username + virtual_path
        with self._lock:
            self.download_path_overrides[key] = local_path

    def clear_download_override(self, username, virtual_path):
        key = username + virtual_path
        with self._lock:
            self.download_path_overrides.pop(key, None)

    def request_downloads_snapshot(self):
        with self._lock:
            self._pending_request_id += 1
            request_id = self._pending_request_id
            pending = {"event": threading.Event(), "downloads": []}
            self.pending_requests[request_id] = pending

        events.invoke_main_thread(self._downloads_snapshot_main_thread, request_id)
        pending["event"].wait(timeout=2)

        with self._lock:
            result = self.pending_requests.pop(request_id, None)

        if not result:
            return []

        return result.get("downloads", [])

    def _downloads_snapshot_main_thread(self, request_id):
        downloads = []
        for transfer in core.downloads.transfers.values():
            if transfer.queued_at is None:
                transfer.queued_at = time.time()
            local_path = None
            if transfer.status == TransferStatus.FINISHED:
                override = self.download_path_overrides.get(transfer.username + transfer.virtual_path)
                if override and os.path.exists(override):
                    local_path = override
                else:
                    download_path, file_exists = core.downloads.get_complete_download_file_path(
                        transfer.username, transfer.virtual_path, transfer.size, transfer.folder_path)
                    if file_exists:
                        local_path = download_path
            if local_path is None and transfer.status == TransferStatus.FINISHED:
                self.clear_download_override(transfer.username, transfer.virtual_path)
            downloads.append({
                "user": transfer.username,
                "path": transfer.virtual_path,
                "virtual_path": transfer.virtual_path,
                "status": transfer.status,
                "size": transfer.size,
                "offset": transfer.current_byte_offset or 0,
                "folder": transfer.folder_path or "",
                "local_path": local_path,
                "queued_at": transfer.queued_at or 0
            })

        with self._lock:
            pending = self.pending_requests.get(request_id)
            if pending is None:
                return

            pending["downloads"] = downloads
            pending["event"].set()

    def notify_user_browse_not_found(self, username):
        if not username:
            return
        with self._lock:
            self._user_browse_status[username] = "not_found"
            self._user_browse_progress.pop(username, None)

    def snapshot(self):
        with self._lock:
            share_files = self.share_files
            share_folders = self.share_folders
            share_status = self.share_status
            chat_lines = list(self.chat_lines)
            searches = {
                token: data.copy() for token, data in self.searches.items()
            }
            connection_info = self.connection_info
            portmap_info = self.portmap_info

        if share_files is None or share_folders is None:
            share_files, share_folders = compute_share_counts()
            if share_files is not None:
                share_status = "ready"

        username = ""
        if core.users is not None and core.users.login_username:
            username = core.users.login_username
        elif config.sections["server"]["login"]:
            username = config.sections["server"]["login"]

        stats = config.sections.get("statistics", {})
        since_timestamp = stats.get("since_timestamp", 0)
        since_text = time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(since_timestamp)) if since_timestamp else ""

        return {
            "status": self._get_status_label(),
            "username": username,
            "share_files": share_files,
            "share_folders": share_folders,
            "share_status": share_status,
            "connection_info": connection_info,
            "portmap_info": portmap_info,
            "stats": {
                "since": since_text,
                "started_downloads": stats.get("started_downloads", 0),
                "completed_downloads": stats.get("completed_downloads", 0),
                "downloaded_size": stats.get("downloaded_size", 0),
                "started_uploads": stats.get("started_uploads", 0),
                "completed_uploads": stats.get("completed_uploads", 0),
                "uploaded_size": stats.get("uploaded_size", 0)
            },
            "shares": list(config.sections["transfers"].get("shared", [])),
            "chat": chat_lines,
            "searches": searches
        }

    def get_chat_snapshot(self):
        with self._lock:
            return list(self.chat_lines)

    def _get_status_label(self):
        if core.users is None:
            return "offline"

        status = core.users.login_status

        if status == UserStatus.ONLINE:
            return "online"

        if status == UserStatus.AWAY:
            return "away"

        if status == UserStatus.OFFLINE:
            return "offline"

        return "unknown"


def compute_share_counts():
    if core.shares is None:
        return None, None

    share_dbs = core.shares.share_dbs
    if not share_dbs:
        return None, None

    share_files = len(share_dbs.get("public_files", {}))
    share_folders = len(share_dbs.get("public_streams", {}))

    if config.sections["transfers"]["reveal_buddy_shares"]:
        share_files += len(share_dbs.get("buddy_files", {}))
        share_folders += len(share_dbs.get("buddy_streams", {}))

    if config.sections["transfers"]["reveal_trusted_shares"]:
        share_files += len(share_dbs.get("trusted_files", {}))
        share_folders += len(share_dbs.get("trusted_streams", {}))

    return share_files, share_folders
