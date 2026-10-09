/**
 * Encryption at rest (issue 16).
 *
 * AES-256-GCM using a key derived from ENCRYPTION_KEY (falls back to
 * JWT_SECRET). Ciphertext is a self-describing string so plaintext legacy
 * files can still be read transparently:
 *
 *   enc:v1:<iv-b64>:<tag-b64>:<ciphertext-b64>
 */
import crypto from "crypto";
import { ENCRYPTION_KEY } from "../config";

function key(): Buffer {
  return crypto.createHash("sha256").update(ENCRYPTION_KEY).digest();
}

export function encryptJson(data: unknown): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([cipher.update(JSON.stringify(data), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `enc:v1:${iv.toString("base64")}:${tag.toString("base64")}:${enc.toString("base64")}`;
}

export function isEncrypted(text: string): boolean {
  return typeof text === "string" && text.startsWith("enc:v1:");
}

/**
 * Decrypt an encrypted payload, or JSON.parse a legacy plaintext payload.
 * Returns null on any failure (corrupt file, wrong key, invalid JSON).
 */
export function decryptJson<T>(text: string): T | null {
  if (!text) return null;
  if (!isEncrypted(text)) {
    try {
      return JSON.parse(text) as T;
    } catch {
      return null;
    }
  }
  const parts = text.split(":");
  if (parts.length !== 5) return null;
  const [, , ivB64, tagB64, dataB64] = parts;
  try {
    const decipher = crypto.createDecipheriv("aes-256-gcm", key(), Buffer.from(ivB64, "base64"));
    decipher.setAuthTag(Buffer.from(tagB64, "base64"));
    const out = Buffer.concat([decipher.update(Buffer.from(dataB64, "base64")), decipher.final()]);
    return JSON.parse(out.toString("utf8")) as T;
  } catch {
    return null;
  }
}
