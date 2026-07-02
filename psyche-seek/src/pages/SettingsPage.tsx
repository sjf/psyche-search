import { FolderCog, LogOut, Pencil, Plus, Settings, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { apiFetch } from "../api";
import DirectoryPicker from "../components/DirectoryPicker";
import Modal from "../components/Modal";
import { hasNativePicker, pickFolderNative } from "../native";
import { useAuth } from "../state/auth";
import { useToast } from "../state/toast";

interface StatusSnapshot {
  username?: string;
  status?: string;
  connection_info?: string;
  portmap_info?: string;
}

interface DirectoryConfig {
  download_dir: string;
  incomplete_dir: string;
  shared_dirs: string[];
}

type PickerTarget = "download" | "incomplete" | "share";

const EMPTY_DIRECTORIES: DirectoryConfig = {
  download_dir: "",
  incomplete_dir: "",
  shared_dirs: []
};

export default function SettingsPage() {
  const [status, setStatus] = useState<StatusSnapshot>({});
  const [isConnected, setIsConnected] = useState(false);
  const hasConnectedRef = useRef(false);
  const [directories, setDirectories] = useState<DirectoryConfig>(EMPTY_DIRECTORIES);
  const [picker, setPicker] = useState<{ target: PickerTarget; path: string } | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const [highlightDirs, setHighlightDirs] = useState(false);
  const dirSectionRef = useRef<HTMLElement | null>(null);
  const location = useLocation();
  const { logout } = useAuth();
  const { addToast } = useToast();

  useEffect(() => {
    if (location.hash !== "#directories") {
      return;
    }
    const timer = window.setTimeout(() => {
      dirSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      setHighlightDirs(true);
    }, 80);
    const clear = window.setTimeout(() => setHighlightDirs(false), 1500);
    return () => {
      window.clearTimeout(timer);
      window.clearTimeout(clear);
    };
  }, [location]);

  useEffect(() => {
    let active = true;

    const loadStatus = async () => {
      try {
        const response = await apiFetch("/api/status");
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

  const loadDirectories = useCallback(async () => {
    try {
      const response = await apiFetch("/api/config/directories");
      if (!response.ok) {
        return;
      }
      const data = (await response.json()) as Partial<DirectoryConfig>;
      setDirectories({
        download_dir: data.download_dir || "",
        incomplete_dir: data.incomplete_dir || "",
        shared_dirs: Array.isArray(data.shared_dirs) ? data.shared_dirs : []
      });
    } catch {
      setDirectories(EMPTY_DIRECTORIES);
    }
  }, []);

  useEffect(() => {
    loadDirectories();
  }, [loadDirectories]);

  const applyDirectory = useCallback(
    async (target: PickerTarget, path: string) => {
      if (!path) {
        return;
      }
      const params = new URLSearchParams();
      let endpoint: string;
      if (target === "share") {
        endpoint = "/api/config/shares";
        params.set("action", "add");
        params.set("path", path);
      } else {
        endpoint = "/api/config/directories";
        params.set("kind", target);
        params.set("path", path);
      }
      try {
        const response = await apiFetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: params.toString()
        });
        if (!response.ok) {
          addToast("Could not update directory.");
          return;
        }
        setDirectories((await response.json()) as DirectoryConfig);
      } catch {
        addToast("Could not update directory.");
      }
    },
    [addToast]
  );

  const removeShare = useCallback(
    async (path: string) => {
      const params = new URLSearchParams();
      params.set("action", "remove");
      params.set("path", path);
      try {
        const response = await apiFetch("/api/config/shares", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: params.toString()
        });
        if (!response.ok) {
          addToast("Could not remove shared folder.");
          return;
        }
        setDirectories((await response.json()) as DirectoryConfig);
      } catch {
        addToast("Could not remove shared folder.");
      }
    },
    [addToast]
  );

  const chooseDirectory = useCallback(
    async (target: PickerTarget, initialPath: string) => {
      if (hasNativePicker()) {
        try {
          const path = await pickFolderNative();
          if (path) {
            applyDirectory(target, path);
          }
        } catch {
          addToast("Could not open the file picker.");
        }
        return;
      }
      setPicker({ target, path: initialPath });
    },
    [addToast, applyDirectory]
  );

  const connectionInfo = status.connection_info || "Server connection status unavailable.";
  const showDisconnectNotice =
    hasConnectedRef.current && !isConnected && connectionInfo.includes("Disconnected from server");
  const displayConnectionInfo =
    isConnected && connectionInfo.includes("Disconnected from server") ? "Connected to server." : connectionInfo;

  const pickerTitle =
    picker?.target === "download"
      ? "Choose download folder"
      : picker?.target === "incomplete"
        ? "Choose incomplete folder"
        : "Add shared folder";

  return (
    <div className="page settings-page">
      <header className="page-header">
        <div className="page-title-row">
          <span className="page-icon">
            <Settings size={20} strokeWidth={1.7} />
          </span>
          <div>
            <h1>Settings</h1>
            <p className="page-subtitle">Account details, folders and session controls.</p>
          </div>
        </div>
      </header>

      <div className="settings-status">
        <div className="settings-status-header">
          <span className={`status-dot ${isConnected ? "status-dot-online" : "status-dot-error"}`} />
          <span>{isConnected ? "Connected" : "Error"}</span>
        </div>
        <div className="settings-status-details">
          <div className="settings-status-line">{displayConnectionInfo}</div>
          {showDisconnectNotice ? (
            <div className="settings-status-line">Check your username and password.</div>
          ) : null}
          {status.portmap_info ? <div className="settings-status-line">{status.portmap_info}</div> : null}
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
      </div>

      <section
        id="directories"
        ref={dirSectionRef}
        className={`section dir-section${highlightDirs ? " dir-section-flash" : ""}`}
      >
        <div className="section-header">
          <h2>
            <FolderCog size={16} strokeWidth={1.7} /> Directories
          </h2>
        </div>

        <div className="dir-list">
          <div className="dir-row">
            <span className="dir-kind">Download</span>
            <div className="dir-path-row">
              <div className="dir-path" title={directories.download_dir}>
                {directories.download_dir || "Not set"}
              </div>
              <button
                type="button"
                className="icon-button dir-change"
                aria-label="Change download folder"
                data-tooltip="Change download folder"
                onClick={() => chooseDirectory("download", directories.download_dir)}
              >
                <Pencil size={15} strokeWidth={1.8} />
              </button>
            </div>
          </div>

          <div className="dir-row">
            <span className="dir-kind">Incomplete</span>
            <div className="dir-path-row">
              <div className="dir-path" title={directories.incomplete_dir}>
                {directories.incomplete_dir || "Not set"}
              </div>
              <button
                type="button"
                className="icon-button dir-change"
                aria-label="Change incomplete folder"
                data-tooltip="Change incomplete folder"
                onClick={() => chooseDirectory("incomplete", directories.incomplete_dir)}
              >
                <Pencil size={15} strokeWidth={1.8} />
              </button>
            </div>
          </div>

          <div className="dir-row">
            <div className="dir-row-head">
              <span className="dir-kind">Shared</span>
              <button
                type="button"
                className="icon-button dir-change"
                aria-label="Add shared folder"
                data-tooltip="Add shared folder"
                onClick={() => chooseDirectory("share", directories.download_dir)}
              >
                <Plus size={16} strokeWidth={2} />
              </button>
            </div>
            {directories.shared_dirs.length === 0 ? (
              <div className="dir-empty">No shared folders.</div>
            ) : (
              <div className="dir-share-list">
                {directories.shared_dirs.map((dir) => (
                  <div key={dir} className="dir-path-row">
                    <span className="dir-path" title={dir}>
                      {dir}
                    </span>
                    <button
                      type="button"
                      className="icon-button dir-remove"
                      aria-label={`Remove ${dir}`}
                      data-tooltip="Remove shared folder"
                      onClick={() => setConfirmRemove(dir)}
                    >
                      <X size={15} strokeWidth={1.9} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </section>

      <div className="settings-footer">
        <button type="button" className="danger-button" onClick={logout}>
          <LogOut size={15} strokeWidth={1.8} /> Log out
        </button>
      </div>

      <Modal
        open={Boolean(confirmRemove)}
        title="Remove shared folder"
        onClose={() => setConfirmRemove(null)}
        className="modal-delete"
        footer={
          <>
            <button
              type="button"
              className="danger-button"
              onClick={() => {
                if (confirmRemove) {
                  removeShare(confirmRemove);
                }
                setConfirmRemove(null);
              }}
            >
              Remove
            </button>
            <button type="button" className="ghost-button" onClick={() => setConfirmRemove(null)}>
              Cancel
            </button>
          </>
        }
      >
        <p>Stop sharing this folder?</p>
        <div className="dir-path confirm-path">{confirmRemove}</div>
      </Modal>

      <DirectoryPicker
        open={Boolean(picker)}
        title={pickerTitle}
        initialPath={picker?.path}
        onClose={() => setPicker(null)}
        onSelect={(path) => {
          if (picker) {
            applyDirectory(picker.target, path);
          }
          setPicker(null);
        }}
      />
    </div>
  );
}
