const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || "";

// Export base URLs for API and WebSocket connections
export const API_BASE = BACKEND_URL;

// If VITE_BACKEND_URL is set (e.g. https://my-backend.com), replace http with ws for WebSocket
// Otherwise, fall back to the current origin (for local development)
export const WS_BASE = BACKEND_URL
  ? BACKEND_URL.replace(/^http/, "ws")
  : `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}`;
