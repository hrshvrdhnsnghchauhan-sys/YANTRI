/**
 * YANTRI Server Configuration
 * Centralized configuration with validation
 */

// Server
export const PORT = Number(process.env.PORT || 3000);
export const NODE_ENV = process.env.NODE_ENV || "development";
export const IS_PRODUCTION = NODE_ENV === "production";
export const CLOUD_MODE = process.env.CLOUD_MODE === "true";

// CORS
export const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || "http://localhost:3000,http://localhost:5173,http://127.0.0.1:3000")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

// Rate Limiting
export const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
export const RATE_LIMIT_MAX_REQUESTS = 100;

// Security
export const AGENT_SHARED_SECRET = process.env.AGENT_SHARED_SECRET || "";
export const HELMET_CSP = {
  directives: {
    defaultSrc: ["'self'"],
    scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
    styleSrc: ["'self'", "'unsafe-inline'"],
    imgSrc: ["'self'", "data:", "https:"],
    connectSrc: ["'self'", "ws:", "wss:", "https:"],
    fontSrc: ["'self'", "data:"],
    objectSrc: ["'none'"],
    mediaSrc: ["'self'", "https:"],
    frameSrc: ["'none'"],
  },
  crossOriginEmbedderPolicy: false,
};

// Desktop Agent
export const DESKTOP_AGENT_URL = process.env.DESKTOP_AGENT_URL || "http://127.0.0.1:8765";
export const DESKTOP_AGENT_TIMEOUT = 25_000;
export const AGENT_RESPAWN_COOLDOWN_MS = 60_000;

// Data Directory
export const DATA_DIR = process.env.YANTRI_DATA_DIR || process.cwd();

// API Keys
export const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
export const TAVILY_API_KEY = process.env.TAVILY_API_KEY || "";
export const GROQ_API_KEY = process.env.GROQ_API_KEY || "";
export const OPENCODE_API_KEY = process.env.OPENCODE_API_KEY || "";
export const OPENCODE_BASE_URL = process.env.OPENCODE_BASE_URL || "https://opencode.ai/zen/v1";
export const OPENCODE_MODEL = process.env.OPENCODE_MODEL || "mimo-v2.6-flash-free";

// Google OAuth
export const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "";
export const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || "";
export const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI || "";

// S3/Storage
export const S3_ENDPOINT = process.env.S3_ENDPOINT || "";
export const S3_REGION = process.env.S3_REGION || "auto";
export const S3_BUCKET = process.env.S3_BUCKET || "";
export const S3_ACCESS_KEY_ID = process.env.S3_ACCESS_KEY_ID || "";
export const S3_SECRET_ACCESS_KEY = process.env.S3_SECRET_ACCESS_KEY || "";
export const YANTRI_SYNC_ROOT = process.env.YANTRI_SYNC_ROOT || "yantri";
export const YANTRI_SYNC_INTERVAL_MS = Number(process.env.YANTRI_SYNC_INTERVAL_MS || 300_000);

// Validation
export function validateConfig(): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!GEMINI_API_KEY && !CLOUD_MODE) {
    errors.push("GEMINI_API_KEY is required (or set CLOUD_MODE=true for server-only mode)");
  }

  if (IS_PRODUCTION) {
    if (ALLOWED_ORIGINS.some((o) => o.includes("localhost"))) {
      errors.push("Production should not allow localhost origins");
    }
    if (!AGENT_SHARED_SECRET) {
      errors.push("AGENT_SHARED_SECRET should be set in production");
    }
  }

  return { valid: errors.length === 0, errors };
}