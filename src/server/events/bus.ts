/**
 * Cross-instance broadcast bus (issue 13).
 *
 * The in-memory `connectedClients` set only works for a single replica. When
 * REDIS_URL is configured this module fans WebSocket broadcasts out over Redis
 * pub/sub so every replica can deliver to its own clients. Without REDIS_URL it
 * is a no-op: `publishBroadcast` still delivers locally, exactly as before.
 */
import { randomUUID } from "crypto";
import { REDIS_URL } from "../config";
import { logger } from "../utils/logger";

const CHANNEL = "yantri:ws";
const INSTANCE_ID = randomUUID();

type BroadcastHandler = (payload: unknown) => void;

let pub: any = null;
let sub: any = null;
let handler: BroadcastHandler | null = null;

export function isRedisEnabled(): boolean {
  return Boolean(REDIS_URL);
}

/** Register the local delivery handler and (optionally) connect to Redis. */
export async function initEventBus(onLocalBroadcast: BroadcastHandler): Promise<void> {
  handler = onLocalBroadcast;
  if (!REDIS_URL) {
    logger.info("[EventBus] REDIS_URL not set — in-memory broadcast only (single instance).");
    return;
  }
  try {
    const { default: Redis } = await import("ioredis");
    pub = new Redis(REDIS_URL);
    sub = new Redis(REDIS_URL);
    await sub.subscribe(CHANNEL);
    sub.on("message", (_channel: string, message: string) => {
      try {
        const envelope = JSON.parse(message) as { source: string; payload: unknown };
        // Ignore our own publishes — we already delivered locally.
        if (envelope.source === INSTANCE_ID) return;
        handler?.(envelope.payload);
      } catch {
        /* ignore malformed frames */
      }
    });
    logger.info("[EventBus] Redis pub/sub enabled for multi-instance broadcast.");
  } catch (e: any) {
    logger.warn(`[EventBus] Redis unavailable, falling back to in-memory broadcast: ${e?.message || e}`);
    pub = null;
    sub = null;
  }
}

/** Deliver to local clients and, when configured, to every other replica. */
export function publishBroadcast(payload: unknown): void {
  handler?.(payload);
  if (pub) {
    try {
      void pub.publish(CHANNEL, JSON.stringify({ source: INSTANCE_ID, payload }));
    } catch {
      /* best-effort */
    }
  }
}

export async function stopEventBus(): Promise<void> {
  try {
    await pub?.quit();
    await sub?.quit();
  } catch {
    /* ignore */
  }
  pub = null;
  sub = null;
}
