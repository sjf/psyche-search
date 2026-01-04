(function () {
  function formatSize(value) {
    if (!value) {
      return "0";
    }
    const units = ["B", "KB", "MB", "GB", "TB"];
    let size = value;
    let unitIndex = 0;
    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex += 1;
    }
    const rounded = size >= 10 ? size.toFixed(0) : size.toFixed(1);
    return `${rounded} ${units[unitIndex]}`;
  }

  function sanitizePath(path) {
    if (path && path.startsWith("@")) {
      const parts = path.split("\\");
      if (parts.length && parts[0].startsWith("@")) {
        return parts.slice(1).join("\\");
      }
    }
    return path || "";
  }

  function renderRows(items) {
    const body = document.getElementById("downloads-body");
    body.innerHTML = "";
    items.forEach(item => {
      const size = item.size || 0;
      const offset = item.offset || 0;
      const percent = size ? Math.floor((offset / size) * 100) : 0;
      const row = document.createElement("tr");
      row.innerHTML = `
        <td>${item.user || ""}</td>
        <td class="path">${sanitizePath(item.path || "")}</td>
        <td>${formatSize(size)}</td>
        <td>${percent}%</td>
        <td>${item.status || ""}</td>
        <td class="path">${item.folder || ""}</td>
      `;
      body.appendChild(row);
    });
  }

  function loadDownloads() {
    fetch("/downloads.json")
      .then(response => response.json())
      .then(data => renderRows(data || []))
      .catch(() => renderRows([]));
  }

  loadDownloads();
})();
