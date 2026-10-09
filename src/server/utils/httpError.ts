/**
 * Consistent error responses (issue 9).
 *
 * Logs the full error internally (structured + audit log) but never leaks
 * stack traces or internal messages to clients in production.
 */
import type { Response } from "express";
import { IS_PRODUCTION } from "../config";
import { logger, logError as logPinoError } from "./logger";
import { logError as logAuditError } from "./auditLog";

export function handleError(res: Response, error: unknown, context?: string): void {
  const err = error instanceof Error ? error : new Error(String(error));
  logPinoError(logger, err, context ? { context } : undefined);
  if (context) logAuditError(`${context}: ${err.message}`);
  if (res.headersSent) return;
  res.status(500).json({ error: IS_PRODUCTION ? "Internal server error" : err.message });
}
