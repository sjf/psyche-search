import { FileText, Folder, FolderOpen, Music2, Play, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch } from "../api";
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
    depth = 0
  }: {
    node: FileNode;
    selectedId: string | null;
    onSelect: (node: FileNode) => void;
    depth?: number;
  }) {
  const [expanded, setExpanded] = useState(true);
  const isDir = node.type === "dir";
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
        <button
          type="button"
          className="tree-icon-button"
          onClick={(event) => {
            event.stopPropagation();
            if (isDir) {
              setExpanded((prev) => !prev);
            }
          }}
          aria-label={expanded ? "Collapse folder" : "Expand folder"}
        >
          {icon}
        </button>
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
  const [showRename, setShowRename] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [showDelete, setShowDelete] = useState(false);
  const { playTrack, enqueue } = usePlayer();
  const { setContent } = useFooter();
  const { addToast } = useToast();

  useEffect(() => {
    let active = true;

    const load = async (searchValue: string) => {
      const params = new URLSearchParams();
      if (searchValue) {
        params.set("search", searchValue);
      }
      const url = `/files/tree.json${params.toString() ? `?${params.toString()}` : ""}`;
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
      } catch {
        if (active) {
          setTree([]);
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
    src: node.path ? `/media?path=${encodeURIComponent(String(node.path))}` : undefined
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
        const response = await apiFetch("/files/rename", {
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
        const response = await apiFetch("/files/delete", {
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
      const response = await fetch(`/media/meta?path=${encodeURIComponent(path)}`);
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
      src: selectedNode.path ? `/media?path=${encodeURIComponent(String(selectedNode.path))}` : undefined
    });
  }, [addToast, enqueue, selectedNode, verifyMediaAccess]);

  const footerContent = useMemo(() => {
    if (!selectedNode || selectedNode.type !== "file") {
      return null;
    }
    const fullPath = selectedNode.path ? String(selectedNode.path) : selectedNode.name;
    const pathParts = fullPath.split(/[/\\]/);
    const parentDir = pathParts.length > 1 ? pathParts[pathParts.length - 2] : "";
    const fileLabel = parentDir ? `${parentDir}/${selectedNode.name}` : selectedNode.name;
    return (
      <div className="file-actions">
        <div className="file-actions-info">
          <span className="file-actions-title">{fileLabel}</span>
        </div>
        <div className="file-actions-buttons">
          <button type="button" className="outline-button" onClick={handlePlay} aria-label="Play">
            <Play size={16} strokeWidth={1.6} />
          </button>
          <button type="button" className="outline-button" onClick={handleQueue}>
            Add to queue
          </button>
          <button
            type="button"
            className="ghost-button"
            onClick={() => {
              setRenameValue(selectedNode.name);
              setShowRename(true);
            }}
          >
            Rename
          </button>
          <button
            type="button"
            className="icon-button danger-button"
            onClick={() => setShowDelete(true)}
            aria-label="Delete"
          >
            <Trash2 size={16} strokeWidth={1.6} />
          </button>
        </div>
      </div>
    );
  }, [handlePlay, handleQueue, selectedNode]);

  useEffect(() => {
    setContent(footerContent);
    return () => setContent(null);
  }, [footerContent, setContent]);

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>Files</h1>
        </div>
        <button type="button" className="ghost-button" onClick={() => setShowModal(true)}>
          Configure directories
        </button>
      </header>

      <SearchBar
        value={query}
        placeholder="Search files"
        onChange={setQuery}
        onSubmit={() => {}}
      />

      <section className="section">
        <div className="section-header">
          <h2>File Browser</h2>
        </div>
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
                />
              ))
            )}
          </div>
        </div>
      </section>

      {showModal && (
        <div className="modal-overlay" role="dialog" aria-modal="true">
          <div className="modal">
            <div className="modal-header">
              <h2>Directories</h2>
              <button
                type="button"
                className="ghost-button icon-button"
                onClick={() => setShowModal(false)}
                aria-label="Close"
              >
                <X size={18} strokeWidth={1.6} />
              </button>
            </div>
            <div className="modal-body">
              <div className="modal-section">
                <label className="field-label">Download directory</label>
                <div className="field-row">
                  <input type="text" defaultValue="/mnt/media/downloads" />
                  <button type="button" disabled>
                    Change
                  </button>
                </div>
              </div>
              <div className="modal-section">
                <label className="field-label">Shared directories</label>
                <div className="field-row">
                  <input type="text" placeholder="/mnt/media/music" />
                  <button type="button" disabled>
                    Add
                  </button>
                </div>
                <div className="modal-list">
                  <div className="modal-list-item">
                    /mnt/media/music
                    <button type="button" className="ghost-button" disabled>
                      Remove
                    </button>
                  </div>
                  <div className="modal-list-item">
                    /mnt/media/ambient
                    <button type="button" className="ghost-button" disabled>
                      Remove
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {showRename && selectedNode && (
        <div className="modal-overlay" role="dialog" aria-modal="true">
          <div className="modal">
            <div className="modal-header">
              <h2>Rename {selectedNode.type === "dir" ? "folder" : "file"}</h2>
              <button
                type="button"
                className="ghost-button icon-button"
                onClick={() => setShowRename(false)}
                aria-label="Close"
              >
                <X size={18} strokeWidth={1.6} />
              </button>
            </div>
            <div className="modal-body">
              <input
                type="text"
                value={renameValue}
                onChange={(event) => setRenameValue(event.target.value)}
              />
              <div className="row-actions">
                <button type="button" onClick={handleRename}>
                  Save
                </button>
                <button type="button" className="ghost-button" onClick={() => setShowRename(false)}>
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showDelete && selectedNode && (
        <div className="modal-overlay" role="dialog" aria-modal="true">
          <div className="modal">
            <div className="modal-header">
              <h2>Delete file</h2>
              <button
                type="button"
                className="ghost-button icon-button"
                onClick={() => setShowDelete(false)}
                aria-label="Close"
              >
                <X size={18} strokeWidth={1.6} />
              </button>
            </div>
            <div className="modal-body">
              <p>
                Are you sure you want to delete <strong>{selectedNode.name}</strong>?
              </p>
              <div className="row-actions">
                <button type="button" className="danger-button" onClick={handleDelete}>
                  Delete
                </button>
                <button type="button" className="ghost-button" onClick={() => setShowDelete(false)}>
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
