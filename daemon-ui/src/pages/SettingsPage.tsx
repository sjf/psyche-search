import { useEffect, useRef, useState } from "react";
import DirectoriesModal from "../components/DirectoriesModal";
import { useAuth } from "../state/auth";

interface StatusSnapshot {
  username?: string;
  status?: string;
  connection_info?: string;
  portmap_info?: string;
}

export default function SettingsPage() {
  const [status, setStatus] = useState<StatusSnapshot>({});
  const [isConnected, setIsConnected] = useState(false);
  const hasConnectedRef = useRef(false);
  const [showModal, setShowModal] = useState(false);
  const { logout } = useAuth();

  useEffect(() => {
    let active = true;

    const loadStatus = async () => {
      try {
        const response = await fetch("/status.json");
        if (!response.ok) {
          return;
        }
        const data = (await response.json()) as StatusSnapshot;
        if (active) {
          setStatus(data);
          const value = (data.status || "").toLowerCase();
          const connected = value.includes("online") || value.includes("connected");
          setIsConnected(connected);
          if (connected) {
            hasConnectedRef.current = true;
          }
        }
      } catch {
        if (active) {
          setStatus({});
          setIsConnected(false);
        }
      }
    };

    loadStatus();
    const timer = window.setInterval(loadStatus, 5000);

    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  const connectionInfo = status.connection_info || "Server connection status unavailable.";
  const showDisconnectNotice =
    hasConnectedRef.current && !isConnected && connectionInfo.includes("Disconnected from server");
  const displayConnectionInfo =
    isConnected && connectionInfo.includes("Disconnected from server") ? "Connected to server." : connectionInfo;

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>Settings</h1>
          <p className="page-subtitle">Account details and session controls.</p>
        </div>
      </header>

      <div className="settings-status">
        <div className="settings-status-header">
          <span className={`status-dot ${isConnected ? "status-dot-online" : "status-dot-error"}`} />
          <span>{isConnected ? "Connected" : "Error"}</span>
        </div>
        <div className="settings-status-details">
          <div className="settings-status-line">
            {displayConnectionInfo}
          </div>
          {showDisconnectNotice ? (
            <div className="settings-status-line">Check your username and password.</div>
          ) : null}
          {status.portmap_info ? (
            <div className="settings-status-line">{status.portmap_info}</div>
          ) : null}
        </div>
      </div>

      <div className="panel settings-panel">
        <div className="settings-row">
          <span className="settings-label">Username</span>
          <input
            type="text"
            className="settings-input"
            value={status.username || "Unknown"}
            readOnly
            tabIndex={-1}
          />
        </div>
        <button type="button" className="ghost-button" onClick={() => setShowModal(true)}>
          Configure directories
        </button>
        <button type="button" className="danger-button" onClick={logout}>
          Log out
        </button>
      </div>

      <DirectoriesModal open={showModal} onClose={() => setShowModal(false)} />
    </div>
  );
}
