/**
 * YANTRI Server - Main Entry Point
 * Modularized server with separated concerns
 */

import express from "express";
import http from "http";
import dotenv from "dotenv";
import { setupWebSocket } from "./routes/websocket";
import apiRoutes from "./routes/api";
import { PORT, IS_PRODUCTION, ALLOWED_ORIGINS, RATE_LIMIT_WINDOW_MS, RATE_LIMIT_MAX_REQUESTS, HELMET_CSP, CLOUD_MODE, DATA_DIR, validateConfig } from "./config";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import cors from "cors";
import * as fs from "fs";
import { logger, requestLogger, logError } from "./utils/logger";
import { startReminderTimer } from "@services/server_reminders";
import { startDeadlineSync } from "@services/server_deadline_sync";
import { startCalendarSync, startCalendarImport } from "@services/server_calendar_sync";

dotenv.config();

// Validate configuration
const { valid, errors } = validateConfig();
if (!valid) {
  console.error("[Config] Validation errors:", errors.join(", "));
  if (IS_PRODUCTION) process.exit(1);
}

async function startServer() {
  const app = express();
  const server = http.createServer(app);

  // Security: Helmet for security headers
  app.use(helmet({ contentSecurityPolicy: HELMET_CSP }));

  // Security: Rate limiting
  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100,
    message: { error: "Too many requests, please try again later" },
    standardHeaders: true,
    legacyHeaders: false,
  });
  app.use("/api/", limiter);

  // Security: Restricted CORS
  app.use(cors({
    origin: (origin, callback) => {
      if (!origin || ALLOWED_ORIGINS.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error("Not allowed by CORS"));
      }
    },
    credentials: true,
  }));

  // Request logging
  app.use(requestLogger());

  app.use(express.json());

  // Logging directory
  const LOGS_DIR = `${DATA_DIR}/logs`;
  try { fs.mkdirSync(LOGS_DIR, { recursive: true }); } catch { }

  // API Routes
  app.use("/api", apiRoutes);

  // WebSocket
  setupWebSocket(server);

  // Start background services
  import("@services/server_reminders").then(m => m.startReminderTimer());
  import("@services/server_deadline_sync").then(m => m.startDeadlineSync());
  import("@services/server_calendar_sync").then(m => { m.startCalendarSync(); m.startCalendarImport(); });

  // Health check
  app.get("/health", (_req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  });

  // Error handling middleware
  app.use((err: Error, _req: any, res: any, _next: any) => {
    logError(logger, err);
    res.status(500).json({ error: "Internal server error" });
  });

  // Start server
  server.listen(PORT, () => {
    logger.info(`YANTRI listening on port ${PORT} (${IS_PRODUCTION ? "production" : "development"})`);
    logger.info(`Cloud Mode: ${CLOUD_MODE}`);
    logger.info(`Allowed Origins: ${ALLOWED_ORIGINS.join(", ")}`);
  });

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    logger.info(`Received ${signal}, shutting down gracefully...`);
    server.close(() => {
      logger.info("HTTP server closed");
      process.exit(0);
    });
    // Force close after 10s
    setTimeout(() => {
      logger.error("Forced shutdown after timeout");
      process.exit(1);
    }, 10_000);
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

startServer().catch((err) => {
  logError(logger, err);
  process.exit(1);
});