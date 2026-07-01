import { Download, X } from "lucide-react";
import { ReactNode, useCallback, useEffect, useRef, useState } from "react";
import FileTree, { FileNode, formatSize } from "./FileTree";
import { useToast } from "../state/toast";

interface BrowseProgress {
  position: number;
  total: number;
}

interface UserBrowsePaneProps {
  username: string;
  focusPath?: string;
  onClose: () => void;
}

type BrowseStatus = "loading" | "ready" | "not_found" | "error";

function collectFiles(node: FileNode): FileNode[] {
  if (node.type === "file") {
    return [node];
  }
  return (node.children || []).flatMap(collectFiles);
}

export default function UserBrowsePane({ username, focusPath, onClose }: UserBrowsePaneProps) {
  const { addToast } = useToast();
  const [status, setStatus] = useState<BrowseStatus>("loading");
  const [tree, setTree] = useState<FileNode[]>([]);
  const [progress, setProgress] = useState<BrowseProgress | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [expandedState, setExpandedState] = useState<Record<string, boolean>>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const pollRef = useRef<number | null>(null);

  useEffect(() => {
    let active = true;
    let attempts = 0;
    setStatus("loading");
    setTree([]);
    setProgress(null);
    setSelectedId(null);
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

  const retry = () => setReloadKey((key) => key + 1);

  useEffect(() => {
    if (status !== "ready" || !focusPath || focusPath === "(root)") {
      return;
    }
    const parts = focusPath.split("\\").filter(Boolean);
    const ancestors: Record<string, boolean> = {};
    let accum = "";
    for (const part of parts) {
      accum = accum ? `${accum}\\${part}` : part;
      ancestors[accum] = true;
    }
    setExpandedState((prev) => ({ ...prev, ...ancestors }));
    setSelectedId(focusPath);
  }, [status, focusPath, tree]);

  useEffect(() => {
    if (!selectedId) {
      return;
    }
    const el = bodyRef.current?.querySelector(".tree-row-selected");
    if (el) {
      el.scrollIntoView({ block: "center" });
    }
  }, [selectedId, expandedState, tree]);

  const handleToggle = useCallback((node: FileNode) => {
    if (node.type !== "dir") {
      return;
    }
    setExpandedState((prev) => ({ ...prev, [node.id]: !(prev[node.id] ?? false) }));
  }, []);

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

  return (
    <section className="section browse-pane">
      <div className="section-header browse-pane-header">
        <h2>Browsing {username}</h2>
        <button
          type="button"
          className="icon-button ghost-button"
          aria-label="Close browser"
          title="Back to results"
          onClick={onClose}
        >
          <X size={18} strokeWidth={1.6} />
        </button>
      </div>
      <div className="table-card">
        <div
          className="files-browser-body tree-panel"
          ref={bodyRef}
          onClick={() => setSelectedId(null)}
          role="presentation"
        >
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
                selectedId={selectedId}
                onSelect={(selected) => setSelectedId(selected.id)}
                expandedState={expandedState}
                onToggle={handleToggle}
                defaultExpanded={false}
                renderActions={renderActions}
              />
            ))
          )}
        </div>
      </div>
    </section>
  );
}
