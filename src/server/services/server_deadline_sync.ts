/**
 * YANTRI Deadline Sync (V4) — auto-reminders for saved user records.
 *
 * Watches the user-data store (server_userdata.ts) for records that carry a
 * due date and are reminder-worthy (deadlines, exams, supplier dues,
 * meetings, custom reminders — NOT inventory logs or notes). For each one it
 * maintains EXACTLY ONE reminder in the standard reminder pipeline
 * (server_reminders.ts), scheduled to fire when the record enters the
 * "due soon" window (default: 24h before due). Fires at due time itself for
 * records that are already inside the window when saved/synced.
 *
 * Deterministic ids (`dl-<recordId>`) make syncing idempotent: create,
 * reschedule-on-change and cancel-on-delete are all safe to run repeatedly.
 * The sync re-runs periodically and after every record mutation.
 */

import {
  addReminder,
  cancelReminder,
  getReminders,
  loadReminders,
} from "./server_reminders";
import { queryRecords, type UserRecord } from "./server_userdata";
import { loadProfile } from "./server_profile";

/** Record types that should fire a due-soon reminder. */
const REMINDER_WORTHY_TYPES = new Set([
  "deadline",
  "exam",
  "meeting",
  "custom_reminder",
  "supplier",
  "work_session",
]);

/** How long before the due date the reminder fires (ms). */
const DUE_SOON_WINDOW_MS = 24 * 60 * 60 * 1000;

/** How often the periodic sync re-runs (ms). */
const SYNC_INTERVAL_MS = 5 * 60 * 1000;

let syncTimer: ReturnType<typeof setInterval> | null = null;

function isReminderWorthy(rec: UserRecord): boolean {
  if (!rec.due) return false;
  const t = new Date(rec.due).getTime();
  if (Number.isNaN(t)) return false;
  // Inventory logs are historical entries, not future events.
  if (rec.type === "inventory") return false;
  // Unknown types default OFF to avoid noisy reminders; known types opt in.
  return REMINDER_WORTHY_TYPES.has(rec.type);
}

function syncIdFor(rec: UserRecord): string {
  return `dl-${rec.id}`;
}

function friendlyDue(rec: UserRecord): string {
  try {
    const d = new Date(rec.due!);
    const hasTime = rec.due!.includes("T");
    return d.toLocaleString(undefined, hasTime
      ? { weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }
      : { weekday: "short", month: "short", day: "numeric" });
  } catch {
    return rec.due!;
  }
}

function reminderTextFor(rec: UserRecord): string {
  return `Due ${friendlyDue(rec)}: ${rec.title}`;
}

/**
 * Reconcile the reminder store with the current set of reminder-worthy
 * records: add missing, reschedule changed, cancel removed/past ones.
 */
export async function syncDeadlineReminders(): Promise<{
  added: number;
  updated: number;
  cancelled: number;
}> {
  await loadReminders(); // refresh in-memory store from disk
  const profile = await loadProfile();
  const email = profile?.email || "";

  const existing = new Map(getReminders().map((r) => [r.id, r]));
  let added = 0;
  let updated = 0;
  let cancelled = 0;

  // --- 1. Upsert reminders for current records -------------------------------
  const records = await queryRecords({ email: email || undefined, limit: 200 });
  const wantedIds = new Set<string>();

  for (const rec of records) {
    if (!isReminderWorthy(rec)) continue;
    const id = syncIdFor(rec);
    wantedIds.add(id);

    const dueMs = new Date(rec.due!).getTime();
    const fireAt = new Date(Math.max(Date.now(), dueMs - DUE_SOON_WINDOW_MS));

    const prev = existing.get(id);
    const prevFireAt = prev ? new Date(prev.fireAt).getTime() : NaN;
    const changed = !prev
      || prev.fired // re-arm if it already fired (e.g. due moved later)
      || Math.abs(prevFireAt - fireAt.getTime()) > 60_000; // >1min drift

    if (prev && !changed) continue;

    // Deterministic replace: cancel the stale entry, add the new one.
    if (prev) cancelReminder(id);
    addReminder(reminderTextFor(rec), (fireAt.getTime() - Date.now()) / 60_000, id);
    if (prev) updated++; else added++;
    existing.set(id, getReminders().find((r) => r.id === id)!);
  }

  // --- 2. Cancel reminders whose record is gone or no longer worthy ----------
  for (const [id, reminder] of existing) {
    if (!id.startsWith("dl-")) continue; // only manage our own entries
    if (wantedIds.has(id)) continue;
    // Record deleted / type changed / due removed -> drop the reminder
    // unless it already fired (keep history so the user saw the alert).
    if (!reminder.fired) {
      cancelReminder(id);
      cancelled++;
    }
  }

  if (added || updated || cancelled) {
    console.log(`[DeadlineSync] added=${added} updated=${updated} cancelled=${cancelled}`);
  }
  return { added, updated, cancelled };
}

/**
 * Start the periodic sync + hook record mutations.
 * Called once from server.ts after startReminderTimer().
 */
export function startDeadlineSync(): void {
  if (syncTimer) return;
  // Initial sync shortly after boot (lets profile/records load first).
  setTimeout(() => void syncDeadlineReminders().catch((e) =>
    console.warn("[DeadlineSync] initial sync failed:", e?.message || e)
  ), 3_000);
  syncTimer = setInterval(() => {
    void syncDeadlineReminders().catch((e) =>
      console.warn("[DeadlineSync] periodic sync failed:", e?.message || e)
    );
  }, SYNC_INTERVAL_MS);
  console.log("[DeadlineSync] started (every 5 min, 24h due-soon window)");
}

export function stopDeadlineSync(): void {
  if (syncTimer) {
    clearInterval(syncTimer);
    syncTimer = null;
  }
}
