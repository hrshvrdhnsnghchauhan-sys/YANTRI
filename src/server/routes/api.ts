/**
 * YANTRI REST API Routes
 * Extracted from server.ts
 */

import { Router, Request, Response } from "express";
import {
  loadMemories,
  saveMemories,
  formatSystemInstructionsWithMemories,
  processConversationSlice,
} from "@services/server_memory";
import { Memory } from "@lib/memoryTypes";
import {
  loadReminders,
  addReminder,
  getReminders,
  cancelReminder,
} from "@services/server_reminders";
import {
  loadProfile,
  saveProfile,
  buildPersonaBlockAsync,
  getAllowedToolNames,
} from "@services/server_profile";
import {
  saveRecord,
  queryRecords,
  updateRecord,
  deleteRecord,
  countByType,
} from "@services/server_userdata";
import { startDeadlineSync, syncDeadlineReminders } from "@services/server_deadline_sync";
import { startCalendarSync, syncRecordToCalendar, importExamsFromCalendar, startCalendarImport } from "@services/server_calendar_sync";
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
} from "@services/server_google";
import { findFirstYouTubeVideo } from "@services/server_youtube";
import { getWeatherServer, getNewsServer } from "@services/server_weather_news";
import { searchTavily, formatTavilyResult } from "@services/server_tavily";
import { callDesktopAgent, isDesktopAgentAvailable, getDesktopAgentUnavailability } from "@services/server_bridge";
import { DATA_DIR, getGeminiApiKey, hasGeminiApiKey, setGeminiApiKey } from "@services/server_paths";
import { metricsHandler } from "@utils/metrics";
import { swaggerSpec } from "@utils/swagger";
import swaggerUi from "swagger-ui-express";

const router = Router();

// Memory REST API Endpoints
router.get("/memories", async (_req: Request, res: Response) => {
  try {
    const memories = await loadMemories();
    res.json(memories);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/memories", async (req: Request, res: Response) => {
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
      updatedAt: timestamp,
    };
    memories.push(newMemory);
    await saveMemories(memories);
    res.status(201).json(newMemory);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.delete("/memories/:id", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    let memories = await loadMemories();
    memories = memories.filter((m) => m.id !== id);
    await saveMemories(memories);
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Config endpoint
router.get("/config", async (_req: Request, res: Response) => {
  const apiKey = getGeminiApiKey();
  const agentAvailable = await isDesktopAgentAvailable();
  const agentUnavailableReason = getDesktopAgentUnavailability();
  res.json({
    hasApiKey: !!apiKey,
    cloudMode: process.env.CLOUD_MODE === "true",
    agentAvailable,
    agentUnavailableReason,
  });
});

// Agent health endpoint
router.get("/agent-health", async (_req: Request, res: Response) => {
  const agentAvailable = await isDesktopAgentAvailable();
  const agentUnavailableReason = getDesktopAgentUnavailability();
  res.json({
    online: agentAvailable,
    reason: agentUnavailableReason,
    cloudMode: process.env.CLOUD_MODE === "true",
  });
});

// Google OAuth endpoints
router.get("/google/status", (_req: Request, res: Response) => {
  res.json({
    configured: hasGoogleCredentials(),
    connected: isGoogleNodeReady(),
    authUrl: hasGoogleCredentials() ? googleAuthUrl() : null,
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
    res.send(
      `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Yantri — Google connected</title></head>` +
      `<body style="font-family:monospace;background:#05070d;color:#67e8f9;display:grid;place-items:center;height:100vh">` +
      `<div style="text-align:center"><h1>✓ Google connected</h1><p>Gmail, Calendar and Tasks are now server-native.</p>` +
      `<p>You can close this tab and return to Yantri.</p></div></body></html>`
    );
  } catch (e: any) {
    console.error("[Google OAuth] Callback failed:", e);
    res.status(500).send(`Google OAuth failed: ${e?.message || e}`);
  }
});

// Google Calendar endpoints
router.get("/google/calendar/events", async (req: Request, res: Response) => {
  const result = await googleListEvents(req.query as any);
  res.json(result);
});

router.get("/google/calendar/search", async (req: Request, res: Response) => {
  const result = await googleSearchEvents(req.query as any);
  res.json(result);
});

router.post("/google/calendar/events", async (req: Request, res: Response) => {
  const result = await googleCreateEvent(req.body);
  res.json(result);
});

router.patch("/google/calendar/events/:id", async (req: Request, res: Response) => {
  const result = await googleUpdateEvent({ event_id: req.params.id, ...req.body });
  res.json(result);
});

router.delete("/google/calendar/events/:id", async (req: Request, res: Response) => {
  const result = await googleDeleteEvent({ event_id: req.params.id });
  res.json(result);
});

// Gmail endpoints
router.get("/google/emails", async (req: Request, res: Response) => {
  const result = await googleListEmails(req.query as any);
  res.json(result);
});

router.get("/google/emails/:id", async (req: Request, res: Response) => {
  const result = await googleReadEmail({ id: req.params.id, ...req.query });
  res.json(result);
});

router.post("/google/emails/send", async (req: Request, res: Response) => {
  const result = await googleSendEmail(req.body);
  res.json(result);
});

// Google Tasks endpoints
router.get("/google/tasks", async (req: Request, res: Response) => {
  const result = await googleListTasks(req.query as any);
  res.json(result);
});

router.post("/google/tasks", async (req: Request, res: Response) => {
  const result = await googleCreateTask(req.body);
  res.json(result);
});

// Google OAuth management
router.post("/google/revoke", async (_req: Request, res: Response) => {
  await clearGoogleTokens();
  res.json({ success: true });
});

// YouTube search
router.get("/youtube/search", async (req: Request, res: Response) => {
  const query = String(req.query.q || "");
  if (!query) return res.status(400).json({ error: "Query parameter 'q' required" });
  const videoId = await findFirstYouTubeVideo(query);
  res.json({ videoId });
});

// Weather & News
router.get("/weather", async (req: Request, res: Response) => {
  try {
    const result = await getWeatherServer({ location: String(req.query.location || "") });
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/news", async (req: Request, res: Response) => {
  try {
    const result = await getNewsServer({
      category: String(req.query.category || "top"),
      count: Number(req.query.count || 5),
    });
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Tavily Search
router.post("/search/tavily", async (req: Request, res: Response) => {
  try {
    const { query, search_depth, topic, max_results, include_images } = req.body;
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
    res.status(500).json({ error: e.message });
  }
});

// Reminders
router.get("/reminders", async (_req: Request, res: Response) => {
  const reminders = getReminders().filter((r) => !r.fired);
  res.json(reminders);
});

router.post("/reminders", async (req: Request, res: Response) => {
  const { text, minutes } = req.body;
  if (!text || !minutes) return res.status(400).json({ error: "text and minutes required" });
  const reminder = addReminder(text, Number(minutes));
  res.status(201).json(reminder);
});

router.delete("/reminders/:id", async (req: Request, res: Response) => {
  const ok = cancelReminder(req.params.id);
  res.json({ success: ok });
});

// Profile
router.get("/profile", async (_req: Request, res: Response) => {
  const profile = await loadProfile();
  res.json(profile || null);
});

router.post("/profile", async (req: Request, res: Response) => {
  try {
    const profile = await saveProfile(req.body);
    res.status(201).json(profile);
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

// User Data / Records
router.get("/userdata", async (req: Request, res: Response) => {
  const records = await queryRecords(req.query as any);
  res.json(records);
});

router.post("/userdata", async (req: Request, res: Response) => {
  try {
    const record = await saveRecord(req.body);
    res.status(201).json(record);
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

router.patch("/userdata/:id", async (req: Request, res: Response) => {
  const record = await updateRecord(req.params.id, req.body);
  if (!record) return res.status(404).json({ error: "Not found" });
  res.json(record);
});

router.delete("/userdata/:id", async (req: Request, res: Response) => {
  const ok = await deleteRecord(req.params.id);
  res.json({ success: ok });
});

router.get("/userdata/stats", async (_req: Request, res: Response) => {
  const counts = await countByType();
  res.json(counts);
});

// Settings (synced to backend)
router.post("/settings", async (req: Request, res: Response) => {
  // Settings are persisted client-side; this is a no-op for server sync
  res.json({ success: true });
});

// API Key management
router.post("/api-key", async (req: Request, res: Response) => {
  const { key } = req.body;
  if (!key) return res.status(400).json({ error: "Key required" });
  try {
    setGeminiApiKey(key);
    res.json({ success: true });
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

router.delete("/api-key", async (_req: Request, res: Response) => {
  // Clear would need to be implemented in server_paths
  res.json({ success: true });
});

// Sync status
router.get("/sync/status", async (_req: Request, res: Response) => {
  // Cloud storage sync status would go here
  res.json({ configured: false });
});

// Prometheus metrics endpoint
router.get("/metrics", metricsHandler);

// Swagger UI documentation
router.use("/docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
  customCss: '.swagger-ui .topbar { display: none }',
  customSiteTitle: "YANTRI API Documentation",
  swaggerOptions: {
    persistAuthorization: true,
    displayRequestDuration: true,
  },
}));

export default router;