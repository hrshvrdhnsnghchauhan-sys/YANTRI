/**
 * YANTRI REST API Routes.
 *
 * Single source of truth for the REST surface, consolidated from the old root
 * server.ts plus the earlier modular endpoints. Mounted at /api by the server
 * entry point.
 */

import { Router, type Request, type Response } from "express";
import path from "path";
import * as fs from "fs";
import { GoogleGenAI } from "@google/genai";
import {
  loadMemories,
  saveMemories,
} from "@services/server_memory";
import type { Memory } from "../../lib/memoryTypes";
import {
  addReminder,
  getReminders,
  cancelReminder,
} from "@services/server_reminders";
import {
  loadProfile,
  saveProfile,
} from "@services/server_profile";
import {
  saveRecord,
  queryRecords,
  updateRecord,
  deleteRecord,
  countByType,
} from "@services/server_userdata";
import {
  hasGoogleCredentials,
  isGoogleNodeReady,
  googleAuthUrl,
  saveGoogleAuthCode,
  clearGoogleTokens,
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
} from "@services/server_google";
import { findFirstYouTubeVideo } from "@services/server_youtube";
import { getWeatherServer, getNewsServer } from "@services/server_weather_news";
import { searchTavily, formatTavilyResult } from "@services/server_tavily";
import {
  callDesktopAgent,
  isDesktopAgentAvailable,
  getDesktopAgentUnavailability,
  DESKTOP_AGENT_URL,
  IS_CLOUD_MODE,
} from "@services/server_bridge";
import { dataFile, hasGeminiApiKey, setGeminiApiKey } from "@services/server_paths";
import { queueUpload, isCloudStorageConfigured } from "@services/server_storage";
import { logCommand, logError, LOGS_DIR } from "../utils/auditLog";
import { handleError } from "../utils/httpError";
import { validateBody, validateQuery } from "../middleware/validate";
import {
  newsQuerySchema,
  weatherQuerySchema,
  reminderCreateSchema,
  profileCreateSchema,
  recordCreateSchema,
  recordPatchSchema,
  recordQueryParamsSchema,
  tavilySearchSchema,
  apiKeySchema,
  settingsSchema,
} from "../utils/validation";
import { metricsHandler } from "../utils/metrics";
import { swaggerSpec } from "../utils/swagger";
import swaggerUi from "swagger-ui-express";

const VALID_MEMORY_CATEGORIES = [
  "identity",
  "preference",
  "goal",
  "project",
  "relationship",
  "emotional",
  "behavior",
];

export function createApiRouter(): Router {
  const router = Router();

  // ── Health ────────────────────────────────────────────────────────────────
  router.get("/health", (_req: Request, res: Response) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  });

  // ── Memory REST API ────────────────────────────────────────────────────────
  router.get("/memories", async (_req: Request, res: Response) => {
    try {
      res.json(await loadMemories());
    } catch (e: any) {
      handleError(res, e);
    }
  });

  router.post("/memories", async (req: Request, res: Response) => {
    try {
      const { category, text } = req.body || {};
      if (!category || !text || !VALID_MEMORY_CATEGORIES.includes(category)) {
        return res.status(400).json({
          error: `category must be one of: ${VALID_MEMORY_CATEGORIES.join(", ")} and text is required.`,
        });
      }
      const memories = await loadMemories();
      const timestamp = new Date().toISOString();
      const newMemory: Memory = {
        id: Math.random().toString(36).substring(2, 11),
        category,
        text,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      memories.push(newMemory);
      await saveMemories(memories);
      res.status(201).json(newMemory);
    } catch (e: any) {
      handleError(res, e);
    }
  });

  router.delete("/memories/:id", async (req: Request, res: Response) => {
    try {
      let memories = await loadMemories();
      memories = memories.filter((m) => m.id !== req.params.id);
      await saveMemories(memories);
      res.json({ success: true });
    } catch (e: any) {
      handleError(res, e);
    }
  });

  // ── Google OAuth (server-native Calendar/Gmail/Tasks) ──────────────────────
  router.get("/google/status", (req: Request, res: Response) => {
    res.json({
      configured: hasGoogleCredentials(),
      connected: isGoogleNodeReady(),
      authUrl: hasGoogleCredentials() ? googleAuthUrl(req.headers.origin) : null,
    });
  });

  router.get("/google/auth", (req: Request, res: Response) => {
    if (!hasGoogleCredentials()) {
      return res.status(400).send(
        "Google OAuth is not configured on this server. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET, then restart."
      );
    }
    res.redirect(googleAuthUrl(req.headers.origin));
  });

  router.get("/google/callback", async (req: Request, res: Response) => {
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
      handleError(res, e, "GOOGLE_OAUTH_CALLBACK_FAILED");
    }
  });

  router.post("/google/disconnect", (_req: Request, res: Response) => {
    clearGoogleTokens();
    logCommand("GOOGLE_OAUTH_DISCONNECTED");
    res.json({ ok: true });
  });

  router.post("/google/revoke", async (_req: Request, res: Response) => {
    await clearGoogleTokens();
    res.json({ success: true });
  });

  // ── Google Calendar ────────────────────────────────────────────────────────
  router.get("/google/calendar/events", async (req: Request, res: Response) => {
    res.json(await googleListEvents(req.query as any));
  });

  router.get("/google/calendar/search", async (req: Request, res: Response) => {
    res.json(await googleSearchEvents(req.query as any));
  });

  router.post("/google/calendar/events", async (req: Request, res: Response) => {
    res.json(await googleCreateEvent(req.body));
  });

  router.patch("/google/calendar/events/:id", async (req: Request, res: Response) => {
    res.json(await googleUpdateEvent({ event_id: req.params.id, ...req.body }));
  });

  router.delete("/google/calendar/events/:id", async (req: Request, res: Response) => {
    res.json(await googleDeleteEvent({ event_id: req.params.id }));
  });

  // ── Gmail ──────────────────────────────────────────────────────────────────
  router.get("/google/emails", async (req: Request, res: Response) => {
    res.json(await googleListEmails(req.query as any));
  });

  router.get("/google/emails/:id", async (req: Request, res: Response) => {
    res.json(await googleReadEmail({ id: req.params.id, ...req.query }));
  });

  router.post("/google/emails/send", async (req: Request, res: Response) => {
    res.json(await googleSendEmail(req.body));
  });

  // ── Google Tasks ───────────────────────────────────────────────────────────
  router.get("/google/tasks", async (req: Request, res: Response) => {
    res.json(await googleListTasks(req.query as any));
  });

  router.post("/google/tasks", async (req: Request, res: Response) => {
    res.json(await googleCreateTask(req.body));
  });

  // ── Reminders ──────────────────────────────────────────────────────────────
  router.get("/reminders", async (_req: Request, res: Response) => {
    try {
      res.json(getReminders());
    } catch (e: any) {
      handleError(res, e);
    }
  });

  router.post("/reminders", validateBody(reminderCreateSchema), async (req: Request, res: Response) => {
    try {
      const { text, minutes } = req.body || {};
      if (!text || typeof minutes !== "number" || minutes <= 0) {
        return res.status(400).json({ error: "text and positive minutes are required." });
      }
      const reminder = addReminder(String(text), minutes);
      logCommand(`REMINDER_SET ${text} in ${minutes}m`);
      res.status(201).json(reminder);
    } catch (e: any) {
      handleError(res, e);
    }
  });

  router.delete("/reminders/:id", async (req: Request, res: Response) => {
    try {
      const ok = cancelReminder(req.params.id);
      if (!ok) return res.status(404).json({ error: "Reminder not found." });
      logCommand(`REMINDER_CANCEL id=${req.params.id}`);
      res.json({ success: true });
    } catch (e: any) {
      handleError(res, e);
    }
  });

  // ── User Profile ───────────────────────────────────────────────────────────
  router.get("/profile", async (_req: Request, res: Response) => {
    try {
      res.json((await loadProfile()) || {});
    } catch (e: any) {
      handleError(res, e);
    }
  });

  router.post("/profile", validateBody(profileCreateSchema), async (req: Request, res: Response) => {
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
      res.status(201).json(profile);
    } catch (e: any) {
      handleError(res, e, "PROFILE_SAVE_ERROR");
    }
  });

  // ── User data records ──────────────────────────────────────────────────────
  router.get("/userdata", validateQuery(recordQueryParamsSchema), async (req: Request, res: Response) => {
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
      handleError(res, e);
    }
  });

  router.post("/userdata", validateBody(recordCreateSchema), async (req: Request, res: Response) => {
    try {
      const { type, title, payload, due, tags, id } = req.body || {};
      if (!type || !title) {
        return res.status(400).json({ error: "type and title are required." });
      }
      const rec = await saveRecord({ type, title, payload, due, tags, id });
      res.status(201).json(rec);
    } catch (e: any) {
      handleError(res, e);
    }
  });

  router.patch("/userdata/:id", validateBody(recordPatchSchema), async (req: Request, res: Response) => {
    try {
      const rec = await updateRecord(req.params.id, req.body || {});
      if (!rec) return res.status(404).json({ error: "Record not found." });
      res.json(rec);
    } catch (e: any) {
      handleError(res, e);
    }
  });

  router.delete("/userdata/:id", async (req: Request, res: Response) => {
    try {
      const ok = await deleteRecord(req.params.id);
      if (!ok) return res.status(404).json({ error: "Record not found." });
      res.json({ success: true });
    } catch (e: any) {
      handleError(res, e);
    }
  });

  router.get("/userdata/stats", async (_req: Request, res: Response) => {
    try {
      res.json(await countByType());
    } catch (e: any) {
      handleError(res, e);
    }
  });

  // ── Settings (mirrored to settings.json) ────────────────────────────────────
  const SETTINGS_FILE = dataFile("settings.json");

  function loadSettingsFile(): Record<string, unknown> {
    try {
      if (fs.existsSync(SETTINGS_FILE)) {
        return JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf-8"));
      }
    } catch {
      /* corrupt file — return defaults */
    }
    return {};
  }

  function saveSettingsFile(data: Record<string, unknown>): void {
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(data, null, 2), "utf-8");
    queueUpload("settings.json");
  }

  router.get("/settings", async (_req: Request, res: Response) => {
    try {
      res.json(loadSettingsFile());
    } catch (e: any) {
      handleError(res, e);
    }
  });

  router.post("/settings", validateBody(settingsSchema), async (req: Request, res: Response) => {
    try {
      const patch = req.body;
      if (!patch || typeof patch !== "object") {
        return res.status(400).json({ error: "Request body must be a JSON object." });
      }
      const next = { ...loadSettingsFile(), ...patch };
      saveSettingsFile(next);

      if ("autoStart" in patch) {
        callDesktopAgent((patch as any).autoStart ? "enableAutoStart" : "disableAutoStart", {}).catch(() => {});
      }

      logCommand(`SETTINGS_UPDATED ${JSON.stringify(patch)}`);
      res.json(next);
    } catch (e: any) {
      logError(`SETTINGS_SAVE_ERROR: ${e.message}`);
      handleError(res, e);
    }
  });

  // ── Config / API-key onboarding ────────────────────────────────────────────
  router.get("/config", async (_req: Request, res: Response) => {
    res.json({
      hasApiKey: hasGeminiApiKey(),
      cloudMode: IS_CLOUD_MODE,
      agentAvailable: IS_CLOUD_MODE ? false : await isDesktopAgentAvailable(),
      agentUnavailableReason: IS_CLOUD_MODE
        ? "Cloud Mode: desktop control is disabled."
        : getDesktopAgentUnavailability(),
    });
  });

  router.post("/config/apikey", validateBody(apiKeySchema), async (req: Request, res: Response) => {
    try {
      const key: string = (req.body?.apiKey ?? "").toString().trim();
      if (!key) {
        return res.status(400).json({ error: "API key is required." });
      }
      try {
        const test = new GoogleGenAI({ apiKey: key });
        const pager = await test.models.list();
        await pager[Symbol.asyncIterator]().next();
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
      handleError(res, e, "APIKEY_SAVE_ERROR");
    }
  });

  // Legacy alias kept for older clients.
  router.post("/api-key", async (req: Request, res: Response) => {
    const { key } = req.body || {};
    if (!key) return res.status(400).json({ error: "Key required" });
    try {
      setGeminiApiKey(key);
      res.json({ success: true });
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  // ── Agent health proxy ─────────────────────────────────────────────────────
  router.get("/agent-health", async (_req: Request, res: Response) => {
    if (IS_CLOUD_MODE) {
      res.json({
        online: false,
        cloudMode: true,
        reason: "Cloud Mode: desktop control is disabled on this deployment.",
      });
      return;
    }
    try {
      const online = await isDesktopAgentAvailable();
      if (!online) {
        const d = getDesktopAgentUnavailability();
        res.json({ online: false, cloudMode: false, reason: d || "" });
        return;
      }
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 3000);
      const r = await fetch(`${DESKTOP_AGENT_URL}/health`, { signal: ctrl.signal });
      clearTimeout(timer);
      if (r.ok) {
        const d = await r.json();
        res.json({ online: true, cloudMode: false, tool_count: d.tool_count });
      } else {
        res.json({ online: false, cloudMode: false, reason: "Agent health check failed." });
      }
    } catch {
      res.json({ online: false, cloudMode: false, reason: "Agent unreachable." });
    }
  });

  // ── Logs ───────────────────────────────────────────────────────────────────
  router.get("/logs/:file", async (req: Request, res: Response) => {
    try {
      const fileName = String(req.params.file);
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
      handleError(res, e);
    }
  });

  // ── Web scraper proxy (structured summary) ─────────────────────────────────
  router.get("/proxy", async (req: Request, res: Response) => {
    try {
      const url = req.query.url as string;
      if (!url) {
        return res.status(400).json({ error: "Missing 'url' parameter." });
      }

      const response = await fetch(url, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36",
        },
      });

      if (!response.ok) {
        throw new Error(`Scraper failed to load page: status ${response.status}`);
      }

      const html = await response.text();

      const titleMatch = html.match(/<title>(.*?)<\/title>/i);
      const title = titleMatch ? titleMatch[1].trim() : "";

      const headings: string[] = [];
      for (const match of html.matchAll(/<h([1-3])\b[^>]*>(.*?)<\/h\1>/gi)) {
        const text = match[2].replace(/<[^>]*>/g, "").trim();
        if (text && text.length > 3 && text.length < 120 && !headings.includes(text)) {
          headings.push(text);
        }
      }

      const links: { text: string; href: string }[] = [];
      for (const match of html.matchAll(/<a\b[^>]*\bhref=["']([^"']+)["'][^>]*>(.*?)<\/a>/gi)) {
        let href = match[1].trim();
        const text = match[2].replace(/<[^>]*>/g, "").trim();
        if (text && text.length > 2 && text.length < 100) {
          if (href.startsWith("/")) {
            try {
              const u = new URL(url);
              href = `${u.protocol}//${u.host}${href}`;
            } catch {
              /* ignore */
            }
          }
          if (href.startsWith("http://") || href.startsWith("https://")) {
            links.push({ text, href });
          }
        }
      }

      const paragraphs: string[] = [];
      for (const match of html.matchAll(/<p\b[^>]*>(.*?)<\/p>/gi)) {
        const text = match[1].replace(/<[^>]*>/g, "").trim();
        if (text && text.length > 25 && text.length < 600 && !paragraphs.includes(text)) {
          paragraphs.push(text);
        }
      }

      const buttons: string[] = [];
      for (const match of html.matchAll(/<button\b[^>]*>(.*?)<\/button>/gi)) {
        const text = match[1].replace(/<[^>]*>/g, "").trim();
        if (text && text.length > 1 && text.length < 60 && !buttons.includes(text)) {
          buttons.push(text);
        }
      }

      res.json({
        url,
        title,
        headings: headings.slice(0, 15),
        links: links.filter((l) => !l.href.includes("javascript:")).slice(0, 30),
        buttons: buttons.slice(0, 15),
        paragraphs: paragraphs.slice(0, 12),
      });
    } catch (err: any) {
      handleError(res, err, "proxy");
    }
  });

  // ── High-fidelity HTML proxy (iframe-friendly) ──────────────────────────────
  router.get("/web-proxy", async (req: Request, res: Response) => {
    let targetUrl = "";
    try {
      const urlParam = req.query.url as string;
      if (!urlParam) {
        return res.status(400).send("Yantri Web Proxy Error: Missing target 'url' parameter");
      }

      targetUrl = urlParam.trim();

      if (targetUrl.startsWith("/")) {
        return res
          .status(400)
          .send(`Yantri Web Proxy Error: Relative paths are not supported directly (${targetUrl}).`);
      }

      try {
        if (!targetUrl.startsWith("http://") && !targetUrl.startsWith("https://")) {
          targetUrl = "https://" + targetUrl;
        }
        const parsed = new URL(targetUrl);
        if (!parsed.hostname || !parsed.hostname.includes(".")) {
          throw new Error("Missing or invalid domain name extension (e.g. .com, .org, .net).");
        }
      } catch {
        return res
          .status(400)
          .send(
            `Yantri Web Proxy Error: Invalid URL specified: "${urlParam}". Make sure you enter a valid domain name.`
          );
      }

      let response;
      try {
        response = await fetch(targetUrl, {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36",
            Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
          },
        });
      } catch (fetchErr: any) {
        return res
          .status(502)
          .send(
            `Yantri Web Proxy Error: Unable to fetch the website "${targetUrl}". The site might be offline, or the URL address is spelled incorrectly. Details: ${fetchErr.message}`
          );
      }

      if (!response.ok) {
        return res
          .status(response.status)
          .send(
            `Yantri Web Proxy Error: Failed loading remote website. Server returned status: ${response.status} (${response.statusText})`
          );
      }

      const contentType = response.headers.get("content-type") || "";

      if (!contentType.includes("text/html")) {
        const arrayBuffer = await response.arrayBuffer();
        res.setHeader("Content-Type", contentType);
        return res.send(Buffer.from(arrayBuffer));
      }

      let htmlContents = await response.text();

      const baseUrlTag = `<base href="${targetUrl}" />`;
      const interceptorScript = `
        <script>
          (function() {
            document.addEventListener('click', function(e) {
              var anchor = e.target.closest('a');
              if (anchor) {
                var href = anchor.getAttribute('href');
                if (href && !href.startsWith('#') && !href.startsWith('javascript:')) {
                  e.preventDefault();
                  try {
                    var resolvedUrl = new URL(href, window.location.href).href;
                    window.parent.postMessage({ type: 'NAVIGATE', url: resolvedUrl }, '*');
                  } catch (err) {}
                }
              }
            }, true);
            document.addEventListener('submit', function(e) {
              var form = e.target;
              if (form) {
                e.preventDefault();
                try {
                  var formData = new FormData(form);
                  var params = new URLSearchParams();
                  formData.forEach(function(value, key) {
                    if (typeof value === 'string') { params.append(key, value); }
                  });
                  var actionAttr = form.getAttribute('action') || '';
                  var actionUrl = new URL(actionAttr, window.location.href).href;
                  if (form.method.toLowerCase() === 'get') {
                    actionUrl += (actionUrl.indexOf('?') !== -1 ? '&' : '?') + params.toString();
                  }
                  window.parent.postMessage({ type: 'NAVIGATE', url: actionUrl }, '*');
                } catch (err) {}
              }
            }, true);
            window.alert = function(msg) { console.log("[Yantri Browser alert bypassed]:", msg); };
            window.confirm = function(msg) { return true; };
            window.open = function(url) { window.parent.postMessage({ type: 'NAVIGATE', url: url }, '*'); return null; };
          })();
        </script>
      `;

      if (htmlContents.includes("<head>")) {
        htmlContents = htmlContents.replace("<head>", `<head>\n${baseUrlTag}\n${interceptorScript}`);
      } else if (htmlContents.includes("<HEAD>")) {
        htmlContents = htmlContents.replace("<HEAD>", `<HEAD>\n${baseUrlTag}\n${interceptorScript}`);
      } else {
        htmlContents = baseUrlTag + "\n" + interceptorScript + "\n" + htmlContents;
      }

      res.setHeader("Content-Type", "text/html");
      res.setHeader("X-Yantri-Proxied", "true");
      res.removeHeader("X-Frame-Options");
      res.removeHeader("Content-Security-Policy");
      res.status(200).send(htmlContents);
    } catch (e: any) {
      handleError(res, e, "web-proxy");
    }
  });

  // ── YouTube search proxy ────────────────────────────────────────────────────
  router.get("/youtube-search", async (req: Request, res: Response) => {
    try {
      const query = req.query.q as string;
      if (!query) {
        return res.status(400).json({ error: "Missing query q" });
      }

      const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(
        query
      )}&hl=en&sp=EgIQAQ%253D%253D`;
      const response = await fetch(searchUrl, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36",
        },
      });
      const html = await response.text();

      const videoList: any[] = [];
      const jsonMatch = html.match(/ytInitialData\s*=\s*({.+?});/);

      if (jsonMatch) {
        try {
          const data = JSON.parse(jsonMatch[1]);
          const contents =
            data.contents?.twoColumnSearchResultRenderer?.primaryContents?.sectionListRenderer?.contents?.[0]
              ?.itemSectionRenderer?.contents;
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
                    author:
                      vr.ownerText?.runs?.[0]?.text ||
                      vr.shortBylineText?.runs?.[0]?.text ||
                      "Unknown Channel",
                    duration: vr.lengthText?.simpleText || "N/A",
                    views: vr.viewCountText?.simpleText || "N/A",
                    published: vr.publishedTimeText?.simpleText || "",
                  });
                }
              }
            }
          }
        } catch {
          /* fall through to regex */
        }
      }

      if (videoList.length === 0) {
        const videoRegex = /"videoId":"([^"]+)"/g;
        let match;
        const ids: string[] = [];
        while ((match = videoRegex.exec(html)) !== null && ids.length < 15) {
          if (match[1] && !ids.includes(match[1])) ids.push(match[1]);
        }
        for (const id of ids) {
          videoList.push({
            videoId: id,
            title: `Live Stream: ${id}`,
            thumbnail: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
            author: "YouTube Creator",
            duration: "N/A",
            views: "Available Now",
          });
        }
      }

      res.setHeader("Cache-Control", "public, max-age=60");
      res.status(200).json({ results: videoList.slice(0, 15) });
    } catch (err: any) {
      logError(`YOUTUBE_SEARCH_ERROR: ${err?.message || err}`);
      res.status(500).json({ error: "YouTube search failed.", results: [] });
    }
  });

  // Simple single-video lookup (server-native, no agent).
  router.get("/youtube/search", async (req: Request, res: Response) => {
    const query = String(req.query.q || "");
    if (!query) return res.status(400).json({ error: "Query parameter 'q' required" });
    const videoId = await findFirstYouTubeVideo(query);
    res.json({ videoId });
  });

  // ── Weather & News ─────────────────────────────────────────────────────────
  router.get("/weather", validateQuery(weatherQuerySchema), async (req: Request, res: Response) => {
    try {
      const result = await getWeatherServer({ location: String(req.query.location || "") });
      res.json(result);
    } catch (e: any) {
      handleError(res, e);
    }
  });

  router.get("/news", validateQuery(newsQuerySchema), async (req: Request, res: Response) => {
    try {
      const result = await getNewsServer({
        category: String(req.query.category || "top"),
        count: Number(req.query.count || 5),
      });
      res.json(result);
    } catch (e: any) {
      handleError(res, e);
    }
  });

  // ── Tavily search ──────────────────────────────────────────────────────────
  router.post("/search/tavily", validateBody(tavilySearchSchema), async (req: Request, res: Response) => {
    try {
      const { query, search_depth, topic, max_results, include_images } = req.body || {};
      if (!query) return res.status(400).json({ error: "Query required" });
      const result = await searchTavily({
        query,
        search_depth,
        topic,
        max_results,
        include_images,
        include_answer: true,
      });
      res.json({ result: formatTavilyResult(result) });
    } catch (e: any) {
      handleError(res, e);
    }
  });

  // ── Cloud sync status ──────────────────────────────────────────────────────
  router.get("/sync/status", async (_req: Request, res: Response) => {
    res.json({ configured: isCloudStorageConfigured() });
  });

  // ── Metrics ────────────────────────────────────────────────────────────────
  router.get("/metrics", metricsHandler);

  // ── Swagger docs ───────────────────────────────────────────────────────────
  router.use(
    "/docs",
    swaggerUi.serve,
    swaggerUi.setup(swaggerSpec, {
      customCss: ".swagger-ui .topbar { display: none }",
      customSiteTitle: "YANTRI API Documentation",
      swaggerOptions: { persistAuthorization: true, displayRequestDuration: true },
    })
  );

  return router;
}

export default createApiRouter;
