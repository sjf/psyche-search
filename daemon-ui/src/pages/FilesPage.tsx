import { FileText, Folder, FolderOpen, Music2, Settings } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch } from "../api";
import FileActionBar from "../components/FileActionBar";
import DirectoriesModal from "../components/DirectoriesModal";
import Modal from "../components/Modal";
import SearchBar from "../components/SearchBar";
import { useFooter } from "../state/footer";
import { Track, usePlayer } from "../state/player";
import { useToast } from "../state/toast";

interface FileNode {
  id: string;
  name: string;
  type: "dir" | "file" | "root";
  size?: number | string;
  path?: string | null;
  children?: FileNode[];
}

  function FileTree({
    node,
    selectedId,
    onSelect,
    expandedState,
    onToggle,
    depth = 0
  }: {
    node: FileNode;
    selectedId: string | null;
    onSelect: (node: FileNode) => void;
    expandedState: Record<string, boolean>;
    onToggle: (node: FileNode) => void;
    depth?: number;
  }) {
  const isDir = node.type === "dir";
  const expanded = isDir ? expandedState[node.id] ?? true : false;
  const isSelected = selectedId === node.id;
  const icon =
    node.type === "dir"
      ? expanded
        ? <FolderOpen size={16} strokeWidth={1.6} />
        : <Folder size={16} strokeWidth={1.6} />
      : node.name.match(/\.(mp3|flac|ogg|opus|wav|aac|m4a|wma|alac|aiff|ape)$/i)
        ? <Music2 size={16} strokeWidth={1.6} />
        : <FileText size={16} strokeWidth={1.6} />;

  const displaySize =
    typeof node.size === "number" ? formatSize(node.size) : typeof node.size === "string" ? node.size : null;

    const isTopLevel = depth === 0 && node.type === "dir";

    return (
      <div className="tree-item">
        <div
          className={`tree-row ${isSelected ? "tree-row-selected" : ""} ${
            isTopLevel ? "tree-row-top" : ""
          }`}
          onClick={(event) => {
            event.stopPropagation();
            onSelect(node);
          }}
        >
        {isDir ? (
          <button
            type="button"
            className="tree-icon-button"
            onClick={(event) => {
              event.stopPropagation();
              onToggle(node);
            }}
            aria-label={expanded ? "Collapse folder" : "Expand folder"}
          >
            {icon}
          </button>
        ) : (
          <span className="tree-icon">{icon}</span>
        )}
        <span className="tree-label">{node.name}</span>
        {displaySize && <span className="tree-meta">{displaySize}</span>}
      </div>
      {isDir && expanded && node.children?.length ? (
        <div className="tree-children">
          {node.children.map((child) => (
            <FileTree
              key={child.id}
              node={child}
              selectedId={selectedId}
              onSelect={onSelect}
              expandedState={expandedState}
              onToggle={onToggle}
              depth={depth + 1}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
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

export default function FilesPage() {
  const [query, setQuery] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [tree, setTree] = useState<FileNode[]>([]);
  const [selectedNode, setSelectedNode] = useState<FileNode | null>(null);
  const [downloadDir, setDownloadDir] = useState("");
  const [sharedDirs, setSharedDirs] = useState<string[]>([]);
  const [expandedState, setExpandedState] = useState<Record<string, boolean>>(() => {
    try {
      const raw = window.localStorage.getItem("filesTreeExpanded");
      if (!raw) {
        return {};
      }
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") {
        return parsed as Record<string, boolean>;
      }
    } catch {
      // Ignore invalid storage.
    }
    return {};
  });
  const [showRename, setShowRename] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [showDelete, setShowDelete] = useState(false);
  const { playTrack, enqueue } = usePlayer();
  const { setContent } = useFooter();
  const { addToast } = useToast();

  useEffect(() => {
    try {
      window.localStorage.setItem("filesTreeExpanded", JSON.stringify(expandedState));
    } catch {
      // Ignore storage failures.
    }
  }, [expandedState]);

  useEffect(() => {
    let active = true;

    const load = async (searchValue: string) => {
      const params = new URLSearchParams();
      if (searchValue) {
        params.set("search", searchValue);
      }
      const url = `/api/files/tree.json${params.toString() ? `?${params.toString()}` : ""}`;
      try {
        const response = await fetch(url);
        if (!response.ok) {
          return;
        }
        const data = await response.json();
        if (!active) {
          return;
        }
        const treeData = data?.tree?.children || [];
        setTree(treeData);
        const downloadsNode = treeData.find(
          (node: FileNode) => node.type === "dir" && node.id !== "shared" && node.path
        );
        setDownloadDir(downloadsNode?.path ? String(downloadsNode.path) : "");
        const sharedNode = treeData.find((node: FileNode) => node.id === "shared");
        const sharedPaths =
          sharedNode?.children
            ?.map((node: FileNode) => (node.path ? String(node.path) : null))
            .filter((value: string | null): value is string => Boolean(value)) || [];
        setSharedDirs(sharedPaths);
      } catch {
        if (active) {
          setTree([]);
          setDownloadDir("");
          setSharedDirs([]);
        }
      }
    };

    load(query.trim());

    return () => {
      active = false;
    };
  }, [query]);

  const filteredTree = useMemo(() => {
    if (!query.trim()) {
      return tree;
    }
    const normalized = query.toLowerCase();

    const filterNode = (node: FileNode): FileNode | null => {
      const matches = node.name.toLowerCase().includes(normalized);
      if (node.type === "file") {
        return matches ? node : null;
      }
      const children = node.children
        ?.map(filterNode)
        .filter((child): child is FileNode => child !== null);
      if (matches || (children && children.length)) {
        return { ...node, children: children || [] };
      }
      return null;
    };

    return tree.map(filterNode).filter((node): node is FileNode => node !== null);
  }, [query, tree]);

  const updateNodeName = (nodes: FileNode[], targetId: string, newName: string): FileNode[] =>
    nodes.map((node) => {
      if (node.id === targetId) {
        return { ...node, name: newName };
      }
      if (node.children) {
        return { ...node, children: updateNodeName(node.children, targetId, newName) };
      }
      return node;
    });

  const removeNode = (nodes: FileNode[], targetId: string): FileNode[] =>
    nodes
      .filter((node) => node.id !== targetId)
      .map((node) => ({
        ...node,
        children: node.children ? removeNode(node.children, targetId) : undefined
      }));

  const toTrack = (node: FileNode): Track => ({
    id: node.id,
    title: node.name,
    path: node.path ?? undefined,
    src: node.path ? `/api/media?path=${encodeURIComponent(String(node.path))}` : undefined
  });

  const findDirectoryTracks = (
    nodes: FileNode[],
    targetId: string
  ): { tracks: Track[]; index: number } | null => {
    for (const node of nodes) {
      if (node.children && node.children.length) {
        const fileChildren = node.children.filter((child) => child.type === "file");
        const matchIndex = fileChildren.findIndex((child) => child.id === targetId);
        if (matchIndex >= 0) {
          return {
            tracks: fileChildren.map(toTrack),
            index: matchIndex
          };
        }
        const nested = findDirectoryTracks(node.children, targetId);
        if (nested) {
          return nested;
        }
      }
    }
    return null;
  };

  const handleRename = async () => {
    if (!selectedNode || !renameValue.trim()) {
      return;
    }
    if (selectedNode.path) {
      const params = new URLSearchParams();
      params.set("path", String(selectedNode.path));
      params.set("name", renameValue.trim());
      try {
      const response = await apiFetch("/api/files/rename", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: params.toString()
        });
        if (!response.ok) {
          addToast("Rename failed.");
          return;
        }
      } catch {
        addToast("Rename failed.");
        return;
      }
    } else {
      addToast("Rename failed.");
      return;
    }
    setTree((prev) => updateNodeName(prev, selectedNode.id, renameValue.trim()));
    setSelectedNode((prev) => (prev ? { ...prev, name: renameValue.trim() } : prev));
    setShowRename(false);
  };

  const handleDelete = async () => {
    if (!selectedNode) {
      return;
    }
    if (selectedNode.path) {
      const params = new URLSearchParams();
      params.set("path", String(selectedNode.path));
      try {
      const response = await apiFetch("/api/files/delete", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: params.toString()
        });
        if (!response.ok) {
          addToast("Delete failed.");
          return;
        }
      } catch {
        addToast("Delete failed.");
        return;
      }
    } else {
      addToast("Delete failed.");
      return;
    }
    setTree((prev) => removeNode(prev, selectedNode.id));
    setSelectedNode(null);
    setShowDelete(false);
  };

  const verifyMediaAccess = useCallback(async (path: string, failureMessage: string) => {
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
  }, [addToast]);

  const handlePlay = useCallback(async () => {
    if (!selectedNode || selectedNode.type !== "file") {
      return;
    }
    if (!selectedNode.path) {
      addToast("File not found.");
      return;
    }
    const ok = await verifyMediaAccess(String(selectedNode.path), "Playback failed.");
    if (!ok) {
      return;
    }
    const directoryContext = findDirectoryTracks(tree, selectedNode.id);
    if (directoryContext) {
      playTrack(toTrack(selectedNode), {
        directoryTracks: directoryContext.tracks,
        directoryIndex: directoryContext.index
      });
    } else {
      playTrack(toTrack(selectedNode));
    }
  }, [addToast, playTrack, selectedNode, tree, verifyMediaAccess]);

  const handleQueue = useCallback(async () => {
    if (!selectedNode || selectedNode.type !== "file") {
      return;
    }
    if (!selectedNode.path) {
      addToast("File not found.");
      return;
    }
    const ok = await verifyMediaAccess(String(selectedNode.path), "Add to queue failed.");
    if (!ok) {
      return;
    }
    enqueue({
      id: selectedNode.id,
      title: selectedNode.name,
      path: selectedNode.path ?? undefined,
      src: selectedNode.path ? `/api/media?path=${encodeURIComponent(String(selectedNode.path))}` : undefined
    });
  }, [addToast, enqueue, selectedNode, verifyMediaAccess]);

  const footerContent = useMemo(() => {
    if (!selectedNode || selectedNode.type !== "file") {
      return null;
    }
    const fullPath = selectedNode.path ? String(selectedNode.path) : selectedNode.name;
    const pathParts = fullPath.split(/[/\\]/);
    const parentDir = pathParts.length > 1 ? pathParts[pathParts.length - 2] : "";
    const fileLabel = selectedNode.name;
    const filePath = parentDir ? `${parentDir}/${selectedNode.name}` : selectedNode.name;
    return (
      <FileActionBar
        fileName={fileLabel}
        filePath={filePath}
        mediaPath={selectedNode.path ? String(selectedNode.path) : undefined}
        onPlay={handlePlay}
        onQueue={handleQueue}
        onRename={() => {
          setRenameValue(selectedNode.name);
          setShowRename(true);
        }}
        onDelete={() => setShowDelete(true)}
      />
    );
  }, [handlePlay, handleQueue, selectedNode]);

  useEffect(() => {
    setContent(footerContent);
    return () => setContent(null);
  }, [footerContent, setContent]);

  return (
    <div className="page files-page">
      <header className="page-header">
        <div>
          <h1>Files</h1>
          <p className="page-subtitle">Browse and manage shared and downloaded files.</p>
        </div>
      </header>

      <SearchBar
        value={query}
        placeholder="Search files"
        onChange={setQuery}
        onSubmit={() => {}}
        extraAction={
          <button
            type="button"
            className="icon-button ghost-button"
            aria-label="Configure directories"
            onClick={() => setShowModal(true)}
          >
            <Settings size={16} strokeWidth={1.6} />
          </button>
        }
      />

      <section className="section">
        <div
          className="files-browser-shell"
          onClick={() => setSelectedNode(null)}
          role="presentation"
        >
          <div className="files-browser-body tree-panel">
            {filteredTree.length === 0 ? (
              <div className="empty-state">No matches found.</div>
            ) : (
              filteredTree.map((node) => (
                <FileTree
                  key={node.id}
                  node={node}
                  selectedId={selectedNode?.id ?? null}
                  onSelect={(selected) => {
                    setSelectedNode(selected);
                  }}
                  expandedState={expandedState}
                  onToggle={(selected) => {
                    if (selected.type !== "dir") {
                      return;
                    }
                    setExpandedState((prev) => {
                      const isExpanded = prev[selected.id] ?? true;
                      return {
                        ...prev,
                        [selected.id]: !isExpanded
                      };
                    });
                  }}
                />
              ))
            )}
          </div>
        </div>
      </section>

      <DirectoriesModal
        open={showModal}
        onClose={() => setShowModal(false)}
        downloadDir={downloadDir}
        sharedDirs={sharedDirs}
      />

      <Modal
        open={showRename && Boolean(selectedNode)}
        title={`Rename ${selectedNode?.type === "dir" ? "folder" : "file"}`}
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
        open={showDelete && Boolean(selectedNode)}
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
        <div className="mono">{selectedNode?.path || selectedNode?.name}</div>
        <p>Are you sure you want to delete this file?</p>
      </Modal>
    </div>
  );
}
