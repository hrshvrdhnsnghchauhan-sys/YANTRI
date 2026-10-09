/**
 * YANTRI — Cloud persistence layer (V5.1).
 *
 * Render's free tier has an EPHEMERAL disk: every redeploy (and daily restart)
 * wipes memories, reminders, settings, profile, user records, Google OAuth
 * tokens and tombstones. This module mirrors those small JSON files to an
 * S3-compatible object store (Cloudflare R2 / Backblaze B2 / AWS S3 — anything
 * that speaks the S3 API) and restores them at boot, so state survives
 * redeploys without a paid Render disk.
 *
 * Design:
 *  - Zero-config when env vars are absent → everything no-ops (logs once).
 *  - Restore is fail-open: if the bucket is unreachable, the app still boots
 *    with local files (they just won't survive the next deploy).
 *  - Uploads are debounced per-file (2s) and coalesced; boot restore happens
 *    before the HTTP server starts accepting traffic where feasible.
 *  - Token file is written with restricted perms locally (best-effort chmod
 *    600); the object store is presumed private (R2/B2 buckets are private by
 *    default — do NOT enable public access).
 *
 * Env vars:
 *   S3_ENDPOINT            e.g. https://<accountid>.r2.cloudflarestorage.com
 *   S3_REGION              "auto" for R2/B2, e.g. us-east-1 for AWS
 *   S3_BUCKET              bucket name
 *   S3_ACCESS_KEY_ID       access key
 *   S3_SECRET_ACCESS_KEY   secret key
 *   YANTRI_SYNC_ROOT       optional: subfolder (prefix) inside the bucket
 *   YANTRI_SYNC_INTERVAL_MS  optional periodic full-flush (default 300000 = 5 min)
 *
 * Files mirrored (kept in one place so future stores join the list):
 *   secrets.json, settings.json, memories.json, reminders.json,
 *   profile.json, userdata.json, google_tokens.json, calendar_tombstones.json
 */

import * as fs from "fs";
import { DATA_DIR, dataFile } from "./server_paths";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const S3_ENDPOINT = process.env.S3_ENDPOINT?.trim() || "";
const S3_REGION = process.env.S3_REGION?.trim() || "auto";
const S3_BUCKET = process.env.S3_BUCKET?.trim() || "";
const S3_ACCESS_KEY_ID = process.env.S3_ACCESS_KEY_ID?.trim() || "";
const S3_SECRET_ACCESS_KEY = process.env.S3_SECRET_ACCESS_KEY?.trim() || "";
const SYNC_ROOT = (process.env.YANTRI_SYNC_ROOT?.trim() || "yantri").replace(/^\/+|\/+$/g, "");
const SYNC_INTERVAL_MS = Math.max(30_000, Number(process.env.YANTRI_SYNC_INTERVAL_MS || 300_000));

/** Whether the cloud mirror is configured and should be active. */
export function isCloudStorageConfigured(): boolean {
  return Boolean(S3_ENDPOINT && S3_BUCKET && S3_ACCESS_KEY_ID && S3_SECRET_ACCESS_KEY);
}

/** Files that must survive redeploys (basenames inside DATA_DIR). */
const SYNC_FILES = [
  "secrets.json",
  "settings.json",
  "memories.json",
  "reminders.json",
  "profile.json",
  "userdata.json",
  "google_tokens.json",
  "calendar_tombstones.json",
] as const;

// ---------------------------------------------------------------------------
// AWS SDK v3 — lazily imported so dev machines without the package still work
// (the module is a normal dependency, but a lazy load keeps boot failure-free).
// ---------------------------------------------------------------------------

type S3ClientT = any;
type S3ModuleT = any;

let s3Module: S3ModuleT | null = null;
let s3Client: S3ClientT | null = null;

async function getS3Client(): Promise<S3ClientT | null> {
  if (!isCloudStorageConfigured()) return null;
  if (s3Client) return s3Client;
  try {
    if (!s3Module) {
      // @ts-ignore — optional at runtime in exotic deploys; bundled normally.
      s3Module = await import("@aws-sdk/client-s3");
    }
    const { S3Client } = s3Module;
    s3Client = new S3Client({
      region: S3_REGION,
      endpoint: S3_ENDPOINT,
      forcePathStyle: true, // required by R2/B2-style endpoints
    });
    return s3Client;
  } catch (e: any) {
    console.warn("[CloudStorage] @aws-sdk/client-s3 unavailable:", e?.message || e);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Low-level object operations
// ---------------------------------------------------------------------------

async function putObject(key: string, body: string): Promise<void> {
  const client = await getS3Client();
  if (!client) return;
  const { PutObjectCommand } = s3Module;
  await client.send(
    new PutObjectCommand({
      Bucket: S3_BUCKET,
      Key: key,
      Body: body,
      ContentType: "application/json; charset=utf-8",
    })
  );
}

async function getObject(key: string): Promise<string | null> {
  const client = await getS3Client();
  if (!client) return null;
  const { GetObjectCommand } = s3Module;
  try {
    const res = await client.send(new GetObjectCommand({ Bucket: S3_BUCKET, Key: key }));
    const bytes = await res.Body.transformToByteArray();
    return Buffer.from(bytes).toString("utf-8");
  } catch (e: any) {
    const name = String(e?.name || e?.code || "");
    if (name === "NoSuchKey" || name === "404") return null;
    throw e;
  }
}

function objectKey(basename: string): string {
  return `${SYNC_ROOT}/${basename}`;
}

// ---------------------------------------------------------------------------
// Restore (boot) — pull cloud copies down over any stale local files
// ---------------------------------------------------------------------------

let restored = false;

/**
 * Restore mirrored files from the object store into DATA_DIR. Fail-open:
 * any error is logged and boot continues with local files.
 */
export async function restoreFromCloud(): Promise<{ restored: string[]; skipped: string[] }> {
  if (restored) return { restored: [], skipped: [] };
  if (!isCloudStorageConfigured()) return { restored: [], skipped: [] };
  restored = true;

  const got: string[] = [];
  const skipped: string[] = [];

  for (const name of SYNC_FILES) {
    try {
      const body = await getObject(objectKey(name));
      if (body == null) {
        skipped.push(name);
        continue;
      }
      const localPath = dataFile(name);
      // Safety: don't clobber a strictly-newer local file (e.g. a fast
      // in-process write that happened before boot restore finished).
      try {
        if (fs.existsSync(localPath)) {
          const cloud = safeJsonParse(body);
          const local = safeJsonParse(fs.readFileSync(localPath, "utf-8"));
          if (cloud?.updatedAt && local?.updatedAt && Number(local.updatedAt) > Number(cloud.updatedAt)) {
            skipped.push(name);
            queueUpload(name); // push the newer local copy up
            continue;
          }
        }
      } catch {
        /* fall through and restore cloud copy */
      }
      fs.writeFileSync(localPath, body, "utf-8");
      got.push(name);
    } catch (e: any) {
      console.warn(`[CloudStorage] restore failed for ${name}:`, e?.message || e);
      skipped.push(name);
    }
  }

  if (got.length) {
    console.log(`[CloudStorage] restored ${got.length} file(s) from object storage: ${got.join(", ")}`);
  } else {
    console.log("[CloudStorage] nothing to restore (fresh bucket or files unchanged).");
  }
  return { restored: got, skipped };
}

function safeJsonParse(s: string): any {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Upload (debounced per file)
// ---------------------------------------------------------------------------

const pending = new Map<string, ReturnType<typeof setTimeout>>();
const inflight = new Set<string>();

/**
 * Queue an upload of one mirrored file. Debounced 2s per file so a burst of
 * writes (e.g. memory extraction after every turn) coalesces into one PUT.
 */
export function queueUpload(basename: string): void {
  if (!isCloudStorageConfigured()) return;
  if (!SYNC_FILES.includes(basename as any)) return;

  const existing = pending.get(basename);
  if (existing) clearTimeout(existing);

  const timer = setTimeout(async () => {
    pending.delete(basename);
    if (inflight.has(basename)) {
      // An upload for this file is running; re-queue to catch the latest.
      queueUpload(basename);
      return;
    }
    inflight.add(basename);
    try {
      const localPath = dataFile(basename);
      if (!fs.existsSync(localPath)) return;
      const body = fs.readFileSync(localPath, "utf-8");
      await putObject(objectKey(basename), body);
    } catch (e: any) {
      console.warn(`[CloudStorage] upload failed for ${basename}:`, e?.message || e);
    } finally {
      inflight.delete(basename);
    }
  }, 2000);

  pending.set(basename, timer);
}

/**
 * Upload every mirrored file immediately (used at shutdown and on a timer).
 */
export async function flushAllToCloud(): Promise<{ uploaded: string[]; failed: string[] }> {
  const uploaded: string[] = [];
  const failed: string[] = [];
  if (!isCloudStorageConfigured()) return { uploaded, failed };

  // Cancel pending debounced timers — flushAll reads straight from disk.
  for (const t of pending.values()) clearTimeout(t);
  pending.clear();

  for (const name of SYNC_FILES) {
    try {
      const localPath = dataFile(name);
      if (!fs.existsSync(localPath)) continue;
      const body = fs.readFileSync(localPath, "utf-8");
      await putObject(objectKey(name), body);
      uploaded.push(name);
    } catch (e: any) {
      console.warn(`[CloudStorage] flush failed for ${name}:`, e?.message || e);
      failed.push(name);
    }
  }
  return { uploaded, failed };
}

// ---------------------------------------------------------------------------
// Boot + periodic flush
// ---------------------------------------------------------------------------

let flushTimer: ReturnType<typeof setInterval> | null = null;

export function startCloudStorageSync(): void {
  if (!isCloudStorageConfigured()) {
    console.log("[CloudStorage] not configured (S3_ENDPOINT/S3_BUCKET/S3_ACCESS_KEY_ID/S3_SECRET_ACCESS_KEY) — state lives on the local disk only.");
    return;
  }
  console.log(`[CloudStorage] enabled → endpoint=${S3_ENDPOINT} bucket=${S3_BUCKET} root=${SYNC_ROOT}/`);
  // Boot restore, then a safety full-flush so a fresh deploy immediately
  // backs up whatever it has (e.g. secrets.json written during onboarding).
  void (async () => {
    await restoreFromCloud();
    await flushAllToCloud();
  })().catch((e) => console.warn("[CloudStorage] boot sync failed:", e?.message || e));

  // Periodic safety flush (also coalesces any missed debounced uploads).
  if (!flushTimer) {
    flushTimer = setInterval(() => {
      void flushAllToCloud().catch(() => {});
    }, SYNC_INTERVAL_MS);
  }
}

/** Hook a JSON-file write so it mirrors automatically. Call after imports. */
export function watchDataFile(basename: string): void {
  // Explicit queueUpload — we deliberately avoid fs.watch (unreliable across
  // platforms and noisy). Data layers call this after each save.
  queueUpload(basename);
}

/** Flush + stop timers (call from the graceful shutdown path). */
export async function stopCloudStorageSync(): Promise<void> {
  if (flushTimer) {
    clearInterval(flushTimer);
    flushTimer = null;
  }
  await flushAllToCloud().catch(() => {});
}

// ---------------------------------------------------------------------------
// Convenience: read+write helpers that auto-mirror, for new code paths.
// Existing modules keep using fs directly and call queueUpload after saves.
// ---------------------------------------------------------------------------

export function readMirroredJson<T>(basename: string, fallback: T): T {
  try {
    const p = dataFile(basename);
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, "utf-8")) as T;
  } catch {
    /* fall through */
  }
  return fallback;
}

export function writeMirroredJson(basename: string, value: unknown): void {
  fs.writeFileSync(dataFile(basename), JSON.stringify(value, null, 2), "utf-8");
  queueUpload(basename);
}

// Re-export path joiner for tests/tools.
export const cloudKeyFor = objectKey;
