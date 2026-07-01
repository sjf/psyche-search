import { ChevronRight, FileText, Folder, FolderOpen, Music2 } from "lucide-react";
import { ReactNode } from "react";

export interface FileNode {
  id: string;
  name: string;
  type: "dir" | "file" | "root";
  size?: number | string;
  path?: string | null;
  user?: string;
  children?: FileNode[];
}

export function formatSize(bytes: number) {
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

interface FileTreeProps {
  node: FileNode;
  selectedId: string | null;
  onSelect: (node: FileNode) => void;
  expandedState: Record<string, boolean>;
  onToggle: (node: FileNode) => void;
  depth?: number;
  defaultExpanded?: boolean;
  renderActions?: (node: FileNode) => ReactNode;
}

export default function FileTree({
  node,
  selectedId,
  onSelect,
  expandedState,
  onToggle,
  depth = 0,
  defaultExpanded = true,
  renderActions
}: FileTreeProps) {
  const isDir = node.type === "dir";
  const expanded = isDir ? expandedState[node.id] ?? defaultExpanded : false;
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
        className={`tree-row ${isSelected ? "tree-row-selected" : ""} ${isTopLevel ? "tree-row-top" : ""}`}
        onClick={(event) => {
          event.stopPropagation();
          onSelect(node);
          if (isDir) {
            onToggle(node);
          }
        }}
      >
        {isDir ? (
          <>
            <span
              className={`tree-caret${expanded ? " tree-caret-open" : ""}`}
              onClick={(event) => {
                event.stopPropagation();
                onToggle(node);
              }}
              aria-hidden="true"
            >
              <ChevronRight size={13} strokeWidth={2.2} />
            </span>
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
          </>
        ) : (
          <>
            <span className="tree-caret-spacer" aria-hidden="true" />
            <span className="tree-icon">{icon}</span>
          </>
        )}
        <span className="tree-label">{node.name}</span>
        {displaySize && <span className="tree-meta">{displaySize}</span>}
        {renderActions ? <span className="tree-actions">{renderActions(node)}</span> : null}
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
              defaultExpanded={defaultExpanded}
              renderActions={renderActions}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
