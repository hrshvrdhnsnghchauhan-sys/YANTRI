/**
 * YANTRI Server Configuration
 * Centralized configuration with validation
 */

import { randomBytes } from "crypto";

// Server
export const PORT = Number(process.env.PORT || 3000);
export const NODE_ENV = process.env.NODE_ENV || "development";
export const IS_PRODUCTION = NODE_ENV === "production";
export const CLOUD_MODE = process.env.CLOUD_MODE === "true";

// ── Authentication ────────────────────────────────────────────────────────────
// Auth is enforced in production unless explicitly disabled, and disabled in
// development unless explicitly enabled (keeps the local dev loop friction-free).
// `AUTH_ENABLED` accepts "true"/"false"; when unset it defaults to IS_PRODUCTION.
export const AUTH_REQUIRED: boolean =
  process.env.AUTH_ENABLED !== undefined
    ? process.env.AUTH_ENABLED === "true"
    : IS_PRODUCTION;

// Signing secret for JWT access tokens. In production it must be provided (see
// validateConfig). In development we generate an ephemeral secret so local runs
// work without configuration; tokens then do not survive a restart.
export const JWT_SECRET: string =
  process.env.JWT_SECRET && process.env.JWT_SECRET.length > 0
    ? process.env.JWT_SECRET
    : randomBytes(32).toString("hex");

export const JWT_EXPIRES_IN: string = process.env.JWT_EXPIRES_IN || "7d";
export const ALLOW_REGISTRATION: boolean = process.env.ALLOW_REGISTRATION !== "false";

// Key used to encrypt sensitive data at rest (Google OAuth tokens). Falls back
// to a deterministic derivation of JWT_SECRET when not explicitly set.
export const ENCRYPTION_KEY: string = process.env.ENCRYPTION_KEY || JWT_SECRET;

// CORS
export const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || "http://localhost:3000,http://localhost:5173,http://127.0.0.1:3000")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

// Rate Limiting
export const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
export const RATE_LIMIT_MAX_REQUESTS = 100; // general API budget per window
export const AUTH_RATE_LIMIT_MAX = Number(process.env.AUTH_RATE_LIMIT_MAX || 10); // auth attempts per window
export const WS_CONNECTIONS_PER_MINUTE = Number(process.env.WS_CONNECTIONS_PER_MINUTE || 30);

// Security
export const AGENT_SHARED_SECRET = process.env.AGENT_SHARED_SECRET || "";
export const HELMET_CSP = {
  directives: {
    defaultSrc: ["'self'"],
    // NOTE: 'unsafe-eval' removed (issue: loose CSP). 'unsafe-inline' remains
    // required by Vite's dev/HMR bootstrap; use nonces when serving from a CDN.
    scriptSrc: ["'self'", "'unsafe-inline'", "https://accounts.google.com"],
    styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
    imgSrc: ["'self'", "data:", "https:"],
    connectSrc: ["'self'", "ws:", "wss:", "https:"],
    fontSrc: ["'self'", "data:", "https://fonts.gstatic.com"],
    objectSrc: ["'none'"],
    mediaSrc: ["'self'", "https:"],
    frameSrc: ["'self'", "https://accounts.google.com"],
  },
  crossOriginEmbedderPolicy: false,
};

// Desktop Agent
export const DESKTOP_AGENT_URL = process.env.DESKTOP_AGENT_URL || "http://127.0.0.1:8765";
export const DESKTOP_AGENT_TIMEOUT = 25_000;
export const AGENT_RESPAWN_COOLDOWN_MS = 60_000;

// Data Directory
export const DATA_DIR = process.env.YANTRI_DATA_DIR || process.cwd();

// SQLite database file (transactional store used for users and as a durable
// mirror for JSON state files).
export const DB_FILE = process.env.YANTRI_DB_FILE || `${DATA_DIR}/yantri.db`;

// ── Optional infrastructure (graceful fallbacks when unset) ──────────────────
export const REDIS_URL = process.env.REDIS_URL || "";
export const OTEL_ENABLED = process.env.OTEL_ENABLED === "true";
export const OTEL_SERVICE_NAME = process.env.OTEL_SERVICE_NAME || "yantri-server";

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
export function validateConfig(): { valid: boolean; errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Fatal: authentication enabled in production without a stable signing
  // secret would silently mint ephemeral tokens on every restart.
  if (IS_PRODUCTION && AUTH_REQUIRED && !process.env.JWT_SECRET) {
    errors.push("JWT_SECRET must be set in production when authentication is enabled");
  }

  // Non-fatal advisories.
  if (!GEMINI_API_KEY && !CLOUD_MODE) {
    warnings.push("GEMINI_API_KEY is not set — voice/chat will be unavailable until a key is added in the UI");
  }
  if (IS_PRODUCTION) {
    if (ALLOWED_ORIGINS.some((o) => o.includes("localhost"))) {
      warnings.push("Production ALLOWED_ORIGINS still contains localhost; set ALLOWED_ORIGINS for your real domain");
    }
    if (!AGENT_SHARED_SECRET) {
      warnings.push("AGENT_SHARED_SECRET is not set — the desktop agent bridge is unauthenticated");
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}