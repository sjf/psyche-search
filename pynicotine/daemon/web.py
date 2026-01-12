# SPDX-FileCopyrightText: 2025 Nicotine+ Contributors
# SPDX-License-Identifier: GPL-3.0-or-later

import html
import json
import mimetypes
import os
import re
import time
import shutil

from http.server import BaseHTTPRequestHandler, HTTPServer
from socketserver import ThreadingMixIn
from string import Template
from urllib.parse import parse_qs
from urllib.parse import quote
from urllib.parse import unquote
from urllib.parse import urlparse
from importlib import resources

from pynicotine.config import config
from pynicotine.logfacility import log
from pynicotine.utils import human_size


class TemplateRenderer:
    __slots__ = ("_template_root", "_asset_root", "_cache")

    def __init__(self):
        package_root = resources.files("pynicotine.daemon")
        self._template_root = package_root / "templates"
        self._asset_root = package_root / "assets"
        self._cache = {}

    def render(self, name, **context):
        template_text = self._read_text(name)
        return Template(template_text).safe_substitute(context)

    def load_asset(self, name):
        cache_key = f"asset:{name}"
        cached = self._cache.get(cache_key)
        if cached is not None:
            return cached

        data = (self._asset_root / name).read_bytes()
        self._cache[cache_key] = data
        return data

    def _read_text(self, name):
        cache_key = f"template:{name}"
        cached = self._cache.get(cache_key)
        if cached is not None:
            return cached

        text = (self._template_root / name).read_text(encoding="utf-8")
        self._cache[cache_key] = text
        return text


class ThreadingHTTPServer(ThreadingMixIn, HTTPServer):
    daemon_threads = True


class DaemonRequestHandler(BaseHTTPRequestHandler):
    server_version = "NicotineDaemon/0.1"
    protocol_version = "HTTP/1.1"

    def do_GET(self):
        parsed = urlparse(self.path)
        query = parse_qs(parsed.query)
        if parsed.path in {"/", "/index.html"}:
            self._serve_index()
            return

        if parsed.path.startswith("/assets/"):
            self._serve_asset(parsed.path)
            return

        if parsed.path == "/shares":
            self._serve_tree_page("Shared Files", "/shares/tree.json", "/", expand_depth=1)
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
            self._serve_tree_page(
                f"User: {username}",
                f"/users/{username}/tree.json",
                "/users",
                expand_depth=1
            )
            return

        if parsed.path == "/search":
            self._serve_search()
            return

        if parsed.path.startswith("/search/"):
            term_text = parsed.path.split("/", 2)[2]
            if term_text.endswith("/tree"):
                term_text = term_text[:-len("/tree")]
            if term_text.endswith("/tree.json"):
                term_text = term_text[:-len("/tree.json")]
                self._serve_search_tree(term_text)
            else:
                term = unquote(term_text)
                token = self.server.state.ensure_search(term)
                if token is None:
                    self._send_response(400, "Missing search term", "text/plain; charset=utf-8")
                    return
                self._serve_tree_page(
                    "Search Results",
                    f"/search/{term_text}/tree.json",
                    "/search",
                    expand_depth=8,
                    subtitle=term
                )
            return

        if parsed.path == "/status.json":
            self._serve_status()
            return

        if parsed.path == "/chat.json":
            self._serve_chat()
            return

        if parsed.path == "/files/tree.json":
            self._serve_files_tree(query)
            return

        if parsed.path == "/media":
            self._serve_media(query)
            return

        if parsed.path == "/media/meta":
            self._serve_media_meta(query)
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

        if parsed.path in {"/files/delete", "/files/rename"}:
            content_length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(content_length).decode("utf-8")
            data = parse_qs(body)
            path = data.get("path", [""])[0].strip()
            new_name = data.get("name", [""])[0].strip()
            download_user = data.get("download_user", [""])[0].strip()
            download_path = data.get("download_path", [""])[0].strip()

            resolved_path, error = self._resolve_media_path({"path": [path]})
            if error:
                self._send_response(403, error, "text/plain; charset=utf-8")
                return
            if not resolved_path or not os.path.exists(resolved_path):
                self._send_response(404, "File not found", "text/plain; charset=utf-8")
                return

            if parsed.path == "/files/delete":
                try:
                    if os.path.isdir(resolved_path):
                        shutil.rmtree(resolved_path)
                    else:
                        os.remove(resolved_path)
                except OSError as error:
                    self._send_response(500, str(error), "text/plain; charset=utf-8")
                    return

                if download_user and download_path:
                    self.server.state.clear_download_override(download_user, download_path)

                self._send_response(204, "", "text/plain; charset=utf-8")
                return

            if not new_name:
                self._send_response(400, "Missing name", "text/plain; charset=utf-8")
                return

            safe_name = os.path.basename(new_name)
            if safe_name != new_name or safe_name in {".", ".."}:
                self._send_response(400, "Invalid name", "text/plain; charset=utf-8")
                return

            new_path = os.path.join(os.path.dirname(resolved_path), safe_name)
            if not self._is_path_allowed(new_path):
                self._send_response(403, "Path not allowed", "text/plain; charset=utf-8")
                return
            if os.path.exists(new_path):
                self._send_response(409, "File already exists", "text/plain; charset=utf-8")
                return

            try:
                os.rename(resolved_path, new_path)
            except OSError as error:
                self._send_response(500, str(error), "text/plain; charset=utf-8")
                return

            if download_user and download_path:
                self.server.state.set_download_override(download_user, download_path, new_path)

            self._send_response(204, "", "text/plain; charset=utf-8")
            return

        if parsed.path in {"/downloads/pause", "/downloads/resume", "/downloads/cancel", "/downloads/clear",
                           "/downloads/clear-completed"}:
            if parsed.path == "/downloads/clear-completed":
                self.server.state.clear_completed_downloads()
                self._send_response(204, "", "text/plain; charset=utf-8")
                return

            content_length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(content_length).decode("utf-8")
            data = parse_qs(body)
            username = data.get("user", [""])[0].strip()
            virtual_path = data.get("path", [""])[0].strip()

            if not username or not virtual_path:
                self._send_response(400, "Missing user or path", "text/plain; charset=utf-8")
                return

            if parsed.path == "/downloads/pause":
                self.server.state.pause_download(username, virtual_path)
            elif parsed.path == "/downloads/resume":
                self.server.state.resume_download(username, virtual_path)
            elif parsed.path == "/downloads/cancel":
                self.server.state.cancel_download(username, virtual_path)
            else:
                self.server.state.clear_download(username, virtual_path)

            self._send_response(204, "", "text/plain; charset=utf-8")
            return

        if parsed.path == "/search/remove":
            content_length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(content_length).decode("utf-8")
            data = parse_qs(body)
            term = data.get("term", [""])[0].strip()
            if term:
                self.server.state.remove_search_term(term)
            else:
                for token in list(self.server.state.searches.keys()):
                    self.server.state.remove_search(token)
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

        encoded_term = quote(term, safe="")
        self._send_redirect(f"/search/{encoded_term}")

    def _serve_index(self):
        snapshot = self.server.state.snapshot()
        nav = self.server.renderer.render("nav.html")

        status = html.escape(snapshot["status"])
        username = html.escape(snapshot["username"] or "unknown")
        share_status = html.escape(snapshot["share_status"])
        stats = snapshot["stats"]
        since_text = html.escape(stats["since"] or "unknown")

        share_rows = []
        for share_name, share_path, *_unused in snapshot.get("shares", []):
            share_rows.append(
                "<tr>"
                f"<td>{html.escape(str(share_name))}</td>"
                f"<td class=\"path\">{html.escape(str(share_path))}</td>"
                "</tr>"
            )

        if share_rows:
            share_table = (
                "<table>"
                "<thead><tr><th>Share</th><th>Path</th></tr></thead>"
                "<tbody>"
                + "".join(share_rows)
                + "</tbody></table>"
            )
        else:
            share_table = "<p>No shared folders configured.</p>"

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

        share_files = snapshot["share_files"]
        share_folders = snapshot["share_folders"]
        share_files_text = "scanning" if share_files is None else str(share_files)
        share_folders_text = "scanning" if share_folders is None else str(share_folders)

        body = self.server.renderer.render(
            "index.html",
            nav=nav,
            share_status=share_status,
            username=username,
            status=status,
            share_files=share_files_text,
            share_folders=share_folders_text,
            downloads_started=str(stats["started_downloads"]),
            downloads_completed=str(stats["completed_downloads"]),
            downloaded_size=human_size(stats["downloaded_size"]),
            uploads_started=str(stats["started_uploads"]),
            uploads_completed=str(stats["completed_uploads"]),
            uploaded_size=human_size(stats["uploaded_size"]),
            since_text=since_text,
            share_table=share_table,
            chat_rows="".join(chat_rows)
        )

        self._send_response(200, body, "text/html; charset=utf-8")

    def _serve_status(self):
        snapshot = self.server.state.snapshot()
        body = json.dumps(snapshot, indent=2)
        self._send_response(200, body, "application/json; charset=utf-8")

    def _serve_chat(self):
        chat_lines = self.server.state.get_chat_snapshot()
        body = json.dumps({"chat": chat_lines}, indent=2)
        self._send_response(200, body, "application/json; charset=utf-8")

    def _serve_tree_page(self, title, data_url, back_url, expand_depth=1, subtitle=""):
        safe_title = html.escape(title)
        safe_back_url = html.escape(back_url)
        subtitle_html = ""
        if subtitle:
            subtitle_html = f"<div class=\\\"subtitle\\\">{html.escape(subtitle)}</div>"
        tree_config = json.dumps({
            "dataUrl": data_url,
            "expandDepth": expand_depth,
            "downloadEnabled": True
        })
        nav = self.server.renderer.render("nav.html")
        body = self.server.renderer.render(
            "tree.html",
            nav=nav,
            page_title=safe_title,
            title=safe_title,
            back_url=safe_back_url,
            subtitle_html=subtitle_html,
            tree_config=tree_config
        )
        self._send_response(200, body, "text/html; charset=utf-8")

    def _serve_shares_tree(self):
        data = self.server.state.request_user_tree("", local=True)
        self._send_response(200, json.dumps(data), "application/json; charset=utf-8")

    def _serve_user_tree(self, username):
        data = self.server.state.request_user_tree(username, local=False)
        self._send_response(200, json.dumps(data), "application/json; charset=utf-8")

    def _serve_search_tree(self, term_text):
        term = unquote(term_text)
        token = self.server.state.ensure_search(term)
        if token is None:
            self._send_response(400, "Missing search term", "text/plain; charset=utf-8")
            return

        tree = self.server.state.build_search_tree(token)
        if tree is None:
            body = json.dumps({"status": "empty", "tree": None})
        else:
            body = json.dumps({"status": "ready", "tree": tree})
        self._send_response(200, body, "application/json; charset=utf-8")

    def _get_media_roots(self):
        roots = []
        download_dir = config.sections["transfers"].get("downloaddir")
        if download_dir:
            roots.append(download_dir)

        for share in config.sections["transfers"].get("shared", []):
            share_path = None
            if isinstance(share, (list, tuple)) and len(share) >= 2:
                share_path = share[1]
            elif isinstance(share, dict):
                share_path = share.get("path")
            if share_path:
                roots.append(share_path)

        normalized = []
        for path in roots:
            expanded = os.path.expandvars(os.path.expanduser(str(path)))
            normalized.append(os.path.realpath(os.path.abspath(expanded)))
        return normalized

    @staticmethod
    def _canonicalize_path(path_value):
        expanded = os.path.expandvars(os.path.expanduser(path_value))
        return os.path.realpath(os.path.abspath(expanded))

    def _resolve_media_path(self, query):
        path_value = query.get("path", [""])[0].strip()
        if not path_value:
            return None, "Missing path"

        candidate = self._canonicalize_path(path_value)
        if self._is_path_allowed(candidate):
            return candidate, None

        return None, "Path not allowed"

    def _is_path_allowed(self, path_value):
        candidate = self._canonicalize_path(path_value)
        for root in self._get_media_roots():
            try:
                if os.path.commonpath([candidate, root]) == root:
                    return True
            except ValueError:
                continue
        return False

    def _serve_media(self, query):
        media_path, error = self._resolve_media_path(query)
        if error:
            self._send_response(403, error, "text/plain; charset=utf-8")
            return

        if not media_path or not os.path.isfile(media_path):
            self._send_response(404, "File not found", "text/plain; charset=utf-8")
            return

        file_size = os.path.getsize(media_path)
        range_header = self.headers.get("Range")
        content_type, _encoding = mimetypes.guess_type(media_path)
        if not content_type:
            content_type = "application/octet-stream"

        start = 0
        end = file_size - 1
        status_code = 200

        if range_header and range_header.startswith("bytes="):
            range_value = range_header.split("=", 1)[1]
            try:
                start_text, end_text = range_value.split("-", 1)
                if start_text:
                    start = int(start_text)
                if end_text:
                    end = int(end_text)
                else:
                    end = file_size - 1
                if not start_text and end_text:
                    # Suffix bytes: "-500"
                    suffix = int(end_text)
                    start = max(file_size - suffix, 0)
                    end = file_size - 1
                if start < 0 or end < start or end >= file_size:
                    raise ValueError
                status_code = 206
            except ValueError:
                self.send_response(416)
                self.send_header("Content-Range", f"bytes */{file_size}")
                self.end_headers()
                return

        self.send_response(status_code)
        self.send_header("Content-Type", content_type)
        self.send_header("Accept-Ranges", "bytes")
        if status_code == 206:
            self.send_header("Content-Range", f"bytes {start}-{end}/{file_size}")
            content_length = end - start + 1
        else:
            content_length = file_size
        self.send_header("Content-Length", str(content_length))
        self.end_headers()

        try:
            with open(media_path, "rb") as file_handle:
                file_handle.seek(start)
                remaining = content_length
                while remaining > 0:
                    chunk = file_handle.read(min(65536, remaining))
                    if not chunk:
                        break
                    self.wfile.write(chunk)
                    remaining -= len(chunk)
        except BrokenPipeError:
            pass

    def _serve_media_meta(self, query):
        media_path, error = self._resolve_media_path(query)
        if error:
            self._send_response(403, error, "text/plain; charset=utf-8")
            return

        if not media_path or not os.path.isfile(media_path):
            self._send_response(404, "File not found", "text/plain; charset=utf-8")
            return

        basename = os.path.basename(media_path)
        title = os.path.splitext(basename)[0]
        artist = None
        if " - " in title:
            artist, title = title.split(" - ", 1)

        content_type, _encoding = mimetypes.guess_type(media_path)
        data = {
            "path": media_path,
            "filename": basename,
            "title": title,
            "artist": artist,
            "album": None,
            "size": os.path.getsize(media_path),
            "content_type": content_type or "application/octet-stream"
        }
        self._send_response(200, json.dumps(data), "application/json; charset=utf-8")

    def _serve_files_tree(self, query):
        search_text = query.get("search", [""])[0].strip()
        search_key = self._normalize_search_key(search_text) if search_text else None
        file_filter_regex, folder_filter_regex = self._get_share_filter_regex()

        download_dir = config.sections["transfers"].get("downloaddir")
        downloads_node = self._build_files_node(
            "Downloads",
            download_dir,
            search_key,
            file_filter_regex=file_filter_regex,
            folder_filter_regex=folder_filter_regex
        )

        shared_root = {
            "id": "shared",
            "name": "Shared",
            "type": "dir",
            "path": None,
            "children": []
        }
        for share in config.sections["transfers"].get("shared", []):
            share_path = None
            share_name = None
            if isinstance(share, (list, tuple)) and len(share) >= 2:
                share_name = share[0]
                share_path = share[1]
            elif isinstance(share, dict):
                share_name = share.get("name")
                share_path = share.get("path")

            if not share_path:
                continue

            share_label = share_path
            share_node = self._build_files_node(
                share_label,
                share_path,
                search_key,
                file_filter_regex=file_filter_regex,
                folder_filter_regex=folder_filter_regex
            )
            if share_node:
                shared_root["children"].append(share_node)

        root = {
            "id": "root",
            "name": "",
            "type": "root",
            "children": []
        }
        if downloads_node:
            root["children"].append(downloads_node)
        if shared_root["children"]:
            root["children"].append(shared_root)

        self._send_response(200, json.dumps({"status": "ready", "tree": root}), "application/json; charset=utf-8")

    @staticmethod
    def _normalize_search_key(value):
        cleaned = []
        for char in value.lower():
            if char.isalnum() or char == "-":
                cleaned.append(char)
        return "".join(cleaned)

    def _matches_search(self, search_key, path_text):
        if not search_key:
            return True
        normalized = self._normalize_search_key(path_text)
        return search_key in normalized

    @staticmethod
    def _to_filter_path(path_value):
        return path_value.replace(os.sep, "\\")

    def _get_share_filter_regex(self):
        share_filters = config.sections["transfers"].get("share_filters") or []
        if not share_filters:
            return None, None

        file_filters = []
        folder_filters = []

        for sfilter in sorted(share_filters):
            escaped_filter = re.escape(sfilter).replace("\\*", ".*")

            if escaped_filter.endswith(("\\", "\\.*")):
                folder_filters.append(escaped_filter)
                continue

            file_filters.append(escaped_filter)

        file_regex = None
        folder_regex = None
        if file_filters:
            file_regex = re.compile("(\\\\(" + "|".join(file_filters) + ")$)", flags=re.IGNORECASE)
        if folder_filters:
            folder_regex = re.compile("(\\\\(" + "|".join(folder_filters) + ")$)", flags=re.IGNORECASE)
        return file_regex, folder_regex

    def _build_files_node(self, label, root_path, search_key, file_filter_regex=None, folder_filter_regex=None):
        if not root_path:
            return None

        expanded = os.path.expandvars(os.path.expanduser(str(root_path)))
        root_path = os.path.realpath(os.path.abspath(expanded))
        if not os.path.isdir(root_path):
            return None

        def walk_dir(folder_path):
            node = {
                "id": folder_path,
                "name": os.path.basename(folder_path) or label,
                "type": "dir",
                "path": folder_path,
                "children": []
            }
            try:
                entries = sorted(os.scandir(folder_path), key=lambda entry: (not entry.is_dir(), entry.name.lower()))
            except OSError:
                return node

            for entry in entries:
                try:
                    if entry.is_dir(follow_symlinks=False):
                        filter_path = self._to_filter_path(entry.path)
                        if folder_filter_regex and folder_filter_regex.search(filter_path):
                            continue
                        child = walk_dir(entry.path)
                        if child["children"] or self._matches_search(search_key, entry.name):
                            node["children"].append(child)
                    elif entry.is_file(follow_symlinks=False):
                        filter_path = self._to_filter_path(entry.path)
                        if file_filter_regex and file_filter_regex.search(filter_path):
                            continue
                        if not self._matches_search(search_key, entry.path):
                            continue
                        node["children"].append({
                            "id": entry.path,
                            "name": entry.name,
                            "type": "file",
                            "path": entry.path,
                            "size": entry.stat().st_size
                        })
                except OSError:
                    continue
            return node

        root_node = walk_dir(root_path)
        if not root_node["children"] and search_key:
            if not self._matches_search(search_key, label):
                return None
        root_node["name"] = label
        return root_node

    def _serve_user_form(self):
        nav = self.server.renderer.render("nav.html")
        body = self.server.renderer.render("user_form.html", nav=nav)
        self._send_response(200, body, "text/html; charset=utf-8")

    def _serve_downloads(self):
        nav = self.server.renderer.render("nav.html")
        body = self.server.renderer.render("downloads.html", nav=nav)
        self._send_response(200, body, "text/html; charset=utf-8")

    def _serve_downloads_json(self):
        downloads = self.server.state.request_downloads_snapshot()
        for item in downloads:
            display_path = item.get("virtual_path") or item.get("path", "")
            if display_path.startswith("@"):
                parts = display_path.split("\\")
                if parts and parts[0].startswith("@"):
                    display_path = "\\".join(parts[1:])
            item["path"] = display_path
        self._send_response(200, json.dumps(downloads), "application/json; charset=utf-8")

    def _serve_search(self):
        snapshot = self.server.state.snapshot()
        searches = snapshot.get("searches", {})

        rows = []
        for _token, data in sorted(searches.items(), key=lambda item: item[1].get("started_at", 0), reverse=True):
            term = html.escape(data.get("term", ""))
            started = time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(data.get("started_at", 0)))
            term_url = quote(data.get("term", ""), safe="")
            rows.append(
                "<tr>"
                f"<td><a class=\"link\" href=\"/search/{term_url}\">{term}</a></td>"
                f"<td>{started}</td>"
                "</tr>"
            )

        nav = self.server.renderer.render("nav.html")
        body = self.server.renderer.render(
            "search.html",
            nav=nav,
            history_rows="".join(rows)
        )
        self._send_response(200, body, "text/html; charset=utf-8")

    def _serve_asset(self, path):
        asset_name = path[len("/assets/"):]
        if not asset_name or ".." in asset_name or "/" in asset_name or "\\" in asset_name:
            self._send_response(404, "Not Found", "text/plain; charset=utf-8")
            return

        try:
            data = self.server.renderer.load_asset(asset_name)
        except FileNotFoundError:
            self._send_response(404, "Not Found", "text/plain; charset=utf-8")
            return

        content_type, _encoding = mimetypes.guess_type(asset_name)
        if not content_type:
            if asset_name.endswith(".js"):
                content_type = "application/javascript"
            else:
                content_type = "application/octet-stream"

        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        try:
            self.wfile.write(data)
        except BrokenPipeError:
            pass

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
        # Silence per-request debug logging for the daemon web UI.
        return
