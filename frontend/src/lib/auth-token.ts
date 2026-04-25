const STORAGE_KEY = "qa_panel_access_token";

export function getStoredToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(STORAGE_KEY);
}

export function setStoredToken(token: string): void {
  window.localStorage.setItem(STORAGE_KEY, token);
}

export function clearStoredToken(): void {
  window.localStorage.removeItem(STORAGE_KEY);
}
