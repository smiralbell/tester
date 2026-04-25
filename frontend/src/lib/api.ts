/** Debe coincidir con `PORT` del microservicio Bun (README suele usar 8000). */
export function getApiBaseUrl(): string {
  return (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000").replace(/\/$/, "");
}

export async function apiJson<T>(
  path: string,
  init?: RequestInit & { token?: string | null }
): Promise<T> {
  const { token, headers, ...rest } = init ?? {};
  const url = `${getApiBaseUrl()}${path.startsWith("/") ? path : `/${path}`}`;
  const h = new Headers(headers);
  if (!h.has("Content-Type") && rest.body) {
    h.set("Content-Type", "application/json");
  }
  if (token) {
    h.set("Authorization", `Bearer ${token}`);
  }
  const res = await fetch(url, { ...rest, headers: h });
  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text) as unknown;
    } catch {
      data = { detail: text };
    }
  }
  if (!res.ok) {
    const o = data && typeof data === "object" && data !== null ? (data as Record<string, unknown>) : null;
    let detail =
      (o?.detail != null && String(o.detail)) ||
      (o?.message != null && String(o.message)) ||
      (o?.error != null && String(o.error)) ||
      "";
    if (!detail && o && Array.isArray(o.details)) {
      const issues = o.details as Array<{ message?: string; path?: (string | number)[] }>;
      detail = issues
        .map((i) => (i.message ? String(i.message) : JSON.stringify(i.path ?? [])))
        .filter(Boolean)
        .join("; ");
    }
    if (!detail) detail = res.statusText;
    throw new Error(detail || `HTTP ${res.status}`);
  }
  return data as T;
}
