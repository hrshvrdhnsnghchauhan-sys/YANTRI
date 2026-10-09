/**
 * YANTRI — Server-native Google Suite (Calendar / Gmail / Tasks).
 *
 * V5: makes the Google tools work WITHOUT the Python desktop agent, so a
 * deployed server (Render, VPS, any device) can read emails, send email and
 * manage calendar purely from Node.
 *
 * OAuth model (BYO credentials):
 *   - GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET environment variables.
 *   - First run: open /api/google/auth → Google consent → redirect to
 *     /api/google/callback → tokens stored in google_tokens.json (data dir).
 *   - Refresh is automatic. A single-user deployment shares one token file.
 *
 * Fallback behavior (hybrid): every public `google*` helper first tries the
 * Node OAuth client; if it is not configured (no client id/secret, no tokens,
 * or the user never completed consent) the call is transparently forwarded to
 * the Python desktop agent via callDesktopAgent, preserving the old behaviour
 * on machines where the agent is running with its own OAuth setup.
 */

import { google } from "googleapis";
import * as fs from "fs";
import { dataFile } from "./server_paths";
import { callDesktopAgent } from "./server_bridge";
import { queueUpload } from "./server_storage";
import { mirrorJson } from "../db";
import { writeTextAtomicSync } from "../utils/persist";
import { encryptJson, decryptJson } from "../utils/crypto";

// ---------------------------------------------------------------------------
// Token persistence (google_tokens.json in the writable data dir)
// ---------------------------------------------------------------------------

interface StoredTokens {
  access_token?: string;
  refresh_token?: string;
  scope?: string;
  token_type?: string;
  id_token?: string;
  expiry_date?: number | null;
}

const TOKENS_FILE = dataFile("google_tokens.json");

function readStoredTokens(): StoredTokens | null {
  try {
    if (fs.existsSync(TOKENS_FILE)) {
      // Tokens are encrypted at rest (issue 16); decryptJson also transparently
      // reads legacy plaintext files from before encryption was enabled.
      return decryptJson<StoredTokens>(fs.readFileSync(TOKENS_FILE, "utf-8"));
    }
  } catch {
    /* corrupt file — re-auth */
  }
  return null;
}

function writeStoredTokens(tokens: StoredTokens): void {
  try {
    writeTextAtomicSync(TOKENS_FILE, encryptJson(tokens));
    mirrorJson("google_tokens.json", tokens);
    queueUpload("google_tokens.json"); // V5.1: mirror to cloud object storage if configured
    try {
      fs.chmodSync(TOKENS_FILE, 0o600);
    } catch {
      /* best-effort */
    }
  } catch (e) {
    console.warn("[Google] could not persist tokens:", e);
  }
}

// ---------------------------------------------------------------------------
// OAuth client
// ---------------------------------------------------------------------------

export function getGoogleClientConfig(): { clientId?: string; clientSecret?: string } {
  return {
    clientId: process.env.GOOGLE_CLIENT_ID?.trim() || undefined,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET?.trim() || undefined,
  };
}

/** True when the deployment has OAuth client credentials configured. */
export function hasGoogleCredentials(): boolean {
  const cfg = getGoogleClientConfig();
  return Boolean(cfg.clientId && cfg.clientSecret);
}

export function hasGoogleTokens(): boolean {
  return Boolean(readStoredTokens()?.refresh_token);
}

/** Whether Google tools can run server-natively right now. */
export function isGoogleNodeReady(): boolean {
  return hasGoogleCredentials() && hasGoogleTokens();
}

/** The redirect URI used for OAuth (Render auto-detect, env override, local). */
export function googleRedirectUri(originOverride?: string): string {
  if (process.env.GOOGLE_REDIRECT_URI) return process.env.GOOGLE_REDIRECT_URI;
  const base = originOverride || process.env.RENDER_EXTERNAL_URL || `http://localhost:${process.env.PORT || 3000}`;
  return `${base.replace(/\/$/, "")}/api/google/callback`;
}

/** Build an authenticated OAuth2 client, or null when not ready. */
function getOAuthClient(): any | null {
  const cfg = getGoogleClientConfig();
  if (!cfg.clientId || !cfg.clientSecret) return null;

  const stored = readStoredTokens();
  if (!stored || !stored.refresh_token) return null; // consent not completed yet

  const oauth2 = new google.auth.OAuth2(cfg.clientId, cfg.clientSecret, googleRedirectUri());
  oauth2.setCredentials({
    refresh_token: stored.refresh_token,
    access_token: stored.access_token,
    expiry_date: stored.expiry_date,
  });
  // Persist refreshed access tokens so restarts don't rely on memory.
  oauth2.on("tokens", (t: any) => {
    const current = readStoredTokens() || {};
    writeStoredTokens({
      ...current,
      access_token: t.access_token || current.access_token,
      expiry_date: t.expiry_date ?? current.expiry_date,
      refresh_token: t.refresh_token || current.refresh_token,
    });
  });
  return oauth2;
}

/** Generate the Google consent URL (offline access, the five scopes we need). */
export function googleAuthUrl(originOverride?: string): string {
  const cfg = getGoogleClientConfig();
  if (!cfg.clientId || !cfg.clientSecret) {
    throw new Error("Google OAuth is not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.");
  }
  const oauth2 = new google.auth.OAuth2(cfg.clientId, cfg.clientSecret, googleRedirectUri(originOverride));
  return oauth2.generateAuthUrl({
    access_type: "offline",
    prompt: "consent", // force refresh_token issuance
    scope: [
      "https://www.googleapis.com/auth/calendar.events",
      "https://www.googleapis.com/auth/calendar.readonly",
      "https://www.googleapis.com/auth/gmail.send",
      "https://www.googleapis.com/auth/gmail.readonly",
      "https://www.googleapis.com/auth/tasks",
    ],
  });
}

/** Exchange an OAuth callback code for tokens and persist them. */
export async function saveGoogleAuthCode(code: string): Promise<void> {
  const cfg = getGoogleClientConfig();
  if (!cfg.clientId || !cfg.clientSecret) {
    throw new Error("Google OAuth is not configured.");
  }
  const oauth2 = new google.auth.OAuth2(cfg.clientId, cfg.clientSecret, googleRedirectUri());
  const { tokens } = await oauth2.getToken(code);
  if (!tokens.refresh_token) {
    console.warn(
      "[Google] consent returned no refresh_token — revoke access at " +
        "https://myaccount.google.com/permissions and reconnect (consent screen forces refresh tokens)."
    );
  }
  writeStoredTokens(tokens as StoredTokens);
}

/** Remove stored tokens (disconnect flow). */
export function clearGoogleTokens(): void {
  try {
    fs.rmSync(TOKENS_FILE, { force: true });
  } catch {
    /* best-effort */
  }
}

// ---------------------------------------------------------------------------
// Internal result type — deliberately flat (no discriminated-union narrowing)
// so it also typechecks cleanly under non-strict tsconfig.
// ---------------------------------------------------------------------------

interface NodeAttempt<T> {
  ran: boolean;          // false → Node OAuth not configured, use agent fallback
  ok: boolean;
  data?: T;
  error?: string;
}

async function attempt<T>(fn: () => Promise<T>): Promise<NodeAttempt<T>> {
  const auth = getOAuthClient();
  if (!auth) return { ran: false, ok: false };
  try {
    return { ran: true, ok: true, data: await fn() };
  } catch (e: any) {
    return { ran: true, ok: false, error: `Google API error: ${e?.message || e}` };
  }
}

// ---------------------------------------------------------------------------
// Public tool results + agent fallback
// ---------------------------------------------------------------------------

export interface GoogleToolResult {
  ok: boolean;
  source?: "node" | "agent";
  result?: any;
  error?: string;
}

function agentFallback(tool: string, args: Record<string, unknown>): Promise<GoogleToolResult> {
  // Delegate to the Python agent exactly as before (hybrid mode).
  return callDesktopAgent(tool, args) as Promise<GoogleToolResult>;
}

// ---------------------------------------------------------------------------
// Calendar
// ---------------------------------------------------------------------------

const cal = google.calendar;

export async function googleListEvents(args: {
  max_results?: number;
  days_ahead?: number;
  show_all?: boolean;
}): Promise<GoogleToolResult> {
  const node = await attempt(async () => {
    const maxResults = Math.min(Number(args.max_results || 10), 50);
    const daysAhead = Math.max(1, Number(args.days_ahead || 7));
    const timeMin = new Date().toISOString();
    const timeMax = new Date(Date.now() + daysAhead * 864e5).toISOString();
    const res = await cal({ version: "v3", auth: getOAuthClient()! }).events.list({
      calendarId: "primary",
      timeMin,
      timeMax,
      maxResults,
      singleEvents: true,
      orderBy: "startTime",
    });
    return (res.data.items || []).map((ev: any) => {
      const entry: any = {
        summary: ev.summary || "(No title)",
        start: ev.start?.dateTime || ev.start?.date || "Unknown",
        end: ev.end?.dateTime || ev.end?.date || "Unknown",
        htmlLink: ev.htmlLink || "",
      };
      if (args.show_all) {
        entry.description = ev.description || "";
        entry.location = ev.location || "";
        entry.attendees = (ev.attendees || []).map((a: any) => ({
          email: a.email || "",
          responseStatus: a.responseStatus || "unknown",
        }));
      }
      return entry;
    });
  });
  if (!node.ran) return agentFallback("getCalendarEvents", args as any);
  if (!node.ok) return { ok: false, error: node.error };
  return {
    ok: true,
    source: "node",
    result: {
      result: node.data!.length ? `Found ${node.data!.length} event(s).` : `No upcoming events found.`,
      events: node.data,
    },
  };
}

export async function googleSearchEvents(args: {
  query?: string;
  days_ahead?: number;
  days_back?: number;
  max_results?: number;
}): Promise<GoogleToolResult> {
  const node = await attempt(async () => {
    const q = (args.query || "").trim().toLowerCase();
    const daysAhead = Math.min(Math.max(1, Number(args.days_ahead || 90)), 365);
    const daysBack = Math.min(Math.max(0, Number(args.days_back || 0)), 365);
    const timeMin = new Date(Date.now() - daysBack * 864e5).toISOString();
    const timeMax = new Date(Date.now() + daysAhead * 864e5).toISOString();
    const res = await cal({ version: "v3", auth: getOAuthClient()! }).events.list({
      calendarId: "primary",
      timeMin,
      timeMax,
      maxResults: 250,
      singleEvents: true,
      orderBy: "startTime",
    });
    const out: any[] = [];
    for (const ev of res.data.items || []) {
      const summary = ev.summary || "";
      if (q && !summary.toLowerCase().includes(q)) continue;
      out.push({
        id: ev.id || "",
        summary,
        start: ev.start?.dateTime || ev.start?.date || "",
        end: ev.end?.dateTime || ev.end?.date || "",
        description: (ev.description || "").slice(0, 500),
        htmlLink: ev.htmlLink || "",
      });
      if (out.length >= Math.min(Math.max(1, Number(args.max_results || 50)), 100)) break;
    }
    return out;
  });
  if (!node.ran) return agentFallback("searchCalendarEvents", args as any);
  if (!node.ok) return { ok: false, error: node.error };
  return {
    ok: true,
    source: "node",
    result: {
      result: node.data!.length ? `Found ${node.data!.length} calendar event(s).` : "No calendar events matching in the window.",
      events: node.data,
    },
  };
}

/** Normalise the flexible event-body shape used across the codebase. */
function normalizeEventBody(body: Record<string, any>) {
  const summary = body.summary || "Event";
  const startTime: string = body.start_time || "";
  const endTime: string = body.end_time || "";
  const resource: Record<string, any> = { summary };

  if (startTime && !startTime.includes("T")) {
    // All-day (date-only)
    resource.start = { date: startTime.slice(0, 10) };
    resource.end = { date: (endTime || startTime).slice(0, 10) };
  } else {
    const start = startTime ? new Date(startTime) : new Date();
    let end = endTime ? new Date(endTime) : new Date(start.getTime() + 36e5);
    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      throw new Error(`Invalid start_time '${startTime}'. Use ISO format like '2026-07-24T14:00:00'.`);
    }
    resource.start = { dateTime: start.toISOString() };
    resource.end = { dateTime: end.toISOString() };
  }
  if (body.description) resource.description = body.description;
  if (body.location) resource.location = body.location;
  if (body.attendees) {
    resource.attendees = String(body.attendees)
      .split(",")
      .map((e) => e.trim())
      .filter(Boolean)
      .map((email) => ({ email }));
  }
  return resource;
}

export async function googleCreateEvent(body: Record<string, any>): Promise<GoogleToolResult> {
  let resource: Record<string, any>;
  try {
    resource = normalizeEventBody(body);
  } catch (e: any) {
    return { ok: false, error: e?.message || "Invalid event body." };
  }
  const node = await attempt(async () => {
    const created = await cal({ version: "v3", auth: getOAuthClient()! }).events.insert({
      calendarId: "primary",
      requestBody: resource,
    });
    return {
      result: `Event created: "${resource.summary}"`,
      eventLink: created.data.htmlLink || "",
      id: created.data.id || "",
    };
  });
  if (!node.ran) return agentFallback("createCalendarEvent", body);
  if (!node.ok) return { ok: false, error: node.error };
  return { ok: true, source: "node", result: node.data };
}

export async function googleUpdateEvent(args: Record<string, any>): Promise<GoogleToolResult> {
  const eventId = args.event_id || args.id;
  if (!eventId) return { ok: false, error: "'event_id' is required." };

  const node = await attempt(async () => {
    const events = cal({ version: "v3", auth: getOAuthClient()! }).events;
    const existing = await events.get({ calendarId: "primary", eventId: String(eventId) });
    const patch: Record<string, any> = {};
    if (args.summary) patch.summary = args.summary;
    if (args.description) patch.description = args.description;
    if (args.location) patch.location = args.location;
    if (args.start_time || args.end_time) {
      const resource = normalizeEventBody({
        summary: existing.data.summary || "Event",
        start_time: args.start_time || existing.data.start?.dateTime || existing.data.start?.date || "",
        end_time: args.end_time || existing.data.end?.dateTime || existing.data.end?.date || "",
      });
      if (args.start_time) patch.start = resource.start;
      if (args.end_time) patch.end = resource.end;
    }
    const updated = await events.update({
      calendarId: "primary",
      eventId: String(eventId),
      requestBody: { ...existing.data, ...patch },
    });
    return {
      result: `Event updated: "${updated.data.summary || eventId}"`,
      eventLink: updated.data.htmlLink || "",
      id: updated.data.id || "",
    };
  });
  if (!node.ran) return agentFallback("updateCalendarEvent", args);
  if (!node.ok) return { ok: false, error: node.error };
  return { ok: true, source: "node", result: node.data };
}

export async function googleDeleteEvent(args: { event_id?: string; id?: string }): Promise<GoogleToolResult> {
  const eventId = args.event_id || args.id;
  if (!eventId) return { ok: false, error: "'event_id' is required." };
  const node = await attempt(async () => {
    try {
      await cal({ version: "v3", auth: getOAuthClient()! }).events.delete({
        calendarId: "primary",
        eventId: String(eventId),
      });
      return { result: `Event ${eventId} deleted.` };
    } catch (e: any) {
      const msg = String(e?.message || e);
      if (/\b(404|410)\b/.test(msg) || e?.code === 404 || e?.code === 410) {
        return { result: `Event ${eventId} already gone.` }; // idempotent
      }
      throw e;
    }
  });
  if (!node.ran) return agentFallback("deleteCalendarEvent", args);
  if (!node.ok) return { ok: false, error: node.error };
  return { ok: true, source: "node", result: node.data };
}

// ---------------------------------------------------------------------------
// Gmail
// ---------------------------------------------------------------------------

function splitAddresses(raw: unknown): { ok: string[]; bad: string[] } {
  const out: { ok: string[]; bad: string[] } = { ok: [], bad: [] };
  const push = (s: string) => {
    const t = s.trim().toLowerCase();
    if (!t) return;
    if (/^[\w.%+-]+@[\w.-]+\.[a-z]{2,}$/.test(t)) out.ok.push(t);
    else out.bad.push(t);
  };
  if (typeof raw === "string") String(raw).split(/[,;\s]+/).forEach(push);
  else if (Array.isArray(raw)) raw.forEach((x) => typeof x === "string" && push(x));
  return out;
}

const gmail = google.gmail;

export async function googleSendEmail(args: {
  to?: string;
  subject?: string;
  body?: string;
  cc?: string;
  /** Gmail message id being replied to — adds In-Reply-To/References and keeps the thread. */
  inReplyTo?: string;
  /** Gmail thread id to send within (threaded reply). */
  threadId?: string;
}): Promise<GoogleToolResult> {
  const to = splitAddresses(args.to);
  if (to.bad.length) {
    return {
      ok: false,
      error: `These don't look like valid email addresses: ${to.bad.join(", ")}. Ask the user to confirm the exact address before sending.`,
    };
  }
  if (!to.ok.length || !args.subject || !args.body) {
    return { ok: false, error: "'to', 'subject', and 'body' are all required." };
  }

  const node = await attempt(async () => {
    // Threading: fetch the original's Message-ID and References so mail
    // clients group the reply into the same conversation.
    let inReplyToHeader = "";
    let references = "";
    if (args.inReplyTo) {
      try {
        const orig = await gmail({ version: "v1", auth: getOAuthClient()! }).users.messages.get({
          userId: "me",
          id: args.inReplyTo,
          format: "metadata",
          metadataHeaders: ["Message-ID", "In-Reply-To", "References"],
        });
        const headers = Object.fromEntries(
          (orig.data.payload?.headers || []).map((h: any) => [h.name, h.value])
        );
        inReplyToHeader = headers["Message-ID"] || "";
        references = [headers["References"], headers["Message-ID"]].filter(Boolean).join(" ");
      } catch {
        /* original gone — send unthreaded rather than fail */
      }
    }

    const message = [
      `To: ${to.ok.join(", ")}`,
      args.cc ? `Cc: ${args.cc}` : "",
      `Subject: ${args.subject}`,
      inReplyToHeader ? `In-Reply-To: ${inReplyToHeader}` : "",
      references ? `References: ${references}` : "",
      "",
      args.body,
    ]
      .filter(Boolean)
      .join("\n");
    const raw = Buffer.from(message).toString("base64url");
    await gmail({ version: "v1", auth: getOAuthClient()! }).users.messages.send({
      userId: "me",
      // threadId keeps the reply inside the original Gmail conversation.
      requestBody: {
        raw,
        ...(args.threadId ? { threadId: args.threadId } : {}),
      },
    });
    return { result: `Email sent to ${to.ok.join(", ")}: "${args.subject}"` };
  });
  if (!node.ran) return agentFallback("sendEmail", args as any);
  if (!node.ok) {
    // Map common Gmail API errors to friendly text (mirrors google.py).
    const msg = node.error || "";
    if (/403/.test(msg)) {
      return { ok: false, error: "Gmail API rejected the request (403). Check that the Gmail API is enabled in your Google Cloud project and the OAuth scopes include gmail.send." };
    }
    if (/401|invalid_grant/.test(msg)) {
      return { ok: false, error: "Google authentication expired. Reconnect Google from Settings → System." };
    }
    return { ok: false, error: msg };
  }
  return { ok: true, source: "node", result: node.data };
}

export async function googleListEmails(args: {
  max_results?: number;
  query?: string;
}): Promise<GoogleToolResult> {
  const node = await attempt(async () => {
    const maxResults = Math.min(Math.max(1, Number(args.max_results || 5)), 20);
    const g = gmail({ version: "v1", auth: getOAuthClient()! });
    const list = await g.users.messages.list({
      userId: "me",
      q: args.query || undefined,
      maxResults,
    });
    const messages = list.data.messages || [];
    const emails: any[] = [];
    for (const m of messages) {
      try {
        const detail = await g.users.messages.get({
          userId: "me",
          id: m.id!,
          format: "metadata",
          metadataHeaders: ["From", "Subject", "Date"],
        });
        const headers = Object.fromEntries(
          (detail.data.payload?.headers || []).map((h: any) => [h.name, h.value])
        );
        emails.push({
          id: m.id,
          from: headers["From"] || "Unknown",
          subject: headers["Subject"] || "(No subject)",
          date: headers["Date"] || "Unknown",
          snippet: detail.data.snippet || "",
        });
      } catch {
        continue;
      }
    }
    return emails;
  });
  if (!node.ran) return agentFallback("getEmails", args as any);
  if (!node.ok) return { ok: false, error: node.error };
  return {
    ok: true,
    source: "node",
    result: {
      result: node.data!.length ? `Found ${node.data!.length} email(s).` : "No emails found matching your criteria.",
      emails: node.data,
    },
  };
}

// ---------------------------------------------------------------------------
// Full email read (MIME walk: text/plain → first text/html)
// ---------------------------------------------------------------------------

/** Decode a MIME body part (base64url or quoted-printable-ish plain). */
function decodeBodyPart(part: any): string {
  const data = part?.body?.data;
  if (!data) return "";
  try {
    return Buffer.from(data, "base64url").toString("utf-8");
  } catch {
    return String(data);
  }
}

/**
 * Walk a MIME tree and pick the best readable body: prefer text/plain,
 * fall back to text/html with tags stripped (no sandbox needed).
 */
export function extractReadableBody(payload: any): string {
  const mime = String(payload?.mimeType || "");

  if (mime === "text/plain") {
    const text = decodeBodyPart(payload);
    if (text.trim()) return text;
  }
  if (mime === "text/html") {
    const html = decodeBodyPart(payload);
    if (html.trim()) {
      return html
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<\/?p>/gi, "\n")
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/[ \t]+/g, " ")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
    }
  }

  // Multipart: recurse, preferring plain over html.
  const parts = payload?.parts || [];
  let htmlFallback = "";
  for (const p of parts) {
    const text = extractReadableBody(p);
    if (!text) continue;
    if (p.mimeType === "text/plain") return text;
    if (p.mimeType === "text/html" && !htmlFallback) htmlFallback = text;
  }
  return htmlFallback;
}

export async function googleReadEmail(args: {
  id?: string;
  message_id?: string;
  max_chars?: number;
}): Promise<GoogleToolResult> {
  const id = args.id || args.message_id;
  if (!id) return { ok: false, error: "'id' is required — get it from getEmails first." };
  const maxChars = Math.min(Math.max(200, Number(args.max_chars || 6000)), 20000);

  const node = await attempt(async () => {
    const detail = await gmail({ version: "v1", auth: getOAuthClient()! }).users.messages.get({
      userId: "me",
      id,
      format: "full",
    });
    const headers = Object.fromEntries(
      (detail.data.payload?.headers || []).map((h: any) => [h.name, h.value])
    );
    const body = extractReadableBody(detail.data.payload).slice(0, maxChars);
    const attachments = [] as any[];
    const walk = (p: any) => {
      for (const part of p?.parts || []) {
        if (part.filename && part.body?.attachmentId) {
          attachments.push({ filename: part.filename, size: part.body.size || 0 });
        }
        walk(part);
      }
    };
    walk(detail.data.payload);
    return {
      id,
      threadId: detail.data.threadId || "",
      from: headers["From"] || "Unknown",
      to: headers["To"] || "",
      subject: headers["Subject"] || "(No subject)",
      date: headers["Date"] || "Unknown",
      body,
      attachments,
    };
  });
  if (!node.ran) return agentFallback("readFullEmail", args as any);
  if (!node.ok) return { ok: false, error: node.error };
  const d = node.data!;
  return {
    ok: true,
    source: "node",
    result: {
      result:
        `From: ${d.from}\nDate: ${d.date}\nSubject: ${d.subject}\n\n${d.body}` +
        (d.attachments.length ? `\n\n[${d.attachments.length} attachment(s): ${d.attachments.map((a: any) => a.filename).join(", ")}]` : ""),
      ...d,
    },
  };
}

// ---------------------------------------------------------------------------
// Google Tasks
// ---------------------------------------------------------------------------

const tasks = google.tasks;

export async function googleListTasks(args: {
  tasklist?: string;
  max_results?: number;
  show_completed?: boolean;
}): Promise<GoogleToolResult> {
  const node = await attempt(async () => {
    const t = tasks({ version: "v1", auth: getOAuthClient()! });
    const title = args.tasklist || "My Tasks";
    const lists = await t.tasklists.list();
    const items = lists.data.items || [];
    const tl = items.find((l: any) => (l.title || "").toLowerCase() === title.toLowerCase());
    if (!tl) {
      const available = items.map((l: any) => l.title).join(", ") || "No task lists found";
      throw new Error(`Task list '${title}' not found. Available: ${available}`);
    }
    const res = await t.tasks.list({
      tasklist: tl.id!,
      maxResults: Math.min(Math.max(1, Number(args.max_results || 10)), 50),
      showCompleted: Boolean(args.show_completed),
    });
    return (res.data.items || []).map((task: any) => ({
      title: task.title || "(Untitled)",
      notes: task.notes || "",
      due: task.due || "",
      status: task.status || "needsAction",
      id: task.id || "",
    }));
  });
  if (!node.ran) return agentFallback("getTasks", args as any);
  if (!node.ok) return { ok: false, error: node.error };
  return {
    ok: true,
    source: "node",
    result: {
      result: node.data!.length ? `Found ${node.data!.length} task(s).` : `No tasks found.`,
      tasks: node.data,
    },
  };
}

export async function googleCreateTask(args: {
  title?: string;
  notes?: string;
  due?: string;
  tasklist?: string;
}): Promise<GoogleToolResult> {
  if (!args.title) return { ok: false, error: "'title' is required." };
  const node = await attempt(async () => {
    const t = tasks({ version: "v1", auth: getOAuthClient()! });
    const title = args.tasklist || "My Tasks";
    const lists = await t.tasklists.list();
    const items = lists.data.items || [];
    const tl = items.find((l: any) => (l.title || "").toLowerCase() === title.toLowerCase());
    if (!tl) {
      const available = items.map((l: any) => l.title).join(", ") || "No task lists found";
      throw new Error(`Task list '${title}' not found. Available: ${available}`);
    }
    const body: Record<string, any> = { title: args.title };
    if (args.notes) body.notes = args.notes;
    if (args.due) body.due = args.due;
    const created = await t.tasks.insert({ tasklist: tl.id!, requestBody: body });
    return { result: `Task created: "${args.title}"`, id: created.data.id || "" };
  });
  if (!node.ran) return agentFallback("createTask", args as any);
  if (!node.ok) return { ok: false, error: node.error };
  return { ok: true, source: "node", result: node.data };
}
