import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { apiFetch } from "../api";

interface StatusSnapshot {
  status?: string;
  connection_info?: string;
}

export default function StatusIndicator() {
  const [statusText, setStatusText] = useState("Disconnected");
  const [isConnected, setIsConnected] = useState(false);
  const hasConnectedRef = useRef(false);

  useEffect(() => {
    let active = true;

    const load = async () => {
      try {
        const response = await apiFetch("/api/status");
        if (!response.ok) {
          return;
        }
        const data = (await response.json()) as StatusSnapshot;
        if (!active) {
          return;
        }
        const value = (data.status || "").toLowerCase();
        const connected = value.includes("online") || value.includes("connected");
        const connectionInfo = data.connection_info || "";
        setIsConnected(connected);
        if (connected) {
          hasConnectedRef.current = true;
        }
        if (!connected && hasConnectedRef.current && connectionInfo.includes("Disconnected from server")) {
          setStatusText("Disconnected");
        } else {
          setStatusText(connected ? "Connected" : "Error");
        }
      } catch {
        if (active) {
          setIsConnected(false);
          setStatusText("Error");
        }
      }
    };

    load();
    const timer = window.setInterval(load, 5000);

    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  return (
    <Link className="status-indicator" to="/settings">
      <span className={`status-dot ${isConnected ? "status-dot-online" : "status-dot-error"}`} />
      <span>{statusText}</span>
    </Link>
  );
}
