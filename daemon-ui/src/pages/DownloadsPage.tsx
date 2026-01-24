import { Pause, Play, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch } from "../api";
import FileActionBar from "../components/FileActionBar";
import Modal from "../components/Modal";
import { useFooter } from "../state/footer";
import { Track, usePlayer } from "../state/player";
import { useToast } from "../state/toast";

interface DownloadItem {
  user: string;
  path: string;
  virtual_path?: string;
  size: number;
  offset: number;
  status: string;
  folder: string;
  isFolder?: boolean;
  local_path?: string | null;
  queued_at?: number;
}

type SortKey = "user" | "path" | "size" | "progress" | "status" | "queued_at";

type SortDirection = "asc" | "desc";

function formatSize(bytes: number) {
  if (!bytes) {
    return "0 B";
  }
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  const rounded = value >= 10 ? value.toFixed(0) : value.toFixed(1);
  return `${rounded} ${units[index]}`;
}

function getProgress(item: DownloadItem) {
  if (!item.size) {
    return 0;
  }
  return Math.min(100, Math.floor((item.offset / item.size) * 100));
}

function isFinished(status: string) {
  const value = status.toLowerCase();
  return value === "finished" || value === "completed";
}

function isPaused(status: string) {
  return status.toLowerCase() === "paused";
}

function formatQueuedAt(timestamp?: number) {
  if (!timestamp) {
    return "-";
  }
  return new Date(timestamp * 1000).toLocaleString();
}

export default function DownloadsPage() {
  const [items, setItems] = useState<DownloadItem[]>([]);
  const [sortKey, setSortKey] = useState<SortKey>("queued_at");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [selectedItem, setSelectedItem] = useState<DownloadItem | null>(null);
  const [showRename, setShowRename] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [showDelete, setShowDelete] = useState(false);
  const { playTrack, enqueue } = usePlayer();
  const { setContent } = useFooter();
  const { addToast } = useToast();
  const deletePath = selectedItem
    ? String(selectedItem.local_path || selectedItem.path || "")
    : "";

  const refreshDownloads = useCallback(async () => {
    try {
      const response = await apiFetch("/api/downloads.json");
      if (!response.ok) {
        return;
      }
      const data = (await response.json()) as DownloadItem[];
      setItems(data);
      setSelectedItem((prev) => {
        if (!prev) {
          return prev;
        }
        const key = prev.user + (prev.virtual_path || prev.path);
        return data.find((item) => item.user + (item.virtual_path || item.path) === key) || null;
      });
    } catch {
      setItems([]);
    }
  }, []);

  useEffect(() => {
    let active = true;

    const load = async () => {
      if (!active) {
        return;
      }
      await refreshDownloads();
    };

    load();
    const timer = window.setInterval(load, 2000);

    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [refreshDownloads]);

  const groupedItems = useMemo(() => {
    const sorted = [...items].sort((a, b) => {
      const direction = sortDirection === "asc" ? 1 : -1;
      switch (sortKey) {
        case "user":
          return a.user.localeCompare(b.user) * direction;
        case "path":
          return a.path.localeCompare(b.path) * direction;
        case "size":
          return (a.size - b.size) * direction;
        case "progress":
          return (getProgress(a) - getProgress(b)) * direction;
        case "status":
          return a.status.localeCompare(b.status) * direction;
        case "queued_at":
          return ((a.queued_at || 0) - (b.queued_at || 0)) * direction;
        default:
          return 0;
      }
    });

    const groups: Array<{ key: string; user: string; folder: string; items: DownloadItem[]; isFolder?: boolean }> = [];
    for (const item of sorted) {
      const key = `${item.user}__${item.folder}`;
      if (item.isFolder) {
        const existing = groups.find((group) => group.key === key);
        if (existing) {
          existing.items.push(item);
        } else {
          groups.push({ key, user: item.user, folder: item.folder, items: [item], isFolder: true });
        }
      } else {
        groups.push({ key: `${key}-${item.path}`, user: item.user, folder: item.folder, items: [item] });
      }
    }
    return groups;
  }, [items, sortDirection, sortKey]);

  const hasCompleted = useMemo(() => items.some((item) => isFinished(item.status)), [items]);

  const requestSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortDirection((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDirection("asc");
    }
  };

  const sortArrow = sortDirection === "asc" ? "▲" : "▼";

  const requestAction = async (action: "pause" | "resume" | "cancel" | "clear", item: DownloadItem) => {
    const virtualPath = item.virtual_path || item.path;
    if (!item.user || !virtualPath) {
      return;
    }
    const params = new URLSearchParams();
    params.set("user", item.user);
    params.set("path", virtualPath);
    try {
      await apiFetch(`/api/downloads/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: params.toString()
      });
      await refreshDownloads();
    } catch {
      // Ignore action failures for now.
    }
  };

  const requestFileRename = async (item: DownloadItem, newName: string) => {
    if (!item.local_path) {
      addToast("File not found.");
      return null;
    }
    const params = new URLSearchParams();
    params.set("path", item.local_path);
    params.set("name", newName);
    params.set("download_user", item.user);
    params.set("download_path", item.virtual_path || item.path);
    try {
      const response = await apiFetch("/api/files/rename", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: params.toString()
      });
      if (!response.ok) {
        addToast("Rename failed.");
        return null;
      }
    } catch {
      addToast("Rename failed.");
      return null;
    }
    const updatedPath = item.local_path.replace(/[^/\\]+$/, newName);
    return updatedPath;
  };

  const requestFileDelete = async (item: DownloadItem) => {
    if (!item.local_path) {
      addToast("File not found.");
      return false;
    }
    const params = new URLSearchParams();
    params.set("path", item.local_path);
    params.set("download_user", item.user);
    params.set("download_path", item.virtual_path || item.path);
    try {
      const response = await apiFetch("/api/files/delete", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: params.toString()
      });
      if (!response.ok) {
        addToast("Delete failed.");
      }
      return response.ok;
    } catch {
      addToast("Delete failed.");
      return false;
    }
  };

  const verifyMediaAccess = async (path: string, failureMessage: string) => {
    try {
      const response = await apiFetch(`/api/media/meta?path=${encodeURIComponent(path)}`);
      if (!response.ok) {
        addToast(failureMessage);
        return false;
      }
      return true;
    } catch {
      addToast(failureMessage);
      return false;
    }
  };

  const handleClearCompleted = async () => {
    if (!hasCompleted) {
      return;
    }
    try {
      await apiFetch("/api/downloads/clear-completed", { method: "POST" });
    } catch {
      // Ignore failures for now.
    }
  };

  const handleRename = async () => {
    if (!selectedItem || !renameValue.trim()) {
      return;
    }
    const newPath = await requestFileRename(selectedItem, renameValue.trim());
    if (!newPath) {
      return;
    }
    setItems((prev) =>
      prev.map((item) => {
        const itemKey = item.user + (item.virtual_path || item.path);
        const selectedKey = selectedItem.user + (selectedItem.virtual_path || selectedItem.path);
        if (itemKey === selectedKey) {
          return { ...item, local_path: newPath };
        }
        return item;
      })
    );
    setSelectedItem((prev) => (prev ? { ...prev, local_path: newPath } : prev));
    setShowRename(false);
  };

  const handleDelete = async () => {
    if (!selectedItem) {
      return;
    }
    const ok = await requestFileDelete(selectedItem);
    if (!ok) {
      return;
    }
    setItems((prev) =>
      prev.map((item) => {
        const itemKey = item.user + (item.virtual_path || item.path);
        const selectedKey = selectedItem.user + (selectedItem.virtual_path || selectedItem.path);
        if (itemKey === selectedKey) {
          return { ...item, local_path: null };
        }
        return item;
      })
    );
    setSelectedItem(null);
    setShowDelete(false);
  };

  const handlePlaySelected = async () => {
    if (!selectedItem?.local_path) {
      addToast("File not found.");
      return;
    }
    const ok = await verifyMediaAccess(selectedItem.local_path, "Playback failed.");
    if (!ok) {
      return;
    }
    playTrack(toTrack(selectedItem));
  };

  const handleQueueSelected = async () => {
    if (!selectedItem?.local_path) {
      addToast("File not found.");
      return;
    }
    const ok = await verifyMediaAccess(selectedItem.local_path, "Add to queue failed.");
    if (!ok) {
      return;
    }
    enqueue(toTrack(selectedItem));
  };

  const toTrack = (item: DownloadItem): Track => ({
    id: item.local_path || item.path,
    title: (item.local_path || item.path).split(/[/\\]/).pop() || item.path,
    path: item.local_path || undefined,
    src: item.local_path ? `/api/media?path=${encodeURIComponent(item.local_path)}` : undefined
  });

  useEffect(() => {
    if (!selectedItem) {
      setContent(null);
      return;
    }
    const fullPath = selectedItem.local_path || selectedItem.path;
    const pathParts = fullPath.split(/[/\\]/);
    const parentDir = pathParts.length > 1 ? pathParts[pathParts.length - 2] : "";
    const fileName = pathParts[pathParts.length - 1] || selectedItem.path;
    const fileLabel = fileName;
    const filePath = parentDir ? `${parentDir}/${fileName}` : fileName;
    const finished = isFinished(selectedItem.status);
    const hasLocalPath = Boolean(selectedItem.local_path);
    const missingFileNotice = finished && !hasLocalPath ? "File not found on disk" : "";
    const statusText = finished ? "" : selectedItem.status;
    const showClear = true;
    setContent(
      <FileActionBar
        fileName={fileLabel}
        filePath={filePath}
        mediaPath={selectedItem.local_path ? String(selectedItem.local_path) : undefined}
        notice={missingFileNotice}
        statusText={statusText}
        showClear={showClear}
        onClear={() => {
          requestAction("clear", selectedItem);
        }}
        onPlay={handlePlaySelected}
        onQueue={handleQueueSelected}
        onRename={() => {
          setRenameValue(
            (selectedItem.local_path || selectedItem.path).split(/[/\\]/).pop() || ""
          );
          setShowRename(true);
        }}
        onDelete={() => setShowDelete(true)}
        disablePlay={!finished || !hasLocalPath}
        disableQueue={!finished || !hasLocalPath}
        showRename={finished && hasLocalPath}
        showDelete={finished && hasLocalPath}
      />
    );

    return () => setContent(null);
  }, [enqueue, playTrack, selectedItem, setContent]);

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>Downloads</h1>
          <p className="page-subtitle">Manage in-progress and completed downloads.</p>
        </div>
      </header>

      <div className="section-header">
        <div />
        <button
          type="button"
          className="secondary-button"
          onClick={handleClearCompleted}
          disabled={!hasCompleted}
        >
          Clear completed
        </button>
      </div>

      <div className="table-card" onClick={() => setSelectedItem(null)} role="presentation">
        <table>
          <thead>
            <tr>
              <th>
                <div className="table-sort">
                  <button type="button" className="sortable" onClick={() => requestSort("user")}>
                    User
                  </button>
                  <button
                    type="button"
                    className={`sort-arrow${sortKey === "user" ? "" : " sort-arrow-hidden"}`}
                    onClick={() => requestSort("user")}
                    aria-hidden={sortKey !== "user"}
                    tabIndex={sortKey === "user" ? 0 : -1}
                  >
                    {sortArrow}
                  </button>
                </div>
              </th>
              <th>
                <div className="table-sort">
                  <button type="button" className="sortable" onClick={() => requestSort("path")}>
                    File
                  </button>
                  <button
                    type="button"
                    className={`sort-arrow${sortKey === "path" ? "" : " sort-arrow-hidden"}`}
                    onClick={() => requestSort("path")}
                    aria-hidden={sortKey !== "path"}
                    tabIndex={sortKey === "path" ? 0 : -1}
                  >
                    {sortArrow}
                  </button>
                </div>
              </th>
              <th>
                <div className="table-sort">
                  <button type="button" className="sortable" onClick={() => requestSort("size")}>
                    Size
                  </button>
                  <button
                    type="button"
                    className={`sort-arrow${sortKey === "size" ? "" : " sort-arrow-hidden"}`}
                    onClick={() => requestSort("size")}
                    aria-hidden={sortKey !== "size"}
                    tabIndex={sortKey === "size" ? 0 : -1}
                  >
                    {sortArrow}
                  </button>
                </div>
              </th>
              <th>
                <div className="table-sort">
                  <button type="button" className="sortable" onClick={() => requestSort("progress")}>
                    Progress
                  </button>
                  <button
                    type="button"
                    className={`sort-arrow${sortKey === "progress" ? "" : " sort-arrow-hidden"}`}
                    onClick={() => requestSort("progress")}
                    aria-hidden={sortKey !== "progress"}
                    tabIndex={sortKey === "progress" ? 0 : -1}
                  >
                    {sortArrow}
                  </button>
                </div>
              </th>
              <th>
                <div className="table-sort">
                  <button type="button" className="sortable" onClick={() => requestSort("status")}>
                    Status
                  </button>
                  <button
                    type="button"
                    className={`sort-arrow${sortKey === "status" ? "" : " sort-arrow-hidden"}`}
                    onClick={() => requestSort("status")}
                    aria-hidden={sortKey !== "status"}
                    tabIndex={sortKey === "status" ? 0 : -1}
                  >
                    {sortArrow}
                  </button>
                </div>
              </th>
              <th>
                <div className="table-sort">
                  <button type="button" className="sortable" onClick={() => requestSort("queued_at")}>
                    Added
                  </button>
                  <button
                    type="button"
                    className={`sort-arrow${sortKey === "queued_at" ? "" : " sort-arrow-hidden"}`}
                    onClick={() => requestSort("queued_at")}
                    aria-hidden={sortKey !== "queued_at"}
                    tabIndex={sortKey === "queued_at" ? 0 : -1}
                  >
                    {sortArrow}
                  </button>
                </div>
              </th>
              <th className="table-actions-header">
                <div className="table-actions-spacer" />
              </th>
            </tr>
          </thead>
          <tbody>
            {groupedItems.flatMap((group) => {
              const groupHeader = group.isFolder ? (
                <tr key={`${group.key}-group`} className="results-group downloads-group">
                  <td className="downloads-user">{group.user}</td>
                  <td className="downloads-path">{group.folder}</td>
                  <td></td>
                  <td></td>
                  <td></td>
                  <td></td>
                  <td></td>
                </tr>
              ) : null;

                const rows = group.items.map((item, index) => (
                <tr
                  key={`${group.key}-${item.path}`}
                  className={`results-file downloads-file${index === group.items.length - 1 ? " results-file-last" : ""}${
                    isFinished(item.status) && item.local_path ? " row-clickable" : ""
                  }`}
                  onClick={(event) => {
                    event.stopPropagation();
                    setSelectedItem(item);
                  }}
                >
                  <td className="downloads-user">{group.isFolder ? "" : item.user}</td>
                  <td className="downloads-path">{item.path}</td>
                  <td>{formatSize(item.size)}</td>
                  <td>
                    <div className="progress-cell">
                      <div className="progress-bar">
                        <div className="progress-fill" style={{ width: `${getProgress(item)}%` }}></div>
                      </div>
                      <span>{getProgress(item)}%</span>
                    </div>
                  </td>
                    <td><span className="downloads-status">{item.status}</span></td>
                    <td className="downloads-added">{formatQueuedAt(item.queued_at)}</td>
                    <td>
                      <div className="row-actions">
                        {!isFinished(item.status) && !isPaused(item.status) && (
                          <button
                            type="button"
                            className="icon-button"
                            aria-label="Pause"
                            onClick={(event) => {
                              event.stopPropagation();
                              requestAction("pause", item);
                            }}
                          >
                            <Pause size={18} strokeWidth={1.6} />
                          </button>
                        )}
                        {isPaused(item.status) && (
                          <button
                            type="button"
                            className="icon-button"
                            aria-label="Resume"
                            onClick={(event) => {
                              event.stopPropagation();
                              requestAction("resume", item);
                            }}
                          >
                            <Play size={18} strokeWidth={1.6} />
                          </button>
                        )}
                        <button
                          type="button"
                          className="icon-button secondary-button"
                          aria-label={isFinished(item.status) ? "Clear" : "Cancel"}
                          title={isFinished(item.status) ? "Clear download" : "Cancel download"}
                          onClick={(event) => {
                            event.stopPropagation();
                            requestAction(isFinished(item.status) ? "clear" : "cancel", item);
                          }}
                        >
                          <X size={14} strokeWidth={1.6} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ));

              return groupHeader ? [groupHeader, ...rows] : rows;
            })}
            {groupedItems.length === 0 ? (
              <tr>
                <td colSpan={7} className="empty-cell">
                  No downloads yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <Modal
        open={showRename && Boolean(selectedItem)}
        title="Rename file"
        onClose={() => setShowRename(false)}
        footer={
          <>
            <button type="button" onClick={handleRename}>
              Save
            </button>
            <button type="button" className="ghost-button" onClick={() => setShowRename(false)}>
              Cancel
            </button>
          </>
        }
      >
        <input
          type="text"
          value={renameValue}
          onChange={(event) => setRenameValue(event.target.value)}
        />
      </Modal>

      <Modal
        open={showDelete && Boolean(selectedItem)}
        title="Delete file"
        onClose={() => setShowDelete(false)}
        className="modal-delete"
        footer={
          <>
            <button type="button" className="danger-button" onClick={handleDelete}>
              Delete
            </button>
            <button type="button" className="ghost-button" onClick={() => setShowDelete(false)}>
              Cancel
            </button>
          </>
        }
      >
        <div className="mono">{deletePath}</div>
        <p>Delete this file from disk?</p>
      </Modal>
    </div>
  );
}
