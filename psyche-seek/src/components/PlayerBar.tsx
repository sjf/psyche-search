import { Pause, Play, SkipBack, SkipForward } from "lucide-react";
import { CSSProperties, ReactNode, useMemo } from "react";
import { usePlayer } from "../state/player";
import { useFooter } from "../state/footer";

function formatTime(seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return "0:00";
  }
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.floor(seconds % 60);
  return `${minutes}:${remainder.toString().padStart(2, "0")}`;
}

export default function PlayerBar() {
  const {
    currentTrack,
    isPlaying,
    duration,
    position,
    toggle,
    seek,
    skipNext,
    skipPrevious
  } = usePlayer();
  const { content } = useFooter();

  const displayTitle = useMemo<ReactNode>(() => {
    if (!currentTrack) {
      return "Nothing playing";
    }
    const metadataParts = [currentTrack.artist, currentTrack.title].filter(
      (value): value is string => Boolean(value)
    );
    if (metadataParts.length > 0) {
      const albumText = currentTrack.album
        ? `${currentTrack.album}${currentTrack.year ? ` (${currentTrack.year})` : ""}`
        : "";
      const main = metadataParts.join(" - ");
      if (!albumText) {
        return main;
      }
      return (
        <span>
          {main} - <span className="player-album">{albumText}</span>
        </span>
      );
    }
    const raw = currentTrack.title || currentTrack.path || "";
    if (raw) {
      return raw.split(/[/\\]/).pop() || raw;
    }
    return "Unknown track";
  }, [currentTrack]);

  const linkTarget = currentTrack?.path ? `/files?path=${encodeURIComponent(currentTrack.path)}` : "/files";

  return (
    <div className="player-bar">
      {content && <div className="player-actions">{content}</div>}
      <div className="player-info">
        <span className={`eq${currentTrack && isPlaying ? " eq-playing" : ""}`} aria-hidden="true">
          <span className="eq-bar" />
          <span className="eq-bar" />
          <span className="eq-bar" />
          <span className="eq-bar" />
        </span>
        <div className="player-info-text">
          {currentTrack && <span className="now-playing-tag">Now Playing</span>}
          <a className="player-title" href={linkTarget}>
            {displayTitle}
          </a>
        </div>
      </div>
      <div className="player-controls-row">
        <div className="player-controls">
          <button type="button" className="player-button icon-button" onClick={skipPrevious}>
            <SkipBack size={16} strokeWidth={1.6} />
          </button>
          <button
            type="button"
            className="player-button icon-button player-button-primary"
            onClick={toggle}
          >
            {isPlaying ? <Pause size={16} strokeWidth={1.9} /> : <Play size={16} strokeWidth={1.9} />}
          </button>
          <button type="button" className="player-button icon-button" onClick={skipNext}>
            <SkipForward size={16} strokeWidth={1.6} />
          </button>
        </div>
        <div className="player-scrub">
          <span className="player-time">{formatTime(position)}</span>
          <input
            type="range"
            min={0}
            max={duration || 0}
            value={Math.min(position, duration || 0)}
            onChange={(event) => seek(Number(event.target.value))}
            style={
              {
                "--scrub-fill-stop": duration > 0 ? `${Math.min(100, (position / duration) * 100)}%` : "0%"
              } as CSSProperties
            }
          />
          <span className="player-time">{formatTime(duration)}</span>
        </div>
      </div>
    </div>
  );
}
