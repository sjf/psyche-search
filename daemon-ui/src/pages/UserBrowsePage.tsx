import { ChevronRight, Download, X } from "lucide-react";
import { ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import FileTree, { FileNode, formatSize } from "../components/FileTree";
import { useToast } from "../state/toast";

interface BrowseProgress {
  position: number;
  total: number;
}

type BrowseStatus = "loading" | "ready" | "not_found" | "error";

function collectFiles(node: FileNode): FileNode[] {
  if (node.type === "file") {
    return [node];
  }
  return (node.children || []).flatMap(collectFiles);
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
  const [reloadKey, setReloadKey] = useState(0);
  const [expandedState, setExpandedState] = useState<Record<string, boolean>>({});
  const bodyRef = useRef<HTMLDivElement>(null);
  const pollRef = useRef<number | null>(null);

  useEffect(() => {
    let active = true;
    let attempts = 0;
    setStatus("loading");
    setTree([]);
    setProgress(null);
    setExpandedState({});

    const load = async () => {
      try {
        const response = await fetch(`/api/user/${encodeURIComponent(username)}/tree.json`);
        if (!response.ok) {
          if (active) {
            setStatus("error");
          }
          return;
        }
        const data = (await response.json()) as {
          status: BrowseStatus;
          tree?: FileNode | null;
          progress?: BrowseProgress | null;
        };
        if (!active) {
          return;
        }
        if (data.status === "ready") {
          setTree(data.tree?.children || []);
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
        setStatus(data.status);
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
  }, [username, reloadKey]);

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

  // Scroll the current folder so it sits just under the pinned bar.
  useEffect(() => {
    if (status !== "ready" || !currentPath) {
      return;
    }
    const el = bodyRef.current?.querySelector(".tree-row-selected");
    if (el) {
      el.scrollIntoView({ block: "start" });
    }
  }, [status, currentPath, expandedState, tree]);

  const retry = () => setReloadKey((key) => key + 1);

  const navigateToFolder = useCallback(
    (path: string) => {
      setSearchParams(path ? { path } : {});
    },
    [setSearchParams]
  );

  const handleToggle = useCallback((node: FileNode) => {
    if (node.type !== "dir") {
      return;
    }
    setExpandedState((prev) => ({ ...prev, [node.id]: !(prev[node.id] ?? false) }));
  }, []);

  const handleActivate = useCallback(
    (node: FileNode) => {
      if (node.type === "dir") {
        navigateToFolder(String(node.path || node.id));
      }
    },
    [navigateToFolder]
  );

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
            onClick={(event) => {
              event.stopPropagation();
              const files = collectFiles(node);
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
    [addToast, download]
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
        <button
          type="button"
          className="icon-button ghost-button"
          aria-label="Back to search"
          title="Back to search"
          onClick={() => navigate("/search")}
        >
          <X size={18} strokeWidth={1.6} />
        </button>
        <nav className="browse-crumbs" aria-label="Location">
          <button type="button" className="link-button browse-crumb-user" onClick={() => navigateToFolder("")}>
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
      </div>

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
              onSelect={() => {}}
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
