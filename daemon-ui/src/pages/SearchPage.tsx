import { Download, FileText, Folder, Music2, Search, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { apiFetch } from "../api";
import NotConnectedNotice from "../components/NotConnectedNotice";
import SearchBar from "../components/SearchBar";
import UserAvatar from "../components/UserAvatar";
import { useToast } from "../state/toast";

interface SearchEntry {
  term: string;
  started_at: number;
  results: number;
  sort?: { key: SortKey; dir: SortDirection };
}

interface StatusSnapshot {
  status?: string;
  searches?: Record<string, SearchEntry>;
}

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

type SortKey = "user" | "speed" | "folder" | "file" | "size" | "attributes";

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

function getFileIcon(name: string) {
  if (name.match(/\.(mp3|flac|ogg|opus|wav|aac|m4a|wma|alac|aiff|ape)$/i)) {
    return <Music2 size={14} strokeWidth={1.6} />;
  }
  return <FileText size={14} strokeWidth={1.6} />;
}

const MAX_SEARCH_CACHE_BYTES = 5 * 1024 * 1024;

function persistSearchCache(cache: Map<string, ResultRow[]>, key: string) {
  while (cache.size > 0) {
    const json = JSON.stringify(Object.fromEntries(cache.entries()));
    if (new Blob([json]).size > MAX_SEARCH_CACHE_BYTES) {
      const oldest = cache.keys().next().value;
      if (oldest === undefined) {
        break;
      }
      cache.delete(oldest);
      continue;
    }
    try {
      localStorage.setItem(key, json);
      return;
    } catch {
      const oldest = cache.keys().next().value;
      if (oldest === undefined) {
        return;
      }
      cache.delete(oldest);
    }
  }
}

function timeAgo(seconds: number) {
  if (!seconds) {
    return "";
  }
  const delta = Math.max(0, Math.floor(Date.now() / 1000) - seconds);
  if (delta < 60) {
    return `${delta}s`;
  }
  if (delta < 3600) {
    return `${Math.floor(delta / 60)}m`;
  }
  if (delta < 86400) {
    return `${Math.floor(delta / 3600)}h`;
  }
  return `${Math.floor(delta / 86400)}d`;
}

const SORT_KEYS: SortKey[] = ["user", "speed", "folder", "file", "size", "attributes"];

const EXAMPLE_SEARCHES = [
  "Miles Davis Kind of Blue",
  "Radiohead In Rainbows flac",
  "Nina Simone Pastel Blues",
  "Aphex Twin Selected Ambient Works",
  "Khruangbin"
];

// Poll long enough to outlast the daemon's 3-minute search window (delay caps at 2s/poll).
const MAX_POLL_ATTEMPTS = 100;

function parseSortKey(value: string | null): SortKey | null {
  return value && (SORT_KEYS as string[]).includes(value) ? (value as SortKey) : null;
}

function findSearch(searches: SearchEntry[], term: string): SearchEntry | undefined {
  const key = term.toLowerCase();
  return searches.find((entry) => (entry.term || "").toLowerCase() === key);
}

function sortQueryFor(entry: SearchEntry | undefined): string {
  return entry?.sort ? `?sort=${entry.sort.key}&dir=${entry.sort.dir}` : "";
}

export default function SearchPage() {
  const { term: termParam } = useParams();
  const navigate = useNavigate();
  const { addToast } = useToast();
  const [term, setTerm] = useState("");
  const [searches, setSearches] = useState<SearchEntry[]>([]);
  const [activeTerm, setActiveTerm] = useState("");
  const [rows, setRows] = useState<ResultRow[]>([]);
  const [status, setStatus] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();
  const savedSort = useMemo(
    () => findSearch(searches, activeTerm)?.sort ?? null,
    [searches, activeTerm]
  );
  const sortKey: SortKey = parseSortKey(searchParams.get("sort")) ?? savedSort?.key ?? "speed";
  const sortDirParam = searchParams.get("dir");
  const sortDirection: SortDirection =
    sortDirParam === "asc" || sortDirParam === "desc" ? sortDirParam : savedSort?.dir ?? "desc";
  const [isConnected, setIsConnected] = useState(false);
  const [statusReady, setStatusReady] = useState(false);
  const prefetchedRef = useRef<Set<string>>(new Set());
  const hoverTimerRef = useRef<number | null>(null);
  const pollTimer = useRef<number | null>(null);
  const pollDelay = useRef(200);
  const pollAttempts = useRef(0);
  const cacheKey = "mseek.searchCache";
  const initialCache = useMemo(() => {
    try {
      const raw = localStorage.getItem(cacheKey);
      if (!raw) {
        return new Map<string, ResultRow[]>();
      }
      const parsed = JSON.parse(raw) as Record<string, ResultRow[]>;
      return new Map(Object.entries(parsed).filter(([, value]) => Array.isArray(value)));
    } catch {
      return new Map<string, ResultRow[]>();
    }
  }, []);
  const cacheRef = useRef<Map<string, ResultRow[]>>(initialCache);

  useEffect(() => {
    let active = true;

    const loadSearches = async () => {
      try {
      const response = await apiFetch("/api/status");
        if (!response.ok) {
          return;
        }
        const data = (await response.json()) as StatusSnapshot;
        if (!active) {
          return;
        }
        const statusValue = (data.status || "").toLowerCase();
        setIsConnected(statusValue.includes("online") || statusValue.includes("connected"));
        setStatusReady(true);
        const entries = Object.values(data.searches || {}).sort(
          (a, b) => (b.started_at || 0) - (a.started_at || 0)
        );
        setSearches(entries.slice(0, 50));
      } catch {
        if (active) {
          setSearches([]);
          setIsConnected(false);
          setStatusReady(true);
        }
      }
    };

    loadSearches();
    const timer = window.setInterval(loadSearches, 5000);

    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (!termParam) {
      return;
    }
    const decoded = decodeURIComponent(termParam);
    setTerm(decoded);
    setActiveTerm(decoded);
  }, [termParam]);

  useEffect(() => {
    let active = true;

    if (!activeTerm) {
      setRows([]);
      setStatus("");
      setSearching(false);
      return () => {
        active = false;
      };
    }

    const cached = cacheRef.current.get(activeTerm) ?? [];
    const hasCached = cached.length > 0;
    if (hasCached) {
      setRows(cached);
      setStatus("");
    } else {
      setRows([]);
      setStatus(isConnected ? "Searching…" : "");
    }
    setSearching(isConnected);

    const scheduleNext = () => {
      if (pollAttempts.current >= MAX_POLL_ATTEMPTS) {
        setSearching(false);
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
      if (!activeTerm) {
        return;
      }
      if (!isConnected) {
        if (active && !hasCached) {
          setRows([]);
          setStatus("");
        }
        setSearching(false);
        return;
      }
      try {
        const response = await apiFetch(`/api/search/${encodeURIComponent(activeTerm)}/tree.json`);
        if (!response.ok) {
          if (active) {
            setStatus("Search results unavailable.");
            setSearching(false);
          }
          return;
        }
        const data = (await response.json()) as {
          status: string;
          state?: string;
          tree: SearchTreeNode | null;
        };
        if (!active) {
          return;
        }
        // The daemon reports whether the search is still running or has settled.
        // Keep polling while it is running so late results stream in.
        const running = data.state !== "complete";
        setSearching(running);
        if (data.status === "ready") {
          const nextRows = buildRows(data.tree);
          setRows(nextRows);
          setStatus(nextRows.length ? "" : running ? "Searching…" : "No results found.");
          cacheRef.current.delete(activeTerm);
          cacheRef.current.set(activeTerm, nextRows);
          persistSearchCache(cacheRef.current, cacheKey);
          if (running) {
            scheduleNext();
          }
          return;
        }
        if (data.status === "empty" || data.status === "loading") {
          setStatus(running ? "Searching…" : "No results found.");
          setRows([]);
          if (running) {
            scheduleNext();
          }
          return;
        }
        setStatus("");
        setRows([]);
        setSearching(false);
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
  }, [activeTerm, isConnected]);

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
      speed: number;
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
          speed: row.speed || 0,
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

  const requestSort = (key: SortKey) => {
    const dir: SortDirection = key === sortKey ? (sortDirection === "asc" ? "desc" : "asc") : "asc";
    const next = new URLSearchParams(searchParams);
    next.set("sort", key);
    next.set("dir", dir);
    setSearchParams(next, { replace: true });
    if (!activeTerm) {
      return;
    }
    setSearches((prev) =>
      prev.map((entry) =>
        (entry.term || "").toLowerCase() === activeTerm.toLowerCase()
          ? { ...entry, sort: { key, dir } }
          : entry
      )
    );
    const body = new URLSearchParams();
    body.set("term", activeTerm);
    body.set("sort", key);
    body.set("dir", dir);
    apiFetch("/api/search/sort", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString()
    }).catch(() => {
      // Sort still applies from the URL; persistence is best-effort.
    });
  };

  const prefetchUser = (user: string) => {
    if (!user || prefetchedRef.current.has(user)) {
      return;
    }
    if (hoverTimerRef.current) {
      window.clearTimeout(hoverTimerRef.current);
    }
    hoverTimerRef.current = window.setTimeout(() => {
      prefetchedRef.current.add(user);
      fetch(`/api/user/${encodeURIComponent(user)}/prefetch`, { method: "POST" }).catch(() => {});
    }, 200);
  };

  const cancelPrefetch = () => {
    if (hoverTimerRef.current) {
      window.clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
  };

  const folderCrumbs = (user: string, folder: string) => {
    if (!folder || folder === "(root)") {
      return (
        <button
          type="button"
          className="link-button"
          title={`Browse ${user}'s files`}
          onClick={(event) => {
            event.stopPropagation();
            navigate(`/user/${encodeURIComponent(user)}`);
          }}
        >
          (root)
        </button>
      );
    }
    const parts = folder.split(/[\\/]/).filter(Boolean);
    return parts.map((part, index) => {
      const sub = parts.slice(0, index + 1).join("\\");
      return (
        <span key={sub} className="crumb">
          {index > 0 ? <span className="crumb-sep">\</span> : null}
          <button
            type="button"
            className="link-button"
            title={`Browse ${part}`}
            onClick={(event) => {
              event.stopPropagation();
              navigate(`/user/${encodeURIComponent(user)}?path=${encodeURIComponent(sub)}`);
            }}
          >
            {part}
          </button>
        </span>
      );
    });
  };

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
      const response = await apiFetch("/api/download", {
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

  const runSearch = async (value: string) => {
    if (!isConnected) {
      return;
    }
    const trimmed = value.trim();
    if (!trimmed) {
      return;
    }
    const params = new URLSearchParams();
    params.set("term", trimmed);
    try {
      await apiFetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: params.toString()
      });
    } catch {
      // Ignore, navigation still updates the UI.
    }
    setTerm(trimmed);
    setActiveTerm(trimmed);
    navigate(`/search/${encodeURIComponent(trimmed)}${sortQueryFor(findSearch(searches, trimmed))}`);
  };

  const handleSearch = () => runSearch(term);

  const recentSearches = useMemo(() => {
    const seen = new Set<string>();
    const list: SearchEntry[] = [];
    for (const entry of searches) {
      const key = (entry.term || "").toLowerCase();
      if (!entry.term || seen.has(key)) {
        continue;
      }
      seen.add(key);
      list.push(entry);
    }
    return list;
  }, [searches]);

  const openRecent = (entry: SearchEntry) => {
    setTerm(entry.term);
    setActiveTerm(entry.term);
    navigate(`/search/${encodeURIComponent(entry.term)}${sortQueryFor(entry)}`);
  };

  const removeRecent = async (recentTerm: string) => {
    setSearches((prev) => prev.filter((entry) => entry.term !== recentTerm));
    const params = new URLSearchParams();
    params.set("term", recentTerm);
    try {
      await apiFetch("/api/search/remove", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: params.toString()
      });
    } catch {
      // Ignore removal failures.
    }
  };

  const clearAllRecents = async () => {
    setSearches([]);
    try {
      await apiFetch("/api/search/remove", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: "term="
      });
    } catch {
      // Ignore removal failures.
    }
  };

  return (
    <div className="page">
      <header className="page-header">
        <div className="page-title-row">
          <span className="page-icon">
            <Search size={20} strokeWidth={1.7} />
          </span>
          <div>
            <h1>Search</h1>
            <p className="page-subtitle">Find files across the Soulseek network.</p>
          </div>
        </div>
      </header>

      <SearchBar
        value={term}
        placeholder="Search Soulseek network"
        onChange={setTerm}
        onSubmit={handleSearch}
        onClear={() => {
          setActiveTerm("");
          setRows([]);
          setStatus("");
          navigate("/search", { replace: true });
        }}
        disabled={!isConnected}
      />
      {statusReady && !isConnected && (
        <div className="panel-note">
          <NotConnectedNotice />
        </div>
      )}

      {activeTerm ? (
        <section className="section">
          <div className="section-header">
            <h2>Search Results</h2>
            <div className="section-header-meta">
              {searching && (
                <span className="search-progress" role="status" aria-live="polite">
                  <span className="spinner" />
                  Searching…
                </span>
              )}
              {rows.length > 0 && (
                <span className="section-meta">
                  {rows.length.toLocaleString()} {rows.length === 1 ? "result" : "results"}
                </span>
              )}
            </div>
          </div>
          <div className="table-card">
            <table>
              <thead>
                <tr>
                  <th>
                    <button type="button" className="sortable" onClick={() => requestSort("user")}>
                      User
                    </button>
                    {sortKey === "user" && (
                      <button type="button" className="sort-arrow" onClick={() => requestSort("user")}>
                          {sortDirection === "asc" ? "▲" : "▼"}
                      </button>
                    )}
                  </th>
                  <th>
                    <button type="button" className="sortable" onClick={() => requestSort("speed")}>
                      Speed
                    </button>
                    {sortKey === "speed" && (
                      <button type="button" className="sort-arrow" onClick={() => requestSort("speed")}>
                          {sortDirection === "asc" ? "▲" : "▼"}
                      </button>
                    )}
                  </th>
                  <th>
                    <button type="button" className="sortable" onClick={() => requestSort("folder")}>
                      Directory
                    </button>
                    {sortKey === "folder" && (
                      <button type="button" className="sort-arrow" onClick={() => requestSort("folder")}>
                          {sortDirection === "asc" ? "▲" : "▼"}
                      </button>
                    )}
                  </th>
                  <th>
                    <button type="button" className="sortable" onClick={() => requestSort("size")}>
                      Size
                    </button>
                    {sortKey === "size" && (
                      <button type="button" className="sort-arrow" onClick={() => requestSort("size")}>
                          {sortDirection === "asc" ? "▲" : "▼"}
                      </button>
                    )}
                  </th>
                  <th />
                  <th>
                    <button type="button" className="sortable" onClick={() => requestSort("attributes")}>
                      Attributes
                    </button>
                    {sortKey === "attributes" && (
                      <button type="button" className="sort-arrow" onClick={() => requestSort("attributes")}>
                          {sortDirection === "asc" ? "▲" : "▼"}
                      </button>
                    )}
                  </th>
                </tr>
              </thead>
              <tbody>
                {groupedResults.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="empty-cell">
                      {status || "No results available."}
                    </td>
                  </tr>
                ) : (
                  groupedResults.flatMap((group) => [
                    <tr
                      key={`${group.key}-group`}
                      className="results-group"
                      onMouseEnter={() => prefetchUser(group.user)}
                      onMouseLeave={cancelPrefetch}
                    >
                      <td className="mono">
                        <div className="user-status">
                          <span
                            className={`user-status-dot ${
                              (group.freeSlots || 0) > 0 ? "user-status-ready" : "user-status-busy"
                            }`}
                            title={(group.freeSlots || 0) > 0 ? "Ready to download" : "Busy (no free slots)"}
                          />
                          <UserAvatar user={group.user} />
                          <button
                            type="button"
                            className="link-button"
                            title={`Browse ${group.user}'s files`}
                            onClick={(event) => {
                              event.stopPropagation();
                              navigate(`/user/${encodeURIComponent(group.user)}`);
                            }}
                          >
                            {group.user}
                          </button>
                        </div>
                      </td>
                      <td className="col-speed">{formatSpeed(group.speed)}</td>
                      <td className="mono">
                        <div className="results-folder">
                          <span className="results-icon">
                            <Folder size={14} strokeWidth={1.6} />
                          </span>
                          <span className="results-crumbs">{folderCrumbs(group.user, group.folder)}</span>
                        </div>
                      </td>
                      <td />
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
                        <td />
                        <td className="col-speed" />
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
      ) : (
        <section className="section recent-searches">
          <div className="section-header">
            <h2>{statusReady && recentSearches.length === 0 ? "Example searches" : "Recent searches"}</h2>
            {recentSearches.length > 0 ? (
              <button type="button" className="secondary-button" onClick={clearAllRecents}>
                Clear all
              </button>
            ) : null}
          </div>
          {recentSearches.length === 0 ? (
            statusReady && (
              <>
                <p className="example-hint">No recent searches yet. Try one of these to get started:</p>
                <div className="recent-list">
                  {EXAMPLE_SEARCHES.map((example) => (
                    <div
                      key={example}
                      className="recent-item"
                      role="button"
                      tabIndex={0}
                      onClick={() => runSearch(example)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          runSearch(example);
                        }
                      }}
                    >
                      <span className="recent-icon">
                        <Search size={15} strokeWidth={1.7} />
                      </span>
                      <span className="recent-term">{example}</span>
                      <span className="recent-count">example</span>
                    </div>
                  ))}
                </div>
              </>
            )
          ) : (
            <div className="recent-list">
              {recentSearches.map((entry) => (
                <div
                  key={entry.term}
                  className="recent-item"
                  role="button"
                  tabIndex={0}
                  onClick={() => openRecent(entry)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      openRecent(entry);
                    }
                  }}
                >
                  <span className="recent-icon">
                    <Search size={15} strokeWidth={1.7} />
                  </span>
                  <span className="recent-term">{entry.term}</span>
                  <span className="recent-count">{entry.results} files</span>
                  <span className="recent-time">{timeAgo(entry.started_at)}</span>
                  <button
                    type="button"
                    className="recent-remove icon-button"
                    aria-label={`Remove ${entry.term}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      removeRecent(entry.term);
                    }}
                  >
                    <X size={15} strokeWidth={1.7} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
