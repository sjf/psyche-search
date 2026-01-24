import { createContext, ReactNode, useContext, useEffect, useMemo, useState } from "react";

type AuthStatus = "loading" | "authenticated" | "unauthenticated";

interface AuthContextValue {
  status: AuthStatus;
  username: string;
  error: string;
  login: (username: string, password: string) => Promise<boolean>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

interface AuthProviderProps {
  children: ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [username, setUsername] = useState("");
  const [error, setError] = useState("");

  const refresh = async () => {
    try {
      const response = await fetch("/auth/me");
      if (!response.ok) {
        setStatus("unauthenticated");
        setUsername("");
        return;
      }
      const data = (await response.json()) as { authenticated?: boolean; username?: string };
      if (data.authenticated) {
        setStatus("authenticated");
        setUsername(data.username || "");
      } else {
        setStatus("unauthenticated");
        setUsername("");
      }
    } catch {
      setStatus("unauthenticated");
      setUsername("");
    }
  };

  useEffect(() => {
    let active = true;
    const boot = async () => {
      await refresh();
      if (!active) {
        return;
      }
    };
    boot();
    const timer = window.setInterval(refresh, 60000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  const login = async (loginUser: string, password: string) => {
    setError("");
    const params = new URLSearchParams();
    params.set("username", loginUser);
    params.set("password", password);
    try {
      const response = await fetch("/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: params.toString()
      });
      if (!response.ok) {
        let detail = "Login failed.";
        try {
          const payload = (await response.json()) as { detail?: string };
          if (payload.detail) {
            detail = payload.detail;
          }
        } catch {
          // ignore
        }
        setError(detail);
        setStatus("unauthenticated");
        setUsername("");
        return false;
      }
      const payload = (await response.json()) as { username?: string };
      setStatus("authenticated");
      setUsername(payload.username || loginUser);
      return true;
    } catch {
      setError("Login failed.");
      setStatus("unauthenticated");
      setUsername("");
      return false;
    }
  };

  const logout = async () => {
    setError("");
    try {
      await fetch("/auth/logout", { method: "POST" });
    } catch {
      // ignore
    }
    setStatus("unauthenticated");
    setUsername("");
  };

  const value = useMemo(
    () => ({ status, username, error, login, logout, refresh }),
    [status, username, error]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return ctx;
}
