import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import { useToast } from "./toast";

export interface Track {
  id: string;
  title: string;
  artist?: string;
  album?: string;
  year?: string;
  path?: string;
  src?: string;
}

interface PlayerState {
  currentTrack: Track | null;
  isPlaying: boolean;
  duration: number;
  position: number;
  queue: Track[];
  play: () => void;
  pause: () => void;
  toggle: () => void;
  seek: (value: number) => void;
  playTrack: (track: Track, context?: PlayContext) => void;
  enqueue: (track: Track) => void;
  skipNext: () => void;
  skipPrevious: () => void;
  audioRef: React.RefObject<HTMLAudioElement>;
}

const PlayerContext = createContext<PlayerState | null>(null);

const STORAGE_KEY = "mseek.player";

interface StoredPlayerState {
  currentTrack: Track | null;
  queue: Track[];
  directoryQueue?: Track[];
  directoryIndex?: number;
  position?: number;
  isPlaying?: boolean;
}

interface PlayContext {
  directoryTracks?: Track[];
  directoryIndex?: number;
}

function loadStoredState(): StoredPlayerState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return { currentTrack: null, queue: [] };
    }
    const parsed = JSON.parse(raw) as StoredPlayerState;
    return {
      currentTrack: parsed.currentTrack || null,
      queue: Array.isArray(parsed.queue) ? parsed.queue : [],
      directoryQueue: Array.isArray(parsed.directoryQueue) ? parsed.directoryQueue : [],
      directoryIndex: typeof parsed.directoryIndex === "number" ? parsed.directoryIndex : -1,
      position: typeof parsed.position === "number" ? parsed.position : 0,
      isPlaying: Boolean(parsed.isPlaying)
    };
  } catch {
    return { currentTrack: null, queue: [] };
  }
}

export function PlayerProvider({ children }: { children: ReactNode }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const { addToast } = useToast();
  const stored = loadStoredState();
  const [currentTrack, setCurrentTrack] = useState<Track | null>(stored.currentTrack);
  const [queue, setQueue] = useState<Track[]>(stored.queue);
  const [directoryQueue, setDirectoryQueue] = useState<Track[]>(stored.directoryQueue || []);
  const [directoryIndex, setDirectoryIndex] = useState<number>(stored.directoryIndex ?? -1);
  const [isPlaying, setIsPlaying] = useState(Boolean(stored.isPlaying));
  const [duration, setDuration] = useState(0);
  const [position, setPosition] = useState(stored.position ?? 0);

  useEffect(() => {
    const payload: StoredPlayerState = {
      currentTrack,
      queue,
      directoryQueue,
      directoryIndex,
      position,
      isPlaying
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  }, [currentTrack, queue, directoryQueue, directoryIndex, position, isPlaying]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !currentTrack?.src) {
      return;
    }
    const desiredSrc = new URL(currentTrack.src, window.location.origin).toString();
    if (audio.src !== desiredSrc) {
      audio.src = desiredSrc;
    }
    if (position > 0 && Math.abs(audio.currentTime - position) > 1) {
      audio.currentTime = position;
    }
    if (isPlaying) {
      audio.play().catch((error) => {
        console.warn("Player play() failed", error);
        if (error?.name !== "NotAllowedError") {
          addToast("Playback failed.");
        }
        setIsPlaying(false);
      });
    }
  }, [addToast, currentTrack, position, isPlaying]);

  useEffect(() => {
    if (!currentTrack?.path) {
      return;
    }
    let active = true;
    const verify = async () => {
      try {
        const metaUrl = `/api/media/meta?path=${encodeURIComponent(currentTrack.path as string)}`;
        console.debug("Player meta check", metaUrl);
        const response = await fetch(metaUrl);
        if (!response.ok && active) {
          console.warn("Player meta check failed", response.status);
          addToast("Playback failed.");
          const audio = audioRef.current;
          if (audio) {
            audio.pause();
            audio.removeAttribute("src");
          }
          setIsPlaying(false);
        }
      } catch {
        if (active) {
          console.warn("Player meta check error");
          addToast("Playback failed.");
          const audio = audioRef.current;
          if (audio) {
            audio.pause();
            audio.removeAttribute("src");
          }
          setIsPlaying(false);
        }
      }
    };
    verify();
    return () => {
      active = false;
    };
  }, [addToast, currentTrack?.path]);

  useEffect(() => {
    if (!currentTrack?.path) {
      return;
    }
    let active = true;
    const loadMetadata = async () => {
      try {
        const metaUrl = `/api/media/audio-meta?path=${encodeURIComponent(currentTrack.path as string)}`;
        const response = await fetch(metaUrl);
        if (!response.ok) {
          return;
        }
        const payload = (await response.json()) as {
          metadata?: { artist?: string; title?: string; album?: string; year?: string };
        };
        if (!active || !payload?.metadata) {
          return;
        }
        setCurrentTrack((prev) => {
          if (!prev || prev.path !== currentTrack.path) {
            return prev;
          }
          return {
            ...prev,
            artist: payload.metadata?.artist || prev.artist,
            title: payload.metadata?.title || prev.title,
            album: payload.metadata?.album || prev.album,
            year: payload.metadata?.year || prev.year
          };
        });
      } catch {
        // Ignore metadata errors to avoid disrupting playback.
      }
    };
    loadMetadata();
    return () => {
      active = false;
    };
  }, [currentTrack?.path]);

  const play = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }
    audio.play().catch((error) => {
      console.warn("Player play() failed", error);
      if (error?.name !== "NotAllowedError") {
        addToast("Playback failed.");
      }
    });
    setIsPlaying(true);
  }, [addToast]);

  const pause = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }
    audio.pause();
    setIsPlaying(false);
  }, []);

  const toggle = useCallback(() => {
    if (isPlaying) {
      pause();
    } else {
      play();
    }
  }, [isPlaying, pause, play]);

  const seek = useCallback((value: number) => {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }
    audio.currentTime = value;
    setPosition(value);
  }, []);

  const playTrack = useCallback((track: Track, context?: PlayContext) => {
    setCurrentTrack(track);
    setPosition(0);
    if (context?.directoryTracks) {
      setDirectoryQueue(context.directoryTracks);
      setDirectoryIndex(typeof context.directoryIndex === "number" ? context.directoryIndex : -1);
    } else {
      setDirectoryQueue([]);
      setDirectoryIndex(-1);
    }
    const audio = audioRef.current;
    if (audio) {
      if (track.src) {
        audio.src = new URL(track.src, window.location.origin).toString();
        audio.currentTime = 0;
        audio.play().catch((error) => {
          console.warn("Player playTrack() failed", error);
          if (error?.name !== "NotAllowedError") {
            addToast("Playback failed.");
          }
        });
        setIsPlaying(true);
      } else {
        audio.pause();
        setIsPlaying(false);
      }
    }
  }, [addToast]);

  const enqueue = useCallback((track: Track) => {
    setQueue((prev) => [...prev, track]);
  }, []);

  const skipNext = useCallback(() => {
    if (queue.length > 0) {
      const [next, ...rest] = queue;
      setQueue(rest);
      playTrack(next);
      return;
    }

    if (directoryQueue.length > 0 && directoryIndex + 1 < directoryQueue.length) {
      const next = directoryQueue[directoryIndex + 1];
      playTrack(next, { directoryTracks: directoryQueue, directoryIndex: directoryIndex + 1 });
      return;
    }

    setIsPlaying(false);
  }, [queue, directoryQueue, directoryIndex, playTrack]);

  const skipPrevious = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }
    audio.currentTime = 0;
    setPosition(0);
  }, []);

  const value = useMemo(
    () => ({
      currentTrack,
      isPlaying,
      duration,
      position,
      queue,
      play,
      pause,
      toggle,
      seek,
      playTrack,
      enqueue,
      skipNext,
      skipPrevious,
      audioRef
    }),
    [
      currentTrack,
      isPlaying,
      duration,
      position,
      queue,
      play,
      pause,
      toggle,
      seek,
      playTrack,
      enqueue,
      skipNext,
      skipPrevious
    ]
  );

  return (
    <PlayerContext.Provider value={value}>
      {children}
      <audio
        ref={audioRef}
        onLoadedMetadata={(event) => {
          const audio = event.currentTarget;
          setDuration(audio.duration || 0);
        }}
        onError={() => {
          console.warn("Player audio element error");
          addToast("Playback failed.");
          setIsPlaying(false);
        }}
        onTimeUpdate={(event) => {
          setPosition(event.currentTarget.currentTime || 0);
        }}
        onEnded={() => {
          skipNext();
        }}
      />
    </PlayerContext.Provider>
  );
}

export function usePlayer() {
  const context = useContext(PlayerContext);
  if (!context) {
    throw new Error("usePlayer must be used within PlayerProvider");
  }
  return context;
}
