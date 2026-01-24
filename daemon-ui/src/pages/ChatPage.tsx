import { useEffect, useState } from "react";
import { apiFetch } from "../api";

interface ChatEntry {
  timestamp: number;
  kind?: string;
  user?: string;
  room?: string;
  message?: string;
}

interface StatusSnapshot {
  chat?: ChatEntry[];
}

const CHAT_KIND_LABELS: Record<string, string> = {
  pm: "Private",
  global: "Global",
  room: "Room"
};

export default function ChatPage() {
  const [messages, setMessages] = useState<ChatEntry[]>([]);

  useEffect(() => {
    let active = true;

    const loadChat = async () => {
      try {
        const response = await apiFetch("/api/chat");
        if (!response.ok) {
          return;
        }
        const data = (await response.json()) as StatusSnapshot;
        if (active) {
          setMessages((data.chat || []).slice(0, 20));
        }
      } catch {
        if (active) {
          setMessages([]);
        }
      }
    };

    loadChat();
    const timer = window.setInterval(loadChat, 3000);

    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>Chat</h1>
          <p className="page-subtitle">Recent Soulseek messages.</p>
        </div>
      </header>

      <div className="table-card">
        <table>
          <thead>
            <tr>
              <th className="chat-time-col">Time</th>
              <th className="chat-user-col">User</th>
              <th className="chat-type-col">Type</th>
              <th className="chat-message-col">Message</th>
            </tr>
          </thead>
          <tbody>
            {messages.length === 0 ? (
              <tr>
                <td colSpan={4} className="empty-cell">
                  No chat messages yet.
                </td>
              </tr>
            ) : (
              messages.map((entry, index) => (
                <tr key={`${entry.timestamp}-${index}`}>
                  <td className="mono chat-time-col">{new Date(entry.timestamp * 1000).toLocaleString()}</td>
                  <td className="chat-user-col">{entry.user || entry.room || ""}</td>
                  <td className="chat-type-col">{entry.kind ? CHAT_KIND_LABELS[entry.kind] || entry.kind : ""}</td>
                  <td className="chat-message-col">{entry.message || ""}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
