/**
 * Client-side auth token store.
 *
 * Stores the JWT in localStorage and patches window.fetch once so every
 * same-origin /api/* request automatically carries the Authorization header.
 * The WebSocket handshake reads the token via getToken() (see lib/audio.ts).
 */
const TOKEN_KEY = "yantri.auth.token";
const USER_KEY = "yantri.auth.user";

export interface StoredUser {
  id: string;
  email: string;
  name?: string | null;
  role?: string | null;
}

function safeLocalStorage(): Storage | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

export function getToken(): string | null {
  return safeLocalStorage()?.getItem(TOKEN_KEY) ?? null;
}

export function setToken(token: string | null): void {
  const ls = safeLocalStorage();
  if (!ls) return;
  if (token) ls.setItem(TOKEN_KEY, token);
  else ls.removeItem(TOKEN_KEY);
}

export function clearToken(): void {
  setToken(null);
  safeLocalStorage()?.removeItem(USER_KEY);
}

export function getStoredUser(): StoredUser | null {
  const raw = safeLocalStorage()?.getItem(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StoredUser;
  } catch {
    return null;
  }
}

export function setStoredUser(user: StoredUser | null): void {
  const ls = safeLocalStorage();
  if (!ls) return;
  if (user) ls.setItem(USER_KEY, JSON.stringify(user));
  else ls.removeItem(USER_KEY);
}

let installed = false;

/** Attach the bearer token to same-origin /api/* fetches automatically. */
export function installFetchAuth(): void {
  if (installed || typeof window === "undefined" || typeof window.fetch !== "function") return;
  installed = true;
  const original = window.fetch.bind(window);

  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const token = getToken();
    if (!token) return original(input, init);

    const url =
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

    const isApi = url.startsWith("/api") || url.includes("/api/");
    if (!isApi) return original(input, init);

    const headers = new Headers(
      init?.headers ?? (typeof input !== "string" && !(input instanceof URL) ? input.headers : undefined)
    );
    if (!headers.has("Authorization")) headers.set("Authorization", `Bearer ${token}`);
    return original(input, { ...init, headers });
  };
}
