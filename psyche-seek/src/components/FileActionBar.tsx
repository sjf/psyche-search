import { ExternalLink, FileText, FolderOpen, Play, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

const AUDIO_EXTENSIONS = /\.(mp3|flac|ogg|opus|wav|aac|m4a|wma|alac|aiff|ape)$/i;

interface FileActionBarProps {
  fileName: string;
  filePath: string;
  mediaPath?: string;
  notice?: string;
  statusText?: string;
  onClear?: () => void;
  showClear?: boolean;
  onPlay: () => void;
  onQueue: () => void;
  onRename: () => void;
  onDelete: () => void;
  onReveal?: () => void;
  onOpen?: () => void;
  disablePlay?: boolean;
  disableQueue?: boolean;
  showRename?: boolean;
  showDelete?: boolean;
  showReveal?: boolean;
  showOpen?: boolean;
}

export default function FileActionBar({
  fileName,
  filePath,
  mediaPath,
  notice,
  statusText,
  onClear,
  showClear = false,
  onPlay,
  onQueue,
  onRename,
  onDelete,
  onReveal,
  onOpen,
  disablePlay = false,
  disableQueue = false,
  showRename = true,
  showDelete = true,
  showReveal = false,
  showOpen = false
}: FileActionBarProps) {
  const [metadata, setMetadata] = useState<{
    artist?: string;
    title?: string;
    album?: string;
    year?: string;
  } | null>(null);
  const metadataCache = useMemo(
    () => new Map<string, { artist?: string; title?: string; album?: string; year?: string } | null>(),
    []
  );

  useEffect(() => {
    if (!mediaPath) {
      setMetadata(null);
      return;
    }
    if (metadataCache.has(mediaPath)) {
      setMetadata(metadataCache.get(mediaPath) ?? null);
      return;
    }
    let active = true;
    const loadMetadata = async () => {
      try {
        const url = `/api/media/audio-meta?path=${encodeURIComponent(mediaPath)}`;
        const response = await fetch(url);
        if (!response.ok) {
          metadataCache.set(mediaPath, null);
          return;
        }
        const payload = (await response.json()) as {
          metadata?: { artist?: string; title?: string; album?: string; year?: string };
        };
        if (!active) {
          return;
        }
        const artist = payload?.metadata?.artist || "";
        const title = payload?.metadata?.title || "";
        const album = payload?.metadata?.album || "";
        const year = payload?.metadata?.year || "";
        const hasMetadata = Boolean(artist || title || album || year);
        const next = hasMetadata ? { artist, title, album, year } : null;
        metadataCache.set(mediaPath, next);
        setMetadata(next);
      } catch {
        if (active) {
          metadataCache.set(mediaPath, null);
          setMetadata(null);
        }
      }
    };
    loadMetadata();
    return () => {
      active = false;
    };
  }, [mediaPath, metadataCache]);

  const displayTitle = useMemo(() => {
    if (!metadata) {
      return { main: fileName, album: "" };
    }
    const parts = [metadata.artist, metadata.title].filter((value) => Boolean(value));
    const yearSuffix = metadata.year ? ` (${metadata.year})` : "";
    return {
      main: parts.join(" - ") || fileName,
      album: metadata.album ? `${metadata.album}${yearSuffix}` : ""
    };
  }, [fileName, metadata]);

  const isAudio = AUDIO_EXTENSIONS.test(fileName);

  return (
    <div className="file-actions">
      <div className="file-actions-left">
        {isAudio ? (
          <>
            <button
              type="button"
              className="outline-button icon-button player-button"
              onClick={onPlay}
              aria-label="Play"
              disabled={disablePlay}
            >
              <Play size={16} strokeWidth={1.6} />
            </button>
            <button type="button" className="outline-button" onClick={onQueue} disabled={disableQueue}>
              Queue
            </button>
          </>
        ) : (
          <span className="file-actions-icon" aria-hidden="true">
            <FileText size={18} strokeWidth={1.6} />
          </span>
        )}
        <div className="file-actions-info">
          <span className="file-actions-title">
            {displayTitle.main}
            {displayTitle.album ? (
              <span className="file-actions-album"> - {displayTitle.album}</span>
            ) : null}
          </span>
          {notice ? (
            <span className="file-actions-notice">{notice}</span>
          ) : (
            <span className="file-actions-path">{filePath}</span>
          )}
        </div>
      </div>
      <div className="file-actions-right">
        {statusText ? <span className="file-actions-status">{statusText}</span> : null}
        {showOpen && onOpen ? (
          <button
            type="button"
            className="icon-button ghost-button"
            onClick={onOpen}
            aria-label="Open in default app"
            title="Open in default app"
          >
            <ExternalLink size={16} strokeWidth={1.6} />
          </button>
        ) : null}
        {showReveal && onReveal ? (
          <button
            type="button"
            className="icon-button ghost-button"
            onClick={onReveal}
            aria-label="Reveal in file manager"
            title="Reveal in file manager"
          >
            <FolderOpen size={16} strokeWidth={1.6} />
          </button>
        ) : null}
        {showRename ? (
          <button type="button" className="ghost-button" onClick={onRename}>
            Rename
          </button>
        ) : null}
        {showDelete ? (
          <button type="button" className="icon-button danger-button" onClick={onDelete} aria-label="Delete">
            <Trash2 size={16} strokeWidth={1.6} />
          </button>
        ) : null}
        {showClear && onClear ? (
          <button
            type="button"
            className="icon-button ghost-button"
            onClick={onClear}
            aria-label="Clear download"
            title="Remove download"
          >
            <X size={16} strokeWidth={1.6} />
          </button>
        ) : null}
      </div>
    </div>
  );
}
