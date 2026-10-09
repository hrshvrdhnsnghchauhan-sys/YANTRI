/**
 * YANTRI Structured Logging
 * Uses pino for high-performance JSON logging
 */

import pino from "pino";
import { IS_PRODUCTION, NODE_ENV, DATA_DIR } from "@config/index";
import * as fs from "fs";

// Ensure logs directory exists
const LOGS_DIR = `${DATA_DIR}/logs`;
try { fs.mkdirSync(LOGS_DIR, { recursive: true }); } catch { }

// Pretty printer for development
const prettyTransport = pino.transport({
  target: "pino-pretty",
  options: {
    colorize: true,
    translateTime: "SYS:standard",
    ignore: "pid,hostname",
  },
});

// File transport for production
const fileTransport = pino.transport({
  targets: [
    {
      target: "pino/file",
      options: { destination: `${LOGS_DIR}/app.log` },
      level: "info",
    },
    {
      target: "pino/file",
      options: { destination: `${LOGS_DIR}/error.log` },
      level: "error",
    },
  ],
});

// Create logger
//
// NOTE: no custom `formatters.level` here. With multiple transport targets pino
// warns and DROPS records that don't carry a numeric level, which silently
// discarded production logs (audit/security events included). Keep the default
// numeric level; pino-pretty renders it for humans in development.
export const logger = pino({
  level: process.env.LOG_LEVEL || (IS_PRODUCTION ? "info" : "debug"),
  timestamp: pino.stdTimeFunctions.isoTime,
  base: {
    service: "yantri",
    environment: NODE_ENV,
  },
}, IS_PRODUCTION ? fileTransport : prettyTransport);

// Child logger factory for contextual logging
export function createLogger(context: Record<string, any>) {
  return logger.child(context);
}

// Request logger middleware
export function requestLogger() {
  return (req: any, res: any, next: any) => {
    const start = Date.now();
    const requestId = req.headers["x-request-id"] || Math.random().toString(36).substring(7);
    
    req.id = requestId;
    req.logger = logger.child({ 
      requestId, 
      method: req.method, 
      url: req.url,
      ip: req.ip 
    });

    res.on("finish", () => {
      const duration = Date.now() - start;
      req.logger.info({
        statusCode: res.statusCode,
        durationMs: duration,
      }, `${req.method} ${req.url} ${res.statusCode} ${duration}ms`);
    });

    next();
  };
}

// Error logger helper
export function logError(logger: pino.Logger, error: Error, context?: Record<string, any>) {
  logger.error({ 
    err: {
      message: error.message,
      stack: error.stack,
      name: error.name,
    },
    ...context,
  }, error.message);
}

// Performance timer
export function createTimer(label: string, logger: pino.Logger) {
  const start = process.hrtime.bigint();
  return {
    end: (meta?: Record<string, any>) => {
      const durationMs = Number(process.hrtime.bigint() - start) / 1_000_000;
      logger.debug({ ...meta, durationMs, timer: label }, `${label} completed`);
      return durationMs;
    },
  };
}

// Audit log for security events
export const auditLogger = createLogger({ category: "audit" });

export function logSecurityEvent(
  event: "auth_success" | "auth_failure" | "permission_denied" | "rate_limited" | "suspicious_activity",
  details: Record<string, any>
) {
  auditLogger.warn({ event, ...details }, `Security event: ${event}`);
}

export default logger;