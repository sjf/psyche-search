export async function apiFetch(path: string, init?: RequestInit) {
  return fetch(path, init);
}
