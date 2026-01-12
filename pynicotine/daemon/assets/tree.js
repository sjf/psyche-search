(function () {
  const config = window.TREE_CONFIG || {};
  const dataUrl = config.dataUrl || "";
  const expandDepth = Number.isInteger(config.expandDepth) ? config.expandDepth : 1;
  const downloadEnabled = config.downloadEnabled !== false;
  const maxPollAttempts = Number.isInteger(config.maxPollAttempts) ? config.maxPollAttempts : 40;
  const initialPollDelayMs = Number.isInteger(config.initialPollDelayMs) ? config.initialPollDelayMs : 200;
  const maxPollDelayMs = Number.isInteger(config.maxPollDelayMs) ? config.maxPollDelayMs : 2000;
  const pollBackoff = Number.isFinite(config.pollBackoff) ? config.pollBackoff : 1.5;

  let pollAttempts = 0;
  let pollDelayMs = initialPollDelayMs;
  let pollTimer = null;
  let requestInFlight = false;

  function setStatus(statusText, showSpinner) {
    const statusEl = document.getElementById("tree-status");
    if (!statusEl) {
      return;
    }
    if (showSpinner) {
      statusEl.innerHTML = `${statusText} <span class="spinner" aria-hidden="true"></span>`;
    } else {
      statusEl.textContent = statusText;
    }
  }

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

  function schedulePoll() {
    if (pollTimer || pollAttempts >= maxPollAttempts) {
      return;
    }
    pollTimer = setTimeout(() => {
      pollTimer = null;
      loadTree();
    }, pollDelayMs);
    pollAttempts += 1;
    pollDelayMs = Math.min(maxPollDelayMs, Math.round(pollDelayMs * pollBackoff));
  }

  function loadTree() {
    if (!dataUrl) {
      return;
    }
    if (requestInFlight) {
      return;
    }
    requestInFlight = true;
    fetch(dataUrl)
      .then(response => response.json())
      .then(data => {
        requestInFlight = false;
        if (!data || data.status !== "ready") {
          if (data && data.status === "not_found") {
            setStatus("User not found.", false);
            return;
          }
          if (data && (data.status === "loading" || data.status === "empty")) {
            setStatus("Searching...", true);
            schedulePoll();
            return;
          }
          setStatus("No data available.", false);
          schedulePoll();
          return;
        }
        setStatus("", false);
        renderTree(data.tree);
      })
      .catch(() => {
        requestInFlight = false;
        setStatus("Failed to load tree data.", false);
        schedulePoll();
      });
  }

  loadTree();
})();
