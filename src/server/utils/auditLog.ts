/**
 * YANTRI — append-only command / startup / error logs (Feature 7).
 *
 * Writes timestamped lines to logs/{commands,startup,errors}.log. Never throws;
 * logging failures are swallowed so they cannot break the app. Structured audit
 * events (security) additionally go through utils/logger's auditLogger.
 */
import path from "path";
import * as fs from "fs";
import { DATA_DIR } from "@services/server_paths";

export const LOGS_DIR = path.join(DATA_DIR, "logs");
try {
  fs.mkdirSync(LOGS_DIR, { recursive: true });
} catch {
  /* already exists */
}

function appendLog(fileName: string, message: string): void {
  try {
    const line = `[${new Date().toISOString()}] ${message}\n`;
    fs.appendFile(path.join(LOGS_DIR, fileName), line, () => {});
  } catch {
    /* logging is best-effort */
  }
}

export const logCommand = (m: string) => appendLog("commands.log", m);
export const logStartup = (m: string) => appendLog("startup.log", m);
export const logError = (m: string) => appendLog("errors.log", m);
