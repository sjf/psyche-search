import { ArrowLeft, ChevronRight, Download } from "lucide-react";
import { ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import FileTree, { FileNode, formatSize, MUSIC_FILE_RE } from "../components/FileTree";
import { fetchUserInfo, hueFor, invalidateUserInfo, userInitials, UserInfo } from "../components/UserAvatar";
import { useToast } from "../state/toast";

interface BrowseProgress {
  position: number;
  total: number;
}

type BrowseStatus = "loading" | "ready" | "not_found" | "error";

interface TreeResponse {
  status: BrowseStatus | "too_large";
  tree?: FileNode | null;
  progress?: BrowseProgress | null;
  truncated?: boolean;
}

function collectFiles(node: FileNode): FileNode[] {
  if (node.type === "file") {
    return [node];
  }
  return (node.children || []).flatMap(collectFiles);
}

interface ShareSummary {
  tracks: number;
  dirs: number;
  size: number;
}

function plural(count: number, word: string) {
  return count === 1 ? word : `${word}s`;
}

function countryFlag(code: string) {
  return code
    .toUpperCase()
    .replace(/[^A-Z]/g, "")
    .replace(/./g, (char) => String.fromCodePoint(127397 + char.charCodeAt(0)));
}

function countryName(code: string) {
  try {
    return new Intl.DisplayNames(["en"], { type: "region" }).of(code.toUpperCase()) || code;
  } catch {
    return code;
  }
}

function summarizeShares(tree: FileNode[]): ShareSummary {
  let tracks = 0;
  let dirs = 0;
  let size = 0;
  const walk = (node: FileNode) => {
    if (node.type === "dir") {
      dirs += 1;
      (node.children || []).forEach(walk);
      return;
    }
    if (node.type === "file") {
      size += Number(node.size) || 0;
      if (MUSIC_FILE_RE.test(node.name)) {
        tracks += 1;
      }
    }
  };
  tree.forEach(walk);
  return { tracks, dirs, size };
}

function BrowseUserProfile({
  username,
  infoKey,
  summary
}: {
  username: string;
  infoKey: number;
  summary: ShareSummary | null;
}) {
  const [info, setInfo] = useState<UserInfo | null>(null);
  const [imgFailed, setImgFailed] = useState(false);

  useEffect(() => {
    let active = true;
    setImgFailed(false);
    fetchUserInfo(username).then((result) => {
      if (active) {
        setInfo(result);
      }
    });
    return () => {
      active = false;
    };
  }, [username, infoKey]);

  const showPic = info?.status === "ready" && info.hasPic && !imgFailed;

  return (
    <section className="browse-profile">
      <span
        className="browse-profile-avatar"
        style={showPic ? undefined : { backgroundColor: `hsl(${hueFor(username)} 45% 32%)` }}
      >
        {showPic ? (
          <img
            src={`/api/user/${encodeURIComponent(username)}/pic?v=${info?.cachedAt ?? 0}`}
            alt=""
            onError={() => setImgFailed(true)}
          />
        ) : (
          <span className="browse-profile-avatar-fallback">{userInitials(username)}</span>
        )}
      </span>
      <div className="browse-profile-meta">
        <h1 className="browse-profile-name">{username}</h1>
        {summary || info?.status === "ready" ? (
          <div className="browse-profile-stats">
            {info?.userStatus ? (
              <span className={`browse-profile-stat stat-${info.userStatus}`}>{info.userStatus}</span>
            ) : null}
            {info?.country ? (
              <span className="browse-profile-stat browse-profile-flag" title={countryName(info.country)}>
                {countryFlag(info.country)}
              </span>
            ) : null}
            {summary ? (
              <>
                <span className="browse-profile-stat">
                  <strong>{summary.tracks.toLocaleString()}</strong> {plural(summary.tracks, "track")}
                </span>
                <span className="browse-profile-stat">
                  <strong>{summary.dirs.toLocaleString()}</strong> {plural(summary.dirs, "folder")}
                </span>
                <span className="browse-profile-stat">
                  <strong>{formatSize(summary.size)}</strong> shared
                </span>
              </>
            ) : null}
            {info?.slotsFree === false ? (
              <span className="browse-profile-stat stat-bad">no free slots</span>
            ) : info?.slotsFree && info.totalUploads ? (
              <span className="browse-profile-stat stat-good">
                <strong>{info.totalUploads.toLocaleString()}</strong> {plural(info.totalUploads, "slot")} free
              </span>
            ) : info?.slotsFree ? (
              <span className="browse-profile-stat stat-good">slot free</span>
            ) : null}
            {info?.queueSize ? (
              <span className="browse-profile-stat">
                <strong>{info.queueSize.toLocaleString()}</strong> in queue
              </span>
            ) : null}
            {info?.avgSpeed ? (
              <span className="browse-profile-stat">
                <strong>{formatSize(info.avgSpeed)}/s</strong> avg speed
              </span>
            ) : null}
          </div>
        ) : null}
        {info?.description ? <p className="browse-profile-desc">{info.description}</p> : null}
      </div>
    </section>
  );
}

function hasUnloadedChildren(node: FileNode): boolean {
  if (node.type === "dir" && node.children === undefined && node.has_children) {
    return true;
  }
  return (node.children || []).some(hasUnloadedChildren);
}

// Fold freshly fetched nodes into what's already loaded: the server's listing
// wins, except a stub never clobbers children we already have.
function mergeChildren(existing: FileNode[] | undefined, incoming: FileNode[] | undefined): FileNode[] | undefined {
  if (!incoming) {
    return existing;
  }
  if (!existing) {
    return incoming;
  }
  const byId = new Map(existing.map((node) => [node.id, node]));
  return incoming.map((node) => {
    const prev = byId.get(node.id);
    if (!prev) {
      return node;
    }
    const children = mergeChildren(prev.children, node.children);
    return children === undefined ? { ...prev, ...node } : { ...prev, ...node, children };
  });
}

function findNodeByPath(nodes: FileNode[], path: string): FileNode | null {
  let found: FileNode | null = null;
  let level: FileNode[] | undefined = nodes;
  let accum = "";
  for (const part of path.split("\\").filter(Boolean)) {
    accum = accum ? `${accum}\\${part}` : part;
    found = (level || []).find((node) => node.type === "dir" && node.id === accum) || null;
    if (!found) {
      return null;
    }
    level = found.children;
  }
  return found;
}

export default function UserBrowsePage() {
  const { username: usernameParam } = useParams();
  const username = usernameParam || "";
  const [searchParams, setSearchParams] = useSearchParams();
  const currentPath = searchParams.get("path") || "";
  const navigate = useNavigate();
  const { addToast } = useToast();

  const [status, setStatus] = useState<BrowseStatus>("loading");
  const [tree, setTree] = useState<FileNode[]>([]);
  const [progress, setProgress] = useState<BrowseProgress | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [infoKey, setInfoKey] = useState(0);
  const [expandedState, setExpandedState] = useState<Record<string, boolean>>({});
  const bodyRef = useRef<HTMLDivElement>(null);
  const pollRef = useRef<number | null>(null);
  const initialScrollPending = useRef(true);
  const currentPathRef = useRef(currentPath);
  currentPathRef.current = currentPath;
  const spineRequestRef = useRef<string | null>(null);

  const fetchTree = useCallback(
    async (path: string, full = false) => {
      const params = new URLSearchParams();
      if (path) {
        params.set("path", path);
      }
      if (full) {
        params.set("full", "1");
      }
      const query = params.toString();
      const response = await fetch(`/api/user/${encodeURIComponent(username)}/tree.json${query ? `?${query}` : ""}`);
      if (!response.ok) {
        throw new Error("Tree request failed");
      }
      return (await response.json()) as TreeResponse;
    },
    [username]
  );

  useEffect(() => {
    let active = true;
    let attempts = 0;
    setStatus("loading");
    setTree([]);
    setTruncated(false);
    setProgress(null);
    setExpandedState({});
    spineRequestRef.current = null;

    const load = async () => {
      try {
        const data = await fetchTree(currentPathRef.current);
        if (!active) {
          return;
        }
        if (data.status === "ready") {
          setTree(data.tree?.children || []);
          setTruncated(!!data.truncated);
          setProgress(null);
          setStatus("ready");
          return;
        }
        if (data.status === "loading") {
          setProgress(data.progress && data.progress.total ? data.progress : null);
          if (attempts < 150) {
            attempts += 1;
            pollRef.current = window.setTimeout(load, 500);
            return;
          }
          setStatus("error");
          return;
        }
        setStatus(data.status === "not_found" ? "not_found" : "error");
      } catch {
        if (active) {
          setStatus("error");
        }
      }
    };

    load();

    return () => {
      active = false;
      if (pollRef.current) {
        window.clearTimeout(pollRef.current);
      }
    };
  }, [username, reloadKey, fetchTree]);

  // Expand the current path (and its ancestors) so the target folder is visible.
  useEffect(() => {
    if (status !== "ready" || !currentPath) {
      return;
    }
    const parts = currentPath.split("\\").filter(Boolean);
    const ancestors: Record<string, boolean> = {};
    let accum = "";
    for (const part of parts) {
      accum = accum ? `${accum}\\${part}` : part;
      ancestors[accum] = true;
    }
    setExpandedState((prev) => ({ ...prev, ...ancestors }));
  }, [status, currentPath, tree]);

  // On a deep link (arriving with ?path=), scroll the target folder so it
  // sits just under the pinned bar — once. Folder clicks within the page
  // change the path too, but must not scroll.
  useEffect(() => {
    initialScrollPending.current = true;
  }, [username]);

  useEffect(() => {
    if (status !== "ready" || !initialScrollPending.current) {
      return;
    }
    if (!currentPath) {
      initialScrollPending.current = false;
      return;
    }
    const el = bodyRef.current?.querySelector(".tree-row-selected");
    if (el) {
      el.scrollIntoView({ block: "start" });
      initialScrollPending.current = false;
    }
  }, [status, currentPath, expandedState, tree]);

  // Opening a user's page/file listing: refresh their cached profile info
  // (picture, description, slots) from the peer. The refresh endpoint returns
  // before the peer answers, so poll until the server cache advances (or we
  // give up), then drop the stale client cache and re-render the profile.
  useEffect(() => {
    if (!username) {
      return;
    }
    let active = true;
    const infoUrl = `/api/user/${encodeURIComponent(username)}/info`;
    const cachedAt = async () => {
      const data = (await (await fetch(infoUrl)).json()) as { status?: string; cached_at?: number };
      return data.status === "ready" ? data.cached_at || 0 : 0;
    };
    (async () => {
      let before = 0;
      try {
        before = await cachedAt();
      } catch {}
      try {
        await fetch(`${infoUrl}/refresh`, { method: "POST" });
      } catch {}
      for (let attempt = 0; attempt < 10 && active; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 1500));
        try {
          if ((await cachedAt()) > before) {
            break;
          }
        } catch {
          break;
        }
      }
      if (active) {
        invalidateUserInfo(username);
        setInfoKey((key) => key + 1);
      }
    })();
    return () => {
      active = false;
    };
  }, [username]);

  const retry = () => setReloadKey((key) => key + 1);

  const loadFolder = useCallback(
    async (path: string) => {
      try {
        const data = await fetchTree(path);
        if (data.status === "ready" && data.tree) {
          const children = data.tree.children || [];
          setTree((prev) => mergeChildren(prev, children) || prev);
          return true;
        }
      } catch {
        // fall through to the toast
      }
      addToast("Could not load folder.", "error");
      return false;
    },
    [addToast, fetchTree]
  );

  // In a pruned (lazy) listing the folder from the URL may not be loaded yet;
  // fetch its spine once the top of the tree is in.
  useEffect(() => {
    if (status !== "ready" || !currentPath) {
      return;
    }
    const node = findNodeByPath(tree, currentPath);
    if (node && (node.children !== undefined || !node.has_children)) {
      return;
    }
    if (spineRequestRef.current === currentPath) {
      return;
    }
    spineRequestRef.current = currentPath;
    loadFolder(currentPath);
  }, [status, currentPath, tree, loadFolder]);

  const navigateToFolder = useCallback(
    (path: string) => {
      setSearchParams(path ? { path } : {});
    },
    [setSearchParams]
  );

  const handleToggle = useCallback(
    (node: FileNode) => {
      if (node.type !== "dir") {
        return;
      }
      const expanding = !(expandedState[node.id] ?? false);
      setExpandedState((prev) => ({ ...prev, [node.id]: !(prev[node.id] ?? false) }));
      if (expanding && node.children === undefined && node.has_children) {
        loadFolder(String(node.path || node.id)).then((ok) => {
          if (!ok) {
            setExpandedState((prev) => ({ ...prev, [node.id]: false }));
          }
        });
      }
    },
    [expandedState, loadFolder]
  );

  const handleActivate = useCallback(
    (node: FileNode) => {
      if (node.type === "dir") {
        navigateToFolder(String(node.path || node.id));
      }
    },
    [navigateToFolder]
  );

  const goBack = useCallback(() => {
    if (window.history.state && window.history.state.idx > 0) {
      navigate(-1);
    } else {
      navigate("/search");
    }
  }, [navigate]);

  const download = useCallback(
    async (path: string, size: number) => {
      if (!path) {
        addToast("Download failed.", "error");
        return;
      }
      const params = new URLSearchParams();
      params.set("user", username);
      params.set("path", path);
      params.set("size", String(size || 0));
      try {
        const response = await fetch("/api/download", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: params.toString()
        });
        addToast(response.ok ? "Download queued." : "Download failed.", response.ok ? "success" : "error");
      } catch {
        addToast("Download failed.", "error");
      }
    },
    [addToast, username]
  );

  const handleSelect = useCallback(
    (node: FileNode) => {
      if (node.type === "file") {
        download(String(node.path || ""), Number(node.size) || 0);
      }
    },
    [download]
  );

  const renderActions = useCallback(
    (node: FileNode): ReactNode => {
      if (node.type === "file") {
        return (
          <button
            type="button"
            className="icon-button icon-button-small icon-button-plain"
            aria-label="Download file"
            title="Download file"
            onClick={(event) => {
              event.stopPropagation();
              download(String(node.path || ""), Number(node.size) || 0);
            }}
          >
            <Download size={16} strokeWidth={1.6} />
          </button>
        );
      }
      if (node.type === "dir") {
        return (
          <button
            type="button"
            className="icon-button icon-button-small icon-button-plain"
            aria-label="Download folder"
            title="Download folder"
            onClick={async (event) => {
              event.stopPropagation();
              let target = node;
              if (hasUnloadedChildren(node)) {
                try {
                  const data = await fetchTree(String(node.path || node.id), true);
                  if (data.status === "too_large") {
                    addToast("Folder is too large to download at once.", "error");
                    return;
                  }
                  if (data.status !== "ready" || !data.tree) {
                    addToast("Download failed.", "error");
                    return;
                  }
                  target = data.tree;
                } catch {
                  addToast("Download failed.", "error");
                  return;
                }
              }
              const files = collectFiles(target);
              if (!files.length) {
                addToast("No files to download.", "error");
                return;
              }
              files.forEach((file) => download(String(file.path || ""), Number(file.size) || 0));
            }}
          >
            <Download size={16} strokeWidth={1.6} />
          </button>
        );
      }
      return null;
    },
    [addToast, download, fetchTree]
  );

  // A pruned (truncated) listing only contains the loaded spine, so client-side
  // share totals would be nonsense; skip the summary for those users.
  const summary = useMemo(
    () => (status === "ready" && tree.length && !truncated ? summarizeShares(tree) : null),
    [status, tree, truncated]
  );

  const crumbs = useMemo(() => {
    const parts = currentPath ? currentPath.split("\\").filter(Boolean) : [];
    const list: { label: string; path: string }[] = [];
    let accum = "";
    for (const part of parts) {
      accum = accum ? `${accum}\\${part}` : part;
      list.push({ label: part, path: accum });
    }
    return list;
  }, [currentPath]);

  return (
    <div className="page browse-page">
      <div className="browse-topbar">
        <nav className="browse-crumbs" aria-label="Location">
          <button
            type="button"
            className="link-button browse-crumb-user"
            onClick={() => {
              if (currentPath) {
                navigateToFolder("");
              }
              window.scrollTo(0, 0);
            }}
          >
            {username}
          </button>
          {crumbs.map((crumb) => (
            <span key={crumb.path} className="browse-crumb">
              <ChevronRight size={14} strokeWidth={1.6} className="crumb-chevron" />
              <button type="button" className="link-button" onClick={() => navigateToFolder(crumb.path)}>
                {crumb.label}
              </button>
            </span>
          ))}
        </nav>
        <button type="button" className="icon-button ghost-button" aria-label="Back" title="Back" onClick={goBack}>
          <ArrowLeft size={18} strokeWidth={1.6} />
        </button>
      </div>

      <BrowseUserProfile username={username} infoKey={infoKey} summary={summary} />

      <div className="browse-tree-body tree-panel" ref={bodyRef}>
        {status === "loading" ? (
          <div className="browse-loading">
            <div className="spinner" aria-hidden="true" />
            {progress ? (
              <>
                <div className="browse-progress">
                  <div
                    className="browse-progress-fill"
                    style={{ width: `${Math.min(100, Math.round((progress.position / progress.total) * 100))}%` }}
                  />
                </div>
                <span className="browse-loading-text">
                  Loading {username}'s files… {formatSize(progress.position)} / {formatSize(progress.total)} (
                  {Math.min(100, Math.round((progress.position / progress.total) * 100))}%)
                </span>
              </>
            ) : (
              <span className="browse-loading-text">Loading {username}'s files…</span>
            )}
          </div>
        ) : status === "not_found" ? (
          <div className="empty-state">
            {username} could not be found or is offline.
            <button type="button" className="link-button browse-retry" onClick={retry}>
              Retry
            </button>
          </div>
        ) : status === "error" ? (
          <div className="empty-state">
            Could not load {username}'s files.
            <button type="button" className="link-button browse-retry" onClick={retry}>
              Retry
            </button>
          </div>
        ) : tree.length === 0 ? (
          <div className="empty-state">{username} is not sharing any files.</div>
        ) : (
          tree.map((node) => (
            <FileTree
              key={node.id}
              node={node}
              selectedId={currentPath}
              onSelect={handleSelect}
              onActivate={handleActivate}
              expandedState={expandedState}
              onToggle={handleToggle}
              defaultExpanded={false}
              renderActions={renderActions}
            />
          ))
        )}
      </div>
    </div>
  );
}
