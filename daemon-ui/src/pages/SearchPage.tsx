import { X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiFetch } from "../api";
import NotConnectedNotice from "../components/NotConnectedNotice";
import SearchBar from "../components/SearchBar";

interface SearchEntry {
  term: string;
  started_at: number;
  results: number;
}

interface StatusSnapshot {
  status?: string;
  searches?: Record<string, SearchEntry>;
}

export default function SearchPage() {
  const navigate = useNavigate();
  const [term, setTerm] = useState("");
  const [searches, setSearches] = useState<SearchEntry[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [statusReady, setStatusReady] = useState(false);

  useEffect(() => {
    let active = true;

    const loadSearches = async () => {
      try {
        const response = await fetch("/status.json");
        if (!response.ok) {
          return;
        }
        const data = (await response.json()) as StatusSnapshot;
        if (!active) {
          return;
        }
        const statusValue = (data.status || "").toLowerCase();
        setIsConnected(statusValue.includes("online") || statusValue.includes("connected"));
        setStatusReady(true);
        const entries = Object.values(data.searches || {}).sort(
          (a, b) => (b.started_at || 0) - (a.started_at || 0)
        );
        setSearches(entries.slice(0, 50));
      } catch {
        if (active) {
          setSearches([]);
          setIsConnected(false);
          setStatusReady(true);
        }
      }
    };

    loadSearches();
    const timer = window.setInterval(loadSearches, 5000);

    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  const handleSearch = async () => {
    if (!isConnected) {
      return;
    }
    const trimmed = term.trim();
    if (!trimmed) {
      return;
    }
    const params = new URLSearchParams();
    params.set("term", trimmed);
    try {
      await apiFetch("/search", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: params.toString()
      });
    } catch {
      // Ignore, navigation still updates the UI.
    }
    navigate(`/search/${encodeURIComponent(trimmed)}`);
  };

  const searchRows = useMemo(
    () =>
      searches.map((entry) => ({
        term: entry.term,
        startedAt: new Date(entry.started_at * 1000).toLocaleString(),
        results: entry.results
      })),
    [searches]
  );

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>Search</h1>
          <p className="page-subtitle">Find files across the Soulseek network.</p>
        </div>
      </header>

      <SearchBar
        value={term}
        placeholder="Search Soulseek network"
        onChange={setTerm}
        onSubmit={handleSearch}
        disabled={!isConnected}
      />
      {statusReady && !isConnected && (
        <div className="panel-note">
          <NotConnectedNotice />
        </div>
      )}

      <section className="section">
        <div className="section-header">
          <h2>Recent Searches</h2>
        </div>
        <div className="table-card">
          <table>
            <thead>
              <tr>
                <th>Query</th>
                <th>Started</th>
                <th>Results</th>
                <th className="table-actions-header">
                  <button
                    type="button"
                    className="icon-button secondary-button"
                    aria-label="Clear recent searches"
                    onClick={async () => {
                      try {
                        await apiFetch("/search/remove", { method: "POST" });
                      } catch {
                        // Ignore errors, still clear locally.
                      }
                      setSearches([]);
                    }}
                    disabled={searches.length === 0}
                  >
                    <X size={14} strokeWidth={1.6} />
                  </button>
                </th>
              </tr>
            </thead>
            <tbody>
              {searchRows.length === 0 ? (
                <tr>
                  <td colSpan={4} className="empty-cell">
                    No recent searches yet.
                  </td>
                </tr>
              ) : (
                searchRows.map((row) => (
                  <tr
                    key={`${row.term}-${row.startedAt}`}
                    className="row-clickable"
                    onClick={() => navigate(`/search/${encodeURIComponent(row.term)}`)}
                  >
                    <td>
                      <span className="row-link">{row.term}</span>
                    </td>
                    <td>{row.startedAt}</td>
                    <td>{row.results}</td>
                    <td className="row-actions">
                      <button
                        type="button"
                        className="icon-button secondary-button"
                        aria-label="Remove search"
                        onClick={async (event) => {
                          event.stopPropagation();
                          const params = new URLSearchParams();
                          params.set("term", row.term);
                          try {
                            await apiFetch("/search/remove", {
                              method: "POST",
                              headers: { "Content-Type": "application/x-www-form-urlencoded" },
                              body: params.toString()
                            });
                          } catch {
                            // Ignore failure; local state update still happens.
                          }
                          setSearches((prev) => prev.filter((entry) => entry.term !== row.term));
                        }}
                      >
                        <X size={14} strokeWidth={1.6} />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
