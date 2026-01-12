export async function apiFetch(path: string, init?: RequestInit) {
  const normalized = path.startsWith("/api") ? path : `/api${path.startsWith("/") ? "" : "/"}${path}`;
  return fetch(normalized, init);
}
