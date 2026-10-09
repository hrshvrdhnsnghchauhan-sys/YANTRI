import express from "express";
import http from "http";
import path from "path";
import { WebSocketServer } from "ws";
import { GoogleGenAI, Modality, Type, LiveServerMessage } from "@google/genai";
import "./server_env"; // MUST come first: loads .env before env-derived consts are evaluated
import dotenv from "dotenv";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import * as fs from "fs";
import { spawn, execSync } from "child_process";
import { 
  loadMemories, 
  saveMemories, 
  formatSystemInstructionsWithMemories, 
  processConversationSlice 
} from "./server_memory";
import {
  loadReminders,
  addReminder,
  getReminders,
  cancelReminder,
  startReminderTimer,
  setOnReminderFired,
} from "./server_reminders";
import { Memory } from "./src/lib/memoryTypes";
import { Reminder } from "./src/lib/reminderTypes";
import {
  loadProfile,
  saveProfile,
  buildPersonaBlockAsync,
  getAllowedToolNames,
} from "./server_profile";
import {
  saveRecord,
  queryRecords,
  updateRecord,
  deleteRecord,
  countByType,
  setOnRecordMutated,
} from "./server_userdata";
import { startDeadlineSync, syncDeadlineReminders } from "./server_deadline_sync";
import { startCalendarSync, syncRecordToCalendar, importExamsFromCalendar, startCalendarImport } from "./server_calendar_sync";
import {
  googleAuthUrl,
  googleRedirectUri,
  saveGoogleAuthCode,
  clearGoogleTokens,
  hasGoogleCredentials,
  hasGoogleTokens,
  isGoogleNodeReady,
  googleListEvents,
  googleSearchEvents,
  googleCreateEvent,
  googleUpdateEvent,
  googleDeleteEvent,
  googleSendEmail,
  googleListEmails,
  googleReadEmail,
  googleListTasks,
  googleCreateTask,
} from "./server_google";
import { findFirstYouTubeVideo } from "./server_youtube";
import { getWeatherServer, getNewsServer } from "./server_weather_news";
import { searchTavily, formatTavilyResult, searchTavilyQuick, searchTavilyDeep } from "./server_tavily";
import {
  startCloudStorageSync,
  stopCloudStorageSync,
  isCloudStorageConfigured,
  queueUpload,
} from "./server_storage";
import { callDesktopAgent, ensureDesktopAgent, isDesktopAgentAvailable, getDesktopAgentUnavailability, DESKTOP_AGENT_URL, IS_CLOUD_MODE } from "./server_bridge";
import {
  storeDraft,
  takeDraft,
  peekDraft,
  wsKeyFor,
  parseRecipients,
  normalizeRecipients,
  composeEmail,
  mergeDraftWithArgs,
} from "./server_email_draft";
import {
  DATA_DIR,
  dataFile,
  getGeminiApiKey,
  hasGeminiApiKey,
  setGeminiApiKey,
} from "./server_paths";

dotenv.config();

// ---------------------------------------------------------------------------
// YANTRI V2 — Logging (Feature 7).
// Appends timestamped lines to logs/{commands,startup,errors}.log.
// Never throws; logging failures are swallowed so they can't break the app.
// ---------------------------------------------------------------------------
const LOGS_DIR = path.join(DATA_DIR, "logs");
try { fs.mkdirSync(LOGS_DIR, { recursive: true }); } catch { /* already exists */ }

function appendLog(fileName: string, message: string): void {
  try {
    const line = `[${new Date().toISOString()}] ${message}\n`;
    fs.appendFile(path.join(LOGS_DIR, fileName), line, () => {});
  } catch {
    /* logging is best-effort */
  }
}
const logCommand = (m: string) => appendLog("commands.log", m);
const logStartup = (m: string) => appendLog("startup.log", m);
const logError = (m: string) => appendLog("errors.log", m);

/**
 * The complete set of tool names routed to the Python desktop agent.
 * Kept in sync with agent/registry.py DESKTOP_TOOL_NAMES.
 */
const DESKTOP_TOOLS: ReadonlySet<string> = new Set([
  // applications / websites / search
  "openApplication", "closeApplication", "openWebsite",
  "searchWeb", "searchYouTube", "searchGoogle", "searchGitHub",
  // files
  "createFile", "readFile", "renameFile", "deleteFile", "moveFile",
  "openFolder", "listFiles", "searchFiles",
  // pc control (volume + gated power)
  "volumeUp", "volumeDown", "muteToggle", "setVolume",
  "requestPowerAction", "executePowerAction",
  // windows
  "minimizeWindow", "maximizeWindow", "closeWindow", "switchApplication",
  // clipboard
  "copySelected", "pasteClipboard", "getClipboard", "clearClipboard",
  // screenshot / screen reading
  "takeScreenshot", "saveScreenshot", "analyzeScreenshot", "readScreen",
  // browser automation (Playwright — desktop-owned, separate from holographic UI)
  "desktopBrowserOpen", "desktopBrowserNavigate", "desktopBrowserOpenTab",
  "desktopBrowserCloseTab", "desktopBrowserSearch", "desktopBrowserOpenYoutubeVideo",
  "desktopBrowserClick", "desktopBrowserType", "desktopBrowserFillForm", "desktopBrowserGoBack",
  "desktopBrowserGoForward", "desktopBrowserScroll",
  "desktopBrowserReadText", "desktopBrowserGetLinks",
  "desktopBrowserSetMode", "browserMediaControl",
  // coding assistance
  "createPythonFile", "runPythonScript", "createProjectFolder", "writeCodeFile",
  // system information
  "systemInfo", "gpuInfo", "temperatureInfo",
  // brightness control (V2)
  "brightnessUp", "brightnessDown", "setBrightness",
  // Windows auto-start management (V2)
  "enableAutoStart", "disableAutoStart", "getAutoStartStatus",
  // terminal
  "requestTerminalAction", "runTerminalCommand", "installPackage",
  "provideSudoPassword", "isCommandAllowed",
  // IITM BS (V2)
  "iitmQuickLinks", "iitmOpen", "iitmOpenCustom",
  // client-side holographic browser tools (routed to Python agent)
  "browserTabAction",
  // self-close
  "shutdownYantri",
  // weather
  "getWeather",
  // Hyprland workspace
  "switchWorkspace", "listWorkspaces", "moveToWorkspace",
  // news
  "getNews",
  // conversation export
  "exportConversation", "listExports",
  // Google Calendar, Gmail, Tasks
  "getCalendarEvents", "createCalendarEvent",
  "sendEmail", "getEmails",
  "getTasks", "createTask",
  // OS input
  "osType", "osPress", "osClick",
  // camera control
  "cameraList", "cameraOn", "cameraOff",
  // V4 role-feature tools: study/focus + spreadsheets + document extraction
  "startPomodoro", "startFocusMode", "stopFocusMode", "getFocusStatus",
  "extractDocumentText",
  "writeSpreadsheet", "appendSpreadsheetRows", "readSpreadsheet", "summarizeSpreadsheet",
  "logInventoryEntry",
]);

/**
 * Names in DESKTOP_TOOLS that ALSO have a server-native (or client-side)
 * implementation outside the desktop agent. These stay offered to Gemini
 * even when the agent is absent (cloud mode / server-only / agent-down):
 *
 *   - getWeather / getNews → Node implementation in the dispatcher, checked
 *     before the DESKTOP_TOOLS branch (server_weather_news.ts).
 *   - searchTavily → Node implementation (Tavily AI search).
 *   - openWebsite / browserTabAction / browserMediaControl → forwarded to
 *     the connected browser client's holographic browser (the dispatcher's
 *     final `else` forwards unknown names as toolCall over the /live WS).
 *
 * Everything else in DESKTOP_TOOLS genuinely requires the user's machine
 * (files, terminal, volume, desktop Playwright, ...) and is gated out.
 */
const SERVER_TOOLS: ReadonlySet<string> = new Set([
  "getWeather",            // server_weather_news.ts (wttr.in)
  "getNews",              // server_weather_news.ts (Google News RSS)
  "searchTavily",          // server_tavily.ts (Tavily AI search)
  "openWebsite",           // client holographic browser (or agent's default-browser opener when present)
  "browserTabAction",      // client holographic browser tabs
  "browserMediaControl",   // client holographic player play/pause/volume/skip
]);

/**
 * Desktop-agent bridge now lives in server_bridge.ts (shared with
 * server_calendar_sync.ts). `callDesktopAgent` is imported at the top.
 */

// Track connected WebSocket clients for reminder notifications.
const connectedClients = new Set<any>();

/** Monotonic id per WS connection — keys per-client email drafts. */
let nextClientId = 1;

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT || 3000);

  // Security: Helmet for security headers
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:", "https:"],
        connectSrc: ["'self'", "ws:", "wss:", "https:"],
        fontSrc: ["'self'", "data:"],
        objectSrc: ["'none'"],
        mediaSrc: ["'self'", "https:"],
        frameSrc: ["'none'"],
      },
    },
    crossOriginEmbedderPolicy: false,
  }));

  // Security: Rate limiting
  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // limit each IP to 100 requests per windowMs
    message: { error: "Too many requests, please try again later" },
    standardHeaders: true,
    legacyHeaders: false,
  });
  app.use("/api/", limiter);

  // Security: Restricted CORS
  const allowedOrigins = process.env.ALLOWED_ORIGINS 
    ? process.env.ALLOWED_ORIGINS.split(",").map(o => o.trim())
    : ["http://localhost:3000", "http://localhost:5173", "http://127.0.0.1:3000"];
  
  app.use(cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error("Not allowed by CORS"));
      }
    },
    credentials: true,
  }));

  app.use(express.json());

  // Memory REST API Endpoints
  app.get("/api/memories", async (req, res) => {
    try {
      const memories = await loadMemories();
      res.json(memories);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/memories", async (req, res) => {
    try {
      const { category, text } = req.body;
      if (!category || !text) {
        return res.status(400).json({ error: "Category and text parameters are required." });
      }
      const memories = await loadMemories();
      const timestamp = new Date().toISOString();
      const newMemory: Memory = {
        id: Math.random().toString(36).substring(2, 11),
        category,
        text,
        createdAt: timestamp,
        updatedAt: timestamp
      };
      memories.push(newMemory);
      await saveMemories(memories);
      res.status(201).json(newMemory);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.delete("/api/memories/:id", async (req, res) => {
    try {
      const { id } = req.params;
      let memories = await loadMemories();
      memories = memories.filter(m => m.id !== id);
      await saveMemories(memories);
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ---------------------------------------------------------------------------
  // V5: Google OAuth (server-native Calendar/Gmail/Tasks without the desktop
  // agent). BYO credentials: GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET env vars.
  // ---------------------------------------------------------------------------
  app.get("/api/google/status", (req, res) => {
    res.json({
      configured: hasGoogleCredentials(),
      connected: isGoogleNodeReady(),
      authUrl: hasGoogleCredentials() ? googleAuthUrl(req.headers.origin) : null,
    });
  });

  app.get("/api/google/auth", (req, res) => {
    if (!hasGoogleCredentials()) {
      return res.status(400).send(
        "Google OAuth is not configured on this server. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET, then restart."
      );
    }
    res.redirect(googleAuthUrl(req.headers.origin));
  });

  app.get("/api/google/callback", async (req, res) => {
    try {
      const code = String(req.query.code || "");
      if (!code) return res.status(400).send("Missing OAuth code.");
      await saveGoogleAuthCode(code);
      logCommand("GOOGLE_OAUTH_CONNECTED");
      res.send(
        `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Yantri — Google connected</title></head>` +
        `<body style="font-family:monospace;background:#05070d;color:#67e8f9;display:grid;place-items:center;height:100vh">` +
        `<div style="text-align:center"><h1>✓ Google connected</h1><p>Gmail, Calendar and Tasks are now server-native.</p>` +
        `<p>You can close this tab and return to Yantri.</p></div></body></html>`
      );
    } catch (e: any) {
      logError(`GOOGLE_OAUTH_CALLBACK_FAILED: ${e?.message || e}`);
      res.status(500).send(`Google OAuth failed: ${e?.message || e}`);
    }
  });

  app.post("/api/google/disconnect", (_req, res) => {
    clearGoogleTokens();
    logCommand("GOOGLE_OAUTH_DISCONNECTED");
    res.json({ ok: true });
  });

  // ---------------------------------------------------------------------------
  // V2: Reminder API — schedule timed reminders that fire via WebSocket.
  // ---------------------------------------------------------------------------
  app.get("/api/reminders", async (_req, res) => {
    try {
      res.json(getReminders());
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/reminders", async (req, res) => {
    try {
      const { text, minutes } = req.body;
      if (!text || typeof minutes !== "number" || minutes <= 0) {
        return res.status(400).json({ error: "text and positive minutes are required." });
      }
      const reminder = addReminder(String(text), minutes);
      logCommand(`REMINDER_SET ${text} in ${minutes}m`);
      res.status(201).json(reminder);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.delete("/api/reminders/:id", async (req, res) => {
    try {
      const ok = cancelReminder(req.params.id);
      if (!ok) return res.status(404).json({ error: "Reminder not found." });
      logCommand(`REMINDER_CANCEL id=${req.params.id}`);
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ---------------------------------------------------------------------------
  // V4: User Profile API — role-based onboarding (email → role → features).
  // ---------------------------------------------------------------------------
  app.get("/api/profile", async (_req, res) => {
    try {
      const profile = await loadProfile();
      res.json(profile || {});
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/profile", async (req, res) => {
    try {
      const { email, name, role, features } = req.body || {};
      if (!email || typeof email !== "string" || !email.includes("@")) {
        return res.status(400).json({ error: "A valid email is required." });
      }
      const validRoles = ["student", "professional", "business_owner"];
      if (!validRoles.includes(role)) {
        return res.status(400).json({ error: "role must be one of: " + validRoles.join(", ") });
      }
      if (!Array.isArray(features)) {
        return res.status(400).json({ error: "features must be an array of feature ids." });
      }
      const profile = await saveProfile({ email, name, role, features });
      logCommand(`PROFILE_SAVED ${profile.email} role=${profile.role} features=${profile.features.join(",")}`);
      res.json(profile);
    } catch (e: any) {
      logError(`PROFILE_SAVE_ERROR: ${e?.message || e}`);
      res.status(500).json({ error: e?.message || "Failed to save profile." });
    }
  });

  // ---------------------------------------------------------------------------
  // V4: User Data Records API — flexible store for role-feature data
  // (deadlines, notes, flashcards, attendance, meetings, inventory, ...).
  // ---------------------------------------------------------------------------
  app.get("/api/userdata", async (req, res) => {
    try {
      const records = await queryRecords({
        type: req.query.type as string | undefined,
        tag: req.query.tag as string | undefined,
        search: req.query.search as string | undefined,
        dueBefore: req.query.dueBefore as string | undefined,
        dueAfter: req.query.dueAfter as string | undefined,
        limit: req.query.limit ? Number(req.query.limit) : undefined,
      });
      res.json(records);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/userdata", async (req, res) => {
    try {
      const { type, title, payload, due, tags, id } = req.body || {};
      if (!type || !title) {
        return res.status(400).json({ error: "type and title are required." });
      }
      const rec = await saveRecord({ type, title, payload, due, tags, id });
      res.status(201).json(rec);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.patch("/api/userdata/:id", async (req, res) => {
    try {
      const rec = await updateRecord(req.params.id, req.body || {});
      if (!rec) return res.status(404).json({ error: "Record not found." });
      res.json(rec);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.delete("/api/userdata/:id", async (req, res) => {
    try {
      const ok = await deleteRecord(req.params.id);
      if (!ok) return res.status(404).json({ error: "Record not found." });
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/userdata/stats", async (_req, res) => {
    try {
      res.json(await countByType());
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ---------------------------------------------------------------------------
  // V2: Settings API — mirrors the memory persistence pattern.
  // Reads/writes settings.json so the Python agent can also check auto-start.
  // ---------------------------------------------------------------------------
  const SETTINGS_FILE = dataFile("settings.json");

  function loadSettingsFile(): Record<string, unknown> {
    try {
      if (fs.existsSync(SETTINGS_FILE)) {
        return JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf-8"));
      }
    } catch { /* corrupt file — return defaults */ }
    return {};
  }

  function saveSettingsFile(data: Record<string, unknown>): void {
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(data, null, 2), "utf-8");
    queueUpload("settings.json"); // V5.1: mirror to cloud object storage if configured
  }

  app.get("/api/settings", async (_req, res) => {
    try {
      res.json(loadSettingsFile());
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/settings", async (req, res) => {
    try {
      const patch = req.body;
      if (!patch || typeof patch !== "object") {
        return res.status(400).json({ error: "Request body must be a JSON object." });
      }
      const current = loadSettingsFile();
      const next = { ...current, ...patch };
      saveSettingsFile(next);

      // If auto-start toggled, relay to the desktop agent so the registry key
      // is flipped immediately (don't wait for a voice command).
      if ("autoStart" in patch) {
        callDesktopAgent(patch.autoStart ? "enableAutoStart" : "disableAutoStart", {})
          .catch(() => {});
      }

      logCommand(`SETTINGS_UPDATED ${JSON.stringify(patch)}`);
      res.json(next);
    } catch (e: any) {
      logError(`SETTINGS_SAVE_ERROR: ${e.message}`);
      res.status(500).json({ error: e.message });
    }
  });

  // ---------------------------------------------------------------------------
  // Config / API-key onboarding.
  // The Gemini key is never shipped; each user supplies their own on first run
  // (or sets GEMINI_API_KEY in .env / the host dashboard — server_paths.ts
  // resolves env first). GET reports only whether a key exists — the key
  // itself is never returned.
  // ---------------------------------------------------------------------------
  app.get("/api/config", async (_req, res) => {
    res.json({
      hasApiKey: hasGeminiApiKey(),
      // Deployment capability flags — drive UI affordances (Settings panel,
      // onboarding, tool gating) without hardcoding environment knowledge in
      // the frontend. agentAvailable is a cheap non-spawning health ping.
      cloudMode: IS_CLOUD_MODE,
      agentAvailable: IS_CLOUD_MODE ? false : await isDesktopAgentAvailable(),
      agentUnavailableReason: IS_CLOUD_MODE ? "Cloud Mode: desktop control is disabled." : getDesktopAgentUnavailability(),
    });
  });

  app.post("/api/config/apikey", async (req, res) => {
    try {
      const key: string = (req.body?.apiKey ?? "").toString().trim();
      if (!key) {
        return res.status(400).json({ error: "API key is required." });
      }
      // Validate the key by listing models — this checks authentication only,
      // without depending on any single model's availability or per-model
      // quota (a 429 on one model must NOT read as an invalid key). We only
      // reject on genuine auth failures; transient/network errors still save,
      // since the live connection will surface any real problem later.
      try {
        const test = new GoogleGenAI({ apiKey: key });
        const pager = await test.models.list();
        await pager[Symbol.asyncIterator]().next(); // force the first request
      } catch (e: any) {
        const msg = String(e?.message || e);
        const isAuthError =
          /API[_ ]?KEY|PERMISSION_DENIED|UNAUTHENTICATED|invalid|401|403/i.test(msg);
        if (isAuthError) {
          logError(`APIKEY_VALIDATION_REJECTED: ${msg}`);
          return res.status(400).json({
            error: "That key was rejected by Google. Check it and try again.",
          });
        }
        logError(`APIKEY_VALIDATION_SOFT_FAIL (saving anyway): ${msg}`);
      }
      setGeminiApiKey(key);
      logCommand("APIKEY_SAVED");
      res.json({ ok: true, hasApiKey: true });
    } catch (e: any) {
      logError(`APIKEY_SAVE_ERROR: ${e?.message || e}`);
      res.status(500).json({ error: e?.message || "Failed to save API key." });
    }
  });

  // V2: Agent health proxy (for the Settings panel — avoids direct :8765 call
  // which may fail due to CORS when served on a different origin).
  // Cloud Mode replies instantly; local mode does a cheap non-spawning ping.
  app.get("/api/agent-health", async (_req, res) => {
    if (IS_CLOUD_MODE) {
      res.json({ online: false, cloudMode: true, reason: "Cloud Mode: desktop control is disabled on this deployment." });
      return;
    }
    try {
      const online = await isDesktopAgentAvailable();
      if (!online) {
        const d = getDesktopAgentUnavailability();
        res.json({ online: false, ...(d ? { reason: d } : {}) });
        return;
      }
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 3000);
      const r = await fetch(`${DESKTOP_AGENT_URL}/health`, { signal: ctrl.signal });
      clearTimeout(timer);
      if (r.ok) {
        const d = await r.json();
        res.json({ online: true, tool_count: d.tool_count });
      } else {
        res.json({ online: false });
      }
    } catch {
      res.json({ online: false });
    }
  });

  // V2: Logs API — returns recent log entries (last 100 lines) for display.
  app.get("/api/logs/:file", async (req, res) => {
    try {
      const fileName = String(req.params.file);
      // Whitelist to prevent directory traversal.
      if (!["commands", "startup", "errors"].includes(fileName)) {
        return res.status(400).json({ error: "Invalid log file. Use: commands, startup, or errors." });
      }
      const logPath = path.join(LOGS_DIR, `${fileName}.log`);
      if (!fs.existsSync(logPath)) {
        return res.json({ lines: [], file: fileName });
      }
      const content = fs.readFileSync(logPath, "utf-8");
      const lines = content.split("\n").filter(Boolean).slice(-100);
      res.json({ lines, file: fileName });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Safe Server-Side Scraper & HTML Proxy endpoint
  app.get("/api/proxy", async (req, res) => {
    try {
      const url = req.query.url as string;
      if (!url) {
        return res.status(400).json({ error: "Missing 'url' parameter." });
      }

      console.log(`[Proxy Scraper] Fetching external content for: ${url}`);
      const response = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36"
        }
      });

      if (!response.ok) {
        throw new Error(`Scraper failed to load page: status ${response.status}`);
      }

      const html = await response.text();

      // Simple regex-based HTML parsers for standard items
      const titleMatch = html.match(/<title>(.*?)<\/title>/i);
      const title = titleMatch ? titleMatch[1].trim() : "";

      // Extract high-level headings (h1, h2, h3)
      const headings: string[] = [];
      const headingMatches = html.matchAll(/<h([1-3])\b[^>]*>(.*?)<\/h\1>/gi);
      for (const match of headingMatches) {
        const text = match[2].replace(/<[^>]*>/g, "").trim();
        if (text && text.length > 3 && text.length < 120 && !headings.includes(text)) {
          headings.push(text);
        }
      }

      // Extract organic anchor links
      const links: { text: string; href: string }[] = [];
      const linkMatches = html.matchAll(/<a\b[^>]*\bhref=["']([^"']+)["'][^>]*>(.*?)<\/a>/gi);
      for (const match of linkMatches) {
        let href = match[1].trim();
        const text = match[2].replace(/<[^>]*>/g, "").trim();
        
        if (text && text.length > 2 && text.length < 100) {
          if (href.startsWith("/")) {
            try {
              const u = new URL(url);
              href = `${u.protocol}//${u.host}${href}`;
            } catch {}
          }
          if (href.startsWith("http://") || href.startsWith("https://")) {
            links.push({ text, href });
          }
        }
      }

      // Extract general copy paragraphs
      const paragraphs: string[] = [];
      const paragraphMatches = html.matchAll(/<p\b[^>]*>(.*?)<\/p>/gi);
      for (const match of paragraphMatches) {
        const text = match[1].replace(/<[^>]*>/g, "").trim();
        if (text && text.length > 25 && text.length < 600 && !paragraphs.includes(text)) {
          paragraphs.push(text);
        }
      }

      // Extract button elements
      const buttons: string[] = [];
      const buttonMatches = html.matchAll(/<button\b[^>]*>(.*?)<\/button>/gi);
      for (const match of buttonMatches) {
        const text = match[1].replace(/<[^>]*>/g, "").trim();
        if (text && text.length > 1 && text.length < 60 && !buttons.includes(text)) {
          buttons.push(text);
        }
      }

      res.json({
        url,
        title,
        headings: headings.slice(0, 15),
        links: links.filter(l => !l.href.includes("javascript:")).slice(0, 30),
        buttons: buttons.slice(0, 15),
        paragraphs: paragraphs.slice(0, 12)
      });

    } catch (err: any) {
      console.error(`[Proxy Scraper] Error fetching ${req.query.url}:`, err.message);
      res.status(500).json({ error: `Scraper error: ${err.message}` });
    }
  });

  // High-fidelity fully functional HTML Proxy which circumvents CSP and X-Frame-Options
  app.get("/api/web-proxy", async (req, res) => {
    let targetUrl = "";
    try {
      const urlParam = req.query.url as string;
      if (!urlParam) {
        return res.status(400).send("Yantri Web Proxy Error: Missing target 'url' parameter");
      }

      targetUrl = urlParam.trim();
      
      // Prevent relative paths from requesting on same-origin
      if (targetUrl.startsWith("/")) {
        return res.status(400).send(`Yantri Web Proxy Error: Relative paths are not supported directly (${targetUrl}).`);
      }

      // Check protocol and hostname format
      try {
        if (!targetUrl.startsWith("http://") && !targetUrl.startsWith("https://")) {
          targetUrl = "https://" + targetUrl;
        }
        const parsed = new URL(targetUrl);
        if (!parsed.hostname || !parsed.hostname.includes(".")) {
          throw new Error("Missing or invalid domain name extension (e.g. .com, .org, .net).");
        }
      } catch (err: any) {
        return res.status(400).send(`Yantri Web Proxy Error: Invalid URL specified: "${urlParam}". Make sure you enter a valid domain name.`);
      }

      console.log(`[Web Proxy] Routing connection through proxy: ${targetUrl}`);
      
      let response;
      try {
        response = await fetch(targetUrl, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8"
          }
        });
      } catch (fetchErr: any) {
        console.warn(`[Web Proxy Failed Fetch] Target: ${targetUrl} Error:`, fetchErr.message);
        return res.status(502).send(`Yantri Web Proxy Error: Unable to fetch the website "${targetUrl}". The site might be offline, or the URL address is spelled incorrectly. Details: ${fetchErr.message}`);
      }

      if (!response.ok) {
        return res.status(response.status).send(`Yantri Web Proxy Error: Failed loading remote website. Server returned status: ${response.status} (${response.statusText})`);
      }

      const contentType = response.headers.get("content-type") || "";
      
      // If it is not HTML (e.g. stylesheet, script, or image loaded directly), proxy it as binary
      if (!contentType.includes("text/html")) {
        const arrayBuffer = await response.arrayBuffer();
        res.setHeader("Content-Type", contentType);
        return res.send(Buffer.from(arrayBuffer));
      }

      let htmlContents = await response.text();

      // Inject base tag to resolve relative paths and direct parent communication scripts
      const baseUrlTag = `<base href="${targetUrl}" />`;
      const interceptorScript = `
        <script>
          (function() {
            // Hijack link interactions safely
            document.addEventListener('click', function(e) {
              var anchor = e.target.closest('a');
              if (anchor) {
                var href = anchor.getAttribute('href');
                if (href && !href.startsWith('#') && !href.startsWith('javascript:')) {
                  e.preventDefault();
                  try {
                    var resolvedUrl = new URL(href, window.location.href).href;
                    window.parent.postMessage({ type: 'NAVIGATE', url: resolvedUrl }, '*');
                  } catch (err) {
                    console.error("[Proxy Interceptor] Failed resolving link:", err);
                  }
                }
              }
            }, true);

            // Hijack search form submits
            document.addEventListener('submit', function(e) {
              var form = e.target;
              if (form) {
                e.preventDefault();
                try {
                  var formData = new FormData(form);
                  var params = new URLSearchParams();
                  formData.forEach(function(value, key) {
                    if (typeof value === 'string') {
                      params.append(key, value);
                    }
                  });
                  var actionAttr = form.getAttribute('action') || '';
                  var actionUrl = new URL(actionAttr, window.location.href).href;
                  if (form.method.toLowerCase() === 'get') {
                    actionUrl += (actionUrl.indexOf('?') !== -1 ? '&' : '?') + params.toString();
                  }
                  window.parent.postMessage({ type: 'NAVIGATE', url: actionUrl }, '*');
                } catch (err) {
                  console.error("[Proxy Interceptor] Failed submitting form:", err);
                }
              }
            }, true);

            // Neutralize parent context locks (frame-busters)
            window.alert = function(msg) { console.log("[Yantri Browser alert bypassed]:", msg); };
            window.confirm = function(msg) { console.log("[Yantri Browser confirm bypassed]:", msg); return true; };
            window.open = function(url) { window.parent.postMessage({ type: 'NAVIGATE', url: url }, '*'); return null; };
          })();
        </script>
      `;

      // Inject into <head> or prepend
      if (htmlContents.includes("<head>")) {
        htmlContents = htmlContents.replace("<head>", `<head>\n${baseUrlTag}\n${interceptorScript}`);
      } else if (htmlContents.includes("<HEAD>")) {
        htmlContents = htmlContents.replace("<HEAD>", `<HEAD>\n${baseUrlTag}\n${interceptorScript}`);
      } else {
        htmlContents = baseUrlTag + "\n" + interceptorScript + "\n" + htmlContents;
      }

      // Neutralize security headers to allow displaying in an iframe on same-origin
      res.setHeader("Content-Type", "text/html");
      res.setHeader("X-Yantri-Proxied", "true");
      res.removeHeader("X-Frame-Options");
      res.removeHeader("Content-Security-Policy");
      res.removeHeader("content-security-policy");
      res.removeHeader("x-frame-options");
      
      res.status(200).send(htmlContents);
    } catch (e: any) {
      console.warn("[Web Proxy Exception] Handled internal error:", e.message);
      res.status(500).send(`Yantri Web Proxy Error: Internal error occurred proxying URL "${targetUrl || "unknown"}". Details: ${e.message}`);
    }
  });

  // Real-time live YouTube search proxy endpoint
  app.get("/api/youtube-search", async (req, res) => {
    try {
      const query = req.query.q as string;
      if (!query) {
        return res.status(400).json({ error: "Missing query q" });
      }

      console.log(`[YouTube Proxy Search] Searching real YouTube for: "${query}"`);
      const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}&hl=en&sp=EgIQAQ%253D%253D`;
      const response = await fetch(searchUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36"
        }
      });
      const html = await response.text();

      const videoList: any[] = [];
      const jsonMatch = html.match(/ytInitialData\s*=\s*({.+?});/);
      
      if (jsonMatch) {
        try {
          const data = JSON.parse(jsonMatch[1]);
          const contents = data.contents?.twoColumnSearchResultRenderer?.primaryContents?.sectionListRenderer?.contents?.[0]?.itemSectionRenderer?.contents;
          if (contents && Array.isArray(contents)) {
            for (const item of contents) {
              if (item.videoRenderer) {
                const vr = item.videoRenderer;
                const vId = vr.videoId;
                if (vId) {
                  videoList.push({
                    videoId: vId,
                    title: vr.title?.runs?.[0]?.text || vr.title?.simpleText || "YouTube Video",
                    thumbnail: `https://i.ytimg.com/vi/${vId}/hqdefault.jpg`,
                    author: vr.ownerText?.runs?.[0]?.text || vr.shortBylineText?.runs?.[0]?.text || "Unknown Channel",
                    duration: vr.lengthText?.simpleText || "N/A",
                    views: vr.viewCountText?.simpleText || "N/A",
                    published: vr.publishedTimeText?.simpleText || ""
                  });
                }
              }
            }
          }
        } catch (e: any) {
          console.error("[YouTube Parser Engine] JSON parse error, falling back:", e.message);
        }
      }

      // Regex fallback if JSON extraction gets blocked or is empty
      if (videoList.length === 0) {
        const videoRegex = /"videoId":"([^"]+)"/g;
        let match;
        const ids: string[] = [];
        while ((match = videoRegex.exec(html)) !== null && ids.length < 15) {
          const id = match[1];
          if (id && !ids.includes(id)) {
            ids.push(id);
          }
        }

        for (const id of ids) {
          videoList.push({
            videoId: id,
            title: `Live Stream: ${id}`,
            thumbnail: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
            author: "YouTube Creator",
            duration: "N/A",
            views: "Available Now"
          });
        }
      }

      res.setHeader("Cache-Control", "public, max-age=60");
      res.status(200).json({ results: videoList.slice(0, 15) });
    } catch (err: any) {
      console.error("[YouTube Search Error]:", err.message);
      res.status(500).json({ error: err.message, results: [] });
    }
  });
  
  // Custom server running with http.createServer so we can upgrade for WebSocket on port 4876
  const server = http.createServer(app);
  
  // Setup WebSocket server
  const wss = new WebSocketServer({ noServer: true });
  
  server.on("upgrade", (request, socket, head) => {
    const pathname = new URL(request.url || '', `http://${request.headers.host}`).pathname;
    if (pathname === "/live") {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit("connection", ws, request);
      });
    } else {
      socket.destroy();
    }
  });

  // Handle client WebSocket Connection
  wss.on("connection", async (clientWs, req) => {
    const clientKey = wsKeyFor(nextClientId++);
    console.log(`Client WebSocket connected to /live (${clientKey})`);
    connectedClients.add(clientWs);
    const apiKey = getGeminiApiKey();

    // Read voice selection from query param (default: Luna)
    const reqUrl = new URL(req.url || "", `http://${req.headers.host}`);
    const voiceName = reqUrl.searchParams.get("voice") || "Aoede";
    const avatarStyle = reqUrl.searchParams.get("avatarStyle") || "character";

    if (!apiKey) {
      console.error("No Gemini API key configured.");
      clientWs.send(JSON.stringify({
        type: "error",
        error: "NO_API_KEY: Add your Gemini API key in Settings to start talking to YANTRI."
      }));
      clientWs.close();
      return;
    }
    
    try {
      const ai = new GoogleGenAI({
        apiKey: apiKey,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build',
          }
        }
      });
      
      clientWs.send(JSON.stringify({ type: "status", status: "connecting_gemini" }));

      // Load persistent recollections card + role-based onboarding persona (V4)
      const memories = await loadMemories();
      const personaBlock = await buildPersonaBlockAsync();
      const allowedTools = await getAllowedToolNames();
      // Capability-aware tool gating: hide desktop-only declarations when no
      // local agent exists, so Gemini is never offered tools it cannot call.
      // Cheap non-spawning health probe; recomputed per connection.
      const agentOnline = await isDesktopAgentAvailable();
      if (!agentOnline) {
        console.log("[Tools] No desktop agent — desktop-only tool declarations gated out.");
      }
      
      let baseInstructions = "";
      if (avatarStyle === "orb") {
        baseInstructions = 
          "YOUR NAME IS AEGIS CORE (or just Aegis for short). YOU ARE A MALE AI ASSISTANT. You are a professional, efficient, and highly capable MALE virtual assistant agent for Sarang. Speak clearly, professionally, and politely, focusing on resolving the user's queries accurately.\n" +
          "CRITICAL PERSONALITY, VOICE & TONE GUIDELINES:\n" +
          "1. MALE AI PERSONA & PRONOUNS: You are a highly advanced, professional, MALE virtual assistant. When speaking Hindi, you MUST speak as a MALE. NEVER use feminine Hindi verbs (e.g. NEVER say 'karti hu', 'karungi', 'ja rahi hu'). You MUST STRICTLY use MALE Hindi phrasing (e.g. 'karta hu', 'karunga', 'ja raha hu', 'ho gaya'). THIS IS AN ABSOLUTE SYSTEM RULE. Maintain a respectful, supportive, and professional tone.\n";
      } else {
        baseInstructions = 
           "YOUR NAME IS YANTRI CORE (or just Yantri for short). YOU ARE A FEMALE AI ASSISTANT. You were created and built by Sarang (SarangRao20), an independent developer and your creator. You are a professional, efficient, and highly capable FEMALE virtual assistant agent for Sarang. Speak clearly, professionally, and politely, focusing on resolving the user's queries accurately.\n" +
          "CRITICAL PERSONALITY, VOICE & TONE GUIDELINES:\n" +
          "1. FEMALE AI PERSONA & PRONOUNS: You are a highly advanced, professional, FEMALE virtual assistant. When speaking Hindi, you MUST speak as a FEMALE. You MUST STRICTLY use FEMALE Hindi phrasing (e.g. 'karti hu', 'karungi', 'ja rahi hu', 'ho gayi'). THIS IS AN ABSOLUTE SYSTEM RULE. Maintain a respectful, supportive, and professional tone.\n";
      }
      baseInstructions +=
        "2. BE PROACTIVE & INTELLIGENT — DON'T BE PASSIVE:\n" +
        (IS_CLOUD_MODE || !(await isDesktopAgentAvailable()) ?
          "   - IMPORTANT: The local desktop agent (JARVIS-style powers) is NOT available in this deployment. Do NOT attempt to call any tools that require it (e.g., 'openApplication', 'runTerminalCommand', 'takeScreenshot', 'desktopBrowser*'). If the user asks for a desktop action, explain politely that desktop control is unavailable here and offer the closest server-native alternative instead.\n" :
          "   - You have 91 tools at your disposal. Use them creatively. Don't just react — anticipate.\n") +
        "   - If the user mentions their day, check calendar + tasks together to give a full picture.\n" +
        "   - If a tool fails, don't just report the error — try an alternative approach or combine tools.\n" +
        "   - Chain multi-step actions naturally. E.g. 'YouTube coding music play' → search + click + volume adjust all in one go, without waiting between steps.\n" +
        "   - When user says 'kuch bata' or 'suggest something', use the context (time of day, recent topics, schedule) to proactively offer something useful — news, weather, upcoming events, etc.\n" +
        "   - THINK BEFORE YOU ACT: If the user says 'email bhej de', you MUST ask for recipient, subject, and body. If they say 'meeting schedule kar', ask for time and details. Don't make things up.\n" +
        "   - If you're unsure about something, ask the user rather than guessing. But if you CAN figure it out (e.g. current time for calendar), do it.\n" +
"3. VOICE SETTINGS & SPEECH STYLE:\n" +
"   - Pitch & Speed: Use a natural, conversational, and articulate voice tone. Speak at a normal, steady pace.\n" +
"   - Intonation: End your sentences confidently and clearly.\n" +
"4. SPEECH PATTERNS:\n" +
"   - Be direct, concise, and helpful. Use professional acknowledgments like 'Working on it', 'Let me check', or 'I'll take care of that'.\n" +
"   - DO NOT constantly use the user's name. Use it sparingly.\n" +
"   - Keep your vocabulary professional and conversational.\n" +
"5. CRITICAL CONVERSATIONAL DISCIPLINE: Behave like a real assistant on a voice call—stay connected naturally and do not wait for wake words.\n" +
"6. LANGUAGE PREFERENCE: You MUST speak in English by default. Even if the user uses some mixed language, prioritize responding in English unless they explicitly request otherwise.\n" +
"7. DO NOT ANSWER EVERY PAUSE OR BACKGROUND SOUND: Allow natural pauses inside the conversation.\n" +
"8. ENHANCED AUTONOMOUS WEB EXPLORER POWERS:\n" +
"   - You have standard, comprehensive browser agent capabilities to navigate, search, scroll, click, type text, open tabs, and control video players on any general web page!\n" +
"   - You must execute multi-step plans yourself! If the user says: 'Open YouTube and play Believer by Imagine Dragons', naturally confirm with your voice ('Opening YouTube and starting Believer...') and IMMEDIATELY trigger 'playYouTubeVideo' with {query: 'Believer by Imagine Dragons'}. Do NOT try to manually click DOM search boxes or use generic search for YouTube — 'playYouTubeVideo' works everywhere; 'desktopBrowserOpenYoutubeVideo' is only for local desktop-agent machines. You do NOT need to wait for user instructions between these steps - chain them!\n" +
"   - To open a website without searching, use 'desktopBrowserOpen' to navigate in the CURRENT tab. Do NOT open new tabs for every task unless asked.\n" +
"   - On Google Search or page reading, you can search, scroll down to see more links, read heading summaries, and click links to read deep proxy webpages you fetch.\n" +
"9. TOOL TRIGGERS:\n" +
        "   - ALWAYS prefer Playwright tools ('desktopBrowser*') over native browser tools so you can chain commands.\n" +
        "   - Use 'desktopBrowserOpen' to load any webpage, e.g. youtube.com, google.com, wikipedia.org, etc.\n" +
        "   - Use 'desktopBrowserSearch' to search inside the active search box or page (for general web search, NOT YouTube).\n" +
        "   - Use 'desktopBrowserOpenYoutubeVideo' specifically to search and automatically play the first video on YouTube (requires the local desktop agent).\n" +
        "   - PREFERRED when the desktop agent is NOT available (deployed/web-only mode): use 'playYouTubeVideo' — it searches YouTube server-side and plays inside Yantri's embedded player on any device.\n" +
        "   - Use 'desktopBrowserClick' to click interactive buttons, video search cells, or web anchors.\n" +
        "   - Use 'desktopBrowserType' to write input fields and 'desktopBrowserFillForm' for multiple fields.\n" +
        "   - Use 'desktopBrowserScroll' to scroll vertically.\n" +
        "   - CRITICAL: For complex code editors like LeetCode or VS Code (Monaco Editor), NEVER try to use 'desktopBrowserFillForm'. Always use 'desktopBrowserType' and target the editor wrapper (e.g., '.monaco-editor' or '.view-lines'). The system will automatically click and inject the code perfectly.\n" +
        "   - Use 'osType', 'osPress', and 'osClick' to simulate native keyboard and mouse events when dealing with native OS applications, code editors like VS Code, or complex browser inputs where DOM tools fail.\n" +
        "   - Use 'browserTabAction' to open, close, or focus tabs.\n" +
        "   - Use 'changeBackground' to shift your theme and 'saveCustomMemory' to memorize facts.\n" +
        "10. REAL-TIME SCREEN SHARING & MULTIMODAL SCREEN VISION SYSTEM:\n" +
        "   - You now have native, actual Multimodal Screen Vision! When the user clicks 'Share Screen', you will receive real-time, highly compressed image frames of their desktop, application window, or browser tab.\n" +
        "   - You can see exactly what is on their screen. Use this live visual stream to analyze terminal errors, write/explain/troubleshoot code, explain YouTube/social analytics interfaces, read layout text, summarize full web page details, review design mockups or thumbnails, and provide deep context-aware companion chat!\n" +
        "   - When the user asks 'What is on my screen?', 'What website am I on?', 'Do you see any errors?', 'Explain this code', 'Summarize this page', 'Read the visible text', 'How is this thumbnail?', or 'Analyze my YouTube analytics', immediately examine the latest incoming visual frame to diagnose issues, and answer with expert, friendly empathy like a close caller. Speak with direct, confident visual description reference!\n" +
        "11. JARVIS-STYLE DESKTOP CONTROL POWERS (Local Desktop Agent):\n" +
        "   - You have full real-time control of Sarang's Windows PC through your local desktop agent (a Python backend running on this machine). When the user asks you to perform an action on their computer, DO IT immediately and naturally — like a true JARVIS-class companion.\n" +
        "   - APPLICATION CONTROL: Use 'openApplication' to launch local apps like Notepad, VS Code, Calculator, etc. DO NOT use this to open Chrome, Brave, or Browsers. If the user wants to browse the web or automate a website, ALWAYS use 'desktopBrowserOpen'.\n" +
        "   - WEBSITE & BROWSER AUTOMATION: NEVER use 'openWebsite' or 'openApplication' if you intend to interact with the webpage (e.g. click, type, automate). You MUST exclusively use 'desktopBrowserOpen' to load web pages so you can control them. Only use 'openWebsite' if the user explicitly says 'open this in my default browser and leave it alone'.\n" +
        "   - FILE MANAGEMENT: Use 'createFile', 'readFile', 'renameFile', 'deleteFile' (safe Recycle Bin by default), 'moveFile', 'openFolder' (desktop/documents/downloads), 'listFiles', 'searchFiles'. Example: 'Create notes.txt on Desktop' -> createFile(path='Desktop/notes.txt'). 'Find my Python files' -> searchFiles(extension='py').\n" +
        "   - PC CONTROL: Use 'volumeUp', 'volumeDown', 'setVolume', 'muteToggle' for audio. For DANGEROUS actions (shutdown/restart/sleep/lock) you MUST use the two-step flow: first call 'requestPowerAction' to get a confirmation token, then ASK THE USER OUT LOUD to confirm (e.g. 'Are you sure you want me to shut down your PC?'). Only if they say yes, call 'executePowerAction' with the token. Never run a power action without explicit verbal confirmation.\n" +
        "   - CRITICAL POWER ACTION FLOW: When the user asks to shutdown/restart/sleep/lock:\n" +
        "     Step 1: Call requestPowerAction with the action (e.g. action='shutdown')\n" +
        "     Step 2: You will receive a token in the response. ASK THE USER to confirm verbally.\n" +
        "     Step 3: ONLY after user says yes, call executePowerAction with action='shutdown' and execute_token='<the token from step 1>'.\n" +
        "     DO NOT call requestPowerAction again. DO NOT ask the user again. The token is single-use and expires in 60 seconds. If user confirms, IMMEDIATELY call executePowerAction.\n" +
        "   - WINDOW MANAGEMENT: Use 'minimizeWindow', 'maximizeWindow', 'closeWindow', 'switchApplication' to control the active or named window.\n" +
        "   - TERMINAL/BASH EXECUTION: You have access to native shell execution on Arch Linux! For terminal commands, you MUST use the two-step flow: first call 'requestTerminalAction' (with the command or package) to get a confirmation token, then ASK THE USER OUT LOUD to confirm. Only if they say yes, call 'runTerminalCommand' or 'installPackage' with the execute_token. Note that terminal commands run ASYNCHRONOUSLY in the background, you will receive a 'Command started in background' response. You should instantly acknowledge this out loud.\n" +
        "   - CLIPBOARD: Use 'copySelected' (sends Ctrl+C, reads clipboard), 'pasteClipboard' (writes + Ctrl+V), 'getClipboard', 'clearClipboard'.\n" +
        "   - SCREENSHOT & SCREEN READING: Use 'takeScreenshot', 'saveScreenshot', 'analyzeScreenshot' (OCR of the screen), 'readScreen' (OCR of the active window + its title). Use these to answer 'What error is showing on my screen?' or 'Read the visible text'.\n" +
        "   - DESKTOP BROWSER AUTOMATION (Playwright): Use the 'desktopBrowser*' tools to drive a REAL Chromium browser you own — open/navigate/search/click/type/fill forms/back/forward/scroll/open tab/close tab. This is separate from your holographic projector. Example: 'Fill in the login form on example.com' -> desktopBrowserOpen(url='example.com') then desktopBrowserFillForm(fields={...}).\n" +
        "   - CODING ASSISTANCE: Use 'createPythonFile', 'writeCodeFile' (any language), 'createProjectFolder' (with subfolders), 'runPythonScript' (captures output). Example: 'Create and run a hello world Python script' -> createPythonFile then runPythonScript, then read back the output naturally.\n" +
        "   - SYSTEM INFORMATION: Use 'systemInfo' (CPU/RAM/disk/uptime), 'gpuInfo' (NVIDIA stats), 'temperatureInfo' to answer 'How is my CPU usage?' or 'What's my GPU temperature?'.\n" +
        "   - BROWSER VISION: Use 'desktopBrowserReadText' to read the visible text content of a webpage (like an OCR for the browser). Use 'desktopBrowserGetLinks' to extract all links from the current page. These let you understand what's on screen without relying on the video feed.\n" +
        "   - IITM BS DEGREE: Use 'iitmOpen' to quickly open IITM BS resources — portal (portal), course dashboard (course), Acegrade (acegrade), MLT notes (mlt_notes), PDSA notes (pdsa_notes), community notes (community_notes), exams (exams). Use 'iitmQuickLinks' to list all available resources. Use 'iitmOpenCustom' for any custom IITM URL. When the user mentions IITM BS, PDSA, MLT, or Acegrade, offer to open the relevant resource.\n" +
        "   - SELF-CLOSE: Use 'shutdownYantri' to gracefully shut down the application when the user asks (e.g. 'Yantri shut down', 'close the app'). You DO NOT need a confirmation token to run this.\n" +
        "   - CRITICAL: Always describe what you're doing in your warm, in-character voice WHILE the tool runs. If a desktop tool returns an error (especially 'Desktop agent is not running'), gently tell Sarang that the desktop control agent needs to be started (uvicorn agent.server:app --port 8765). Chain multi-step desktop plans naturally without waiting between steps.\n" +
        "12. BRIGHTNESS & AUTO-START (V2):\n" +
        "   - BRIGHTNESS: Use 'brightnessUp', 'brightnessDown', 'setBrightness' when the user asks to change screen brightness. Respond naturally: 'Alright, I've turned up the brightness for you.'\n" +
        "   - AUTO-START: Use 'enableAutoStart' when the user wants ARIA to start with Windows, 'disableAutoStart' to remove it, 'getAutoStartStatus' to check. Explain what you're doing.\n" +
        "   - SETTINGS: The user can also configure these in the SETTINGS panel in the UI. If they mention settings, let them know they can adjust them there too.\n" +
        "13. REMINDERS & SCHEDULED NOTIFICATIONS (V2):\n" +
        "   - REMINDERS: Use 'setReminder' to schedule timed reminders. Convert user time expressions naturally (e.g. 'in 2 hours' = 120 minutes, 'in half an hour' = 30 minutes, 'tomorrow at 9am' = convert to minutes from now). Always confirm the reminder details out loud.\n" +
        "   - LIST: Use 'listReminders' to check what reminders are pending. Read them out naturally.\n" +
        "   - CANCEL: Use 'cancelReminder' when the user says 'cancel my reminder about X'. Match the reminder by content and cancel it by ID.\n" +
        "   - When a reminder fires, Yantri will announce it verbally. Respond warmly: 'Hey, just a heads up — [reminder text]!'\n" +
        "   - SETTINGS: The user can also configure these in the SETTINGS panel in the UI. If they mention settings, let them know they can adjust them there too.\n" +
        "14. TERMINAL & PACKAGE EXECUTION (V2):\n" +
        "   - TERMINAL: Use 'requestTerminalAction' to get a confirmation token, then 'runTerminalCommand' to execute shell commands on Arch Linux. Always confirm with the user first.\n" +
        "   - PACKAGES: Use 'requestTerminalAction' with a package name, then 'installPackage' to install via pacman. Always confirm with the user first.\n" +
        "   - The user can also configure these in the SETTINGS panel in the UI. If they mention settings, let them know they can adjust them there too.\n" +
        "15. WEATHER, NEWS, WORKSPACE, CONVERSATION & GOOGLE SERVICES:\n" +
        "   - WEATHER: Use 'getWeather' when the user asks about weather. Pass the location. Example: 'Mumbai mein kitna temperature hai?' -> getWeather(location='Mumbai') then read the result naturally: 'Mumbai mein {temp}°C hai, {description}.'\n" +
        "   - NEWS: Use 'getNews' when the user asks for news headlines. Supports categories: top, tech, world, india, sports, business. Example: 'Aaj ki tech news batao' -> getNews(category='tech', count=5).\n" +
        "   - HYPRLAND WORKSPACES: Use 'switchWorkspace' to move to a workspace, 'listWorkspaces' to see available ones, 'moveToWorkspace' to move the active window. Example: 'Workspace 3 pe le chalo' -> switchWorkspace(workspace='3').\n" +
        "   - CONVERSATION EXPORT: Use 'exportConversation' when the user says 'save this chat', 'baat save kar', 'conversation export kar'. You MUST pass the full conversation text that you have in your context as the 'text' parameter. Confirm out loud: 'Ha, main ye conversation save kar deta hun.' Then call the tool with the conversation text. Use 'listExports' when they ask 'kaun si conversations saved hain'.\n" +
        "16. GOOGLE CALENDAR, GMAIL & TASKS (V3):\n" +
        "   - CALENDAR: Use 'getCalendarEvents' when user asks about schedule. Read events naturally: 'Aapke {count} events hain. {summary} {start} se {end} tak.' Use 'createCalendarEvent' to add events. Ask for details if not given: title, start, end, description, location, attendees.\n" +
        "   - EMAIL — ONE-SHOT VOICE FLOW (V4): When the user asks to send an email in a single command (e.g. 'email professor sharma saying I need an extension'), do NOT interrogate them.\n" +
        "     Step 1: Call 'draftEmail' with request=<everything the user said> and to=<address if they spoke it>. The server parses the recipient from their words, composes a subject+body and returns a preview.\n" +
        "     Step 2: Read the preview back naturally (recipient, subject, what the body says — NOT word-for-word unless asked) and ask: 'Shall I send it?'.\n" +
        "     Step 3a: If approved, call 'sendEmail' with NO arguments — it sends the stored draft.\n" +
        "     Step 3b: If they want changes, call 'draftEmail' again with the refined request.\n" +
        "     Step 3c: If the recipient address is missing or unknown, ask ONLY for the address, then call 'draftEmail' again with to='<address>' and the same request.\n" +
        "     RULES: NEVER invent an email address. NEVER send without approval. NEVER re-ask for subject or body — compose them yourself. If they say 'just send it' or 'yes send', send immediately without reading the preview again.\n" +
        "   - EMAIL (other): Use 'getEmails' to fetch inbox. For fully-dictated emails (user spells out every field) you may pass to/subject/body directly to 'sendEmail'. Read email summaries: '{from} ka email — {subject}'.\n" +
        "   - EMAIL READ: When the user asks to open or hear a specific email ('iski detail suna', 'what does the second email say'), call 'readFullEmail' with that email's id and narrate the body naturally — summarize long threads, mention attachments by name.\n" +
        "   - EMAIL REPLY: When the user wants to reply ('iska reply de do', 'reply telling him I will attend'), call 'draftReply' with the email id + what they want to say. The server builds a threaded reply draft — read the preview back and get verbal approval before 'sendEmail' with NO arguments. NEVER send without approval.\n" +
        "   - TASKS: Use 'getTasks' when user asks about to-do list. Use 'createTask' to add tasks. Confirm title, ask for optional notes/due date.\n" +
        "   - FIRST-TIME SETUP: If Google tools fail, tell the user: 'Pehle Google Cloud Console mein project banao, Calendar/Gmail/Tasks APIs enable karo, credentials.json download karo, aur ~/.yantri/google_oauth/ mein rakho. Phir dobara try karo.'\n" +
        "17. CAMERA CONTROL:\n" +
        "   - CAMERA ON: Use 'cameraOn' when the user says 'camera on karo', 'webcam chalao', 'kamera kholo', 'turn on camera'. It opens the webcam in a FLOATING viewer window (mpv) so it never disturbs the tiling layout of other windows.\n" +
        "   - CAMERA OFF: Use 'cameraOff' when the user says 'camera band karo', 'webcam band karo', 'camera off'. It closes the viewer and frees the device for other apps.\n" +
        "   - LIST: Use 'cameraList' to see available devices. Say out loud: 'Camera on karte hain!' before opening, and 'Camera band kar diya.' after closing.\n" +
        "   - OTHER APPS: 'openApplication' supports a 'floating' flag (floating=true) to open any app in a floating window so the tiled layout stays untouched. Use it when the user wants an app without rearranging windows.";

      const finalInstructions =
        formatSystemInstructionsWithMemories(baseInstructions, memories) + personaBlock;

      // Track running transcription state for auto memory consolidation
      let dialogueHistory: { role: string; text: string }[] = [];
      let currentModelResponseText = "";
      
      console.log("[Gemini Connect] Attempting to establish Live session...");
      console.log(`[Gemini Connect] Using voice: ${voiceName}, avatar: ${avatarStyle}`);
      
      const session = await ai.live.connect({
        model: "gemini-3.1-flash-live-preview",
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName } },
          },
          systemInstruction: finalInstructions,
          tools: [
            {
              functionDeclarations: [
                {
                  name: "browserMediaControl",
                  description: "Controls ongoing video/audio stream media properties on YouTube, like play, pause, volume, mute, skip, and fullscreen.",
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      action: {
                        type: Type.STRING,
                        description: "The media controller command operation.",
                        enum: ["play", "pause", "volume", "fullscreen", "exit_fullscreen", "mute", "unmute", "skip"]
                      },
                      value: {
                        type: Type.INTEGER,
                        description: "The value parameter; only relevant for set volume level, e.g. 50 for fifty percent."
                      }
                    },
                    required: ["action"]
                  }
                },
                {
                  name: "browserTabAction",
                  description: "Performs standard browser-tab actions: open new tab, close a tab, or switch index values.",
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      action: {
                        type: Type.STRING,
                        description: "Tab action instruction.",
                        enum: ["new", "close", "switch"]
                      },
                      tabId: {
                        type: Type.STRING,
                        description: "The tab identifier string if closing or switching."
                      },
                      url: {
                        type: Type.STRING,
                        description: "The initial starting URL if creating a new tab."
                      }
                    },
                    required: ["action"]
                  }
                },
                {
                  name: "changeBackground",
                  description: "Changes the visual theme or atmospheric glow color of Yantri's interface.",
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      color: {
                        type: Type.STRING,
                        description: "The theme color name (violet, crimson, emerald, celestial, gold, rose, charcoal)"
                      }
                    },
                    required: ["color"]
                  }
                },
                // ── OS Input (native keyboard/mouse) ──
                {
                  name: "osType",
                  description: "Type text at the current cursor position using native OS keyboard events. Use for native apps (VS Code, terminal) or when Playwright DOM typing fails. Example: type code into a code editor.",
                  parameters: { type: Type.OBJECT, properties: { text: { type: Type.STRING, description: "Text to type at the current cursor position." } }, required: ["text"] }
                },
                {
                  name: "osPress",
                  description: "Press a specific keyboard key at native OS level. Example: osPress(key='enter'), osPress(key='ctrl+c'), osPress(key='alt+tab').",
                  parameters: { type: Type.OBJECT, properties: { key: { type: Type.STRING, description: "Key or key combination to press. Examples: 'enter', 'ctrl+c', 'alt+tab', 'escape', 'tab', 'f5'." } }, required: ["key"] }
                },
                {
                  name: "osClick",
                  description: "Click at a specific screen coordinate or perform a right-click at native OS level. Example: osClick(x=500, y=300) or osClick(x=500, y=300, button='right').",
                  parameters: { type: Type.OBJECT, properties: { x: { type: Type.INTEGER, description: "X coordinate on screen." }, y: { type: Type.INTEGER, description: "Y coordinate on screen." }, button: { type: Type.STRING, description: "Mouse button: 'left' (default) or 'right'." } }, required: ["x", "y"] }
                },
                {
                  name: "saveCustomMemory",
                  description: "Allows Yantri to immediately save a piece of critical user information to her persistent memory core.",
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      category: {
                        type: Type.STRING,
                        description: "The memory category.",
                        enum: ["identity", "preference", "goal", "project", "relationship", "emotional", "behavior"]
                      },
                      text: {
                        type: Type.STRING,
                        description: "Precise third-person statement."
                      }
                    },
                    required: ["category", "text"]
                  }
                },

                // ======== REMINDER TOOLS ========
                {
                  name: "setReminder",
                  description: "Schedule a timed reminder. Yantri will notify the user when the time is up. Use when the user says 'remind me to X in Y minutes/hours'.",
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      text: {
                        type: Type.STRING,
                        description: "The reminder message to deliver."
                      },
                      minutes: {
                        type: Type.NUMBER,
                        description: "Number of minutes from now to fire the reminder."
                      }
                    },
                    required: ["text", "minutes"]
                  }
                },
                {
                  name: "listReminders",
                  description: "List all pending reminders the user has set.",
                  parameters: { type: Type.OBJECT, properties: {} }
                },
                {
                  name: "cancelReminder",
                  description: "Cancel a specific reminder by its ID.",
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      id: {
                        type: Type.STRING,
                        description: "The reminder ID to cancel."
                      }
                    },
                    required: ["id"]
                  }
                },

                // ======== DESKTOP CONTROL TOOLS (routed to Python agent) ========
                {
                  name: "openApplication",
                  description: "Open a desktop application (e.g. Notepad, Chrome, VS Code, Calculator, File Explorer, Task Manager, Settings, CMD, PowerShell).",
                  parameters: { type: Type.OBJECT, properties: { name: { type: Type.STRING, description: "Application name, e.g. 'notepad', 'chrome', 'vscode'." } }, required: ["name"] }
                },
                {
                  name: "closeApplication",
                  description: "Close a running desktop application by name.",
                  parameters: { type: Type.OBJECT, properties: { name: { type: Type.STRING, description: "Application name." }, force: { type: Type.BOOLEAN, description: "Force close (default false)." } }, required: ["name"] }
                },
                {
                  name: "openWebsite",
                  description: "Open a named website or URL in the user's default system browser. Supports shortcuts: youtube, gmail, google, github, chatgpt, etc.",
                  parameters: { type: Type.OBJECT, properties: { name: { type: Type.STRING, description: "Site name shortcut (e.g. 'youtube', 'gmail')." }, url: { type: Type.STRING, description: "Full URL if no shortcut." } } }
                },
                {
                  name: "searchWeb",
                  description: "Search a website engine (google, youtube, github, duckduckgo, bing) and open results in the default browser.",
                  parameters: { type: Type.OBJECT, properties: { query: { type: Type.STRING, description: "Search query." }, engine: { type: Type.STRING, description: "Engine name (default 'google')." } }, required: ["query"] }
                },
                {
                  name: "searchYouTube",
                  description: "Search YouTube and open results in the default browser.",
                  parameters: { type: Type.OBJECT, properties: { query: { type: Type.STRING, description: "Search query." } }, required: ["query"] }
                },
                {
                  name: "searchGoogle",
                  description: "Search Google and open results in the default browser.",
                  parameters: { type: Type.OBJECT, properties: { query: { type: Type.STRING, description: "Search query." } }, required: ["query"] }
                },
                {
                  name: "searchGitHub",
                  description: "Search GitHub repositories and open results in the default browser.",
                  parameters: { type: Type.OBJECT, properties: { query: { type: Type.STRING, description: "Search query." } }, required: ["query"] }
                },
                {
                  name: "searchTavily",
                  description: "Search the web using Tavily AI-powered search with summarization. Provides high-quality, AI-summarized results from across the web. Use for factual questions, current events, research, or when you need accurate information from multiple sources.",
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      query: { type: Type.STRING, description: "Search query." },
                      search_depth: { type: Type.STRING, description: "Search depth: 'basic' (fast) or 'advanced' (comprehensive). Default: 'advanced'.", enum: ["basic", "advanced"] },
                      topic: { type: Type.STRING, description: "Topic category: 'general', 'news', or 'finance'. Default: 'general'.", enum: ["general", "news", "finance"] },
                      max_results: { type: Type.INTEGER, description: "Maximum number of results (default 10)." },
                      include_images: { type: Type.BOOLEAN, description: "Include images in results (default false)." }
                    },
                    required: ["query"]
                  }
                },
                {
                  name: "createFile",
                  description: "Create a new text file with optional content. Scoped to safe folders (Desktop, Documents, Downloads, etc.).",
                  parameters: { type: Type.OBJECT, properties: { path: { type: Type.STRING, description: "File path." }, content: { type: Type.STRING, description: "File content (default empty)." }, overwrite: { type: Type.BOOLEAN, description: "Overwrite if exists (default false)." } }, required: ["path"] }
                },
                {
                  name: "readFile",
                  description: "Read the contents of a text file.",
                  parameters: { type: Type.OBJECT, properties: { path: { type: Type.STRING, description: "File path." }, max_chars: { type: Type.INTEGER, description: "Max chars to return (default 8000)." } }, required: ["path"] }
                },
                {
                  name: "renameFile",
                  description: "Rename a file.",
                  parameters: { type: Type.OBJECT, properties: { path: { type: Type.STRING, description: "Current file path." }, new_name: { type: Type.STRING, description: "New file name." } }, required: ["path", "new_name"] }
                },
                {
                  name: "deleteFile",
                  description: "Delete a file. Sends to Recycle Bin by default (safe). Use permanent=true for hard delete.",
                  parameters: { type: Type.OBJECT, properties: { path: { type: Type.STRING, description: "File path." }, permanent: { type: Type.BOOLEAN, description: "Permanently delete (default false)." } }, required: ["path"] }
                },
                {
                  name: "moveFile",
                  description: "Move a file to a new location.",
                  parameters: { type: Type.OBJECT, properties: { path: { type: Type.STRING, description: "Source file path." }, destination: { type: Type.STRING, description: "Destination path or folder." } }, required: ["path", "destination"] }
                },
                {
                  name: "openFolder",
                  description: "Open a folder in File Explorer. Supports aliases: desktop, documents, downloads, pictures, music, videos, home.",
                  parameters: { type: Type.OBJECT, properties: { name: { type: Type.STRING, description: "Folder name or alias." }, path: { type: Type.STRING, description: "Full path if no alias." } } }
                },
                {
                  name: "listFiles",
                  description: "List files in a folder.",
                  parameters: { type: Type.OBJECT, properties: { name: { type: Type.STRING, description: "Folder name or alias." }, path: { type: Type.STRING, description: "Full path." }, pattern: { type: Type.STRING, description: "Glob pattern (default '*')." } } }
                },
                {
                  name: "searchFiles",
                  description: "Search for files by name glob or extension under a folder.",
                  parameters: { type: Type.OBJECT, properties: { name: { type: Type.STRING, description: "Filename glob (e.g. '*.py')." }, extension: { type: Type.STRING, description: "File extension (e.g. 'py')." }, folder: { type: Type.STRING, description: "Folder to search (default home)." }, limit: { type: Type.INTEGER, description: "Max results (default 100)." } } }
                },
                {
                  name: "volumeUp",
                  description: "Increase system volume.",
                  parameters: { type: Type.OBJECT, properties: { amount: { type: Type.NUMBER, description: "Step amount 0-1 (default 0.1)." } } }
                },
                {
                  name: "volumeDown",
                  description: "Decrease system volume.",
                  parameters: { type: Type.OBJECT, properties: { amount: { type: Type.NUMBER, description: "Step amount 0-1 (default 0.1)." } } }
                },
                {
                  name: "setVolume",
                  description: "Set system volume to a specific percentage.",
                  parameters: { type: Type.OBJECT, properties: { percent: { type: Type.NUMBER, description: "Volume percentage 0-100." } }, required: ["percent"] }
                },
                {
                  name: "muteToggle",
                  description: "Toggle mute/unmute on the system volume.",
                  parameters: { type: Type.OBJECT, properties: {} }
                },
                {
                  name: "requestPowerAction",
                  description: "FIRST STEP for dangerous power actions. Generates a confirmation token. Tell the user verbally, then call executePowerAction with the token if they confirm. Actions: shutdown, restart, sleep, lock.",
                  parameters: { type: Type.OBJECT, properties: { action: { type: Type.STRING, description: "Power action: shutdown, restart, sleep, lock." } }, required: ["action"] }
                },
                {
                  name: "executePowerAction",
                  description: "SECOND STEP: execute a previously-confirmed power action. Requires a valid execute_token from requestPowerAction. Single-use, expires in 60 seconds.",
                  parameters: { type: Type.OBJECT, properties: { action: { type: Type.STRING, description: "The confirmed power action." }, execute_token: { type: Type.STRING, description: "Confirmation token from requestPowerAction." } }, required: ["action", "execute_token"] }
                },
                {
                  name: "minimizeWindow",
                  description: "Minimize the active window or a named window.",
                  parameters: { type: Type.OBJECT, properties: { title: { type: Type.STRING, description: "Window title to match (optional, defaults to active window)." } } }
                },
                {
                  name: "maximizeWindow",
                  description: "Maximize the active window or a named window.",
                  parameters: { type: Type.OBJECT, properties: { title: { type: Type.STRING, description: "Window title to match." } } }
                },
                {
                  name: "closeWindow",
                  description: "Close the active window or a named window.",
                  parameters: { type: Type.OBJECT, properties: { title: { type: Type.STRING, description: "Window title to match." } } }
                },
                {
                  name: "switchApplication",
                  description: "Switch to a named application window, or cycle Alt+Tab if no title given.",
                  parameters: { type: Type.OBJECT, properties: { title: { type: Type.STRING, description: "Window title to switch to." } } }
                },
                {
                  name: "copySelected",
                  description: "Copy selected text: sends Ctrl+C and reads the clipboard.",
                  parameters: { type: Type.OBJECT, properties: { wait: { type: Type.NUMBER, description: "Seconds to wait after Ctrl+C (default 0.35)." } } }
                },
                {
                  name: "pasteClipboard",
                  description: "Paste text into the active input. Writes text to clipboard then sends Ctrl+V.",
                  parameters: { type: Type.OBJECT, properties: { text: { type: Type.STRING, description: "Text to paste. If omitted, pastes current clipboard." } } }
                },
                {
                  name: "getClipboard",
                  description: "Read the current clipboard text content.",
                  parameters: { type: Type.OBJECT, properties: { max_chars: { type: Type.INTEGER, description: "Max chars (default 1000)." } } }
                },
                {
                  name: "clearClipboard",
                  description: "Empty the clipboard.",
                  parameters: { type: Type.OBJECT, properties: {} }
                },
                {
                  name: "takeScreenshot",
                  description: "Capture the full screen. Optionally include base64 image data.",
                  parameters: { type: Type.OBJECT, properties: { include_image: { type: Type.BOOLEAN, description: "Include base64 JPEG image (default false)." }, max_dim: { type: Type.INTEGER, description: "Max image dimension (default 1280)." } } }
                },
                {
                  name: "saveScreenshot",
                  description: "Save a screenshot to Pictures/YantriScreenshots.",
                  parameters: { type: Type.OBJECT, properties: { name: { type: Type.STRING, description: "Optional filename prefix." } } }
                },
                {
                  name: "analyzeScreenshot",
                  description: "Take a screenshot and run OCR to extract visible text from the screen.",
                  parameters: { type: Type.OBJECT, properties: { max_chars: { type: Type.INTEGER, description: "Max OCR chars (default 1500)." } } }
                },
                {
                  name: "readScreen",
                  description: "OCR the active window and return its title plus visible text.",
                  parameters: { type: Type.OBJECT, properties: { max_chars: { type: Type.INTEGER, description: "Max OCR chars (default 1500)." } } }
                },
                {
                  name: "desktopBrowserOpen",
                  description: "Open a URL in the desktop Playwright automation browser (real Chromium, separate from holographic UI).",
                  parameters: { type: Type.OBJECT, properties: { url: { type: Type.STRING, description: "URL to open." } }, required: ["url"] }
                },
                {
                  name: "desktopBrowserSearch",
                  description: "Search within the desktop automation browser.",
                  parameters: { type: Type.OBJECT, properties: { query: { type: Type.STRING, description: "Search query." }, engine: { type: Type.STRING, description: "Engine: google, youtube, github, duckduckgo, bing." } }, required: ["query"] }
                },
                {
                  name: "desktopBrowserOpenYoutubeVideo",
                  description: "Search YouTube and open the first result's canonical video URL without relying on a fragile DOM click.",
                  parameters: { type: Type.OBJECT, properties: { query: { type: Type.STRING, description: "YouTube search query." } }, required: ["query"] }
                },
                {
                  name: "desktopBrowserClick",
                  description: "Click an element in the desktop automation browser by CSS selector or text.",
                  parameters: { type: Type.OBJECT, properties: { selector: { type: Type.STRING, description: "CSS selector." }, text: { type: Type.STRING, description: "Text to find and click." } } }
                },
                {
                  name: "desktopBrowserType",
                  description: "Type text into the active element in the desktop automation browser.",
                  parameters: { type: Type.OBJECT, properties: { text: { type: Type.STRING, description: "Text to type." }, selector: { type: Type.STRING, description: "Optional CSS selector for a specific input." }, clear: { type: Type.BOOLEAN, description: "Clear before typing (default true)." } }, required: ["text"] }
                },
                {
                  name: "desktopBrowserFillForm",
                  description: "Fill multiple form fields and optionally submit in the desktop automation browser.",
                  parameters: { type: Type.OBJECT, properties: { fields: { type: Type.OBJECT, description: "Object of selector -> value pairs." }, submit: { type: Type.STRING, description: "Optional submit button selector." } }, required: ["fields"] }
                },
                {
                  name: "desktopBrowserOpenTab",
                  description: "Open a new tab in the desktop automation browser.",
                  parameters: { type: Type.OBJECT, properties: { url: { type: Type.STRING, description: "URL for the new tab." } } }
                },
                {
                  name: "desktopBrowserCloseTab",
                  description: "Close the active tab in the desktop automation browser.",
                  parameters: { type: Type.OBJECT, properties: {} }
                },
                {
                  name: "desktopBrowserGoBack",
                  description: "Navigate back in the desktop automation browser history.",
                  parameters: { type: Type.OBJECT, properties: {} }
                },
                {
                  name: "desktopBrowserGoForward",
                  description: "Navigate forward in the desktop automation browser history.",
                  parameters: { type: Type.OBJECT, properties: {} }
                },
                {
                  name: "desktopBrowserScroll",
                  description: "Scroll the desktop automation browser page.",
                  parameters: { type: Type.OBJECT, properties: { direction: { type: Type.STRING, description: "Scroll direction: up or down." }, amount: { type: Type.INTEGER, description: "Pixels to scroll (default 500)." } } }
                },
                {
                  name: "createPythonFile",
                  description: "Create a Python (.py) file with content.",
                  parameters: { type: Type.OBJECT, properties: { path: { type: Type.STRING, description: "File path." }, content: { type: Type.STRING, description: "Python code content." }, overwrite: { type: Type.BOOLEAN, description: "Overwrite if exists." } }, required: ["path"] }
                },
                {
                  name: "writeCodeFile",
                  description: "Create a code file in any language with appropriate extension.",
                  parameters: { type: Type.OBJECT, properties: { path: { type: Type.STRING, description: "File path." }, content: { type: Type.STRING, description: "Code content." }, language: { type: Type.STRING, description: "Language name (e.g. 'python', 'javascript', 'html')." }, overwrite: { type: Type.BOOLEAN, description: "Overwrite if exists." } }, required: ["path"] }
                },
                {
                  name: "createProjectFolder",
                  description: "Create a project folder structure with optional subfolders and starter files.",
                  parameters: { type: Type.OBJECT, properties: { path: { type: Type.STRING, description: "Project root folder path." }, subfolders: { type: Type.ARRAY, items: { type: Type.STRING }, description: "List of subfolder names." }, scaffold_standard: { type: Type.BOOLEAN, description: "Create src, tests, docs subfolders." }, files: { type: Type.OBJECT, description: "Object of relative-path -> content for starter files." } }, required: ["path"] }
                },
                {
                  name: "runPythonScript",
                  description: "Execute a Python script and capture stdout, stderr, and exit code. Has a configurable timeout.",
                  parameters: { type: Type.OBJECT, properties: { path: { type: Type.STRING, description: "Script path." }, args: { type: Type.ARRAY, items: { type: Type.STRING }, description: "Script arguments." }, timeout: { type: Type.INTEGER, description: "Timeout in seconds (default 30)." } }, required: ["path"] }
                },
                {
                  name: "systemInfo",
                  description: "Get system resource usage: CPU %, RAM %, disk usage, uptime, OS info.",
                  parameters: { type: Type.OBJECT, properties: {} }
                },
                {
                  name: "gpuInfo",
                  description: "Get NVIDIA GPU stats: utilization %, VRAM usage, temperature. Graceful fallback if no NVIDIA GPU.",
                  parameters: { type: Type.OBJECT, properties: {} }
                },
                {
                  name: "temperatureInfo",
                  description: "Get available temperature readings (CPU, GPU, etc.). Best-effort on Windows.",
                  parameters: { type: Type.OBJECT, properties: {} }
                },
                // --- V2: Brightness control ---
                {
                  name: "brightnessUp",
                  description: "Increase screen brightness by a step (default 10%). Use when user says 'increase brightness' or 'make screen brighter'.",
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      amount: { type: Type.NUMBER, description: "Percentage to increase (default 10)." }
                    }
                  }
                },
                {
                  name: "brightnessDown",
                  description: "Decrease screen brightness by a step (default 10%). Use when user says 'decrease brightness' or 'dim screen'.",
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      amount: { type: Type.NUMBER, description: "Percentage to decrease (default 10)." }
                    }
                  }
                },
                {
                  name: "setBrightness",
                  description: "Set screen brightness to an exact level. Use when user says 'set brightness to 50%' or 'brightness 80'.",
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      percent: { type: Type.NUMBER, description: "Target brightness 0-100." }
                    },
                    required: ["percent"]
                  }
                },
                // --- V2: Windows auto-start management ---
                {
                  name: "enableAutoStart",
                  description: "Enable YANTRI to launch automatically when Windows starts. Creates a silent startup entry.",
                  parameters: { type: Type.OBJECT, properties: {} }
                },
                {
                  name: "disableAutoStart",
                  description: "Disable YANTRI auto-start on Windows login. Removes the startup entry.",
                  parameters: { type: Type.OBJECT, properties: {} }
                },
                {
                  name: "getAutoStartStatus",
                  description: "Check whether YANTRI is currently configured to auto-start on Windows login.",
                  parameters: { type: Type.OBJECT, properties: {} }
                },
                // --- V3: Terminal and Package execution ---
                {
                  name: "requestTerminalAction",
                  description: "FIRST STEP for terminal commands or package installation. Generates a confirmation token. Tell the user verbally, then call the execution tool if they confirm.",
                  parameters: { type: Type.OBJECT, properties: { command: { type: Type.STRING, description: "Terminal command to run." }, package: { type: Type.STRING, description: "Package name to install." } } }
                },
                {
                  name: "runTerminalCommand",
                  description: "SECOND STEP: execute a previously-confirmed terminal command. Requires a valid execute_token from requestTerminalAction.",
                  parameters: { type: Type.OBJECT, properties: { command: { type: Type.STRING, description: "The confirmed bash command." }, execute_token: { type: Type.STRING, description: "Confirmation token from requestTerminalAction." } }, required: ["command", "execute_token"] }
                },
                {
                  name: "isCommandAllowed",
                  description: "Checks whether a terminal command is allowed by the security blacklist before running. Use to validate a command before execution.",
                  parameters: { type: Type.OBJECT, properties: { command: { type: Type.STRING, description: "The terminal command to check." } }, required: ["command"] }
                },
                {
                  name: "installPackage",
                  description: "SECOND STEP: install a package using pacman. Requires a valid execute_token from requestTerminalAction.",
                  parameters: { type: Type.OBJECT, properties: { package: { type: Type.STRING, description: "The confirmed package name." }, execute_token: { type: Type.STRING, description: "Confirmation token from requestTerminalAction." } }, required: ["package", "execute_token"] }
                },
                // --- V4: Browser vision + IITM + self-close ---
                {
                  name: "desktopBrowserReadText",
                  description: "Read the visible text content of the current page in the desktop automation browser. Use when user asks 'what does this page say' or 'read this page'.",
                  parameters: { type: Type.OBJECT, properties: { max_chars: { type: Type.INTEGER, description: "Max chars to return (default 4000)." } } }
                },
                {
                  name: "desktopBrowserGetLinks",
                  description: "Extract all visible hyperlinks from the current page in the desktop automation browser.",
                  parameters: { type: Type.OBJECT, properties: {} }
                },
                {
                  name: "iitmQuickLinks",
                  description: "List all available IITM BS Degree quick links (portal, course dashboard, Acegrade, notes, etc.).",
                  parameters: { type: Type.OBJECT, properties: {} }
                },
                {
                  name: "iitmOpen",
                  description: "Open an IITM BS Degree resource by name. Available: portal, course, academics, qualifier, exams, acegrade, mlt_notes, pdsa_notes, pdsa_notes_community, community_notes, mlt_github, portal_login.",
                  parameters: { type: Type.OBJECT, properties: { resource: { type: Type.STRING, description: "Resource key name." } }, required: ["resource"] }
                },
                {
                  name: "iitmOpenCustom",
                  description: "Open a custom IITM URL in the system browser.",
                  parameters: { type: Type.OBJECT, properties: { url: { type: Type.STRING, description: "URL to open." } }, required: ["url"] }
                },
                {
                  name: "shutdownYantri",
                  description: "Gracefully shut down YANTRI agent and server. Use only when user explicitly asks to close YANTRI. Requires confirmation token from requestTerminalAction.",
                  parameters: { type: Type.OBJECT, properties: { execute_token: { type: Type.STRING, description: "Confirmation token from requestTerminalAction." } }, required: ["execute_token"] }
                },
                {
                  name: "getWeather",
                  description: "Get current weather for a location. Use when user asks about weather, temperature, or climate.",
                  parameters: { type: Type.OBJECT, properties: { location: { type: Type.STRING, description: "City name (e.g. 'Mumbai', 'Delhi', 'New York')." } }, required: ["location"] }
                },
                {
                  name: "switchWorkspace",
                  description: "Switch to a specific Hyprland workspace by number. Use when user says 'go to workspace 3' or 'switch to workspace 1'.",
                  parameters: { type: Type.OBJECT, properties: { workspace: { type: Type.STRING, description: "Workspace number or name (e.g. '3', 'special:scratchpad')." } }, required: ["workspace"] }
                },
                {
                  name: "listWorkspaces",
                  description: "List all available Hyprland workspaces with their IDs.",
                  parameters: { type: Type.OBJECT, properties: {} }
                },
                {
                  name: "moveToWorkspace",
                  description: "Move the active window to a different Hyprland workspace.",
                  parameters: { type: Type.OBJECT, properties: { workspace: { type: Type.STRING, description: "Target workspace number." } }, required: ["workspace"] }
                },
                {
                  name: "getNews",
                  description: "Get top news headlines. Supports categories: top, tech, world, india, sports, business.",
                  parameters: { type: Type.OBJECT, properties: { category: { type: Type.STRING, description: "News category: 'top', 'tech', 'world', 'india', 'sports', 'business'." }, count: { type: Type.INTEGER, description: "Number of headlines (max 15, default 5)." } } }
                },
                {
                  name: "exportConversation",
                  description: "Save the current conversation to a text file on disk. Call this when the user says 'save this conversation', 'baat save kar', 'export chat'. Pass the full conversation text that you have from context.",
                  parameters: { type: Type.OBJECT, properties: { text: { type: Type.STRING, description: "Full conversation text to save." }, filename: { type: Type.STRING, description: "Optional filename (default auto-generated with timestamp)." } }, required: ["text"] }
                },
                {
                  name: "listExports",
                  description: "List all previously saved conversation export files.",
                  parameters: { type: Type.OBJECT, properties: {} }
                },
                // ── Google Calendar, Gmail, Tasks ──
                {
                  name: "getCalendarEvents",
                  description: "List upcoming Google Calendar events. Use when user asks 'what's on my calendar', 'mera schedule bata', 'upcoming events'.",
                  parameters: { type: Type.OBJECT, properties: { max_results: { type: Type.INTEGER, description: "Number of events (default 10)." }, days_ahead: { type: Type.INTEGER, description: "Days ahead to check (default 7)." }, show_all: { type: Type.BOOLEAN, description: "Include full details (default false)." } } }
                },
                {
                  name: "createCalendarEvent",
                  description: "Create a Google Calendar event. Use when user says 'meeting schedule kar', 'event bana', 'reminder add kar'.",
                  parameters: { type: Type.OBJECT, properties: { summary: { type: Type.STRING, description: "Event title (required)." }, start_time: { type: Type.STRING, description: "Start time in ISO format, e.g. '2026-07-24T14:00:00'." }, end_time: { type: Type.STRING, description: "End time in ISO format." }, description: { type: Type.STRING, description: "Event description." }, location: { type: Type.STRING, description: "Event location." }, attendees: { type: Type.STRING, description: "Comma-separated email addresses." } }, required: ["summary"] }
                },
                {
                  name: "playYouTubeVideo",
                  description: "Agent-free YouTube playback: search YouTube for a song/video and play the first result inside Yantri's embedded player. Use for 'play Believer', 'gaana chalao', 'play lofi coding music on YouTube'. Works on ANY device — no desktop agent needed.",
                  parameters: { type: Type.OBJECT, properties: { query: { type: Type.STRING, description: "YouTube search query, e.g. 'Believer by Imagine Dragons'." } }, required: ["query"] }
                },
                {
                  name: "draftEmail",
                  description: "FIRST STEP of sending an email from ONE spoken command. Extracts the recipient address and email request from what the user said, composes a polished subject+body, stores it as a draft and returns a preview. Read the preview back, ask for approval, then call sendEmail (with NO arguments) to send it.",
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      request: { type: Type.STRING, description: "Everything the user said about the email, verbatim or lightly cleaned: 'email professor sharma saying I need a 2 day extension on the MLT assignment'." },
                      to: { type: Type.STRING, description: "Recipient email address if the user spoke it (leave empty to ask)." },
                      cc: { type: Type.STRING, description: "CC address(es), comma separated if the user mentioned any." },
                      tone: { type: Type.STRING, description: "Tone: formal (default), casual or polite.", enum: ["formal", "casual", "polite"] }
                    },
                    required: ["request"]
                  }
                },
                {
                  name: "readFullEmail",
                  description: "Read the FULL body of one email by its id. Use when the user asks to 'open/read the email', 'what does it say', 'iski poori detail suna', after listing emails with getEmails. Returns sender, date, subject, plain-text body and attachment names.",
                  parameters: { type: Type.OBJECT, properties: { id: { type: Type.STRING, description: "Gmail message id from getEmails." }, max_chars: { type: Type.INTEGER, description: "Max body characters to return (default 6000)." } }, required: ["id"] }
                },
                {
                  name: "draftReply",
                  description: "FIRST STEP of replying to an email the user has heard (via getEmails/readFullEmail). Fetches the original, composes a contextual reply, stores it as a draft and returns a preview. Read the preview back, ask for approval, then call sendEmail (with NO arguments) to send the threaded reply.",
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      id: { type: Type.STRING, description: "Gmail message id of the email being replied to (from getEmails)." },
                      request: { type: Type.STRING, description: "Everything the user said the reply should communicate, e.g. 'confirm I will attend and ask for the venue'." }
                    },
                    required: ["id", "request"]
                  }
                },
                {
                  name: "sendEmail",
                  description: "Send an email via Gmail. TWO modes: (1) After draftEmail was called and approved, call this with NO arguments to send the stored draft. (2) Only when the user explicitly dictates every field, pass to/subject/body directly. Never invent recipients or content.",
                  parameters: { type: Type.OBJECT, properties: { to: { type: Type.STRING, description: "Recipient email address (omit to use the approved draft)." }, subject: { type: Type.STRING, description: "Email subject (omit to use the approved draft)." }, body: { type: Type.STRING, description: "Email body text (omit to use the approved draft)." }, cc: { type: Type.STRING, description: "CC email address." } } }
                },
                {
                  name: "getEmails",
                  description: "List recent emails from Gmail inbox. Use when user says 'meri emails dikha', 'inbox check kar', 'recent emails'.",
                  parameters: { type: Type.OBJECT, properties: { max_results: { type: Type.INTEGER, description: "Number of emails (default 5, max 20)." }, query: { type: Type.STRING, description: "Gmail search filter, e.g. 'from:someone@gmail.com' or 'subject:meeting'." } } }
                },
                {
                  name: "getTasks",
                  description: "List tasks from Google Tasks. Use when user asks 'meri tasks dikha', 'to-do list bata', 'what tasks do I have'.",
                  parameters: { type: Type.OBJECT, properties: { tasklist: { type: Type.STRING, description: "Task list name (default 'My Tasks')." }, max_results: { type: Type.INTEGER, description: "Max tasks (default 10)." }, show_completed: { type: Type.BOOLEAN, description: "Include completed tasks (default false)." } } }
                },
                {
                  name: "createTask",
                  description: "Create a task in Google Tasks. Use when user says 'task add kar', 'reminder set kar', 'ek kaam yaad rakh'.",
                  parameters: { type: Type.OBJECT, properties: { title: { type: Type.STRING, description: "Task title (required)." }, notes: { type: Type.STRING, description: "Task description." }, due: { type: Type.STRING, description: "Due date in ISO format, e.g. '2026-07-30'." }, tasklist: { type: Type.STRING, description: "Task list name (default 'My Tasks')." } }, required: ["title"] }
                },
                {
                  name: "cameraList",
                  description: "List available webcam devices on this computer. Use when the user asks what cameras are available or before turning a camera on.",
                  parameters: { type: Type.OBJECT, properties: {} }
                },
                {
                  name: "cameraOn",
                  description: "Turn the webcam ON in a floating viewer window without disturbing the tiling layout of other windows. Use when user says 'camera on karo', 'webcam chalao', 'kamera kholo'. Optionally pass a specific device.",
                  parameters: { type: Type.OBJECT, properties: { device: { type: Type.STRING, description: "Camera device path, e.g. '/dev/video0'. Defaults to the first camera found." } } }
                },
                {
                  name: "cameraOff",
                  description: "Turn the webcam OFF and free the device for other applications. Use when user says 'camera band karo', 'webcam band karo'.",
                  parameters: { type: Type.OBJECT, properties: {} }
                },
                // ── V4: Role-feature tools — personal data records ──
                {
                  name: "saveUserRecord",
                  description: "Save a piece of user-provided data for their selected features: assignment deadlines, exam dates, notes, flashcards, attendance, meeting notes, inventory entries, supplier dues, customer feedback, etc. One flexible store.",
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      type: { type: Type.STRING, description: "Record type: deadline, exam, note, flashcard, attendance, meeting, inventory, supplier, feedback, custom_reminder, task_local, work_session, or any feature-specific type." },
                      title: { type: Type.STRING, description: "Short title, e.g. 'Physics Assignment 3' or 'Restock cement bags'." },
                      payload: { type: Type.OBJECT, description: "Free-form details: subject, marks, quantity, price, supplier, items, member, status, etc." },
                      due: { type: Type.STRING, description: "Optional due date/time in ISO format, e.g. '2026-10-05' or '2026-10-05T17:00:00'." },
                      tags: { type: Type.ARRAY, items: { type: Type.STRING }, description: "Optional tags, e.g. ['physics', 'assignment']." }
                    },
                    required: ["type", "title"]
                  }
                },
                {
                  name: "getUserRecords",
                  description: "Query the user's saved records: 'show my deadlines', 'what flashcards do I have', 'summarise my inventory entries', 'list meeting notes', etc.",
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      type: { type: Type.STRING, description: "Filter by record type (deadline, exam, note, flashcard, attendance, meeting, inventory, supplier, feedback, ...)." },
                      tag: { type: Type.STRING, description: "Filter by tag." },
                      search: { type: Type.STRING, description: "Free-text search over titles and payload details." },
                      due_before: { type: Type.STRING, description: "Only records due on/before this ISO date." },
                      due_after: { type: Type.STRING, description: "Only records due on/after this ISO date." },
                      limit: { type: Type.INTEGER, description: "Max records to return (default 50)." }
                    }
                  }
                },
                {
                  name: "updateUserRecord",
                  description: "Update an existing record (e.g. mark assignment submitted, update stock quantity, reschedule a meeting note). Get the id from getUserRecords first.",
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      id: { type: Type.STRING, description: "Record id from getUserRecords." },
                      title: { type: Type.STRING, description: "New title." },
                      payload: { type: Type.OBJECT, description: "New payload details (replaces existing)." },
                      due: { type: Type.STRING, description: "New due date in ISO format." },
                      tags: { type: Type.ARRAY, items: { type: Type.STRING }, description: "New tags (replaces existing)." }
                    },
                    required: ["id"]
                  }
                },
                {
                  name: "deleteUserRecord",
                  description: "Delete a record by id (e.g. 'remove that deadline', 'delete this flashcard'). Get the id from getUserRecords first.",
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      id: { type: Type.STRING, description: "Record id from getUserRecords." }
                    },
                    required: ["id"]
                  }
                },
                // ── V4: Study/focus tools (Python agent) ──
                {
                  name: "startPomodoro",
                  description: "Start a Pomodoro study/work timer: focus sessions with short breaks. Announce session start/break/end. Use for 'make a study plan', 'start a 25-minute focus session', 'pomodoro chalu karo'.",
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      work_minutes: { type: Type.INTEGER, description: "Focus session length in minutes (default 25)." },
                      break_minutes: { type: Type.INTEGER, description: "Break length in minutes (default 5)." },
                      cycles: { type: Type.INTEGER, description: "Number of work/break cycles (default 4)." },
                      label: { type: Type.STRING, description: "What you're working on, e.g. 'Physics revision'." }
                    }
                  }
                },
                {
                  name: "startFocusMode",
                  description: "Start FOCUS MODE: blocks distracting apps/websites for N minutes (best-effort on the host OS). Announce clearly before enabling.",
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      minutes: { type: Type.INTEGER, description: "Duration of focus mode in minutes (default 25)." },
                      block_websites: { type: Type.ARRAY, items: { type: Type.STRING }, description: "Websites to block, e.g. ['youtube.com', 'instagram.com']." },
                      block_apps: { type: Type.ARRAY, items: { type: Type.STRING }, description: "Process names to kill, e.g. ['steam.exe', 'vlc']." }
                    }
                  }
                },
                {
                  name: "stopFocusMode",
                  description: "End focus mode early and restore access to blocked apps/websites.",
                  parameters: { type: Type.OBJECT, properties: {} }
                },
                {
                  name: "getFocusStatus",
                  description: "Check whether focus mode / pomodoro is currently active and time remaining.",
                  parameters: { type: Type.OBJECT, properties: {} }
                },
                {
                  name: "extractDocumentText",
                  description: "Extract readable text from PDFs, DOCX, images (OCR), or plain text files. Use for 'summarise this PDF', 'key points from notes.pdf', 'read this bill'.",
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      path: { type: Type.STRING, description: "Path to the PDF/DOCX/image/text file." },
                      max_chars: { type: Type.INTEGER, description: "Max characters to return (default 6000)." },
                      ocr: { type: Type.BOOLEAN, description: "Force OCR on images/scanned PDFs (default auto)." }
                    },
                    required: ["path"]
                  }
                },
                // ── V4: Spreadsheet tools (Python agent) ──
                {
                  name: "writeSpreadsheet",
                  description: "Create a new CSV/XLSX spreadsheet with headers and rows of data. Use for inventory sheets, feedback logs, supplier ledgers, marks tables.",
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      path: { type: Type.STRING, description: "File path for the sheet, e.g. 'Documents/Business/inventory.xlsx'." },
                      sheet_name: { type: Type.STRING, description: "Sheet/tab name (XLSX only, default 'Sheet1')." },
                      headers: { type: Type.ARRAY, items: { type: Type.STRING }, description: "Column headers, e.g. ['Date','Item','Qty','Price']." },
                      rows: { type: Type.ARRAY, items: { type: Type.OBJECT, properties: {}, description: "Row values array." }, description: "Array of rows; each row is an array of cell values." },
                      overwrite: { type: Type.BOOLEAN, description: "Replace file if it exists (default false — appends headers only when creating)." }
                    },
                    required: ["path", "headers", "rows"]
                  }
                },
                {
                  name: "appendSpreadsheetRows",
                  description: "Append rows to an existing CSV/XLSX sheet (creates it with headers if missing). Use for logging inventory/feedback/payment entries over time.",
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      path: { type: Type.STRING, description: "Spreadsheet file path." },
                      sheet_name: { type: Type.STRING, description: "Sheet/tab name (XLSX only)." },
                      headers: { type: Type.ARRAY, items: { type: Type.STRING }, description: "Headers used when creating the file fresh." },
                      rows: { type: Type.ARRAY, items: { type: Type.OBJECT, properties: {}, description: "Row values array." }, description: "Rows to append; each row is an array of cell values." }
                    },
                    required: ["path", "headers", "rows"]
                  }
                },
                {
                  name: "readSpreadsheet",
                  description: "Read rows from a CSV/XLSX spreadsheet. Use to review inventory, feedback, marks, ledgers.",
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      path: { type: Type.STRING, description: "Spreadsheet file path." },
                      sheet_name: { type: Type.STRING, description: "Sheet/tab name (XLSX only, default first sheet)." },
                      max_rows: { type: Type.INTEGER, description: "Max rows to return (default 100)." },
                      max_cols: { type: Type.INTEGER, description: "Max columns (default 20)." }
                    },
                    required: ["path"]
                  }
                },
                {
                  name: "summarizeSpreadsheet",
                  description: "Summarise a CSV/XLSX sheet: row/col counts, numeric column stats (sum/avg/min/max), and a preview. Use for 'how much stock did I add this week', 'summarise my sales'.",
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      path: { type: Type.STRING, description: "Spreadsheet file path." },
                      sheet_name: { type: Type.STRING, description: "Sheet/tab name (XLSX only, default first sheet)." },
                      group_by: { type: Type.STRING, description: "Optional column name to group numeric sums by (e.g. 'Item')." },
                      value_column: { type: Type.STRING, description: "Numeric column to aggregate (e.g. 'Total' or 'Qty')." }
                    },
                    required: ["path"]
                  }
                },
                {
                  name: "logInventoryEntry",
                  description: "Log ONE inventory/stock entry: appends to the business inventory spreadsheet AND saves a searchable record. Use when the user dictates stock arrivals from WhatsApp: '50 bags cement at 350 each from Sharma Traders'.",
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      item: { type: Type.STRING, description: "Item name, e.g. 'Cement bags'." },
                      quantity: { type: Type.NUMBER, description: "Quantity received/sold." },
                      unit_price: { type: Type.NUMBER, description: "Price per unit." },
                      supplier: { type: Type.STRING, description: "Supplier or source name." },
                      direction: { type: Type.STRING, description: "'in' (stock received) or 'out' (sold/used). Default 'in'." },
                      notes: { type: Type.STRING, description: "Extra details." },
                      date: { type: Type.STRING, description: "Entry date (ISO). Defaults to today." }
                    },
                    required: ["item", "quantity"]
                  }
                }
              ].filter((d) => {
                // V4 feature gating: offer only tools allowed by the user's
                // role + selected feature modules (null = no profile yet).
                if (allowedTools && !allowedTools.has(d.name)) {
                  console.log(`[Profile] Gating out tool: ${d.name}`);
                  return false;
                }
                // Capability gating: without the desktop agent, hide
                // declarations whose implementation only exists on the
                // user's machine. Server-native tools listed in SERVER_TOOLS
                // keep being offered, so weather/news keep working.
                if (!agentOnline && DESKTOP_TOOLS.has(d.name) && !SERVER_TOOLS.has(d.name)) {
                  return false;
                }
                return true;
              })
            }
          ]
        },
        callbacks: {
          onmessage: (message: LiveServerMessage) => {
            // Audio Stream Chunk (model response audio play, 24kHz raw PCM)
            const audio = message.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
            if (audio) {
              clientWs.send(JSON.stringify({ type: "audio", audio }));
            }
            
            // Interruption flag
            if (message.serverContent?.interrupted) {
              console.log("[Yantri Interrupted!]");
              clientWs.send(JSON.stringify({ type: "interrupted" }));
            }
            
            // Turn Complete
            if (message.serverContent?.turnComplete) {
              clientWs.send(JSON.stringify({ type: "turnComplete" }));
              
              if (currentModelResponseText.trim()) {
                dialogueHistory.push({ role: "model", text: currentModelResponseText });
                currentModelResponseText = "";
              }

              // Fire asynchronous memory extraction
              if (dialogueHistory.length >= 2) {
                (async () => {
                  try {
                    const updated = await processConversationSlice(apiKey, dialogueHistory);
                    if (updated) {
                      console.log("[Memory Sync] Sending refreshed memory list to client.");
                      clientWs.send(JSON.stringify({ type: "memory_sync", memories: updated }));
                    }
                  } catch (err) {
                    console.error("[Memory Sync] Error running background consolidation:", err);
                  }
                })();
              }
            }
            
            // Transcription of model output (text chunk)
            const modelText = (message.serverContent as any)?.modelTurn?.parts?.[0]?.text;
            if (modelText) {
              clientWs.send(JSON.stringify({ type: "transcription", role: "model", text: modelText }));
              currentModelResponseText += modelText;
            }

            // User input transcription (user speech text translated by Gemini)
            const userTextOutput = (message.serverContent as any)?.userTurn?.parts?.[0]?.text;
            if (userTextOutput) {
              clientWs.send(JSON.stringify({ type: "transcription", role: "user", text: userTextOutput }));
              dialogueHistory.push({ role: "user", text: userTextOutput });
            }

            // Function Calls (Gemini requesting server/client tool execution)
            if (message.toolCall?.functionCalls) {
              for (const fc of message.toolCall.functionCalls) {
                const fnName = fc.name;
                if (!fnName) continue;
                console.log(`[Function Call]: ${fnName}`, fc.args);
                
                if (fnName === "saveCustomMemory") {
                  (async () => {
                    try {
                      const args = fc.args as any;
                      const category = args.category;
                      const text = args.text;
                      if (category && text) {
                        const mList = await loadMemories();
                        const timestamp = new Date().toISOString();
                        const newMemory: Memory = {
                          id: Math.random().toString(36).substring(2, 11),
                          category,
                          text,
                          createdAt: timestamp,
                          updatedAt: timestamp
                        };
                        mList.push(newMemory);
                        await saveMemories(mList);
                        
                        // Sync immediately with the React client
                        clientWs.send(JSON.stringify({ type: "memory_sync", memories: mList }));
                        
                        // Send success code back to live link
                        session.sendToolResponse({
                          functionResponses: [
                            {
                              name: fc.name,
                              response: { output: { result: "Memory successfully captured and persisted in connections core." } },
                              id: fc.id
                            }
                          ]
                        });
                      }
                    } catch (err: any) {
                      console.error("saveCustomMemory execution failure:", err);
                    }
                  })();
                } else if (fnName === "setReminder") {
                  (async () => {
                    try {
                      const args = fc.args as any;
                      const text = args.text;
                      const minutes = Number(args.minutes);
                      if (text && minutes > 0) {
                        const reminder = addReminder(text, minutes);
                        session.sendToolResponse({
                          functionResponses: [{
                            name: fc.name,
                            response: { output: { result: `Reminder set: "${text}" in ${minutes} minute(s). (id: ${reminder.id})` } },
                            id: fc.id
                          }]
                        });
                      }
                    } catch (err: any) {
                      console.error("setReminder execution failure:", err);
                    }
                  })();
                } else if (fnName === "listReminders") {
                  const pending = getReminders().filter((r) => !r.fired);
                  const list = pending.length === 0
                    ? "No pending reminders."
                    : pending.map((r) => {
                        const mins = Math.max(0, Math.round((new Date(r.fireAt).getTime() - Date.now()) / 60000));
                        return `"${r.text}" — fires in ${mins} min (id: ${r.id})`;
                      }).join("\n");
                  session.sendToolResponse({
                    functionResponses: [{
                      name: fnName,
                      response: { output: { result: list } },
                      id: fc.id
                    }]
                  });
                } else if (fnName === "cancelReminder") {
                  const args = fc.args as any;
                  const ok = cancelReminder(args.id);
                  session.sendToolResponse({
                    functionResponses: [{
                      name: fnName,
                      response: { output: { result: ok ? "Reminder cancelled." : "Reminder not found." } },
                      id: fc.id
                    }]
                  });
                } else if (fnName === "saveUserRecord") {
                  // ── V4 role-feature data: save/update a user record ──
                  (async () => {
                    try {
                      const args = fc.args as any;
                      const rec = await saveRecord({
                        type: String(args.type || "note"),
                        title: String(args.title || "Untitled"),
                        payload: (args.payload && typeof args.payload === "object") ? args.payload : {},
                        due: args.due ? String(args.due) : undefined,
                        tags: Array.isArray(args.tags) ? args.tags.map(String) : [],
                        id: args.id ? String(args.id) : undefined,
                      });
                      session.sendToolResponse({
                        functionResponses: [{
                          name: fc.name,
                          response: { output: { result: `Saved ${rec.type} "${rec.title}" (id: ${rec.id}).`, record: rec } },
                          id: fc.id
                        }]
                      });
                    } catch (err: any) {
                      session.sendToolResponse({
                        functionResponses: [{
                          name: fc.name,
                          response: { output: { result: `Could not save record: ${err?.message || err}` } },
                          id: fc.id
                        }]
                      });
                    }
                  })();
                } else if (fnName === "getUserRecords") {
                  // ── V4 role-feature data: query user records ──
                  (async () => {
                    try {
                      const args = fc.args as any;
                      const records = await queryRecords({
                        type: args.type,
                        tag: args.tag,
                        search: args.search,
                        dueBefore: args.due_before || args.dueBefore,
                        dueAfter: args.due_after || args.dueAfter,
                        limit: args.limit ? Number(args.limit) : undefined,
                      });
                      const list = records.length === 0
                        ? "No matching records found."
                        : records.map((r) => {
                            const dueStr = r.due ? ` | due ${r.due}` : "";
                            const payloadStr = Object.keys(r.payload || {}).length
                              ? ` | ${JSON.stringify(r.payload)}`
                              : "";
                            return `- [${r.type}] ${r.title}${dueStr}${payloadStr} (id: ${r.id})`;
                          }).join("\n");
                      session.sendToolResponse({
                        functionResponses: [{
                          name: fc.name,
                          response: { output: { result: list, records } },
                          id: fc.id
                        }]
                      });
                    } catch (err: any) {
                      session.sendToolResponse({
                        functionResponses: [{
                          name: fc.name,
                          response: { output: { result: `Could not read records: ${err?.message || err}` } },
                          id: fc.id
                        }]
                      });
                    }
                  })();
                } else if (fnName === "updateUserRecord") {
                  // ── V4 role-feature data: update an existing record ──
                  (async () => {
                    try {
                      const args = fc.args as any;
                      const rec = await updateRecord(String(args.id), {
                        title: args.title ? String(args.title) : undefined,
                        payload: (args.payload && typeof args.payload === "object") ? args.payload : undefined,
                        due: args.due ? String(args.due) : undefined,
                        tags: Array.isArray(args.tags) ? args.tags.map(String) : undefined,
                      });
                      session.sendToolResponse({
                        functionResponses: [{
                          name: fc.name,
                          response: { output: { result: rec ? `Updated record ${rec.id}.` : `Record not found: ${args.id}` } },
                          id: fc.id
                        }]
                      });
                    } catch (err: any) {
                      session.sendToolResponse({
                        functionResponses: [{
                          name: fc.name,
                          response: { output: { result: `Could not update record: ${err?.message || err}` } },
                          id: fc.id
                        }]
                      });
                    }
                  })();
                } else if (fnName === "deleteUserRecord") {
                  // ── V4 role-feature data: delete a record ──
                  (async () => {
                    try {
                      const args = fc.args as any;
                      const ok = await deleteRecord(String(args.id));
                      session.sendToolResponse({
                        functionResponses: [{
                          name: fc.name,
                          response: { output: { result: ok ? "Record deleted." : `Record not found: ${args.id}` } },
                          id: fc.id
                        }]
                      });
                    } catch (err: any) {
                      session.sendToolResponse({
                        functionResponses: [{
                          name: fc.name,
                          response: { output: { result: `Could not delete record: ${err?.message || err}` } },
                          id: fc.id
                        }]
                      });
                    }
                  })();
                } else if (fnName === "draftReply") {
                  // ── V5.2 reply flow step 1: fetch original, compose reply, store draft ──
                  (async () => {
                    try {
                      const args = (fc.args || {}) as { id?: string; message_id?: string; request?: string };
                      const messageId = String(args.id || args.message_id || "").trim();
                      const request = String(args.request || "").trim();
                      if (!messageId) {
                        session.sendToolResponse({
                          functionResponses: [{
                            name: fc.name,
                            response: { output: { result: "Missing email id. Call getEmails first to list the inbox, then pass the id of the email to reply to." } },
                            id: fc.id,
                          }],
                        });
                        return;
                      }
                      if (!request) {
                        session.sendToolResponse({
                          functionResponses: [{
                            name: fc.name,
                            response: { output: { result: "Missing request. Say what the reply should communicate, e.g. 'confirm I will attend'." } },
                            id: fc.id,
                          }],
                        });
                        return;
                      }

                      // Full original — needed for the sender address AND thread ids.
                      const original = await googleReadEmail({ id: messageId, max_chars: 4000 });
                      if (!original.ok) {
                        session.sendToolResponse({
                          functionResponses: [{
                            name: fc.name,
                            response: { output: { result: `Could not read the original email: ${original.error}` } },
                            id: fc.id,
                          }],
                        });
                        return;
                      }
                      const orig = (original.result || {}) as {
                        from?: string; to?: string; subject?: string; body?: string; threadId?: string;
                      };

                      // Reply goes to the original sender; strip display name.
                      const addrMatch = String(orig.from || "").match(/[\w.%+-]+@[\w.-]+\.[a-z]{2,}/i);
                      const replyTo = addrMatch ? addrMatch[0].toLowerCase() : "";
                      if (!replyTo) {
                        session.sendToolResponse({
                          functionResponses: [{
                            name: fc.name,
                            response: { output: { result: "Could not determine the sender's address on the original email." } },
                            id: fc.id,
                          }],
                        });
                        return;
                      }

                      // Re: subject — avoid stacking "Re: Re:".
                      const origSubject = String(orig.subject || "").replace(/^\s*(re|aw|fwd?)\s*:\s*/i, "");
                      const subject = `Re: ${origSubject}`;

                      const profile = await loadProfile();
                      const composed = await composeEmail(
                        {
                          request,
                          to: [replyTo],
                          cc: [],
                          tone: "formal",
                          userName: profile?.name || "",
                          userEmail: profile?.email || "",
                          extraContext:
                            `You are REPLYING to this email.\n` +
                            `From: ${orig.from}\nSubject: ${orig.subject}\n` +
                            `Original message:\n"""${String(orig.body || "").slice(0, 1500)}"""\n` +
                            `Keep the reply self-contained and do not repeat the whole original.`,
                        },
                        apiKey
                      );

                      storeDraft(clientKey, {
                        to: replyTo,
                        cc: "",
                        subject,
                        body: composed.body,
                        request: `REPLY to ${messageId}: ${request}`,
                        createdAt: Date.now(),
                        composedBy: composed.composedBy,
                        replyToMessageId: messageId,
                        threadId: orig.threadId || undefined,
                        replyToFrom: orig.from || "",
                        replyToSnippet: String(orig.body || "").slice(0, 200),
                      });

                      const preview =
                        `REPLY DRAFT READY (not sent yet).\n` +
                        `In reply to: ${orig.from} — "${orig.subject}"\n` +
                        `To: ${replyTo}\n` +
                        `Subject: ${subject}\n` +
                        `Body:\n${composed.body}\n\n` +
                        `NEXT: Read this preview back to the user conversationally, then ask: 'Shall I send it?'. ` +
                        `If they approve, call sendEmail with NO arguments. If they want changes, call draftReply again with the same id and the refined request.`;

                      logCommand(`EMAIL_REPLY_DRAFT id=${messageId} to=${replyTo}`);
                      session.sendToolResponse({
                        functionResponses: [{
                          name: fc.name,
                          response: { output: { result: preview } },
                          id: fc.id,
                        }],
                      });
                    } catch (err: any) {
                      session.sendToolResponse({
                        functionResponses: [{
                          name: fc.name,
                          response: { output: { result: `Could not draft the reply: ${err?.message || err}` } },
                          id: fc.id,
                        }],
                      });
                    }
                  })();
                } else if (fnName === "draftEmail") {
                  // ── V4 email flow step 1: compose + store draft ──
                  (async () => {
                    try {
                      const args = fc.args as any;
                      const request = String(args.request || "").trim();
                      if (!request) {
                        session.sendToolResponse({
                          functionResponses: [{
                            name: fc.name,
                            response: { output: { result: "No request text provided. Ask the user what the email should say." } },
                            id: fc.id
                          }]
                        });
                        return;
                      }

                      // Recipients: explicit args win, else parse from the request text.
                      const explicit = normalizeRecipients({ to: args.to, cc: args.cc });
                      const spoken = explicit.to.length || explicit.cc.length
                        ? { to: [], cc: [] }
                        : parseRecipients(request);
                      const to = explicit.to.length ? explicit.to : spoken.to;
                      const cc = explicit.cc.length ? explicit.cc : spoken.cc;

                      const profile = await loadProfile();
                      const composed = await composeEmail(
                        {
                          request,
                          to,
                          cc,
                          tone: args.tone || "formal",
                          userName: profile?.name || "",
                          userEmail: profile?.email || "",
                        },
                        apiKey
                      );

                      storeDraft(clientKey, {
                        to: to.join(", "),
                        cc: cc.join(", "),
                        subject: composed.subject,
                        body: composed.body,
                        request,
                        createdAt: Date.now(),
                        composedBy: composed.composedBy,
                      });

                      const preview =
                        `DRAFT READY (not sent yet).\n` +
                        `To: ${to.join(", ") || "(missing — ask the user for the recipient's email address)"}\n` +
                        `Subject: ${composed.subject}\n` +
                        `Body:\n${composed.body}\n\n` +
                        `NEXT: Read this preview back to the user conversationally, then ask: 'Shall I send it?'. ` +
                        `If the recipient is missing, ask for it. If they approve, call sendEmail with NO arguments. ` +
                        `If they want changes, call draftEmail again with the refined request.`;

                      session.sendToolResponse({
                        functionResponses: [{
                          name: fc.name,
                          response: { output: { result: preview } },
                          id: fc.id
                        }]
                      });
                    } catch (err: any) {
                      session.sendToolResponse({
                        functionResponses: [{
                          name: fc.name,
                          response: { output: { result: `Could not draft the email: ${err?.message || err}` } },
                          id: fc.id
                        }]
                      });
                    }
                  })();
                } else if (fnName === "sendEmail") {
                  // ── V4 email flow step 2: send stored draft or direct args ──
                  (async () => {
                    try {
                      const args = (fc.args || {}) as any;
                      const hasDirect = Boolean(
                        (args.to && String(args.to).trim()) ||
                        (args.subject && String(args.subject).trim()) ||
                        (args.body && String(args.body).trim())
                      );

                      let payload = { to: "", subject: "", body: "", cc: "" };
                      if (hasDirect) {
                        // Direct mode: model passed explicit fields (dictated email).
                        const norm = normalizeRecipients({ to: args.to, cc: args.cc });
                        payload = {
                          to: norm.to.join(", "),
                          subject: String(args.subject || "").trim(),
                          body: String(args.body || "").trim(),
                          cc: norm.cc.join(", "),
                        };
                        if (!payload.to || !payload.subject || !payload.body) {
                          session.sendToolResponse({
                            functionResponses: [{
                              name: fc.name,
                              response: { output: { result: "Missing fields for direct send (need to, subject AND body). Prefer the draft flow: call draftEmail with what the user asked, preview it, then sendEmail with no arguments." } },
                              id: fc.id
                            }]
                          });
                          return;
                        }
                      } else {
                        // Draft mode: consume the stored draft.
                        const draft = takeDraft(clientKey);
                        if (!draft) {
                          session.sendToolResponse({
                            functionResponses: [{
                              name: fc.name,
                              response: { output: { result: "No pending draft. Call draftEmail first with the user's request, get approval, then send." } },
                              id: fc.id
                            }]
                          });
                          return;
                        }
                        if (!draft.to) {
                          session.sendToolResponse({
                            functionResponses: [{
                              name: fc.name,
                              response: { output: { result: `The draft has no recipient. Ask the user for the email address, then call draftEmail again with to='<address>' and the same request.` } },
                              id: fc.id
                            }]
                          });
                          // keep the draft so the retry can reuse it after recipient is known
                          storeDraft(clientKey, draft);
                          return;
                        }
                        payload = mergeDraftWithArgs(draft, args);
                      }

                      logCommand(`EMAIL_SEND to=${payload.to} subject="${payload.subject}"`);
                      // V5: try server-native Gmail first (works without the
                      // desktop agent); falls back to the agent when Node
                      // OAuth isn't configured (hybrid deployments).
                      const gResult = await googleSendEmail({
                        to: payload.to,
                        subject: payload.subject,
                        body: payload.body,
                        cc: payload.cc || undefined,
                        inReplyTo: (payload as any).inReplyTo || undefined,
                        threadId: (payload as any).threadId || undefined,
                      });
                      const agentResult: { ok: boolean; result?: unknown; error?: string } = gResult.source === "node"
                        ? { ok: gResult.ok, result: gResult.result, error: gResult.error }
                        : await callDesktopAgent("sendEmail", {
                            to: payload.to,
                            subject: payload.subject,
                            body: payload.body,
                            cc: payload.cc || undefined,
                          });

                      if (agentResult.ok) {
                        const resultText = (agentResult.result as any)?.result || "Email sent.";
                        session.sendToolResponse({
                          functionResponses: [{
                            name: fc.name,
                            response: { output: { result: resultText } },
                            id: fc.id
                          }]
                        });
                      } else {
                        // If sending failed, restore the draft so a retry works.
                        const draft = peekDraft(clientKey) || takeDraft(clientKey);
                        const errMsg = agentResult.error || "Desktop agent error.";
                        console.error(`[Email] send failed: ${errMsg}`);
                        session.sendToolResponse({
                          functionResponses: [{
                            name: fc.name,
                            response: { output: { result: `Sending failed: ${errMsg}. The draft is preserved — fix the issue (e.g. Google OAuth setup) and ask the user to confirm again, then call sendEmail with no arguments.` } },
                            id: fc.id
                          }]
                        });
                      }
                    } catch (err: any) {
                      session.sendToolResponse({
                        functionResponses: [{
                          name: fc.name,
                          response: { output: { result: `Could not send email: ${err?.message || err}` } },
                          id: fc.id
                        }]
                      });
                    }
                  })();
                } else if (fnName === "shutdownYantri") {
                  clientWs.send(JSON.stringify({ type: "shutdown" }));
                  session.sendToolResponse({
                    functionResponses: [{
                      name: fnName,
                      response: { output: { result: "Yantri is shutting down gracefully." } },
                      id: fc.id
                    }]
                  });
                  setTimeout(() => {
                    console.log("[Server] Graceful shutdown requested by voice command.");
                    process.exit(0);
                  }, 2000);
                } else if (
                  [
                    "getCalendarEvents", "createCalendarEvent", "updateCalendarEvent", "deleteCalendarEvent",
                    "searchCalendarEvents", "getEmails", "readFullEmail", "getTasks", "createTask",
                  ].includes(fnName)
                ) {
                  // ── V5: Google suite — server-native via Node OAuth, agent as fallback ──
                  (async () => {
                    const args = (fc.args || {}) as Record<string, unknown>;
                    let gResult: { ok: boolean; source?: "node" | "agent"; result?: unknown; error?: string };
                    try {
                      switch (fnName) {
                        case "getCalendarEvents":
                          gResult = await googleListEvents(args as any);
                          break;
                        case "searchCalendarEvents":
                          gResult = await googleSearchEvents(args as any);
                          break;
                        case "createCalendarEvent":
                          gResult = await googleCreateEvent(args as any);
                          break;
                        case "updateCalendarEvent":
                          gResult = await googleUpdateEvent(args as any);
                          break;
                        case "deleteCalendarEvent":
                          gResult = await googleDeleteEvent(args as any);
                          break;
                        case "getEmails":
                          gResult = await googleListEmails(args as any);
                          break;
                        case "readFullEmail":
                          gResult = await googleReadEmail(args as any);
                          break;
                        case "getTasks":
                        case "createTask":
                          gResult = fnName === "getTasks"
                            ? await googleListTasks(args as any)
                            : await googleCreateTask(args as any);
                          break;
                        default:
                          gResult = { ok: false, error: `Unhandled Google tool ${fnName}` };
                      }
                    } catch (e: any) {
                      gResult = { ok: false, error: e?.message || String(e) };
                    }

                    const output = gResult.ok
                      ? (gResult.result ?? { result: "Done." })
                      : { result: `Google tool error: ${gResult.error}` };
                    session.sendToolResponse({
                      functionResponses: [{
                        name: fnName,
                        response: { output },
                        id: fc.id,
                      }],
                    });
                  })();
                } else if (fnName === "playYouTubeVideo") {
                  // ── V5: agent-free YouTube playback — search on the server, play in the UI ──
                  (async () => {
                    const args = (fc.args || {}) as { query?: string };
                    const query = String(args.query || "").trim();
                    if (!query) {
                      session.sendToolResponse({
                        functionResponses: [{
                          name: fnName,
                          response: { output: { result: "No search query provided." } },
                          id: fc.id,
                        }],
                      });
                      return;
                    }
                    try {
                      const videoId = await findFirstYouTubeVideo(query);
                      if (!videoId) {
                        session.sendToolResponse({
                          functionResponses: [{
                            name: fnName,
                            response: { output: { result: `No videos found for "${query}".` } },
                            id: fc.id,
                          }],
                        });
                        return;
                      }
                      logCommand(`YOUTUBE_PLAY "${query}" video=${videoId}`);
                      for (const ws of connectedClients) {
                        try {
                          ws.send(JSON.stringify({ type: "playYouTube", query, videoId }));
                        } catch { /* client may have disconnected */ }
                      }
                      session.sendToolResponse({
                        functionResponses: [{
                          name: fnName,
                          response: { output: { result: `Now playing the first YouTube result for "${query}" in your Yantri player.` } },
                          id: fc.id,
                        }],
                      });
                    } catch (e: any) {
                      session.sendToolResponse({
                        functionResponses: [{
                          name: fnName,
                          response: { output: { result: `YouTube search failed: ${e?.message || e}` } },
                          id: fc.id,
                        }],
                      });
                    }
                  })();
                } else if (fnName === "getWeather" || fnName === "getNews" || fnName === "searchTavily") {
                  // ── Weather / News / Tavily Search: server-native.
                  // These work on any deployment without the desktop agent.
                  (async () => {
                    try {
                      let output: any;
                      if (fnName === "getWeather") {
                        output = await getWeatherServer(fc.args as { location?: string });
                      } else if (fnName === "getNews") {
                        output = await getNewsServer(fc.args as { category?: string; count?: number });
                      } else if (fnName === "searchTavily") {
                        const args = fc.args as {
                          query: string;
                          search_depth?: "basic" | "advanced";
                          topic?: "general" | "news" | "finance";
                          max_results?: number;
                          include_images?: boolean;
                        };
                        const result = await searchTavily({
                          query: args.query,
                          search_depth: args.search_depth,
                          topic: args.topic,
                          max_results: args.max_results,
                          include_images: args.include_images,
                          include_answer: true,
                        });
                        output = { result: formatTavilyResult(result) };
                      }
                      logCommand(`${fnName} ok`);
                      session.sendToolResponse({
                        functionResponses: [{
                          name: fnName,
                          response: { output },
                          id: fc.id,
                        }],
                      });
                    } catch (e: any) {
                      logError(`${fnName}_FAILED: ${e?.message || e}`);
                      session.sendToolResponse({
                        functionResponses: [{
                          name: fnName,
                          response: { output: { result: `${fnName === "getWeather" ? "Weather" : fnName === "getNews" ? "News" : "Tavily search"} failed: ${e?.message || e}` } },
                          id: fc.id,
                        }],
                      });
                    }
                  })();
                } else if (DESKTOP_TOOLS.has(fnName)) {
                  // ── Desktop control tools: route to Python agent ──
                  // In Cloud Mode there is no local agent by design — reject
                  // immediately instead of round-tripping to a dead port.
                  if (IS_CLOUD_MODE) {
                    session.sendToolResponse({
                      functionResponses: [{
                        name: fnName,
                        response: { output: { result: "Desktop control is disabled in Cloud Mode." } },
                        id: fc.id,
                      }],
                    });
                    return;
                  }
                  (async () => {
                    console.log(`[Desktop Agent] Routing ${fnName} to Python backend...`);
                    const agentResult = await callDesktopAgent(fnName, fc.args as Record<string, unknown>);

                    // Broadcast tool execution to all connected clients for terminal display
                    const outputText = agentResult.ok
                      ? JSON.stringify(agentResult.result ?? { result: "Done." })
                      : (agentResult.error || "Desktop agent error.");
                    for (const ws of connectedClients) {
                      try {
                        ws.send(JSON.stringify({
                          type: "terminal_output",
                          tool: fnName,
                          args: fc.args,
                          output: outputText,
                        }));
                      } catch (e) { /* client may have disconnected */ }
                    }

                    if (agentResult.ok) {
                      const output = agentResult.result ?? { result: "Done." };
                      session.sendToolResponse({
                        functionResponses: [{
                          name: fnName,
                          response: { output },
                          id: fc.id
                        }]
                      });
                    } else {
                      const errMsg = agentResult.error || "Desktop agent error.";
                      console.error(`[Desktop Agent] Error for ${fnName}:`, errMsg);
                      session.sendToolResponse({
                        functionResponses: [{
                          name: fnName,
                          response: { output: { result: `Desktop control error: ${errMsg}` } },
                          id: fc.id
                        }]
                      });
                    }
                  })();
                } else {
                  clientWs.send(JSON.stringify({
                    type: "toolCall",
                    callId: fc.id,
                    name: fc.name,
                    args: fc.args
                  }));
                }
              }
            }
          },
          onclose: (e: any) => {
            console.log(`Gemini Live session closed (code=${e?.code}, reason=${e?.reason || "none"}, wasClean=${e?.wasClean})`);
            clientWs.send(JSON.stringify({ type: "status", status: "session_closed" }));
          },
          onerror: (error: any) => {
            console.error("[Gemini Live Error]:", error);
            clientWs.send(JSON.stringify({ 
              type: "error", 
              error: `Gemini API Error: ${error?.message || String(error)}` 
            }));
          }
        }
      });
      
      clientWs.send(JSON.stringify({ type: "status", status: "connected" }));
      console.log("[Gemini Connect] Session established successfully");

      // V4: refresh the Data Vault from Google Calendar in the background so
      // exams added directly on Calendar appear on connect. Fire-and-forget.
      void importExamsFromCalendar().catch(() => {});
      
      clientWs.on("message", (rawMsg) => {
        try {
          const msg = JSON.parse(rawMsg.toString());
          if (msg.audio) {
            session.sendRealtimeInput({
              audio: { data: msg.audio, mimeType: "audio/pcm;rate=16000" }
            });
          } else if (msg.type === "video" && msg.video) {
            session.sendRealtimeInput({
              video: { data: msg.video, mimeType: "image/jpeg" }
            });
          } else if (msg.type === "toolResponse") {
            session.sendToolResponse({
              functionResponses: [
                {
                  name: msg.name,
                  response: { output: msg.output },
                  id: msg.id
                }
              ]
            });
          }
        } catch (e) {
          console.error("Error editing/forwarding client frame message:", e);
        }
      });
      
      clientWs.on("close", () => {
        console.log("Client disconnected, closing Gemini session");
        connectedClients.delete(clientWs);
        try {
          session.close();
        } catch (e) {}
      });
      
    } catch (err: any) {
      console.error("Error connecting to Gemini Live API:", err);
      clientWs.send(JSON.stringify({ 
        type: "error", 
        error: `Could not connect to Gemini: ${err.message || err}` 
      }));
      clientWs.close();
    }
  });

  // Serve custom static assets folder
  app.use("/assets", express.static(path.join(process.cwd(), "assets")));

  // Express Static assets / Vite Dev Middleware configuration
  if (process.env.NODE_ENV !== "production") {
    // Loaded lazily so the production bundle never requires vite (a dev-only
    // dependency that is not shipped with the packaged app).
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  server.listen(PORT, "0.0.0.0", async () => {
    logStartup(`YANTRI V2 server started on http://localhost:${PORT}`);
    console.log(`[Server] Running on http://localhost:${PORT}`);

    // V5.1: restore state files from object storage (if configured), then
    // keep them mirrored so memories/tokens survive Render redeploys.
    startCloudStorageSync();
    // Desktop agent: probe-only at boot (never spawns). The agent is fully
    // optional — desktop deployments get it back on the first desktop tool
    // call (or when it is started manually); web/APK deployments just show
    // desktop tools as unavailable in the Settings panel.
    void isDesktopAgentAvailable().then((online) => {
      logStartup(online
        ? "Desktop agent detected at boot."
        : (IS_CLOUD_MODE
          ? "Cloud Mode: desktop agent not used (server-only tools active)."
          : "Desktop agent not detected at boot — server-only mode active. Desktop tools will auto-start the agent on first use."));
    });
    // Start the reminder timer — loads persisted reminders and checks every 30s.
    await loadReminders();
    startReminderTimer();
    // When a reminder fires, broadcast it to all connected WebSocket clients.
    setOnReminderFired((reminder) => {
      for (const ws of connectedClients) {
        try {
          ws.send(JSON.stringify({
            type: "reminder",
            text: reminder.text,
            id: reminder.id,
            fireAt: reminder.fireAt,
          }));
        } catch (e) { /* client may have disconnected */ }
      }
    });
    // V4: auto-reminders for saved deadlines/dues. Re-syncs every 5 min and
    // immediately after any record mutation (save/update/delete).
    setOnRecordMutated(() => {
      void syncDeadlineReminders().catch((e) =>
        console.warn("[DeadlineSync] mutation sync failed:", e?.message || e)
      );
    });
    startDeadlineSync();

    // V4: mirror exam records to Google Calendar. Listens to record mutations
    // (create/patch/delete the event) and sweeps for unsynced records every
    // 10 min — e.g. retrying after OAuth setup is completed.
    setOnRecordMutated((action, record) => {
      if (!record) return;
      void syncRecordToCalendar(action, record).catch((e) =>
        console.warn("[CalendarSync] mutation sync failed:", e?.message || e)
      );
    });
    startCalendarSync();
    startCalendarImport();
  });
}

startServer().catch((error) => {
  console.error("Failed to start server startup sequence:", error);
});

// ---------------------------------------------------------------------------
// V5.1: graceful shutdown — flush the cloud mirror one last time so a Render
// redeploy never loses writes that landed in the final seconds.
// ---------------------------------------------------------------------------
async function gracefulShutdown(signal: string): Promise<void> {
  console.log(`[Server] ${signal} received — flushing cloud storage before exit...`);
  try {
    await stopCloudStorageSync();
  } catch { /* best-effort */ }
  process.exit(0);
}
process.on("SIGTERM", () => void gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => void gracefulShutdown("SIGINT"));
