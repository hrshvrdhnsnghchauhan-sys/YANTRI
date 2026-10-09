/**
 * YANTRI Calendar Sync (V4) — two-way mirror between user records and Google
 * Calendar.
 *
 * OUTBOUND (record → event): when a record of type "exam" or "meeting" is
 * saved via saveUserRecord (or the REST API), this engine creates a matching
 * Google Calendar event through the Python desktop agent's Calendar API. The
 * event id is stamped into the record's payload (calendarEventId) so
 * updates/deletes stay idempotent:
 *
 *   save record   → create event (or reuse if already synced)
 *   update record → patch the event
 *   delete record → delete the event
 *
 * INBOUND (event → record): on WS connect, exam-like events already on the
 * user's Google Calendar are imported into the Data Vault (see
 * importExamsFromCalendar) with dedup and dismissal tombstones.
 *
 * Design notes:
 *  - Fire-and-forget: sync failures NEVER block saving a record. The sync
 *    state is recorded in the payload (calendarSyncError) and a boot-time
 *    + periodic sweep retries anything that isn't synced yet.
 *  - If Google OAuth isn't configured, everything no-ops silently (logged
 *    once) — onboarding does not require Google setup.
 */

import {
  googleDeleteEvent,
  googleUpdateEvent,
  googleCreateEvent,
  googleSearchEvents,
} from "./server_google";
import { queueUpload } from "./server_storage";
import fs from "fs";
import {
  patchRecordSilent,
  queryRecords,
  saveRecord,
  deleteRecord,
  type UserRecord,
} from "./server_userdata";
import { loadProfile } from "./server_profile";
import { dataFile } from "./server_paths";

/** Which record types get mirrored to Calendar. */
const SYNCED_TYPES = new Set(["exam", "meeting", "deadline"]);

/** Per-type presentation: Calendar title prefix + default event duration. */
const TYPE_META: Record<string, { prefix: string; durationMs: number; source: string }> = {
  exam: { prefix: "[Exam]", durationMs: 3 * 60 * 60 * 1000, source: "exam tracker" },
  meeting: { prefix: "[Meeting]", durationMs: 60 * 60 * 1000, source: "meeting notes" },
  deadline: { prefix: "[Deadline]", durationMs: 60 * 60 * 1000, source: "deadline tracker" },
};

/** One Google sync attempt / result. */
export interface CalendarSyncResult {
  ok: boolean;
  action: "created" | "updated" | "deleted" | "skipped" | "error";
  eventId?: string;
  error?: string;
}

function isSyncable(rec: UserRecord): boolean {
  return SYNCED_TYPES.has(rec.type) && Boolean(rec.due);
}

/**
 * Add a duration to a naive local ISO datetime string, returning a naive
 * local ISO string (no timezone conversion). Using toISOString() here would
 * silently shift the wall-clock time to UTC.
 */
function addDurationLocal(iso: string, ms: number): string {
  const d = new Date(iso);
  d.setTime(d.getTime() + ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** Build the Calendar event body from a record. */
function eventBodyFor(rec: UserRecord): Record<string, unknown> {
  const meta = TYPE_META[rec.type] || TYPE_META.exam;
  const hasTime = rec.due!.includes("T");
  const start = hasTime ? rec.due! : `${rec.due}T00:00:00`;
  // Timed events get their type's default duration; date-only become all-day.
  const end = hasTime
    ? addDurationLocal(rec.due!, meta.durationMs)
    : `${rec.due}T23:59:00`;

  return {
    summary: `${meta.prefix} ${rec.title}`,
    description:
      `Auto-synced by Yantri from your ${meta.source}.\n` +
      `Record ID: ${rec.id}\n` +
      (rec.tags.length ? `Tags: ${rec.tags.join(", ")}\n` : "") +
      Object.entries(rec.payload || {})
        .filter(([k]) => !k.startsWith("calendar"))
        .map(([k, v]) => `${k}: ${v}`)
        .join("\n"),
    start_time: start,
    end_time: end,
  };
}

/**
 * Sync one record to Google Calendar (create / update / delete).
 * Returns the outcome; never throws.
 */
export async function syncRecordToCalendar(
  action: "save" | "update" | "delete",
  rec: UserRecord
): Promise<CalendarSyncResult> {
  const existingId = (rec.payload?.calendarEventId as string) || "";
  const alreadySynced = Boolean(rec.payload?.calendarSynced);

  // ---------------------------------------------------------------- delete
  if (action === "delete") {
    if (!existingId) return { ok: true, action: "skipped" };
    const res = await googleDeleteEvent({ event_id: existingId });
    return res.ok
      ? { ok: true, action: "deleted", eventId: existingId }
      : { ok: false, action: "error", eventId: existingId, error: res.error };
  }

  // ------------------------------------------------------------ not syncable
  if (!isSyncable(rec)) {
    // If it WAS synced and the due date was removed, clean up the event.
    if (existingId && action === "update") {
      const del = await googleDeleteEvent({ event_id: existingId });
      await patchRecordSilent(rec.id, {
        payload: { ...rec.payload, calendarEventId: undefined, calendarSynced: false },
      });
      return del.ok
        ? { ok: true, action: "deleted", eventId: existingId }
        : { ok: false, action: "error", error: del.error };
    }
    return { ok: true, action: "skipped" };
  }

  // ---------------------------------------------------------------- upsert
  const body = eventBodyFor(rec);

  if (existingId && alreadySynced) {
    const res = await googleUpdateEvent({
      event_id: existingId,
      ...body,
    });
    if (res.ok) return { ok: true, action: "updated", eventId: existingId };
    // Event might have been deleted from Google side — fall through to create.
    console.warn(`[CalendarSync] update failed (${res.error}); will attempt create.`);
  }

  const res = await googleCreateEvent(body);
  if (res.ok) {
    const eventId = (res.result as any)?.id || (res.result as any)?.eventLink || "";
    await patchRecordSilent(rec.id, {
      payload: { ...rec.payload, calendarEventId: eventId || undefined, calendarSynced: true, calendarSyncError: undefined },
    });
    return { ok: true, action: existingId ? "updated" : "created", eventId };
  }

  const err = res.error || "Unknown calendar error";
  // Record the failure (visible in DataDashboard payload chips) and allow retry.
  await patchRecordSilent(rec.id, {
    payload: { ...rec.payload, calendarSynced: false, calendarSyncError: String(err).slice(0, 200) },
  });
  console.warn(`[CalendarSync] create failed for "${rec.title}": ${err.slice(0, 120)}`);
  return { ok: false, action: "error", error: err };
}

/**
 * Sweep all syncable records and retry any that aren't synced yet.
 * Called at boot and periodically; also useful after OAuth is set up.
 */
export async function sweepCalendarSync(): Promise<{ attempted: number; synced: number; failed: number }> {
  const profile = await loadProfile();
  if (!profile) return { attempted: 0, synced: 0, failed: 0 };

  const records = await queryRecords({ type: Array.from(SYNCED_TYPES), limit: 200 });
  let attempted = 0;
  let synced = 0;
  let failed = 0;

  for (const rec of records) {
    if (!isSyncable(rec)) continue;
    if (rec.payload?.calendarSynced && rec.payload?.calendarEventId) continue; // already good
    attempted++;
    const res = await syncRecordToCalendar("save", rec);
    if (res.ok) synced++; else failed++;
    // Small delay to be gentle with the Python agent / Google API.
    await new Promise((r) => setTimeout(r, 250));
  }

  if (attempted > 0) {
    console.log(`[CalendarSync] sweep: attempted=${attempted} synced=${synced} failed=${failed}`);
  }
  return { attempted, synced, failed };
}

let sweepTimer: ReturnType<typeof setInterval> | null = null;

/** Start the boot sweep + periodic retry loop. */
export function startCalendarSync(): void {
  if (sweepTimer) return;
  // Wait for profile + records to be readable.
  setTimeout(() => void sweepCalendarSync().catch(() => {}), 5_000);
  sweepTimer = setInterval(() => {
    void sweepCalendarSync().catch(() => {});
  }, 10 * 60 * 1000);
  console.log("[CalendarSync] started (sweep every 10 min for unsynced exams/meetings)");
}

export function stopCalendarSync(): void {
  if (sweepTimer) {
    clearInterval(sweepTimer);
    sweepTimer = null;
  }
}

// ===========================================================================
// INBOUND SYNC — import exam-like Calendar events into the Data Vault
// ===========================================================================

/** Title keywords that qualify a calendar event as an exam. */
const EXAM_KEYWORDS = ["exam", "test", "quiz", "midterm", "final", "mid-term", "assessment"];

/** Prefixes our outbound sync adds — those events already have a record. */
const OWNED_PREFIXES = ["[Exam]", "[Meeting]", "[Deadline]"];

/** How often the dismissed-tombstone cache is pruned (ms). */
const TOMBSTONE_PRUNE_MS = 24 * 60 * 60 * 1000;

/** eventId → dismissal timestamp for imported events the user deleted. */
const dismissedEvents = new Map<string, number>();

/**
 * Tombstones survive restarts via calendar_tombstones.json in the data dir —
 * otherwise a dismissed import would resurrect on the next boot.
 */
const TOMBSTONES_FILE = dataFile("calendar_tombstones.json");

function loadTombstones(): void {
  if (dismissedEvents.size > 0) return; // already loaded
  try {
    const raw = JSON.parse(fs.readFileSync(TOMBSTONES_FILE, "utf-8")) as Record<string, number>;
    for (const [id, ts] of Object.entries(raw)) dismissedEvents.set(id, ts);
  } catch {
    /* no file yet */
  }
}

function persistTombstones(): void {
  try {
    fs.writeFileSync(
      TOMBSTONES_FILE,
      JSON.stringify(Object.fromEntries(dismissedEvents), null, 2),
      "utf-8"
    );
    queueUpload("calendar_tombstones.json"); // V5.1: mirror to cloud storage if configured
  } catch (e) {
    console.warn("[CalendarSync] could not persist tombstones:", e);
  }
}

/**
 * Import exam-like events from the user's Google Calendar into the Data
 * Vault. Skips: our own outbound events, already-imported events, dismissed
 * tombstones, and events without a recognizable time. Upserts otherwise:
 * re-import refreshes title/time if Google changed them.
 */
export async function importExamsFromCalendar(): Promise<{
  imported: number;
  updated: number;
  skipped: number;
}> {
  const profile = await loadProfile();
  if (!profile) return { imported: 0, updated: 0, skipped: 0 };

  // Load + prune tombstones so the store doesn't grow forever.
  loadTombstones();
  const now = Date.now();
  for (const [id, ts] of dismissedEvents) {
    if (now - ts > TOMBSTONE_PRUNE_MS * 14) dismissedEvents.delete(id);
  }

  const res = await googleSearchEvents({
    days_ahead: 120,
    days_back: 7,
    max_results: 100,
  });
  if (!res.ok) {
    // Expected when Google OAuth isn't set up — keep quiet (one log line).
    console.log(`[CalendarSync] import skipped: ${String(res.error).slice(0, 100)}`);
    return { imported: 0, updated: 0, skipped: 0 };
  }

  const events = ((res.result as any)?.events || []) as Array<{
    id: string;
    summary: string;
    start: string;
    end: string;
    description?: string;
  }>;

  // Existing records keyed by their imported event id.
  const existingRecords = await queryRecords({ type: "exam", limit: 200 });
  const byEventId = new Map<string, UserRecord>();
  for (const r of existingRecords) {
    const eid = r.payload?.calendarEventId as string;
    if (eid) byEventId.set(eid, r);
  }

  let imported = 0;
  let updated = 0;
  let skipped = 0;

  for (const ev of events) {
    if (!ev.id || !ev.start) continue;
    // Never re-import our own outbound events — they have records already.
    if (OWNED_PREFIXES.some((p) => ev.summary.startsWith(p))) {
      skipped++;
      continue;
    }
    // Keyword filter — only exam-like titles.
    const title = ev.summary.toLowerCase();
    if (!EXAM_KEYWORDS.some((k) => title.includes(k))) {
      skipped++;
      continue;
    }
    // User dismissed this import before — respect that.
    if (dismissedEvents.has(ev.id)) {
      skipped++;
      continue;
    }

    const due = ev.start.includes("T") ? ev.start : ev.start;
    const rec = byEventId.get(ev.id);
    if (rec) {
      // Already imported — refresh if Google changed title or time.
      const changed = rec.title !== ev.summary || rec.due !== due;
      if (changed) {
        await patchRecordSilent(rec.id, {
          title: ev.summary,
          due,
          payload: { ...rec.payload, calendarSynced: true, calendarSyncError: undefined },
        });
        updated++;
      }
      continue;
    }

    // New import.
    await saveRecord({
      type: "exam",
      title: ev.summary,
      due,
      payload: {
        calendarEventId: ev.id,
        calendarSynced: true,
        importedFromCalendar: true,
      },
      tags: ["imported"],
    });
    imported++;
  }

  if (imported || updated) {
    console.log(`[CalendarSync] import: new=${imported} updated=${updated} skipped=${skipped}`);
  }
  return { imported, updated, skipped };
}

/**
 * Dismiss an imported exam record: delete the record and tombstone the
 * calendar event so future imports don't resurrect it. Exported for the
 * REST/tool layer (e.g. a "dismiss" button in the Data Vault).
 */
export async function dismissImportedExam(recordId: string): Promise<boolean> {
  const rec = (await queryRecords({ type: "exam", limit: 200 })).find((r) => r.id === recordId);
  if (!rec?.payload?.calendarEventId) return false;
  const eventId = rec.payload.calendarEventId as string;
  loadTombstones();
  dismissedEvents.set(eventId, Date.now());
  persistTombstones();
  // Deleting the record would normally trigger outbound sync (delete event);
  // imported records should NOT delete the user's Google event, so use the
  // silent path and clear the linkage first.
  await patchRecordSilent(recordId, { payload: {} });
  return deleteRecord(recordId);
}

let importTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Run the import once shortly after boot and then periodically. The WS
 * connect hook (server.ts) also calls importExamsFromCalendar directly so
 * the vault is fresh whenever the user starts a session.
 */
export function startCalendarImport(): void {
  if (importTimer) return;
  setTimeout(() => void importExamsFromCalendar().catch(() => {}), 8_000);
  importTimer = setInterval(() => {
    void importExamsFromCalendar().catch(() => {});
  }, 15 * 60 * 1000);
  console.log("[CalendarSync] import loop started (every 15 min)");
}
