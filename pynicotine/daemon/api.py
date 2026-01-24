# SPDX-FileCopyrightText: 2025 Nicotine+ Contributors
# SPDX-License-Identifier: GPL-3.0-or-later

import hmac
import mimetypes
import os
import re
import secrets
import time

from fastapi import FastAPI, Form, HTTPException, Request, Response
from fastapi.responses import FileResponse, JSONResponse

from pynicotine.config import config


class DaemonAPI:
    def __init__(self, state):
        self.state = state
        self._sessions = {}
        self._session_cookie = "nicotine_session"
        self._session_ttl = 60 * 60 * 12

    def create_app(self):
        app = FastAPI()

        @app.middleware("http")
        async def require_auth(request: Request, call_next):
            path = request.url.path
            if path.startswith("/auth/") or path in {"/openapi.json", "/docs", "/docs/oauth2-redirect"}:
                return await call_next(request)
            if not self._is_authenticated(request):
                return JSONResponse({"detail": "Unauthorized"}, status_code=401)
            return await call_next(request)

        @app.post("/auth/login")
        def login(response: Response, username: str = Form(""), password: str = Form("")):
            config_user, config_pass = self._get_config_credentials()
            if not config_user or not config_pass:
                raise HTTPException(status_code=503, detail="Authentication not configured")
            if not self._credentials_match(username, password, config_user, config_pass):
                raise HTTPException(status_code=401, detail="Invalid credentials")
            token = self._create_session(config_user)
            response.set_cookie(
                self._session_cookie,
                token,
                httponly=True,
                samesite="lax",
                max_age=self._session_ttl
            )
            return {"authenticated": True, "username": config_user}

        @app.post("/auth/logout")
        def logout(request: Request, response: Response):
            token = request.cookies.get(self._session_cookie)
            if token:
                self._sessions.pop(token, None)
            response.delete_cookie(self._session_cookie)
            response.status_code = 204
            return response

        @app.get("/auth/me")
        def auth_me(request: Request):
            session = self._get_session(request)
            if not session:
                return JSONResponse({"authenticated": False})
            return JSONResponse({"authenticated": True, "username": session["username"]})

        @app.get("/status.json")
        def status():
            return JSONResponse(self.state.snapshot())

        @app.get("/chat.json")
        def chat():
            return JSONResponse({"chat": self.state.get_chat_snapshot()})

        @app.get("/downloads.json")
        def downloads():
            downloads = self.state.request_downloads_snapshot()
            for item in downloads:
                display_path = item.get("virtual_path") or item.get("path", "")
                if display_path.startswith("@"):
                    parts = display_path.split("\\")
                    if parts and parts[0].startswith("@"):
                        display_path = "\\".join(parts[1:])
                item["path"] = display_path
            return JSONResponse(downloads)

        @app.post("/download")
        def download(user: str = Form(""), path: str = Form(""), size: str = Form("0")):
            if not user or not path:
                raise HTTPException(status_code=400, detail="Missing user or path")
            try:
                size_value = int(size)
            except ValueError:
                size_value = 0
            self.state.request_download(user, path, size=size_value)
            return Response(status_code=204)

        @app.post("/downloads/clear-completed")
        def clear_completed_downloads():
            self.state.clear_completed_downloads()
            return Response(status_code=204)

        @app.post("/downloads/{action}")
        def downloads_action(
            action: str,
            user: str = Form(""),
            path: str = Form("")
        ):
            if action not in {"pause", "resume", "cancel", "clear"}:
                raise HTTPException(status_code=404, detail="Not Found")
            if not user or not path:
                raise HTTPException(status_code=400, detail="Missing user or path")

            if action == "pause":
                self.state.pause_download(user, path)
            elif action == "resume":
                self.state.resume_download(user, path)
            elif action == "cancel":
                self.state.cancel_download(user, path)
            else:
                self.state.clear_download(user, path)
            return Response(status_code=204)

        @app.post("/search")
        def search(term: str = Form("")):
            if not term:
                raise HTTPException(status_code=400, detail="Missing search term")
            self.state.ensure_search(term)
            return Response(status_code=204)

        @app.post("/search/remove")
        def remove_search(term: str = Form("")):
            if term:
                self.state.remove_search_term(term)
            else:
                for token in list(self.state.searches.keys()):
                    self.state.remove_search(token)
            return Response(status_code=204)

        @app.get("/search/{term}/tree.json")
        def search_tree(term: str):
            token = self.state.ensure_search(term)
            if token is None:
                raise HTTPException(status_code=400, detail="Missing search term")
            tree = self.state.build_search_tree(token)
            if tree is None:
                return JSONResponse({"status": "empty", "tree": None})
            return JSONResponse({"status": "ready", "tree": tree})

        @app.get("/files/tree.json")
        def files_tree(search: str = ""):
            data = self._build_files_tree(search)
            return JSONResponse({"status": "ready", "tree": data})

        @app.get("/media")
        def media(path: str, request: Request):
            media_path = self._resolve_media_path(path)
            if not media_path:
                raise HTTPException(status_code=403, detail="Path not allowed")
            if not os.path.isfile(media_path):
                raise HTTPException(status_code=404, detail="File not found")
            content_type, _encoding = mimetypes.guess_type(media_path)
            return FileResponse(media_path, media_type=content_type or "application/octet-stream")

        @app.get("/media/meta")
        def media_meta(path: str):
            media_path = self._resolve_media_path(path)
            if not media_path:
                raise HTTPException(status_code=403, detail="Path not allowed")
            if not os.path.isfile(media_path):
                raise HTTPException(status_code=404, detail="File not found")
            basename = os.path.basename(media_path)
            title = os.path.splitext(basename)[0]
            artist = None
            if " - " in title:
                artist, title = title.split(" - ", 1)
            content_type, _encoding = mimetypes.guess_type(media_path)
            return JSONResponse({
                "path": media_path,
                "filename": basename,
                "title": title,
                "artist": artist,
                "album": None,
                "size": os.path.getsize(media_path),
                "content_type": content_type or "application/octet-stream"
            })

        @app.post("/files/delete")
        def delete_file(
            path: str = Form(""),
            download_user: str = Form(""),
            download_path: str = Form("")
        ):
            resolved_path = self._resolve_media_path(path)
            if not resolved_path:
                raise HTTPException(status_code=403, detail="Path not allowed")
            if not os.path.exists(resolved_path):
                raise HTTPException(status_code=404, detail="File not found")

            try:
                if os.path.isdir(resolved_path):
                    for root, dirs, files in os.walk(resolved_path, topdown=False):
                        for filename in files:
                            os.remove(os.path.join(root, filename))
                        for dirname in dirs:
                            os.rmdir(os.path.join(root, dirname))
                    os.rmdir(resolved_path)
                else:
                    os.remove(resolved_path)
            except OSError as error:
                raise HTTPException(status_code=500, detail=str(error)) from error

            if download_user and download_path:
                self.state.clear_download_override(download_user, download_path)
            return Response(status_code=204)

        @app.post("/files/rename")
        def rename_file(
            path: str = Form(""),
            name: str = Form(""),
            download_user: str = Form(""),
            download_path: str = Form("")
        ):
            resolved_path = self._resolve_media_path(path)
            if not resolved_path:
                raise HTTPException(status_code=403, detail="Path not allowed")
            if not os.path.exists(resolved_path):
                raise HTTPException(status_code=404, detail="File not found")
            if not name:
                raise HTTPException(status_code=400, detail="Missing name")

            safe_name = os.path.basename(name)
            if safe_name != name or safe_name in {".", ".."}:
                raise HTTPException(status_code=400, detail="Invalid name")

            new_path = os.path.join(os.path.dirname(resolved_path), safe_name)
            new_path = os.path.realpath(os.path.abspath(new_path))
            if not self._is_path_allowed(new_path):
                raise HTTPException(status_code=403, detail="Path not allowed")
            if os.path.exists(new_path):
                raise HTTPException(status_code=409, detail="File already exists")

            try:
                os.rename(resolved_path, new_path)
            except OSError as error:
                raise HTTPException(status_code=500, detail=str(error)) from error

            if download_user and download_path:
                self.state.set_download_override(download_user, download_path, new_path)
            return Response(status_code=204)

        return app

    @staticmethod
    def _credentials_match(username, password, config_user, config_pass):
        return hmac.compare_digest(username, config_user) and hmac.compare_digest(password, config_pass)

    @staticmethod
    def _get_config_credentials():
        username = config.sections["server"].get("login") or ""
        password = config.sections["server"].get("passw") or ""
        return username, password

    def _create_session(self, username):
        token = secrets.token_urlsafe(32)
        self._sessions[token] = {
            "username": username,
            "expires_at": time.time() + self._session_ttl
        }
        return token

    def _get_session(self, request: Request):
        token = request.cookies.get(self._session_cookie)
        if not token:
            return None
        session = self._sessions.get(token)
        if not session:
            return None
        if session["expires_at"] <= time.time():
            self._sessions.pop(token, None)
            return None
        return session

    def _is_authenticated(self, request: Request):
        return self._get_session(request) is not None

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

    def _resolve_media_path(self, path_value):
        if not path_value:
            return None
        candidate = self._canonicalize_path(path_value)
        if self._is_path_allowed(candidate):
            return candidate
        return None

    def _is_path_allowed(self, path_value):
        candidate = self._canonicalize_path(path_value)
        for root in self._get_media_roots():
            try:
                if os.path.commonpath([candidate, root]) == root:
                    return True
            except ValueError:
                continue
        return False

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

    def _build_files_tree(self, search_text):
        search_text = search_text.strip()
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

            share_label = (share_name or share_path).replace("_", "/")
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
        return root



def create_app(state):
    return DaemonAPI(state).create_app()
