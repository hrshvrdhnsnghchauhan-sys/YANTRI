/**
 * YANTRI Server — main entry point.
 *
 * Consolidates the former root server.ts into the modular src/server tree.
 * `./env` MUST be imported first so every later module sees the full .env at
 * module-evaluation time.
 */
import "./env";

import express from "express";
import http from "http";
import path from "path";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import cors from "cors";
import * as fs from "fs";
import {
  PORT,
  IS_PRODUCTION,
  NODE_ENV,
  ALLOWED_ORIGINS,
  RATE_LIMIT_WINDOW_MS,
  RATE_LIMIT_MAX_REQUESTS,
  HELMET_CSP,
  CLOUD_MODE,
  DATA_DIR,
  JWT_SECRET,
  AUTH_REQUIRED,
  validateConfig,
} from "./config";
import { logger, requestLogger, logError as logPinoError } from "./utils/logger";
import { createApiRouter } from "./routes/api";
import { setupWebSocket, connectedClients } from "./routes/websocket";
import { createAuthRouter } from "./routes/auth";
import { authenticate, requireAuth } from "./middleware/auth";
import { logStartup, logError } from "./utils/auditLog";
import { startCloudStorageSync, stopCloudStorageSync } from "./services/server_storage";
import {
  loadReminders,
  startReminderTimer,
  setOnReminderFired,
} from "./services/server_reminders";
import { setOnRecordMutated } from "./services/server_userdata";
import { startDeadlineSync, syncDeadlineReminders } from "./services/server_deadline_sync";
import {
  startCalendarSync,
  syncRecordToCalendar,
  startCalendarImport,
} from "./services/server_calendar_sync";
import { isDesktopAgentAvailable } from "./services/server_bridge";
import { initStorage } from "./db";

const configCheck = validateConfig();
for (const w of configCheck.warnings) console.warn(`[Config] ${w}`);
if (!configCheck.valid) {
  console.error("[Config] Validation errors:", configCheck.errors.join(", "));
  if (IS_PRODUCTION) process.exit(1);
}

async function startServer() {
  const app = express();

  // Security: Helmet for security headers.
  app.use(helmet({ contentSecurityPolicy: HELMET_CSP, crossOriginEmbedderPolicy: false }));

  // Security: strict rate limiting on the API surface.
  const limiter = rateLimit({
    windowMs: RATE_LIMIT_WINDOW_MS,
    max: RATE_LIMIT_MAX_REQUESTS,
    message: { error: "Too many requests, please try again later" },
    standardHeaders: true,
    legacyHeaders: false,
  });
  app.use("/api/", limiter);

  // Security: restricted CORS.
  app.use(
    cors({
      origin: (origin, callback) => {
        if (!origin || ALLOWED_ORIGINS.includes(origin)) {
          callback(null, true);
        } else {
          callback(new Error("Not allowed by CORS"));
        }
      },
      credentials: true,
    })
  );

  // Request logging with request-id correlation.
  app.use(requestLogger());

  // Body size limits (DoS protection).
  app.use(express.json({ limit: "1mb" }));
  app.use(express.urlencoded({ extended: false, limit: "1mb" }));

  const LOGS_DIR = path.join(DATA_DIR, "logs");
  try {
    fs.mkdirSync(LOGS_DIR, { recursive: true });
  } catch {
    /* already exists */
  }

  // Health check (root + /api/health handled by the API router).
  app.get("/health", (_req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  });

  // Authentication routes are always public.
  app.use("/api/auth", createAuthRouter());

  // Everything else under /api requires authentication when AUTH_REQUIRED.
  app.use("/api", authenticate, requireAuth, createApiRouter());

  // Static assets folder.
  app.use("/assets", express.static(path.join(process.cwd(), "assets")));

  const server = http.createServer(app);

  // WebSocket route (/live) — validates the JWT when auth is required.
  setupWebSocket(server);

  // Vite dev middleware / built assets.
  if (!IS_PRODUCTION) {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  // Centralised error handler — never leak internals in production.
  app.use((err: any, _req: any, res: any, _next: any) => {
    logPinoError(logger, err);
    res.status(err?.status || 500).json({ error: "Internal server error" });
  });

  server.listen(PORT, "0.0.0.0", async () => {
    logStartup(`YANTRI server started on http://localhost:${PORT} (${NODE_ENV})`);
    logger.info(`YANTRI listening on port ${PORT} (${IS_PRODUCTION ? "production" : "development"})`);
    logger.info(`Cloud Mode: ${CLOUD_MODE}`);
    logger.info(`Auth required: ${AUTH_REQUIRED}`);
    logger.info(`Allowed Origins: ${ALLOWED_ORIGINS.join(", ")}`);

    // Restore mirrored state from object storage, then keep it synced.
    startCloudStorageSync();

    void isDesktopAgentAvailable().then((online) => {
      logStartup(
        online
          ? "Desktop agent detected at boot."
          : CLOUD_MODE
            ? "Cloud Mode: desktop agent not used (server-only tools active)."
            : "Desktop agent not detected at boot — server-only mode active."
      );
    });

    await loadReminders();
    startReminderTimer();
    setOnReminderFired((reminder) => {
      for (const ws of connectedClients) {
        try {
          ws.send(
            JSON.stringify({
              type: "reminder",
              text: reminder.text,
              id: reminder.id,
              fireAt: reminder.fireAt,
            })
          );
        } catch {
          /* client disconnected */
        }
      }
    });

    setOnRecordMutated(() => {
      void syncDeadlineReminders().catch((e) =>
        console.warn("[DeadlineSync] mutation sync failed:", e?.message || e)
      );
    });
    startDeadlineSync();

    setOnRecordMutated((action, record) => {
      if (!record) return;
      void syncRecordToCalendar(action, record).catch((e) =>
        console.warn("[CalendarSync] mutation sync failed:", e?.message || e)
      );
    });
    startCalendarSync();
    startCalendarImport();
  });

  const shutdown = async (signal: string) => {
    logger.info(`Received ${signal}, shutting down gracefully...`);
    try {
      await stopCloudStorageSync();
    } catch {
      /* best-effort */
    }
    server.close(() => {
      logger.info("HTTP server closed");
      process.exit(0);
    });
    setTimeout(() => {
      logger.error("Forced shutdown after timeout");
      process.exit(1);
    }, 10_000);
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

// Initialise persistence (SQLite) before serving traffic.
initStorage();

startServer().catch((err) => {
  logError(`FATAL_STARTUP: ${err?.message || err}`);
  logPinoError(logger, err as Error);
  process.exit(1);
});

// Re-export for tests / tooling.
export { JWT_SECRET };
