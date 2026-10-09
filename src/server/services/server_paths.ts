/**
 * YANTRI — path & secret resolution.
 *
 * Separates read-only *code/asset* locations (shipped with the app) from the
 * writable *data* location (per-user, survives reinstalls). In development both
 * collapse to the project root, so existing behaviour is unchanged. When the
 * packaged Electron app launches the backend it sets YANTRI_DATA_DIR to a
 * writable folder under %APPDATA%\YANTRI, because the install directory
 * (Program Files) is read-only.
 *
 * The Gemini API key is NOT shipped with the app. Each user supplies their own
 * on first run; it is stored here in the per-user data dir (never returned to
 * the frontend).
 */

import fs from "fs";
import path from "path";
import { queueUpload } from "./server_storage";
import { mirrorJson } from "../db";
import { writeTextAtomicSync } from "../utils/persist";

/** Writable per-user data directory. Falls back to cwd in development. */
export const DATA_DIR: string = process.env.YANTRI_DATA_DIR || process.cwd();

try {
  fs.mkdirSync(DATA_DIR, { recursive: true });
} catch {
  /* already exists / best-effort */
}

/** Absolute path to a file inside the writable data directory. */
export function dataFile(name: string): string {
  return path.join(DATA_DIR, name);
}

// ---------------------------------------------------------------------------
// Gemini API key store (secrets.json in the data dir).
// ---------------------------------------------------------------------------
const SECRETS_FILE = dataFile("secrets.json");

interface Secrets {
  geminiApiKey?: string;
}

function readSecrets(): Secrets {
  try {
    if (fs.existsSync(SECRETS_FILE)) {
      return JSON.parse(fs.readFileSync(SECRETS_FILE, "utf-8")) as Secrets;
    }
  } catch {
    /* corrupt — treat as empty */
  }
  return {};
}

/**
 * Resolve the active Gemini API key.
 *
 * Resolution order:
 *   1. GEMINI_API_KEY environment variable (.env or host) — the canonical,
 *      deployment-friendly source. Nothing is written to disk and the
 *      Settings onboarding gate is satisfied automatically.
 *   2. secrets.json in the data dir — the key pasted in the UI by a desktop
 *      user who never set the env var.
 */
export function getGeminiApiKey(): string | undefined {
  const fromEnv = process.env.GEMINI_API_KEY?.trim();
  if (fromEnv) return fromEnv;
  return readSecrets().geminiApiKey?.trim() || undefined;
}

/** Whether any usable key is configured (without revealing it). */
export function hasGeminiApiKey(): boolean {
  return Boolean(getGeminiApiKey());
}

/** Persist a user-supplied key to the per-user secrets file. */
export function setGeminiApiKey(key: string): void {
  const trimmed = (key || "").trim();
  if (!trimmed) throw new Error("API key must not be empty.");
  const current = readSecrets();
  current.geminiApiKey = trimmed;
  writeTextAtomicSync(SECRETS_FILE, JSON.stringify(current, null, 2));
  mirrorJson("secrets.json", current);
  queueUpload("secrets.json"); // V5.1: mirror to cloud object storage if configured
  try {
    fs.chmodSync(SECRETS_FILE, 0o600); // owner-only where supported
  } catch {
    /* Windows ACLs differ; best-effort */
  }
}

/** Remove the stored key (used by "reset"/sign-out flows). */
export function clearGeminiApiKey(): void {
  const current = readSecrets();
  delete current.geminiApiKey;
  try {
    writeTextAtomicSync(SECRETS_FILE, JSON.stringify(current, null, 2));
    mirrorJson("secrets.json", current);
  } catch {
    /* best-effort */
  }
}
