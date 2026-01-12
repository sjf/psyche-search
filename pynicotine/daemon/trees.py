# SPDX-FileCopyrightText: 2025 Nicotine+ Contributors
# SPDX-License-Identifier: GPL-3.0-or-later

from pynicotine.core import core


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


def build_user_tree(username, hide_at_root=False):
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


def build_search_tree(results):
    if not results:
        return None

    root = {"name": "", "type": "root", "children": []}
    user_nodes = {}

    for entry in results:
        user = entry.get("user", "")
        path = entry.get("path", "")
        free_slots = entry.get("free_slots")
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
        folder_path = "\\".join(parts[:-1]) or "(root)"

        folder_node = _find_child_dir(user_node, folder_path)
        if folder_node is None:
            folder_node = {"name": folder_path, "type": "dir", "children": []}
            user_node["children"].append(folder_node)

        folder_node["children"].append({
            "name": filename,
            "type": "file",
            "size": entry.get("size", 0),
            "path": entry.get("path", ""),
            "user": user,
            "speed": entry.get("speed", 0),
            "free_slots": free_slots,
            "attributes": entry.get("attributes", "")
        })

    _sort_tree(root)
    return root
