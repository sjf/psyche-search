# SPDX-FileCopyrightText: 2025 Nicotine+ Contributors
# SPDX-License-Identifier: GPL-3.0-or-later

import html
import json
import mimetypes
import time

from http.server import BaseHTTPRequestHandler, HTTPServer
from socketserver import ThreadingMixIn
from string import Template
from urllib.parse import parse_qs
from urllib.parse import quote
from urllib.parse import unquote
from urllib.parse import urlparse
from importlib import resources

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
        log.add_debug("Daemon web request: %s", (args,))
