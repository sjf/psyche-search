import { ChevronUp } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "../api";
import FileTree, { FileNode } from "./FileTree";
import Modal from "./Modal";

interface DirectoryPickerProps {
  open: boolean;
  title: string;
  initialPath?: string;
  onClose: () => void;
  onSelect: (path: string) => void;
}

interface ListResponse {
  path: string;
  parent: string | null;
  entries: { name: string; path: string }[];
}

const toNode = (entry: { name: string; path: string }): FileNode => ({
  id: entry.path,
  name: entry.name,
  type: "dir",
  path: entry.path,
  children: []
});

const setChildren = (nodes: FileNode[], targetId: string, children: FileNode[]): FileNode[] =>
  nodes.map((node) => {
    if (node.id === targetId) {
      return { ...node, children };
    }
    if (node.children && node.children.length) {
      return { ...node, children: setChildren(node.children, targetId, children) };
    }
    return node;
  });

export default function DirectoryPicker({
  open,
  title,
  initialPath,
  onClose,
  onSelect
}: DirectoryPickerProps) {
  const [basePath, setBasePath] = useState("");
  const [parentPath, setParentPath] = useState<string | null>(null);
  const [nodes, setNodes] = useState<FileNode[]>([]);
  const [expandedState, setExpandedState] = useState<Record<string, boolean>>({});
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState<Record<string, boolean>>({});

  const list = useCallback(async (path: string): Promise<ListResponse | null> => {
    const params = new URLSearchParams();
    if (path) {
      params.set("path", path);
    }
    const response = await apiFetch(`/api/fs/list${params.toString() ? `?${params.toString()}` : ""}`);
    if (!response.ok) {
      throw new Error("Could not open directory.");
    }
    return (await response.json()) as ListResponse;
  }, []);

  const navigateTo = useCallback(
    async (path: string) => {
      setLoading(true);
      setError("");
      try {
        const data = await list(path);
        if (!data) {
          return;
        }
        setBasePath(data.path);
        setParentPath(data.parent);
        setNodes(data.entries.map(toNode));
        setExpandedState({});
        setLoaded({});
        setSelectedPath(data.path);
      } catch {
        setError("Could not open that folder.");
      } finally {
        setLoading(false);
      }
    },
    [list]
  );

  useEffect(() => {
    if (open) {
      navigateTo(initialPath || "");
    }
  }, [open, initialPath, navigateTo]);

  const handleToggle = useCallback(
    async (node: FileNode) => {
      const willExpand = !(expandedState[node.id] ?? false);
      setExpandedState((prev) => ({ ...prev, [node.id]: willExpand }));
      if (willExpand && !loaded[node.id] && node.path) {
        try {
          const data = await list(node.path);
          if (data) {
            setNodes((prev) => setChildren(prev, node.id, data.entries.map(toNode)));
            setLoaded((prev) => ({ ...prev, [node.id]: true }));
          }
        } catch {
          setError("Could not open that folder.");
        }
      }
    },
    [expandedState, list, loaded]
  );

  const footer = (
    <>
      <button type="button" onClick={() => selectedPath && onSelect(selectedPath)} disabled={!selectedPath}>
        Select folder
      </button>
      <button type="button" className="ghost-button" onClick={onClose}>
        Cancel
      </button>
    </>
  );

  return (
    <Modal open={open} title={title} onClose={onClose} className="directory-picker" footer={footer}>
      <div className="dir-picker-bar">
        <button
          type="button"
          className="ghost-button icon-button"
          aria-label="Parent folder"
          disabled={!parentPath || loading}
          onClick={() => parentPath && navigateTo(parentPath)}
        >
          <ChevronUp size={16} strokeWidth={1.7} />
        </button>
        <span className="dir-picker-path" title={basePath}>
          {basePath || "…"}
        </span>
      </div>
      <div className="dir-picker-body tree-panel">
        {error ? (
          <div className="empty-state">{error}</div>
        ) : nodes.length === 0 ? (
          <div className="empty-state">{loading ? "Loading…" : "No subfolders here."}</div>
        ) : (
          nodes.map((node) => (
            <FileTree
              key={node.id}
              node={node}
              selectedId={selectedPath}
              onSelect={(selected) => selected.path && setSelectedPath(String(selected.path))}
              expandedState={expandedState}
              onToggle={handleToggle}
              defaultExpanded={false}
            />
          ))
        )}
      </div>
    </Modal>
  );
}
