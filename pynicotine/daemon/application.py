# SPDX-FileCopyrightText: 2025 Nicotine+ Contributors
# SPDX-License-Identifier: GPL-3.0-or-later

import html
import json
import sys
import threading
import time

from collections import deque
from urllib.parse import parse_qs
from http.server import BaseHTTPRequestHandler, HTTPServer
from socketserver import ThreadingMixIn
from urllib.parse import urlparse

from pynicotine.config import config
from pynicotine.core import core
from pynicotine.events import events
from pynicotine.logfacility import log
from pynicotine.slskmessages import UserStatus
from pynicotine.utils import human_size


class DaemonState:
    __slots__ = ("_lock", "share_files", "share_folders", "share_status", "chat_lines",
                 "searches", "search_results", "max_search_results", "pending_searches",
                 "_pending_search_id", "_user_browse_events")

    def __init__(self):
        self._lock = threading.Lock()
        self.share_files = None
        self.share_folders = None
        self.share_status = "scanning"
        self.chat_lines = deque(maxlen=50)
        self.searches = {}
        self.search_results = {}
        self.max_search_results = 500
        self.pending_searches = {}
        self._pending_search_id = 0
        self._user_browse_events = {}

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
            self._pending_search_id += 1
            request_id = self._pending_search_id
            pending = {"event": threading.Event(), "token": None}
            self.pending_searches[request_id] = pending

        events.invoke_main_thread(self._start_search_main_thread, request_id, term)
        pending["event"].wait(timeout=3)

        with self._lock:
            token = pending["token"]
            self.pending_searches.pop(request_id, None)

        return token

    def _start_search_main_thread(self, request_id, term):
        core.search.do_search(term, "global")
        token = core.search.token

        with self._lock:
            pending = self.pending_searches.get(request_id)
            if pending is None:
                return

            pending["token"] = token
            pending["event"].set()

    def add_search(self, token, term):
        with self._lock:
            self.searches[token] = {
                "term": term,
                "started_at": int(time.time()),
                "results": 0
            }
            self.search_results.setdefault(token, [])

    def remove_search(self, token):
        with self._lock:
            self.searches.pop(token, None)
            self.search_results.pop(token, None)

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
                _code, name, size, _ext, _attrs = fileinfo
                items.append({
                    "user": username,
                    "path": name,
                    "size": size,
                    "free_slots": free_slots,
                    "speed": speed,
                    "inqueue": inqueue
                })

            self.searches[token]["results"] = len(items)

    def get_search_snapshot(self, token):
        with self._lock:
            search = self.searches.get(token)
            results = list(self.search_results.get(token, []))

        return search, results

    def request_user_tree(self, username, local=False):
        events.invoke_main_thread(self._ensure_user_browse_main_thread, username, local)

        event = self._get_user_browse_event(username, local)
        event.wait(timeout=30)

        with self._lock:
            self._pending_search_id += 1
            request_id = self._pending_search_id
            pending = {"event": threading.Event(), "tree": None, "status": "loading"}
            self.pending_searches[request_id] = pending

        events.invoke_main_thread(self._get_user_tree_main_thread, request_id, username, local)
        pending["event"].wait(timeout=3)

        with self._lock:
            result = self.pending_searches.pop(request_id, None)

        if not result:
            return {"status": "loading"}

        return {"status": result["status"], "tree": result.get("tree")}

    def _ensure_user_browse_main_thread(self, username, local):
        local_username = core.users.login_username or config.sections["server"]["login"]
        if local:
            if not local_username:
                return
            else:
                if local_username not in core.userbrowse.users:
                    core.userbrowse.browse_local_shares(new_request=True, switch_page=False)
                else:
                    core.userbrowse.browse_local_shares(new_request=False, switch_page=False)
        else:
            if not username:
                return
            else:
                if username not in core.userbrowse.users:
                    core.userbrowse.browse_user(username, new_request=True, switch_page=False)
                else:
                    core.userbrowse.browse_user(username, new_request=False, switch_page=False)

    def _get_user_tree_main_thread(self, request_id, username, local):
        local_username = core.users.login_username or config.sections["server"]["login"]
        if local:
            if not local_username:
                status = "error"
                tree = None
            else:
                tree = _build_tree_from_userbrowse(local_username, hide_at_root=False)
                status = "ready" if tree else "loading"
        else:
            if not username:
                status = "error"
                tree = None
            else:
                tree = _build_tree_from_userbrowse(username, hide_at_root=True)
                status = "ready" if tree else "loading"

        with self._lock:
            pending = self.pending_searches.get(request_id)
            if pending is None:
                return

            pending["tree"] = tree
            pending["status"] = status
            pending["event"].set()

    def build_search_tree(self, token):
        with self._lock:
            results = list(self.search_results.get(token, []))

        if not results:
            return None

        root = {"name": "", "type": "root", "children": []}
        user_nodes = {}

        for entry in results:
            user = entry.get("user", "")
            path = entry.get("path", "")
            if not user or not path:
                continue

            user_node = user_nodes.get(user)
            if user_node is None:
                user_node = {"name": user, "type": "dir", "children": []}
                user_nodes[user] = user_node
                root["children"].append(user_node)

            parts = path.split("\\")
            if parts and parts[0].startswith("@"):
                parts = parts[1:]
            if not parts:
                continue

            filename = parts[-1]
            folder_path = "\\".join(parts[:-1])
            if not folder_path:
                folder_path = "(root)"

            folder_node = _find_child_dir(user_node, folder_path)
            if folder_node is None:
                folder_node = {"name": folder_path, "type": "dir", "children": []}
                user_node["children"].append(folder_node)

            folder_node["children"].append({
                "name": filename,
                "type": "file",
                "size": entry.get("size", 0),
                "path": entry.get("path", ""),
                "user": user
            })

        _sort_tree(root)
        return root

    def request_download(self, username, virtual_path, size=0):
        events.invoke_main_thread(self._download_main_thread, username, virtual_path, size)

    def _download_main_thread(self, username, virtual_path, size):
        if not username or not virtual_path:
            return
        core.downloads.enqueue_download(username, virtual_path, size=size)

    def _get_user_browse_event(self, username, local):
        local_username = core.users.login_username or config.sections["server"]["login"]
        key = local_username if local else username
        with self._lock:
            event = self._user_browse_events.get(key)
            if event is None:
                event = self._user_browse_events[key] = threading.Event()
            event.clear()
        return event

    def notify_user_browse(self, username):
        with self._lock:
            event = self._user_browse_events.get(username)
        if event:
            event.set()

    def request_downloads_snapshot(self):
        with self._lock:
            self._pending_search_id += 1
            request_id = self._pending_search_id
            pending = {"event": threading.Event(), "downloads": []}
            self.pending_searches[request_id] = pending

        events.invoke_main_thread(self._downloads_snapshot_main_thread, request_id)
        pending["event"].wait(timeout=2)

        with self._lock:
            result = self.pending_searches.pop(request_id, None)

        if not result:
            return []

        return result.get("downloads", [])

    def _downloads_snapshot_main_thread(self, request_id):
        downloads = []
        for transfer in core.downloads.transfers.values():
            downloads.append({
                "user": transfer.username,
                "path": transfer.virtual_path,
                "status": transfer.status,
                "size": transfer.size,
                "offset": transfer.current_byte_offset or 0,
                "folder": transfer.folder_path or ""
            })

        with self._lock:
            pending = self.pending_searches.get(request_id)
            if pending is None:
                return

            pending["downloads"] = downloads
            pending["event"].set()

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

    def snapshot(self):
        with self._lock:
            share_files = self.share_files
            share_folders = self.share_folders
            share_status = self.share_status
            chat_lines = list(self.chat_lines)
            searches = {
                token: data.copy() for token, data in self.searches.items()
            }

        if share_files is None or share_folders is None:
            share_files, share_folders = _compute_share_counts()
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


def _compute_share_counts():
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


def _find_child_dir(node, name):
    for child in node.get("children", []):
        if child.get("type") == "dir" and child.get("name") == name:
            return child
    return None


def _sort_tree(node):
    children = node.get("children", [])
    children.sort(key=lambda child: (0 if child.get("type") == "dir" else 1, child.get("name", "").lower()))
    for child in children:
        if child.get("type") == "dir":
            _sort_tree(child)


def _build_tree_from_folder_map(folder_map):
    root = {"name": "", "type": "root", "children": []}
    node_map = {"": root}

    for folder_path, files in folder_map.items():
        original_folder_path = None
        if isinstance(files, dict):
            original_folder_path = files.get("full_path")
            files = files.get("files", [])

        parts = folder_path.split("\\") if folder_path else []
        current = root
        path_accum = ""

        for part in parts:
            if not part:
                continue
            path_accum = part if not path_accum else f"{path_accum}\\{part}"
            node = node_map.get(path_accum)
            if node is None:
                node = {"name": part, "type": "dir", "children": []}
                node_map[path_accum] = node
                current["children"].append(node)
            current = node

        for file_data in files:
            if len(file_data) < 3:
                continue
            basename = file_data[1]
            size = file_data[2]
            full_path = basename
            if original_folder_path:
                full_path = f"{original_folder_path}\\{basename}"
            elif folder_path:
                full_path = f"{folder_path}\\{basename}"
            current["children"].append({
                "name": basename,
                "type": "file",
                "size": size,
                "path": full_path
            })

    _sort_tree(root)
    return root


def _build_tree_from_userbrowse(username, hide_at_root=False):
    browsed_user = core.userbrowse.users.get(username)
    if browsed_user is None:
        return None

    folder_map = {}
    for folders in (browsed_user.public_folders, browsed_user.private_folders):
        for folder_path, files in folders.items():
            original_path = folder_path
            if hide_at_root and folder_path:
                parts = folder_path.split("\\")
                if parts and parts[0].startswith("@"):
                    parts = parts[1:]
                    folder_path = "\\".join(parts)
            folder_map[folder_path] = {
                "full_path": original_path,
                "files": files
            }

    if not folder_map:
        return None

    return _build_tree_from_folder_map(folder_map)


class ThreadingHTTPServer(ThreadingMixIn, HTTPServer):
    daemon_threads = True


class StatusRequestHandler(BaseHTTPRequestHandler):
    server_version = "NicotineDaemon/0.1"
    protocol_version = "HTTP/1.1"

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path in {"/", "/index.html"}:
            self._serve_index()
            return

        if parsed.path == "/shares":
            self._serve_tree_page("Shared Files", "/shares/tree.json", "/")
            return

        if parsed.path == "/shares/tree.json":
            self._serve_shares_tree()
            return

        if parsed.path == "/downloads":
            self._serve_downloads()
            return
        if parsed.path == "/downloads.json":
            self._serve_downloads_json()
            return

        if parsed.path == "/users":
            self._serve_user_form()
            return

        if parsed.path.startswith("/users/") and parsed.path.endswith("/tree.json"):
            username = parsed.path[len("/users/"):-len("/tree.json")]
            self._serve_user_tree(username)
            return

        if parsed.path.startswith("/users/"):
            username = parsed.path.split("/", 2)[2]
            self._serve_tree_page(f"User: {html.escape(username)}", f"/users/{username}/tree.json", "/users")
            return

        if parsed.path == "/search":
            self._serve_search()
            return

        if parsed.path.startswith("/search/"):
            token_text = parsed.path.split("/", 2)[2]
            if token_text.endswith("/tree"):
                token_text = token_text[:-len("/tree")]
            if token_text.endswith("/tree.json"):
                token_text = token_text[:-len("/tree.json")]
                self._serve_search_tree(token_text)
            else:
                self._serve_tree_page(
                    f"Search Tree #{token_text}",
                    f"/search/{token_text}/tree.json",
                    "/search",
                    expand_depth=8
                )
            return

        if parsed.path == "/status.json":
            self._serve_status()
            return

        self._send_response(404, "Not Found", "text/plain; charset=utf-8")

    def do_POST(self):
        parsed = urlparse(self.path)
        if parsed.path == "/users":
            content_length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(content_length).decode("utf-8")
            data = parse_qs(body)
            username = data.get("username", [""])[0].strip()
            if not username:
                self._send_response(400, "Missing username", "text/plain; charset=utf-8")
                return
            self._send_redirect(f"/users/{username}")
            return

        if parsed.path == "/download":
            content_length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(content_length).decode("utf-8")
            data = parse_qs(body)
            username = data.get("user", [""])[0].strip()
            path = data.get("path", [""])[0].strip()
            size_text = data.get("size", ["0"])[0].strip()
            try:
                size = int(size_text)
            except ValueError:
                size = 0

            if not username or not path:
                self._send_response(400, "Missing user or path", "text/plain; charset=utf-8")
                return

            self.server.state.request_download(username, path, size=size)
            self._send_response(204, "", "text/plain; charset=utf-8")
            return

        if parsed.path != "/search":
            self._send_response(404, "Not Found", "text/plain; charset=utf-8")
            return

        content_length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(content_length).decode("utf-8")
        data = parse_qs(body)
        term = data.get("term", [""])[0].strip()

        if not term:
            self._send_response(400, "Missing search term", "text/plain; charset=utf-8")
            return

        token = self.server.state.request_search(term)
        if token is None:
            self._send_response(500, "Search could not be started", "text/plain; charset=utf-8")
            return

        self._send_redirect(f"/search/{token}/tree")

    def _serve_index(self):
        snapshot = self.server.state.snapshot()

        status = html.escape(snapshot["status"])
        username = html.escape(snapshot["username"] or "unknown")
        share_files = snapshot["share_files"]
        share_folders = snapshot["share_folders"]
        share_status = html.escape(snapshot["share_status"])
        stats = snapshot["stats"]
        downloads_started = stats["started_downloads"]
        downloads_completed = stats["completed_downloads"]
        uploads_started = stats["started_uploads"]
        uploads_completed = stats["completed_uploads"]
        downloaded_size = human_size(stats["downloaded_size"])
        uploaded_size = human_size(stats["uploaded_size"])
        since_text = html.escape(stats["since"] or "unknown")
        share_rows = []
        for share_name, share_path, *_unused in snapshot.get("shares", []):
            share_rows.append(
                "<tr>"
                f"<td>{html.escape(str(share_name))}</td>"
                f"<td class=\"path\">{html.escape(str(share_path))}</td>"
                "</tr>"
            )

        share_table = "<p>No shared folders configured.</p>"
        if share_rows:
            share_table = (
                "<table>"
                "<thead><tr><th>Share</th><th>Path</th></tr></thead>"
                "<tbody>"
                + "".join(share_rows)
                + "</tbody></table>"
            )
        chat_rows = []
        for entry in snapshot.get("chat", []):
            timestamp = time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(entry["timestamp"]))
            kind = entry.get("kind", "")
            user = entry.get("user") or ""
            room = entry.get("room") or ""

            if kind == "pm":
                kind_label = "Private"
            elif kind == "global":
                kind_label = "Global"
            else:
                kind_label = room or "Room"

            target = user
            message = entry.get("message") or ""

            chat_rows.append(
                "<tr>"
                f"<td>{html.escape(timestamp)}</td>"
                f"<td>{html.escape(kind_label)}</td>"
                f"<td>{html.escape(str(target))}</td>"
                f"<td>{html.escape(str(message))}</td>"
                "</tr>"
            )

        chat_table = (
            "<table class=\"chat-table\">"
            "<thead><tr><th class=\"chat-time\">Time</th><th class=\"chat-type\">Type</th>"
            "<th class=\"chat-target\">Target</th><th class=\"chat-message\">Message</th></tr></thead>"
            "<tbody>"
            + "".join(chat_rows)
            + "</tbody></table>"
        )

        if share_files is None:
            share_files_text = "scanning"
        else:
            share_files_text = str(share_files)

        if share_folders is None:
            share_folders_text = "scanning"
        else:
            share_folders_text = str(share_folders)

        body = f"""<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>PsycheSearch Daemon</title>
  <style>
    :root {{
      color-scheme: dark;
      --bg: #0b0b0f;
      --panel: #14141b;
      --panel-border: #232333;
      --accent: #7a4dff;
      --accent-soft: rgba(122, 77, 255, 0.2);
      --text: #d6d6d6;
      --text-muted: #9a9aa8;
    }}
    body {{
      font-family: "Azeret Mono", "Azeret", "DejaVu Sans", Arial, sans-serif;
      margin: 24px;
      background: var(--bg);
      color: var(--text);
    }}
    h1 {{
      margin: 0 0 6px;
      font-size: 22px;
      font-weight: 600;
    }}
    h2 {{
      margin: 18px 0 12px;
      font-size: 16px;
      font-weight: 600;
      color: var(--text-muted);
    }}
    .header {{
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 18px;
    }}
    .header-actions {{
      display: flex;
      gap: 8px;
    }}
    .link {{
      color: var(--text);
      background: transparent;
      border: 1px solid var(--panel-border);
      border-radius: 6px;
      padding: 6px 10px;
      font-size: 12px;
      text-decoration: none;
      display: inline-flex;
      align-items: center;
    }}
    .link:hover {{
      border-color: var(--accent);
      color: var(--accent);
    }}
    .status {{
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 12px;
      margin-bottom: 24px;
    }}
    .card {{
      background: var(--panel);
      border: 1px solid var(--panel-border);
      border-radius: 8px;
      padding: 12px 14px;
      box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.2);
    }}
    .label {{
      text-transform: uppercase;
      font-size: 11px;
      letter-spacing: 0.04em;
      color: var(--text-muted);
      margin-bottom: 6px;
    }}
    table {{
      width: 100%;
      border-collapse: collapse;
      background: var(--panel);
      border: 1px solid var(--panel-border);
      border-radius: 8px;
      overflow: hidden;
    }}
    th, td {{
      text-align: left;
      padding: 10px 12px;
      border-bottom: 1px solid #1f1f2a;
      font-size: 14px;
    }}
    th {{
      background: #191924;
      font-weight: 600;
    }}
    tr:last-child td {{
      border-bottom: none;
    }}
    .path {{
      font-family: "Azeret Mono", "DejaVu Sans Mono", "Liberation Mono", monospace;
      font-size: 12px;
      color: var(--text-muted);
      word-break: break-all;
    }}
    .chat-table {{
      table-layout: fixed;
    }}
    .chat-time {{
      width: 160px;
    }}
    .chat-type {{
      width: 90px;
    }}
    .chat-target {{
      width: 160px;
    }}
    .chat-message {{
      width: auto;
    }}
    .pill {{
      display: inline-block;
      padding: 2px 8px;
      border-radius: 999px;
      background: var(--accent-soft);
      color: var(--accent);
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }}
    .grid {{
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 12px;
      margin-bottom: 24px;
    }}
  </style>
</head>
<body>
  <div class="header">
    <div>
      <h1>PsycheSearch Daemon</h1>
      <div class="pill">Share status: {share_status}</div>
    </div>
    <div class="header-actions">
      <a class="link" href="/search">Search</a>
      <a class="link" href="/shares">Shared Files</a>
      <a class="link" href="/downloads">Downloads</a>
      <a class="link" href="/users">Browse User</a>
    </div>
  </div>
  <section class="status">
    <div class="card">
      <div class="label">Account</div>
      <div>{username}</div>
    </div>
    <div class="card">
      <div class="label">Connection</div>
      <div>{status}</div>
    </div>
    <div class="card">
      <div class="label">Shared files</div>
      <div>{share_files_text}</div>
    </div>
    <div class="card">
      <div class="label">Shared folders</div>
      <div>{share_folders_text}</div>
    </div>
  </section>
  <h2>Transfer Stats</h2>
  <section class="grid">
    <div class="card">
      <div class="label">Downloads started</div>
      <div>{downloads_started}</div>
    </div>
    <div class="card">
      <div class="label">Downloads completed</div>
      <div>{downloads_completed}</div>
    </div>
    <div class="card">
      <div class="label">Downloaded</div>
      <div>{downloaded_size}</div>
    </div>
    <div class="card">
      <div class="label">Uploads started</div>
      <div>{uploads_started}</div>
    </div>
    <div class="card">
      <div class="label">Uploads completed</div>
      <div>{uploads_completed}</div>
    </div>
    <div class="card">
      <div class="label">Uploaded</div>
      <div>{uploaded_size}</div>
    </div>
    <div class="card">
      <div class="label">Stats since</div>
      <div>{since_text}</div>
    </div>
  </section>
  <h2>Shared Folders</h2>
  {share_table}
  <h2>Chat (Last 50)</h2>
  {chat_table}
</body>
</html>
"""

        self._send_response(200, body, "text/html; charset=utf-8")

    def _serve_status(self):
        snapshot = self.server.state.snapshot()
        body = json.dumps(snapshot, indent=2)
        self._send_response(200, body, "application/json; charset=utf-8")

    def _serve_tree_page(self, title, data_url, back_url, expand_depth=1):
        body = f"""<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>{title}</title>
  <style>
    :root {{
      color-scheme: dark;
      --bg: #0b0b0f;
      --panel: #14141b;
      --panel-border: #232333;
      --accent: #7a4dff;
      --accent-soft: rgba(122, 77, 255, 0.2);
      --text: #d6d6d6;
      --text-muted: #9a9aa8;
    }}
    body {{
      font-family: "Azeret Mono", "Azeret", "DejaVu Sans", Arial, sans-serif;
      margin: 24px;
      background: var(--bg);
      color: var(--text);
    }}
    h1 {{
      margin: 0 0 10px;
      font-size: 22px;
      font-weight: 600;
    }}
    .row {{
      display: flex;
      gap: 8px;
      align-items: center;
      margin-bottom: 12px;
    }}
    .link {{
      color: var(--text);
      background: transparent;
      border: 1px solid var(--panel-border);
      border-radius: 6px;
      padding: 6px 10px;
      font-size: 12px;
      text-decoration: none;
      display: inline-flex;
      align-items: center;
    }}
    .link:hover {{
      border-color: var(--accent);
      color: var(--accent);
    }}
    .panel {{
      background: var(--panel);
      border: 1px solid var(--panel-border);
      border-radius: 8px;
      padding: 12px 14px;
    }}
    .tree {{
      font-size: 13px;
    }}
    .tree ul {{
      list-style: none;
      padding-left: 18px;
      margin: 6px 0;
    }}
    .tree li {{
      margin: 2px 0;
    }}
    .tree-row {{
      display: flex;
      align-items: center;
      gap: 6px;
    }}
    .tree-file {{
      cursor: pointer;
    }}
    .tree-file:hover {{
      color: var(--accent);
    }}
    .tree-toggle {{
      width: 12px;
      height: 12px;
      text-align: center;
      background: transparent;
      border: 1px solid transparent;
      color: var(--text);
      border-radius: 2px;
      padding: 0;
      cursor: pointer;
      line-height: 12px;
    }}
    .tree-toggle.dir {{
      border-color: transparent;
    }}
    .tree-toggle.empty {{
      border-color: transparent;
      cursor: default;
    }}
    .icon {{
      width: 12px;
      height: 12px;
      border-radius: 2px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      font-size: 10px;
      line-height: 1;
      color: #bfbfbf;
      border: 1px solid var(--panel-border);
    }}
    .icon.dir {{
      background: #6e3dff;
      border-color: #8f6bff;
    }}
    .icon.file {{
      background: #1a1a22;
      border-color: #2b2b35;
    }}
    .icon.audio {{
      background: transparent;
      border-color: transparent;
      color: #b9a6ff;
    }}
    .icon.spacer {{
      border-color: transparent;
      background: transparent;
    }}
    .folder-icon {{
      width: 11px;
      height: 8px;
      background: #5f35e6;
      border: 1px solid #8f6bff;
      border-radius: 2px;
      display: inline-block;
      position: relative;
      top: 0;
    }}
    .folder-icon::before {{
      content: "";
      position: absolute;
      top: -3px;
      left: 0;
      width: 6px;
      height: 3px;
      background: #5f35e6;
      border: 1px solid #8f6bff;
      border-bottom: none;
      border-radius: 2px 2px 0 0;
    }}
    .folder-icon.open {{
      background: #2f1b7a;
      border-color: #b29bff;
    }}
    .folder-icon.open::before {{
      background: #7b57ff;
      border-color: #b29bff;
    }}
    .collapsed > ul {{
      display: none;
    }}
    .status {{
      color: var(--text-muted);
      margin-bottom: 8px;
    }}
  </style>
</head>
<body>
  <div class="row">
    <h1>{title}</h1>
  </div>
  <div class="row">
    <a class="link" href="{back_url}">Back</a>
  </div>
  <div class="panel">
    <div class="status" id="tree-status">Loading…</div>
    <div class="tree" id="tree-root"></div>
  </div>
  <script>
    function isAudioFile(name) {{
      const parts = name.split(".");
      if (parts.length < 2) {{
        return false;
      }}
      const ext = parts.pop().toLowerCase();
      const audioExts = new Set([
        "mp3", "flac", "ogg", "opus", "wav", "aac", "m4a", "wma",
        "alac", "aiff", "aif", "ape", "mpc", "oga"
      ]);
      const playlistExts = new Set(["m3u", "m3u8", "pls", "xspf"]);
      if (playlistExts.has(ext)) {{
        return false;
      }}
      return audioExts.has(ext);
    }}

    const expandDepth = {expand_depth};

    function downloadFile(node) {{
      const params = new URLSearchParams();
      params.append("user", node.user || "");
      params.append("path", node.path || "");
      params.append("size", node.size || 0);

      fetch("/download", {{
        method: "POST",
        headers: {{
          "Content-Type": "application/x-www-form-urlencoded"
        }},
        body: params.toString()
      }}).then(response => {{
        const statusEl = document.getElementById("tree-status");
        if (response.ok) {{
          statusEl.textContent = "Download queued.";
          setTimeout(() => {{ statusEl.textContent = ""; }}, 1500);
        }} else {{
          statusEl.textContent = "Failed to queue download.";
        }}
      }}).catch(() => {{
        const statusEl = document.getElementById("tree-status");
        statusEl.textContent = "Failed to queue download.";
      }});
    }}

    function createNode(node, depth) {{
      const li = document.createElement("li");
      const row = document.createElement("div");
      row.className = "tree-row";

      const toggle = document.createElement("button");
      toggle.className = "tree-toggle";

      const icon = document.createElement("span");
      if (node.type === "dir") {{
        icon.className = "icon spacer";
      }} else {{
        icon.className = "icon file";
        if (isAudioFile(node.name || "")) {{
          icon.classList.add("audio");
          icon.textContent = "\\u266B";
        }}
      }}

      const label = document.createElement("span");
      label.textContent = node.name || "(root)";

      row.appendChild(toggle);
      row.appendChild(icon);
      row.appendChild(label);
      li.appendChild(row);

      if (node.type === "dir" && node.children && node.children.length) {{
        const childList = document.createElement("ul");
        node.children.forEach(child => childList.appendChild(createNode(child, depth + 1)));
        li.appendChild(childList);

        const expanded = depth < expandDepth;
        toggle.classList.add("dir");
        const folderIcon = document.createElement("span");
        folderIcon.className = "folder-icon" + (expanded ? " open" : "");
        toggle.appendChild(folderIcon);
        if (!expanded) {{
          li.classList.add("collapsed");
        }}
        toggle.addEventListener("click", () => {{
          const isCollapsed = li.classList.toggle("collapsed");
          folderIcon.classList.toggle("open", !isCollapsed);
        }});
        label.addEventListener("click", () => {{
          const isCollapsed = li.classList.toggle("collapsed");
          folderIcon.classList.toggle("open", !isCollapsed);
        }});
      }} else {{
        toggle.classList.add("empty");
        toggle.textContent = "";
        if (node.user && node.path) {{
          label.classList.add("tree-file");
          label.title = "Click to download";
          label.addEventListener("click", () => downloadFile(node));
        }}
      }}

      return li;
    }}

    function renderTree(root) {{
      const container = document.getElementById("tree-root");
      container.innerHTML = "";
      if (!root || !root.children || !root.children.length) {{
        container.textContent = "No files to display.";
        return;
      }}
      const list = document.createElement("ul");
      root.children.forEach(child => list.appendChild(createNode(child, 0)));
      container.appendChild(list);
    }}

    function loadTree() {{
      fetch("{data_url}")
        .then(response => response.json())
        .then(data => {{
          const statusEl = document.getElementById("tree-status");
          if (!data || data.status !== "ready") {{
            statusEl.textContent = data && data.status === "loading" ? "Loading…" : "No data available.";
            return;
          }}
          statusEl.textContent = "";
          renderTree(data.tree);
        }})
        .catch(() => {{
          const statusEl = document.getElementById("tree-status");
          statusEl.textContent = "Failed to load tree data.";
        }});
    }}

    loadTree();
  </script>
</body>
</html>
"""
        self._send_response(200, body, "text/html; charset=utf-8")

    def _serve_shares_tree(self):
        data = self.server.state.request_user_tree("", local=True)
        self._send_response(200, json.dumps(data), "application/json; charset=utf-8")

    def _serve_user_tree(self, username):
        data = self.server.state.request_user_tree(username, local=False)
        self._send_response(200, json.dumps(data), "application/json; charset=utf-8")

    def _serve_search_tree(self, token_text):
        try:
            token = int(token_text)
        except ValueError:
            self._send_response(404, "Not Found", "text/plain; charset=utf-8")
            return

        tree = self.server.state.build_search_tree(token)
        if tree is None:
            body = json.dumps({"status": "empty", "tree": None})
        else:
            body = json.dumps({"status": "ready", "tree": tree})
        self._send_response(200, body, "application/json; charset=utf-8")

    def _serve_user_form(self):
        body = """<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>Browse User</title>
  <style>
    :root {
      color-scheme: dark;
      --bg: #0b0b0f;
      --panel: #14141b;
      --panel-border: #232333;
      --accent: #7a4dff;
      --accent-soft: rgba(122, 77, 255, 0.2);
      --text: #d6d6d6;
      --text-muted: #9a9aa8;
    }
    body {
      font-family: "Azeret Mono", "Azeret", "DejaVu Sans", Arial, sans-serif;
      margin: 24px;
      background: var(--bg);
      color: var(--text);
    }
    h1 {
      margin: 0 0 12px;
      font-size: 22px;
      font-weight: 600;
    }
    .panel {
      background: var(--panel);
      border: 1px solid var(--panel-border);
      border-radius: 8px;
      padding: 12px 14px;
    }
    .row {
      display: flex;
      gap: 12px;
      flex-wrap: wrap;
      align-items: center;
    }
    input[type="text"] {
      background: #0e0e14;
      border: 1px solid var(--panel-border);
      color: var(--text);
      padding: 8px 10px;
      border-radius: 6px;
      min-width: 260px;
      flex: 1;
    }
    button, .link {
      color: var(--text);
      background: transparent;
      border: 1px solid var(--panel-border);
      border-radius: 6px;
      padding: 8px 12px;
      font-size: 12px;
      text-decoration: none;
      display: inline-flex;
      align-items: center;
      cursor: pointer;
    }
    button:hover, .link:hover {
      border-color: var(--accent);
      color: var(--accent);
    }
  </style>
</head>
<body>
  <h1>Browse User</h1>
  <div class="panel">
    <form method="post" action="/users">
      <div class="row">
        <input type="text" name="username" placeholder="Username" />
        <button type="submit">Browse</button>
        <a class="link" href="/">Back</a>
      </div>
    </form>
  </div>
</body>
</html>
"""
        self._send_response(200, body, "text/html; charset=utf-8")

    def _serve_downloads(self):
        body = """<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>Downloads</title>
  <style>
    :root {{
      color-scheme: dark;
      --bg: #0b0b0f;
      --panel: #14141b;
      --panel-border: #232333;
      --accent: #7a4dff;
      --accent-soft: rgba(122, 77, 255, 0.2);
      --text: #d6d6d6;
      --text-muted: #9a9aa8;
    }}
    body {{
      font-family: "Azeret Mono", "Azeret", "DejaVu Sans", Arial, sans-serif;
      margin: 24px;
      background: var(--bg);
      color: var(--text);
    }}
    h1 {{
      margin: 0 0 12px;
      font-size: 22px;
      font-weight: 600;
    }}
    .row {{
      display: flex;
      gap: 8px;
      align-items: center;
      margin-bottom: 12px;
    }}
    .link {{
      color: var(--text);
      background: transparent;
      border: 1px solid var(--panel-border);
      border-radius: 6px;
      padding: 6px 10px;
      font-size: 12px;
      text-decoration: none;
      display: inline-flex;
      align-items: center;
      cursor: pointer;
    }}
    .link:hover {{
      border-color: var(--accent);
      color: var(--accent);
    }}
    table {{
      width: 100%;
      border-collapse: collapse;
      background: var(--panel);
      border: 1px solid var(--panel-border);
      border-radius: 8px;
      overflow: hidden;
    }}
    th, td {{
      text-align: left;
      padding: 10px 12px;
      border-bottom: 1px solid #1f1f2a;
      font-size: 14px;
    }}
    th {{
      background: #191924;
      font-weight: 600;
    }}
    tr:last-child td {{
      border-bottom: none;
    }}
    .path {{
      font-family: "Azeret Mono", "DejaVu Sans Mono", "Liberation Mono", monospace;
      font-size: 12px;
      color: var(--text-muted);
      word-break: break-all;
    }}
  </style>
</head>
<body>
  <div class="row">
    <h1>Downloads</h1>
    <a class="link" href="/">Back</a>
  </div>
  <table>
    <thead><tr><th>User</th><th>Path</th><th>Size</th><th>Progress</th><th>Status</th><th>Folder</th></tr></thead>
    <tbody id="downloads-body"></tbody>
  </table>
  <script>
    function formatSize(value) {{
      if (!value) {{
        return "0";
      }}
      const units = ["B", "KB", "MB", "GB", "TB"];
      let size = value;
      let unitIndex = 0;
      while (size >= 1024 && unitIndex < units.length - 1) {{
        size /= 1024;
        unitIndex += 1;
      }}
      const rounded = size >= 10 ? size.toFixed(0) : size.toFixed(1);
      return `${{rounded}} ${{units[unitIndex]}}`;
    }}

    function sanitizePath(path) {{
      if (path && path.startsWith("@")) {{
        const parts = path.split("\\\\");
        if (parts.length && parts[0].startsWith("@")) {{
          return parts.slice(1).join("\\\\");
        }}
      }}
      return path || "";
    }}

    function renderRows(items) {{
      const body = document.getElementById("downloads-body");
      body.innerHTML = "";
      items.forEach(item => {{
        const size = item.size || 0;
        const offset = item.offset || 0;
        const percent = size ? Math.floor((offset / size) * 100) : 0;
        const row = document.createElement("tr");
        row.innerHTML = `
          <td>${{item.user || ""}}</td>
          <td class="path">${{sanitizePath(item.path || "")}}</td>
          <td>${{formatSize(size)}}</td>
          <td>${{percent}}%</td>
          <td>${{item.status || ""}}</td>
          <td class="path">${{item.folder || ""}}</td>
        `;
        body.appendChild(row);
      }});
    }}

    function loadDownloads() {{
      fetch("/downloads.json")
        .then(response => response.json())
        .then(data => renderRows(data || []))
        .catch(() => renderRows([]));
    }}

    loadDownloads();
  </script>
</body>
</html>
"""
        self._send_response(200, body, "text/html; charset=utf-8")

    def _serve_downloads_json(self):
        downloads = self.server.state.request_downloads_snapshot()
        for item in downloads:
            path = item.get("path", "")
            if path.startswith("@"):
                parts = path.split("\\")
                if parts and parts[0].startswith("@"):
                    item["path"] = "\\".join(parts[1:])
        self._send_response(200, json.dumps(downloads), "application/json; charset=utf-8")

    def _serve_search(self):
        snapshot = self.server.state.snapshot()
        searches = snapshot.get("searches", {})

        rows = []
        for token, data in sorted(searches.items(), key=lambda item: item[0], reverse=True):
            term = html.escape(data.get("term", ""))
            count = data.get("results", 0)
            started = time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(data.get("started_at", 0)))
            rows.append(
                "<tr>"
                f"<td><a class=\"link\" href=\"/search/{token}\">#{token}</a></td>"
                f"<td>{term}</td>"
                f"<td>{count}</td>"
                f"<td>{started}</td>"
                "</tr>"
            )

        history_table = (
            "<table>"
            "<thead><tr><th>Search</th><th>Term</th><th>Results</th><th>Started</th></tr></thead>"
            "<tbody>"
            + "".join(rows)
            + "</tbody></table>"
        )

        body = f"""<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>PsycheSearch Search</title>
  <style>
    :root {{
      color-scheme: dark;
      --bg: #0b0b0f;
      --panel: #14141b;
      --panel-border: #232333;
      --accent: #7a4dff;
      --accent-soft: rgba(122, 77, 255, 0.2);
      --text: #d6d6d6;
      --text-muted: #9a9aa8;
    }}
    body {{
      font-family: "Azeret Mono", "Azeret", "DejaVu Sans", Arial, sans-serif;
      margin: 24px;
      background: var(--bg);
      color: var(--text);
    }}
    h1 {{
      margin: 0 0 12px;
      font-size: 22px;
      font-weight: 600;
    }}
    h2 {{
      margin: 18px 0 12px;
      font-size: 16px;
      font-weight: 600;
      color: var(--text-muted);
    }}
    .panel {{
      background: var(--panel);
      border: 1px solid var(--panel-border);
      border-radius: 8px;
      padding: 12px 14px;
    }}
    .row {{
      display: flex;
      gap: 12px;
      flex-wrap: wrap;
      align-items: center;
    }}
    input[type="text"] {{
      background: #0e0e14;
      border: 1px solid var(--panel-border);
      color: var(--text);
      padding: 8px 10px;
      border-radius: 6px;
      min-width: 260px;
      flex: 1;
    }}
    button {{
      color: var(--text);
      background: transparent;
      border: 1px solid var(--panel-border);
      border-radius: 6px;
      padding: 8px 12px;
      font-size: 12px;
      cursor: pointer;
    }}
    button:hover {{
      border-color: var(--accent);
      color: var(--accent);
    }}
    .link {{
      color: var(--text);
      background: transparent;
      border: 1px solid var(--panel-border);
      border-radius: 6px;
      padding: 6px 10px;
      font-size: 12px;
      text-decoration: none;
      display: inline-flex;
      align-items: center;
    }}
    .link:hover {{
      border-color: var(--accent);
      color: var(--accent);
    }}
    table {{
      width: 100%;
      border-collapse: collapse;
      background: var(--panel);
      border: 1px solid var(--panel-border);
      border-radius: 8px;
      overflow: hidden;
    }}
    th, td {{
      text-align: left;
      padding: 10px 12px;
      border-bottom: 1px solid #1f1f2a;
      font-size: 14px;
    }}
    th {{
      background: #191924;
      font-weight: 600;
    }}
    tr:last-child td {{
      border-bottom: none;
    }}
  </style>
</head>
<body>
  <h1>Search</h1>
  <div class="panel">
    <form method="post" action="/search">
      <div class="row">
        <input type="text" name="term" placeholder="Search Soulseek network" />
        <button type="submit">Search</button>
        <a class="link" href="/">Back</a>
      </div>
    </form>
  </div>
  <h2>Recent Searches</h2>
  {history_table}
</body>
</html>
"""
        self._send_response(200, body, "text/html; charset=utf-8")

    def _serve_search_results(self, token_text):
        try:
            token = int(token_text)
        except ValueError:
            self._send_response(404, "Not Found", "text/plain; charset=utf-8")
            return

        self._send_redirect(f"/search/{token}/tree")

    def _send_response(self, status, body, content_type):
        body_bytes = body.encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body_bytes)))
        self.end_headers()
        try:
            self.wfile.write(body_bytes)
        except BrokenPipeError:
            pass

    def _send_redirect(self, location):
        self.send_response(303)
        self.send_header("Location", location)
        self.end_headers()

    def log_message(self, _format, *args):
        log.add_debug("Daemon web request: %s", args)


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
        events.connect("quit", self._on_quit)

    def run(self):
        core.start()

        if config.need_config():
            log.add("Daemon mode requires username/password in the config file.")
            return 1

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
            self._web_server = ThreadingHTTPServer((host, port), StatusRequestHandler)
        except OSError as error:
            log.add("Failed to start daemon web UI on %s:%s: %s", (host, port, error))
            return False

        self._web_server.state = self._state
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

        share_files, share_folders = _compute_share_counts()
        self._state.set_share_counts(share_files, share_folders)

    def _on_log_message(self, timestamp_format, msg, _title, _level):
        if timestamp_format:
            timestamp = time.strftime(timestamp_format)
            line = f"[{timestamp}] {msg}"
        else:
            line = msg

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
