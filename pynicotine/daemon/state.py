# SPDX-FileCopyrightText: 2025 Nicotine+ Contributors
# SPDX-License-Identifier: GPL-3.0-or-later

import hashlib
import hmac
import io
import json
import os
import threading
import time

from collections import deque

from PIL import Image, ImageOps

from pynicotine.config import config
from pynicotine.core import core
from pynicotine.events import events
from pynicotine.slskmessages import FileListMessage
from pynicotine.slskmessages import UserInfoRequest
from pynicotine.slskmessages import UserStatus
from pynicotine.transfers import TransferStatus
from pynicotine.utils import clean_file
from pynicotine.utils import encode_path
from pynicotine.daemon.trees import build_search_tree
from pynicotine.daemon.trees import build_user_tree
from pynicotine.daemon.trees import count_nodes
from pynicotine.daemon.trees import find_node
from pynicotine.daemon.trees import prune_tree_to_path


USER_TREE_CACHE_TTL = 24 * 60 * 60  # keep a browsed user's listing for at least a day
USER_TREE_MAX_FULL_NODES = 30000  # bigger listings are pruned per request; the browser can't take 100k+ nodes
USER_BROWSE_TIMEOUT = 45  # give up on an unresponsive user after this many seconds
USER_INFO_CACHE_TTL = 7 * 24 * 60 * 60  # keep profile pic + description for a week
USER_INFO_TIMEOUT = 30  # give up on an unresponsive user's profile after this many seconds
USER_THUMB_SIZE = 96  # square profile-picture thumbnail edge, in pixels
SEARCH_CACHE_TTL = 24 * 60 * 60  # keep search results on disk for at least a day
SEARCH_QUIET_PERIOD = 20   # a live search is "complete" once no new results arrive for this long
SEARCH_MAX_DURATION = 180  # ... or once this many seconds pass since it started, whichever is first
SEARCH_SAVE_INTERVAL = 4  # seconds between disk writes for an actively-updating search
SEARCH_SORT_KEYS = ("user", "speed", "folder", "file", "size", "attributes")

# A login that goes through a reconnect can wait out the network thread's
# short retry timer (~5s) on top of the TCP connect and server round-trip.
# Port mapping is no longer part of the login path.
LOGIN_TIMEOUT = 20


def compute_search_state(entry, now, max_results=0):
    """Return "running" or "complete" for a live search entry.

    Soulseek searches never formally finish; peers answer asynchronously with no
    defined end. We treat a search as complete once the result cap is reached (no
    further results are kept), results stop arriving for a quiet period, or a hard
    time cap elapses.
    """
    started = entry.get("started_at", 0)
    if not started:
        return "complete"
    if max_results and entry.get("results", 0) >= max_results:
        return "complete"
    if now - started >= SEARCH_MAX_DURATION:
        return "complete"
    last_result = entry.get("last_result_at", started)
    if now - last_result >= SEARCH_QUIET_PERIOD:
        return "complete"
    return "running"


class DaemonState:
    __slots__ = ("_lock", "share_files", "share_folders", "share_status", "chat_lines",
                 "searches", "search_results", "search_terms", "max_search_results",
                 "_search_cache_index", "_search_last_saved", "_search_sort",
                 "pending_requests", "_pending_request_id", "_pending_login",
                 "_user_browse_status", "_user_browse_progress", "_user_browse_started",
                 "_user_tree_cache", "connection_info", "portmap_info",
                 "download_path_overrides", "_user_info_cache", "_user_info_status",
                 "_user_info_started", "_user_watch")

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
        self._search_last_saved = {}
        self._search_cache_index = self._load_search_cache_index()
        self._search_sort = self._load_search_sort()
        self.pending_requests = {}
        self._pending_request_id = 0
        self._pending_login = None
        self._user_browse_status = {}
        self._user_browse_progress = {}
        self._user_browse_started = {}
        self._user_tree_cache = {}
        self._user_info_cache = {}
        self._user_info_status = {}
        self._user_info_started = {}
        self._user_watch = {}
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
        completed = pending["event"].wait(timeout=LOGIN_TIMEOUT)

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
            # Status is OFFLINE even while a connection attempt is in flight, and
            # the network thread silently drops ServerConnect while one exists —
            # a plain connect() would never send these credentials. reconnect()
            # closes any in-flight attempt (arming a short retry timer that picks
            # up the new credentials) and is a no-op when idle; connect() covers
            # the idle case and cancels any pending reconnect-backoff timer.
            core.reconnect()
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
            core.reconnect()
            core.connect()

        if done is not None:
            done.set()

    def resolve_login(self, success, username=None, reason=None, checksum=None, detail=None):
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
                pending["result"] = {"success": False, "reason": reason or "failed", "detail": detail}
            pending["event"].set()

    def begin_logout(self):
        events.invoke_main_thread(self._logout_main_thread)

    def _logout_main_thread(self):
        if core.users is not None and core.users.login_status != UserStatus.OFFLINE:
            core.disconnect()

    def add_search(self, token, term):
        with self._lock:
            now = int(time.time())
            self.searches[token] = {
                "term": term,
                "started_at": now,
                "last_result_at": now,
                "results": 0
            }
            self.search_results.setdefault(token, [])
            if term:
                self.search_terms[term.casefold()] = token

    def remove_search(self, token, drop_cache=False):
        term = ""
        with self._lock:
            search = self.searches.pop(token, None)
            self.search_results.pop(token, None)
            self._search_last_saved.pop(token, None)
            if search:
                term = search.get("term") or ""
                if term:
                    self.search_terms.pop(term.casefold(), None)
        # A search expiring (core "remove-search") must NOT drop the on-disk cache;
        # only an explicit user removal does.
        if drop_cache and term:
            self._delete_search_cache(term)

    def remove_search_term(self, term):
        key = term.casefold()
        with self._lock:
            token = self.search_terms.get(key)
        if token is not None:
            self.remove_search(token, drop_cache=True)
        else:
            self._delete_search_cache(term)

    def clear_all_searches(self):
        with self._lock:
            tokens = list(self.searches.keys())
            cached_terms = [entry.get("term", "") for entry in self._search_cache_index.values()]
        for token in tokens:
            self.remove_search(token, drop_cache=True)
        for term in cached_terms:
            if term:
                self._delete_search_cache(term)

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
                now = int(time.time())
                self.searches[token] = {
                    "term": clean_term,
                    "started_at": now,
                    "last_result_at": now,
                    "results": 0
                }
                self.search_results.setdefault(token, [])

        return token

    def add_search_results(self, token, username, results, free_slots, speed, inqueue):
        if not results:
            return

        save_payload = None
        with self._lock:
            if token not in self.searches:
                return

            now = time.time()
            self.searches[token]["last_result_at"] = now
            items = self.search_results.setdefault(token, [])
            remaining = self.max_search_results - len(items)
            if remaining > 0:
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

            if items and now - self._search_last_saved.get(token, 0) >= SEARCH_SAVE_INTERVAL:
                self._search_last_saved[token] = now
                term = self.searches[token].get("term", "")
                if term:
                    save_payload = (term, self.searches[token].get("started_at", int(now)), list(items))

        if save_payload:
            self._save_search_cache(*save_payload)

    def get_search_snapshot(self, token):
        with self._lock:
            search = self.searches.get(token)
            results = list(self.search_results.get(token, []))

        return search, results

    def get_user_tree_state(self, username, path="", full=False):
        """Current browse state for a user, without blocking.

        The frontend polls this quickly. A browse is kicked off on demand and its
        progress and resulting tree are reported as they become available. A built
        listing is cached (memory + disk) for at least a day, so repeat browses and
        prefetches return instantly.

        Listings above USER_TREE_MAX_FULL_NODES are never returned whole: the
        response is pruned to the spine of `path` and the frontend fetches deeper
        levels on demand. `full` returns the complete subtree at `path` (still
        subject to the node cap), for folder downloads.
        """
        if not username:
            return {"status": "error", "tree": None}

        now = time.time()

        with self._lock:
            cached = self._user_tree_cache.get(username)
            if cached and now - cached["cached_at"] < USER_TREE_CACHE_TTL:
                return self._tree_payload(cached, path, full)

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
            return self._tree_payload(disk_entry, path, full)

        return self.start_user_browse(username)

    @staticmethod
    def _tree_payload(entry, path, full):
        tree = entry["tree"]
        node_count = entry.get("node_count")
        if node_count is None:
            node_count = count_nodes(tree)
            entry["node_count"] = node_count

        if node_count <= USER_TREE_MAX_FULL_NODES:
            if full:
                node = find_node(tree, path)
                if node is None:
                    return {"status": "error", "tree": None}
                return {"status": "ready", "tree": node, "cached": True}
            return {"status": "ready", "tree": tree, "cached": True}

        if full:
            node = find_node(tree, path)
            if node is None:
                return {"status": "error", "tree": None}
            if count_nodes(node) > USER_TREE_MAX_FULL_NODES:
                return {"status": "too_large", "tree": None}
            return {"status": "ready", "tree": node, "cached": True}

        return {"status": "ready", "tree": prune_tree_to_path(tree, path), "cached": True, "truncated": True}

    def start_user_browse(self, username):
        """Begin a browse unless one is already running or cached. Safe to fire-and-forget (prefetch)."""
        if not username:
            return {"status": "error", "tree": None}

        now = time.time()
        with self._lock:
            cached = self._user_tree_cache.get(username)
            if cached and now - cached["cached_at"] < USER_TREE_CACHE_TTL:
                return self._tree_payload(cached, "", False)

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
        cache_dir = os.path.join(config.data_folder_path, "users")
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
            cache_dir = os.path.join(config.data_folder_path, "users")
            os.makedirs(encode_path(cache_dir), exist_ok=True)
            with open(encode_path(self._user_cache_path(username)), "w", encoding="utf-8") as file_handle:
                json.dump({"cached_at": entry["cached_at"], "tree": entry["tree"]}, file_handle, ensure_ascii=False)
        except OSError:
            pass

    def get_search_state(self, token):
        with self._lock:
            entry = self.searches.get(token)
            if entry is None:
                return "complete"
            return compute_search_state(entry, time.time(), self.max_search_results)

    # --- user info (profile picture + description), cached for a week ---------

    def get_user_info_state(self, username):
        """Current profile state for a user, without blocking.

        The frontend calls this once per user shown in a result list. A profile
        request is kicked off on demand; the picture and description are cached
        (memory + disk) for a week, so repeat views return instantly.
        """
        if not username:
            return {"status": "error", "description": "", "has_pic": False}

        now = time.time()

        with self._lock:
            cached = self._user_info_cache.get(username)
            if cached and now - cached["cached_at"] < USER_INFO_CACHE_TTL:
                return self._user_info_payload(username, cached)

            status = self._user_info_status.get(username)
            if status == "loading":
                started = self._user_info_started.get(username, now)
                if now - started <= USER_INFO_TIMEOUT:
                    return {"status": "loading", "description": "", "has_pic": False}
                self._user_info_status[username] = "error"
                return {"status": "error", "description": "", "has_pic": False}

        disk_entry = self._load_cached_user_info(username)
        if disk_entry is not None:
            with self._lock:
                self._user_info_cache[username] = disk_entry
            return self._user_info_payload(username, disk_entry)

        return self.start_user_info(username)

    def start_user_info(self, username, force=False):
        """Request a user's profile unless one is already cached or in flight.

        force=True re-requests from the peer even when a fresh copy is cached
        (used when a user's page / file listing is opened), refreshing the cache.
        An in-flight request is still coalesced.
        """
        if not username:
            return {"status": "error", "description": "", "has_pic": False}

        now = time.time()
        with self._lock:
            cached = self._user_info_cache.get(username)
            if not force and cached and now - cached["cached_at"] < USER_INFO_CACHE_TTL:
                return self._user_info_payload(username, cached)

            if self._user_info_status.get(username) == "loading":
                started = self._user_info_started.get(username, now)
                if now - started <= USER_INFO_TIMEOUT:
                    return {"status": "loading", "description": "", "has_pic": False}

            self._user_info_status[username] = "loading"
            self._user_info_started[username] = now

        events.invoke_main_thread(self._request_user_info_main_thread, username)
        return {"status": "loading", "description": "", "has_pic": False}

    def _request_user_info_main_thread(self, username):
        if not username:
            return
        core.send_message_to_peer(username, UserInfoRequest())
        # Track live status/speed/country alongside the profile. Watching gives
        # the initial stats and pushes status changes; stats are re-requested
        # explicitly since the server never pushes stat updates.
        self._user_watch.setdefault(username, {})
        core.users.watch_user(username, context="daemon-userinfo")
        core.users.request_user_stats(username)

    def on_user_stats(self, msg):
        username = getattr(msg, "user", None)
        watch = self._user_watch.get(username)
        if watch is None:
            return
        watch["avg_speed"] = getattr(msg, "avgspeed", None)
        status = getattr(msg, "status", None)
        if status is not None:
            watch["status"] = self._status_name(status)
        country = getattr(msg, "country", None)
        if country:
            watch["country"] = country

    def on_user_status(self, msg):
        username = getattr(msg, "user", None)
        watch = self._user_watch.get(username)
        if watch is None or msg.status is None:
            return
        watch["status"] = self._status_name(msg.status)

    def on_user_country(self, username, country_code):
        watch = self._user_watch.get(username)
        if watch is None or not country_code:
            return
        watch["country"] = country_code

    @staticmethod
    def _status_name(status):
        return {
            UserStatus.OFFLINE: "offline",
            UserStatus.AWAY: "away",
            UserStatus.ONLINE: "online",
        }.get(status)

    def on_user_info_response(self, msg):
        username = getattr(msg, "username", None)
        if not username:
            return

        pic = getattr(msg, "pic", None) or None
        slots_free = getattr(msg, "slotsavail", None)
        entry = {
            "description": getattr(msg, "descr", "") or "",
            "has_pic": bool(pic),
            "mime": self._detect_image_mime(pic) if pic else "",
            "cached_at": time.time(),
            "total_uploads": getattr(msg, "totalupl", None),
            "queue_size": getattr(msg, "queuesize", None),
            "slots_free": bool(slots_free) if slots_free is not None else None,
        }
        with self._lock:
            self._user_info_cache[username] = entry
            self._user_info_status[username] = "ready"
        self._save_cached_user_info(username, entry, pic)

    def get_user_pic(self, username, thumb=False):
        """Return (bytes, mime) for a cached profile picture, or None.

        With thumb=True, serve the small square thumbnail, generating it on
        demand if missing (e.g. pictures cached before thumbnails existed) and
        falling back to the full picture if the image can't be thumbnailed.
        """
        if not username:
            return None

        json_path, pic_path, thumb_path = self._user_info_cache_paths(username)
        try:
            encoded_json = encode_path(json_path)
            encoded_pic = encode_path(pic_path)
            if not os.path.isfile(encoded_pic) or not os.path.isfile(encoded_json):
                return None
            if time.time() - os.path.getmtime(encoded_json) >= USER_INFO_CACHE_TTL:
                return None
            with open(encoded_json, "r", encoding="utf-8") as file_handle:
                meta = json.load(file_handle)
        except (OSError, ValueError):
            return None

        if thumb:
            encoded_thumb = encode_path(thumb_path)
            try:
                if os.path.isfile(encoded_thumb):
                    with open(encoded_thumb, "rb") as file_handle:
                        cached_thumb = file_handle.read()
                    if cached_thumb:
                        return cached_thumb, "image/png"
            except OSError:
                pass

            # No thumbnail on disk yet: build one from the full picture.
            try:
                with open(encoded_pic, "rb") as file_handle:
                    full = file_handle.read()
            except OSError:
                return None
            thumb_bytes = self._make_thumbnail(full)
            if thumb_bytes:
                try:
                    with open(encoded_thumb, "wb") as file_handle:
                        file_handle.write(thumb_bytes)
                except OSError:
                    pass
                return thumb_bytes, "image/png"
            # Thumbnailing failed (undecodable image): fall back to the full pic.

        try:
            with open(encoded_pic, "rb") as file_handle:
                data = file_handle.read()
        except OSError:
            return None
        if not data:
            return None
        return data, meta.get("mime") or "application/octet-stream"

    def _user_info_payload(self, username, entry):
        watch = self._user_watch.get(username) or {}
        return {
            "status": "ready",
            "description": entry.get("description", ""),
            "has_pic": bool(entry.get("has_pic")),
            "cached_at": int(entry.get("cached_at", 0)),
            "total_uploads": entry.get("total_uploads"),
            "queue_size": entry.get("queue_size"),
            "slots_free": entry.get("slots_free"),
            "user_status": watch.get("status"),
            "avg_speed": watch.get("avg_speed"),
            "country": watch.get("country"),
        }

    @staticmethod
    def _detect_image_mime(data):
        if not data:
            return ""
        if data[:8] == b"\x89PNG\r\n\x1a\n":
            return "image/png"
        if data[:2] == b"\xff\xd8":
            return "image/jpeg"
        if data[:6] in (b"GIF87a", b"GIF89a"):
            return "image/gif"
        if data[:2] == b"BM":
            return "image/bmp"
        if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
            return "image/webp"
        return "application/octet-stream"

    @staticmethod
    def _user_info_cache_paths(username):
        cache_dir = os.path.join(config.data_folder_path, "userinfo")
        base = os.path.join(cache_dir, clean_file(username))
        return base + ".json", base + ".pic", base + ".thumb"

    @staticmethod
    def _make_thumbnail(pic_bytes):
        """Square, center-cropped PNG thumbnail. Returns None only if the image
        can't be decoded (caller then falls back to serving the full picture)."""
        if not pic_bytes:
            return None
        try:
            with Image.open(io.BytesIO(pic_bytes)) as img:
                img = ImageOps.exif_transpose(img)
                has_alpha = img.mode in ("RGBA", "LA", "PA") or (
                    img.mode == "P" and "transparency" in img.info)
                img = img.convert("RGBA" if has_alpha else "RGB")
                width, height = img.size
                side = min(width, height)
                if side <= 0:
                    return None
                left = (width - side) // 2
                top = (height - side) // 2
                img = img.crop((left, top, left + side, top + side))
                img = img.resize((USER_THUMB_SIZE, USER_THUMB_SIZE), Image.LANCZOS)
                out = io.BytesIO()
                img.save(out, format="PNG", optimize=True)
                return out.getvalue()
        except Exception:
            return None

    def _load_cached_user_info(self, username):
        json_path, _pic_path, _thumb_path = self._user_info_cache_paths(username)
        try:
            encoded = encode_path(json_path)
            if not os.path.isfile(encoded):
                return None
            if time.time() - os.path.getmtime(encoded) >= USER_INFO_CACHE_TTL:
                return None
            with open(encoded, "r", encoding="utf-8") as file_handle:
                data = json.load(file_handle)
        except (OSError, ValueError):
            return None

        return {
            "description": data.get("description", ""),
            "has_pic": bool(data.get("has_pic")),
            "mime": data.get("mime", ""),
            "cached_at": data.get("cached_at", time.time()),
            "total_uploads": data.get("total_uploads"),
            "queue_size": data.get("queue_size"),
            "slots_free": data.get("slots_free"),
        }

    def _save_cached_user_info(self, username, entry, pic):
        json_path, pic_path, thumb_path = self._user_info_cache_paths(username)
        thumb = self._make_thumbnail(pic) if pic else None
        try:
            cache_dir = os.path.join(config.data_folder_path, "userinfo")
            os.makedirs(encode_path(cache_dir), exist_ok=True)
            with open(encode_path(json_path), "w", encoding="utf-8") as file_handle:
                json.dump({
                    "cached_at": entry["cached_at"],
                    "description": entry["description"],
                    "has_pic": entry["has_pic"],
                    "mime": entry["mime"],
                    "total_uploads": entry.get("total_uploads"),
                    "queue_size": entry.get("queue_size"),
                    "slots_free": entry.get("slots_free"),
                }, file_handle, ensure_ascii=False)
            if pic:
                with open(encode_path(pic_path), "wb") as file_handle:
                    file_handle.write(pic)
            else:
                for stale in (pic_path, thumb_path):
                    encoded = encode_path(stale)
                    if os.path.isfile(encoded):
                        os.remove(encoded)
            if thumb:
                with open(encode_path(thumb_path), "wb") as file_handle:
                    file_handle.write(thumb)
            elif pic:
                # picture present but not thumbnailable: drop any stale thumb
                encoded_thumb = encode_path(thumb_path)
                if os.path.isfile(encoded_thumb):
                    os.remove(encoded_thumb)
        except OSError:
            pass

    def build_search_tree(self, token):
        with self._lock:
            results = list(self.search_results.get(token, []))
            term = self.searches.get(token, {}).get("term", "")
            cached = self._search_cache_index.get(term.casefold()) if term else None
            cached_results = list(cached["results"]) if cached else []

        if cached_results:
            seen = {(row.get("user"), row.get("path")) for row in results}
            for row in cached_results:
                if (row.get("user"), row.get("path")) not in seen:
                    results.append(row)

        return build_search_tree(results)

    @staticmethod
    def _search_cache_dir():
        return os.path.join(config.data_folder_path, "search")

    @staticmethod
    def _search_cache_path(term):
        digest = hashlib.sha1(term.casefold().encode("utf-8")).hexdigest()[:16]
        return os.path.join(DaemonState._search_cache_dir(), digest + ".json")

    def _load_search_cache_index(self):
        index = {}
        cache_dir = self._search_cache_dir()
        try:
            filenames = os.listdir(encode_path(cache_dir))
        except OSError:
            return index

        now = time.time()
        for raw_name in filenames:
            path = os.path.join(cache_dir, os.fsdecode(raw_name))
            try:
                encoded = encode_path(path)
                if now - os.path.getmtime(encoded) >= SEARCH_CACHE_TTL:
                    continue
                with open(encoded, "r", encoding="utf-8") as file_handle:
                    data = json.load(file_handle)
            except (OSError, ValueError):
                continue

            term = data.get("term")
            if not term:
                continue
            index[term.casefold()] = {
                "term": term,
                "started_at": data.get("started_at", 0),
                "cached_at": data.get("cached_at", now),
                "results": data.get("results", [])
            }
        return index

    def _save_search_cache(self, term, started_at, results):
        entry = {
            "term": term,
            "started_at": started_at,
            "cached_at": time.time(),
            "results": results
        }
        with self._lock:
            self._search_cache_index[term.casefold()] = entry
        try:
            os.makedirs(encode_path(self._search_cache_dir()), exist_ok=True)
            with open(encode_path(self._search_cache_path(term)), "w", encoding="utf-8") as file_handle:
                json.dump(entry, file_handle, ensure_ascii=False)
        except OSError:
            pass

    def _delete_search_cache(self, term):
        with self._lock:
            self._search_cache_index.pop(term.casefold(), None)
        try:
            os.remove(encode_path(self._search_cache_path(term)))
        except OSError:
            pass

    @staticmethod
    def _search_sort_path():
        return os.path.join(config.data_folder_path, "daemon-searchsort.json")

    def _load_search_sort(self):
        try:
            with open(encode_path(self._search_sort_path()), "r", encoding="utf-8") as file_handle:
                data = json.load(file_handle)
        except (OSError, ValueError):
            return {}
        if not isinstance(data, dict):
            return {}
        result = {}
        for term_key, value in data.items():
            if isinstance(value, dict) and value.get("key") in SEARCH_SORT_KEYS \
                    and value.get("dir") in ("asc", "desc"):
                result[term_key] = {"key": value["key"], "dir": value["dir"]}
        return result

    def _save_search_sort(self):
        with self._lock:
            snapshot = dict(self._search_sort)
        try:
            os.makedirs(encode_path(config.data_folder_path), exist_ok=True)
            with open(encode_path(self._search_sort_path()), "w", encoding="utf-8") as file_handle:
                json.dump(snapshot, file_handle, ensure_ascii=False)
        except OSError:
            pass

    def set_search_sort(self, term, key, direction):
        if not term or key not in SEARCH_SORT_KEYS or direction not in ("asc", "desc"):
            return
        with self._lock:
            self._search_sort[term.casefold()] = {"key": key, "dir": direction}
        self._save_search_sort()

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

    @staticmethod
    def _expand_config_path(path):
        # Config paths may contain placeholders like ${NICOTINE_DATA_HOME}
        # (the defaults do); expand them the same way the transfer code does.
        if not path:
            return ""
        return os.path.normpath(os.path.expandvars(str(path)))

    def get_directories(self):
        transfers = config.sections["transfers"]
        shared_dirs = []
        for share in transfers.get("shared", []):
            if isinstance(share, (list, tuple)) and len(share) >= 2:
                shared_dirs.append(self._expand_config_path(share[1]))
            elif isinstance(share, dict) and share.get("path"):
                shared_dirs.append(self._expand_config_path(share["path"]))
        return {
            "download_dir": self._expand_config_path(transfers.get("downloaddir")),
            "incomplete_dir": self._expand_config_path(transfers.get("incompletedir")),
            "shared_dirs": shared_dirs
        }

    def set_download_directory(self, path, incomplete=False):
        key = "incompletedir" if incomplete else "downloaddir"
        return self._run_config_change(self._set_directory_main_thread, key, path)

    def _set_directory_main_thread(self, key, path):
        config.sections["transfers"][key] = os.path.normpath(path)
        config.write_configuration()
        return True

    def add_share(self, path):
        return self._run_config_change(self._add_share_main_thread, path)

    def _add_share_main_thread(self, path):
        virtual_name = core.shares.add_share(path)
        if not virtual_name:
            return False
        config.write_configuration()
        core.shares.rescan_shares()
        return True

    def remove_share(self, path):
        return self._run_config_change(self._remove_share_main_thread, path)

    def _remove_share_main_thread(self, path):
        if not core.shares.remove_share(path):
            return False
        config.write_configuration()
        core.shares.rescan_shares()
        return True

    def _run_config_change(self, target, *args):
        done = threading.Event()
        result = {"value": False, "error": None}

        def run():
            try:
                result["value"] = target(*args)
            except Exception as error:  # noqa: BLE001
                result["error"] = error
            finally:
                done.set()

        events.invoke_main_thread(run)
        done.wait(timeout=5)
        if result["error"] is not None:
            raise result["error"]
        return result["value"]

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
            now = time.time()
            searches = {}
            for token, data in self.searches.items():
                entry = data.copy()
                entry["state"] = compute_search_state(data, now, self.max_search_results)
                searches[token] = entry
            live_terms = {data.get("term", "").casefold() for data in self.searches.values()}
            for key, cached in self._search_cache_index.items():
                if key in live_terms:
                    continue
                searches[f"cache:{key}"] = {
                    "term": cached.get("term", ""),
                    "started_at": cached.get("started_at", 0),
                    "results": len(cached.get("results", [])),
                    "state": "complete"
                }
            for entry in searches.values():
                sort = self._search_sort.get(entry.get("term", "").casefold())
                if sort:
                    entry["sort"] = dict(sort)
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
