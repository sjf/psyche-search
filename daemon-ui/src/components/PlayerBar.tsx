import { Pause, Play, SkipBack, SkipForward } from "lucide-react";
import { useMemo } from "react";
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

  const displayTitle = useMemo(() => {
    if (!currentTrack) {
      return "Nothing playing";
    }
    if (currentTrack.artist || currentTrack.title) {
      const artist = currentTrack.artist || "Unknown artist";
      const title = currentTrack.title || "Unknown track";
      return `${artist} - ${title}`;
    }
    return currentTrack.path || currentTrack.title || "Unknown track";
  }, [currentTrack]);

  const album = currentTrack?.album || "";
  const linkTarget = currentTrack?.path ? `/files?path=${encodeURIComponent(currentTrack.path)}` : "/files";

  return (
    <div className="player-bar">
      {content && <div className="player-actions">{content}</div>}
      <div className="player-info">
        <a className="player-title" href={linkTarget}>
          {displayTitle}
        </a>
        {album && <div className="player-meta">{album}</div>}
      </div>
      <div className="player-controls-row">
        <div className="player-controls">
          <button type="button" className="player-button icon-button" onClick={skipPrevious}>
            <SkipBack size={16} strokeWidth={1.6} />
          </button>
          <button type="button" className="player-button icon-button" onClick={toggle}>
            {isPlaying ? <Pause size={16} strokeWidth={1.6} /> : <Play size={16} strokeWidth={1.6} />}
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
          />
          <span className="player-time">{formatTime(duration)}</span>
        </div>
      </div>
    </div>
  );
}
