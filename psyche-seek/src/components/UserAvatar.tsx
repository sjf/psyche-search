import { useEffect, useState } from "react";
import { apiFetch } from "../api";

export type UserPresence = "online" | "away" | "offline";

export interface UserInfo {
  status: "ready" | "loading" | "error";
  hasPic: boolean;
  description: string;
  cachedAt: number;
  totalUploads: number | null;
  queueSize: number | null;
  slotsFree: boolean | null;
  userStatus: UserPresence | null;
  avgSpeed: number | null;
  country: string | null;
}

// Shared across every avatar so a user shown on many rows is only fetched once.
const infoCache = new Map<string, UserInfo>();
const inflight = new Map<string, Promise<UserInfo>>();

// Drop a user's cached profile so the next avatar mount refetches it. Called
// after a forced server-side refresh (e.g. opening the user's browse page).
export function invalidateUserInfo(user: string) {
  infoCache.delete(user);
  inflight.delete(user);
}

const MAX_POLLS = 12;
const POLL_DELAY = 1200;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function fetchUserInfo(user: string): Promise<UserInfo> {
  const cached = infoCache.get(user);
  if (cached) {
    return cached;
  }
  const existing = inflight.get(user);
  if (existing) {
    return existing;
  }

  const promise = (async (): Promise<UserInfo> => {
    let result: UserInfo = {
      status: "error",
      hasPic: false,
      description: "",
      cachedAt: 0,
      totalUploads: null,
      queueSize: null,
      slotsFree: null,
      userStatus: null,
      avgSpeed: null,
      country: null
    };
    for (let attempt = 0; attempt < MAX_POLLS; attempt += 1) {
      try {
        const response = await apiFetch(`/api/user/${encodeURIComponent(user)}/info`);
        if (!response.ok) {
          break;
        }
        const data = (await response.json()) as {
          status: string;
          description?: string;
          has_pic?: boolean;
          cached_at?: number;
          total_uploads?: number | null;
          queue_size?: number | null;
          slots_free?: boolean | null;
          user_status?: string | null;
          avg_speed?: number | null;
          country?: string | null;
        };
        if (data.status === "ready") {
          result = {
            status: "ready",
            hasPic: Boolean(data.has_pic),
            description: data.description || "",
            cachedAt: data.cached_at || 0,
            totalUploads: typeof data.total_uploads === "number" ? data.total_uploads : null,
            queueSize: typeof data.queue_size === "number" ? data.queue_size : null,
            slotsFree: typeof data.slots_free === "boolean" ? data.slots_free : null,
            userStatus:
              data.user_status === "online" || data.user_status === "away" || data.user_status === "offline"
                ? data.user_status
                : null,
            avgSpeed: typeof data.avg_speed === "number" ? data.avg_speed : null,
            country: typeof data.country === "string" && data.country ? data.country : null
          };
          break;
        }
        if (data.status !== "loading") {
          break;
        }
      } catch {
        break;
      }
      await sleep(POLL_DELAY);
    }
    infoCache.set(user, result);
    inflight.delete(user);
    return result;
  })();

  inflight.set(user, promise);
  return promise;
}

export function userInitials(user: string) {
  const cleaned = user.replace(/[^a-zA-Z0-9]/g, "");
  return (cleaned.slice(0, 2) || user.slice(0, 2) || "?").toUpperCase();
}

// Deterministic hue per username so fallback avatars are stable and varied.
export function hueFor(user: string) {
  let hash = 0;
  for (let i = 0; i < user.length; i += 1) {
    hash = (hash * 31 + user.charCodeAt(i)) & 0xffffffff;
  }
  return Math.abs(hash) % 360;
}

export default function UserAvatar({ user }: { user: string }) {
  const [info, setInfo] = useState<UserInfo | null>(() => infoCache.get(user) || null);
  const [imgFailed, setImgFailed] = useState(false);

  useEffect(() => {
    let active = true;
    setImgFailed(false);
    const known = infoCache.get(user);
    if (known) {
      setInfo(known);
      return;
    }
    setInfo(null);
    fetchUserInfo(user).then((result) => {
      if (active) {
        setInfo(result);
      }
    });
    return () => {
      active = false;
    };
  }, [user]);

  const showPic = info?.status === "ready" && info.hasPic && !imgFailed;

  return (
    <span
      className="user-avatar"
      title={info?.description ? `${user} — ${info.description}` : user}
      style={showPic ? undefined : { backgroundColor: `hsl(${hueFor(user)} 45% 32%)` }}
    >
      {showPic ? (
        <img
          src={`/api/user/${encodeURIComponent(user)}/pic?size=thumb&v=${info?.cachedAt ?? 0}`}
          alt=""
          loading="lazy"
          onError={() => setImgFailed(true)}
        />
      ) : (
        <span className="user-avatar-fallback">{userInitials(user)}</span>
      )}
    </span>
  );
}
