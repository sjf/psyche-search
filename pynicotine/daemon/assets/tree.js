(function () {
  const config = window.TREE_CONFIG || {};
  const dataUrl = config.dataUrl || "";
  const expandDepth = Number.isInteger(config.expandDepth) ? config.expandDepth : 1;
  const downloadEnabled = config.downloadEnabled !== false;

  function isAudioFile(name) {
    const parts = name.split(".");
    if (parts.length < 2) {
      return false;
    }
    const ext = parts.pop().toLowerCase();
    const audioExts = new Set([
      "mp3", "flac", "ogg", "opus", "wav", "aac", "m4a", "wma",
      "alac", "aiff", "aif", "ape", "mpc", "oga"
    ]);
    const playlistExts = new Set(["m3u", "m3u8", "pls", "xspf"]);
    if (playlistExts.has(ext)) {
      return false;
    }
    return audioExts.has(ext);
  }

  function downloadFile(node) {
    if (!downloadEnabled) {
      return;
    }
    const params = new URLSearchParams();
    params.append("user", node.user || "");
    params.append("path", node.path || "");
    params.append("size", node.size || 0);

    fetch("/download", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: params.toString()
    }).then(response => {
      const statusEl = document.getElementById("tree-status");
      if (response.ok) {
        statusEl.textContent = "Download queued.";
        setTimeout(() => { statusEl.textContent = ""; }, 1500);
      } else {
        statusEl.textContent = "Failed to queue download.";
      }
    }).catch(() => {
      const statusEl = document.getElementById("tree-status");
      statusEl.textContent = "Failed to queue download.";
    });
  }

  function createNode(node, depth) {
    const li = document.createElement("li");
    const row = document.createElement("div");
    row.className = "tree-row";

    const toggle = document.createElement("button");
    toggle.className = "tree-toggle";

    const icon = document.createElement("span");
    if (node.type === "dir") {
      icon.className = "icon spacer";
    } else {
      icon.className = "icon file";
      if (isAudioFile(node.name || "")) {
        icon.classList.add("audio");
        icon.textContent = "\u266B";
      }
    }

    const label = document.createElement("span");
    label.textContent = node.name || "(root)";

    row.appendChild(toggle);
    row.appendChild(icon);
    row.appendChild(label);
    li.appendChild(row);

    if (node.type === "dir" && node.children && node.children.length) {
      const childList = document.createElement("ul");
      node.children.forEach(child => childList.appendChild(createNode(child, depth + 1)));
      li.appendChild(childList);

      const expanded = depth < expandDepth;
      toggle.classList.add("dir");
      const folderIcon = document.createElement("span");
      folderIcon.className = "folder-icon" + (expanded ? " open" : "");
      toggle.appendChild(folderIcon);
      if (!expanded) {
        li.classList.add("collapsed");
      }
      toggle.addEventListener("click", () => {
        const isCollapsed = li.classList.toggle("collapsed");
        folderIcon.classList.toggle("open", !isCollapsed);
      });
      label.addEventListener("click", () => {
        const isCollapsed = li.classList.toggle("collapsed");
        folderIcon.classList.toggle("open", !isCollapsed);
      });
    } else {
      toggle.classList.add("empty");
      toggle.textContent = "";
      if (downloadEnabled && node.user && node.path) {
        label.classList.add("tree-file");
        label.title = "Click to download";
        label.addEventListener("click", () => downloadFile(node));
      }
    }

    return li;
  }

  function renderTree(root) {
    const container = document.getElementById("tree-root");
    container.innerHTML = "";
    if (!root || !root.children || !root.children.length) {
      container.textContent = "No files to display.";
      return;
    }
    const list = document.createElement("ul");
    root.children.forEach(child => list.appendChild(createNode(child, 0)));
    container.appendChild(list);
  }

  function loadTree() {
    if (!dataUrl) {
      return;
    }
    fetch(dataUrl)
      .then(response => response.json())
      .then(data => {
        const statusEl = document.getElementById("tree-status");
        if (!data || data.status !== "ready") {
          if (data && data.status === "not_found") {
            statusEl.textContent = "User not found.";
          } else if (data && data.status === "loading") {
            statusEl.textContent = "Loading...";
          } else {
            statusEl.textContent = "No data available.";
          }
          return;
        }
        statusEl.textContent = "";
        renderTree(data.tree);
      })
      .catch(() => {
        const statusEl = document.getElementById("tree-status");
        statusEl.textContent = "Failed to load tree data.";
      });
  }

  loadTree();
})();
