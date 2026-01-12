import { Download, FileText, Folder, Music2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { apiFetch } from "../api";
import NotConnectedNotice from "../components/NotConnectedNotice";
import SearchBar from "../components/SearchBar";
import { useToast } from "../state/toast";

interface ResultRow {
  user: string;
  folder: string;
  file: string;
  size: number;
  speed?: number;
  attributes?: string;
  freeSlots?: number;
  path?: string;
}

interface SearchTreeNode {
  name: string;
  type: "root" | "dir" | "file";
  children?: SearchTreeNode[];
  size?: number;
  path?: string;
  user?: string;
  speed?: number;
  free_slots?: number;
  attributes?: string;
}

interface StatusSnapshot {
  status?: string;
}

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

function formatSpeed(value?: number) {
  if (!value) {
    return "-";
  }
  const units = ["KB/s", "MB/s", "GB/s"];
  let speed = value;
  let unitIndex = 0;
  while (speed >= 1024 && unitIndex < units.length - 1) {
    speed /= 1024;
    unitIndex += 1;
  }
  const rounded = speed >= 10 ? speed.toFixed(0) : speed.toFixed(1);
  return `${rounded} ${units[unitIndex]}`;
}

type SortKey = "user" | "speed" | "folder" | "file" | "size" | "attributes";

function getFileIcon(name: string) {
  if (name.match(/\.(mp3|flac|ogg|opus|wav|aac|m4a|wma|alac|aiff|ape)$/i)) {
    return <Music2 size={14} strokeWidth={1.6} />;
  }
  return <FileText size={14} strokeWidth={1.6} />;
}

export default function SearchResultsPage() {
  const { term } = useParams();
  const navigate = useNavigate();
  const [status, setStatus] = useState("Loading search results...");
  const [rows, setRows] = useState<ResultRow[]>([]);
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("speed");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
  const [isConnected, setIsConnected] = useState(false);
  const [statusReady, setStatusReady] = useState(false);
  const { addToast } = useToast();
  const pollTimer = useRef<number | null>(null);
  const pollDelay = useRef(200);
  const pollAttempts = useRef(0);

  const decodedTerm = useMemo(() => decodeURIComponent(term || ""), [term]);

  useEffect(() => {
    setQuery(decodedTerm || "");
  }, [decodedTerm]);

  useEffect(() => {
    let active = true;

    const loadStatus = async () => {
      try {
        const response = await fetch("/status.json");
        if (!response.ok) {
          return;
        }
        const data = (await response.json()) as StatusSnapshot;
        if (!active) {
          return;
        }
        const value = (data.status || "").toLowerCase();
        setIsConnected(value.includes("online") || value.includes("connected"));
        setStatusReady(true);
      } catch {
        if (active) {
          setIsConnected(false);
          setStatusReady(true);
        }
      }
    };

    loadStatus();
    const statusTimer = window.setInterval(loadStatus, 5000);

    return () => {
      active = false;
      window.clearInterval(statusTimer);
    };
  }, []);

  useEffect(() => {
    let active = true;

    setRows([]);
    setStatus(isConnected ? "Loading search results..." : "");

    const scheduleNext = () => {
      if (pollAttempts.current >= 40) {
        return;
      }
      pollAttempts.current += 1;
      pollTimer.current = window.setTimeout(() => {
        pollTimer.current = null;
        loadResults();
      }, pollDelay.current);
      pollDelay.current = Math.min(2000, Math.round(pollDelay.current * 1.5));
    };

    const buildRows = (tree: SearchTreeNode | null): ResultRow[] => {
      if (!tree?.children?.length) {
        return [];
      }
      const collected: ResultRow[] = [];

      const walk = (node: SearchTreeNode, user: string, pathParts: string[]) => {
        if (node.type === "file") {
          collected.push({
            user,
            folder: pathParts.join("/") || "(root)",
            file: node.name,
            size: node.size || 0,
            speed: node.speed,
            attributes: node.attributes,
            freeSlots: node.free_slots,
            path: node.path
          });
          return;
        }
        if (node.type === "dir") {
          const nextParts = node.name ? [...pathParts, node.name] : pathParts;
          node.children?.forEach((child) => walk(child, user, nextParts));
        }
      };

      for (const userNode of tree.children) {
        if (userNode.type !== "dir") {
          continue;
        }
        const user = userNode.name;
        userNode.children?.forEach((child) => walk(child, user, []));
      }

      return collected;
    };

    const loadResults = async () => {
      if (!decodedTerm) {
        return;
      }
      if (!isConnected) {
        if (active) {
          setRows([]);
          setStatus("");
        }
        return;
      }
      try {
        const response = await apiFetch(`/search/${encodeURIComponent(decodedTerm)}/tree.json`);
        if (!response.ok) {
          if (active) {
            setStatus("Search results unavailable.");
          }
          return;
        }
        const data = (await response.json()) as { status: string; tree: SearchTreeNode | null };
        if (!active) {
          return;
        }
        if (data.status === "ready") {
          const nextRows = buildRows(data.tree);
          setRows(nextRows);
          setStatus(nextRows.length ? "" : "No results found.");
          return;
        }
        if (data.status === "empty" || data.status === "loading") {
          setStatus("Searching...");
          setRows([]);
          scheduleNext();
          return;
        }
        setStatus("No results found.");
        setRows([]);
      } catch {
        if (active) {
          setStatus("Search failed.");
          setRows([]);
          scheduleNext();
        }
      }
    };

    pollAttempts.current = 0;
    pollDelay.current = 200;
    loadResults();

    return () => {
      active = false;
      if (pollTimer.current) {
        window.clearTimeout(pollTimer.current);
      }
    };
  }, [decodedTerm, isConnected]);

  const groupedResults = useMemo(() => {
    const sorted = [...rows].sort((a, b) => {
      const dir = sortDirection === "asc" ? 1 : -1;
      switch (sortKey) {
        case "user":
          return a.user.localeCompare(b.user) * dir;
        case "folder":
          return a.folder.localeCompare(b.folder) * dir;
        case "file":
          return a.file.localeCompare(b.file) * dir;
        case "size":
          return (a.size - b.size) * dir;
        case "speed":
          return ((a.speed || 0) - (b.speed || 0)) * dir;
        case "attributes":
          return (a.attributes || "").localeCompare(b.attributes || "") * dir;
        default:
          return 0;
      }
    });

    const groups: Array<{
      key: string;
      user: string;
      folder: string;
      speed?: number;
      freeSlots?: number;
      files: ResultRow[];
    }> = [];

    for (const row of sorted) {
      const key = `${row.user}__${row.folder}`;
      const existing = groups.find((group) => group.key === key);
      if (existing) {
        existing.files.push(row);
      } else {
        groups.push({
          key,
          user: row.user,
          folder: row.folder,
          speed: row.speed,
          freeSlots: row.freeSlots,
          files: [row]
        });
      }
    }
    for (const group of groups) {
      group.speed = group.files.reduce((max, file) => Math.max(max, file.speed || 0), 0);
      group.freeSlots = group.files.reduce((max, file) => Math.max(max, file.freeSlots || 0), 0);
    }
    return groups;
  }, [rows, sortDirection, sortKey]);

  const requestDownload = async (user: string, path: string, size: number) => {
    if (!user || !path) {
      addToast("Download failed.", "error");
      return;
    }
    const params = new URLSearchParams();
    params.set("user", user);
    params.set("path", path);
    params.set("size", String(size));
    try {
      const response = await apiFetch("/download", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: params.toString()
      });
      if (!response.ok) {
        addToast("Download failed.", "error");
      } else {
        addToast("Download queued.", "success");
      }
    } catch {
      addToast("Download failed.", "error");
    }
  };

  const handleFolderDownload = async (user: string, files: ResultRow[]) => {
    const candidates = files.filter((file) => file.path);
    if (!candidates.length) {
      addToast("Download failed.", "error");
      return;
    }
    await Promise.all(candidates.map((file) => requestDownload(user, file.path || "", file.size)));
  };

  const requestSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortDirection((prev) => (prev === "asc" ? "desc" : "asc"));
      return;
    }
    setSortKey(key);
    setSortDirection("asc");
  };

  const handleSearch = async () => {
    if (!isConnected) {
      return;
    }
    const trimmed = query.trim();
    if (!trimmed) {
      return;
    }
    const params = new URLSearchParams();
    params.set("term", trimmed);
    try {
      await apiFetch("/search", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: params.toString()
      });
    } catch {
      // ignore
    }
    navigate(`/search/${encodeURIComponent(trimmed)}`);
  };

  const sortArrow = sortDirection === "asc" ? "▲" : "▼";

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>Search Results</h1>
        </div>
      </header>

      <SearchBar
        value={query}
        placeholder="Search Soulseek network"
        onChange={setQuery}
        onSubmit={handleSearch}
        disabled={!isConnected}
      />

      <section className="section">
        <div className="section-header">
          <h2>Results</h2>
        </div>
        <div className="table-card">
          {statusReady && !isConnected && (
            <div className="results-status">
              <NotConnectedNotice />
            </div>
          )}
          <table>
            <thead>
              <tr>
                <th className="col-user">
                  <button type="button" className="sortable" onClick={() => requestSort("user")}>User</button>
                  {sortKey === "user" && (
                    <button type="button" className="sort-arrow" onClick={() => requestSort("user")}>
                      {sortArrow}
                    </button>
                  )}
                </th>
                <th className="col-speed">
                  <button type="button" className="sortable" onClick={() => requestSort("speed")}>Speed</button>
                  {sortKey === "speed" && (
                    <button type="button" className="sort-arrow" onClick={() => requestSort("speed")}>
                      {sortArrow}
                    </button>
                  )}
                </th>
                <th>
                  <button type="button" className="sortable" onClick={() => requestSort("folder")}>Directory</button>
                  {sortKey === "folder" && (
                    <button type="button" className="sort-arrow" onClick={() => requestSort("folder")}>
                      {sortArrow}
                    </button>
                  )}
                </th>
                <th className="col-size">
                  <button type="button" className="sortable" onClick={() => requestSort("size")}>Size</button>
                  {sortKey === "size" && (
                    <button type="button" className="sort-arrow" onClick={() => requestSort("size")}>
                      {sortArrow}
                    </button>
                  )}
                </th>
                <th>Download</th>
                <th className="col-attributes">
                  <button type="button" className="sortable" onClick={() => requestSort("attributes")}>Attributes</button>
                  {sortKey === "attributes" && (
                    <button type="button" className="sort-arrow" onClick={() => requestSort("attributes")}>
                      {sortArrow}
                    </button>
                  )}
                </th>
              </tr>
            </thead>
            <tbody>
              {groupedResults.length === 0 ? (
                <tr>
                  <td colSpan={6} className="empty-cell">{status || "No results available."}</td>
                </tr>
              ) : (
                groupedResults.flatMap((group) => [
                  <tr key={`${group.key}-group`} className="results-group">
                    <td className="mono">
                      <div className="user-status">
                        <span
                          className={`user-status-dot ${
                            (group.freeSlots || 0) > 0 ? "user-status-ready" : "user-status-busy"
                          }`}
                          title={(group.freeSlots || 0) > 0 ? "Ready to download" : "Busy (no free slots)"}
                        />
                        <span>{group.user}</span>
                      </div>
                    </td>
                    <td className="col-speed">{formatSpeed(group.speed)}</td>
                    <td className="mono">
                      <div className="results-folder">
                        <span className="results-icon">
                          <Folder size={14} strokeWidth={1.6} />
                        </span>
                        <span>{group.folder}</span>
                      </div>
                    </td>
                    <td></td>
                    <td>
                      <button
                        type="button"
                        className="icon-button icon-button-small icon-button-plain"
                        aria-label="Download folder"
                        title="Download directory"
                        onClick={(event) => {
                          event.stopPropagation();
                          handleFolderDownload(group.user, group.files);
                        }}
                      >
                        <Download size={18} strokeWidth={1.6} />
                      </button>
                    </td>
                    <td>Folder</td>
                  </tr>,
                  ...group.files.map((file, index) => (
                    <tr
                      key={`${group.key}-${file.file}`}
                      className={`results-file${index === group.files.length - 1 ? " results-file-last" : ""}`}
                    >
                      <td></td>
                      <td className="col-speed"></td>
                      <td className="mono">
                        <span className="results-file-name">
                          <span className="results-icon">{getFileIcon(file.file)}</span>
                          {file.file}
                        </span>
                      </td>
                      <td className="col-size">{formatSize(file.size)}</td>
                      <td>
                        <button
                          type="button"
                          className="icon-button icon-button-small icon-button-plain"
                          aria-label="Download file"
                          title="Download file"
                          onClick={(event) => {
                            event.stopPropagation();
                            requestDownload(file.user, file.path || "", file.size);
                          }}
                        >
                          <Download size={18} strokeWidth={1.6} />
                        </button>
                      </td>
                      <td className="col-attributes">{file.attributes || "-"}</td>
                    </tr>
                  ))
                ])
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
