/**
 * YANTRI User Data Records (V4) — role-feature personal data store.
 *
 * A single flexible JSON-backed store powering every role-feature that needs
 * to remember user-provided data: assignment deadlines, notes, flashcards,
 * attendance, meeting notes, inventory entries, supplier dues, feedback, etc.
 *
 * Each record: { id, email, type, title, payload, due, tags, createdAt, updatedAt }
 *   - type: namespaced per feature (e.g. "deadline", "note", "flashcard",
 *     "attendance", "meeting", "inventory", "supplier", "feedback", "reminder_custom")
 *   - payload: free-form JSON (subject, marks, quantity, price, who, ...)
 *
 * Persisted to userdata.json in the data dir. All queries are scoped by the
 * onboarded user's email so multiple accounts on one machine stay separate.
 */

import fs from "fs/promises";
import { dataFile } from "./server_paths";
import { loadProfile } from "./server_profile";
import { queueUpload } from "./server_storage";
import { persistJson } from "../db";

const DATA_FILE = dataFile("userdata.json");

export interface UserRecord {
  id: string;
  email: string;
  type: string;
  title: string;
  payload: Record<string, unknown>;
  /** Optional ISO date/datetime — deadlines, dues, exam dates. */
  due?: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

let cache: UserRecord[] | null = null;

/**
 * Optional hooks fired after any record mutation (add/update/delete).
 * server_deadline_sync registers a callback so due-dated records get their
 * auto-reminder rescheduled immediately; server_calendar_sync registers one
 * so exam records get mirrored to Google Calendar. Listeners are fire-and-
 * forget from the mutator's perspective — each is invoked inside try/catch.
 */
type MutationListener = (action: "save" | "update" | "delete", record?: UserRecord) => void;
const mutationListeners: MutationListener[] = [];

export function setOnRecordMutated(listener: MutationListener | null): void {
  if (listener) mutationListeners.push(listener);
}

function notifyMutation(action: "save" | "update" | "delete", record?: UserRecord): void {
  for (const listener of mutationListeners) {
    try {
      listener(action, record);
    } catch (e) {
      console.error("[UserData] mutation listener error:", e);
    }
  }
}

async function readAll(): Promise<UserRecord[]> {
  if (cache) return cache;
  try {
    const data = await fs.readFile(DATA_FILE, "utf-8");
    cache = JSON.parse(data) as UserRecord[];
  } catch (error: any) {
    if (error.code !== "ENOENT") {
      console.error("[UserData] Error loading records:", error);
    }
    cache = [];
  }
  return cache;
}

async function writeAll(records: UserRecord[]): Promise<void> {
  try {
    await persistJson("userdata.json", DATA_FILE, records);
    cache = records;
    queueUpload("userdata.json"); // V5.1: mirror to cloud object storage if configured
  } catch (error) {
    console.error("[UserData] Error saving records:", error);
  }
}

/** Current onboarded email, or "" when no profile exists (shared store). */
async function currentEmail(): Promise<string> {
  const profile = await loadProfile();
  return profile?.email || "";
}

function makeId(): string {
  return Math.random().toString(36).substring(2, 11) + Date.now().toString(36);
}

// ---------------------------------------------------------------------------
// CRUD used by the /api/userdata REST endpoints and tool handlers
// ---------------------------------------------------------------------------

export interface SaveRecordInput {
  type: string;
  title: string;
  payload?: Record<string, unknown>;
  due?: string;
  tags?: string[];
  /** Override email (defaults to the onboarded user). */
  email?: string;
  /** When set, update the existing record with this id instead of creating. */
  id?: string;
}

export async function saveRecord(input: SaveRecordInput): Promise<UserRecord> {
  if (!input.type || !input.title) {
    throw new Error("type and title are required.");
  }
  const records = await readAll();
  const now = new Date().toISOString();
  const email = (input.email || (await currentEmail())).toLowerCase();

  if (input.id) {
    const idx = records.findIndex((r) => r.id === input.id && (!email || r.email === email));
    if (idx === -1) throw new Error(`Record not found: ${input.id}`);
    const updated: UserRecord = {
      ...records[idx],
      title: input.title,
      payload: input.payload ?? records[idx].payload,
      due: input.due ?? records[idx].due,
      tags: input.tags ?? records[idx].tags,
      updatedAt: now,
    };
    records[idx] = updated;
    await writeAll(records);
    notifyMutation("update", updated);
    return updated;
  }

  const rec: UserRecord = {
    id: makeId(),
    email,
    type: input.type,
    title: input.title,
    payload: input.payload ?? {},
    due: input.due,
    tags: input.tags ?? [],
    createdAt: now,
    updatedAt: now,
  };
  records.push(rec);
  await writeAll(records);
  notifyMutation("save", rec);
  return rec;
}

export interface QueryRecordsInput {
  type?: string | string[];
  tag?: string;
  /** Only records with a due date on/before this ISO date. */
  dueBefore?: string;
  /** Only records with a due date on/after this ISO date. */
  dueAfter?: string;
  /** Free-text search over title + payload JSON. */
  search?: string;
  limit?: number;
  email?: string;
}

export async function queryRecords(input: QueryRecordsInput = {}): Promise<UserRecord[]> {
  const records = await readAll();
  const email = (input.email || (await currentEmail())).toLowerCase();
  const types = input.type
    ? (Array.isArray(input.type) ? input.type : [input.type]).map((t) => t.toLowerCase())
    : null;

  let out = records.filter((r) => {
    if (email && r.email !== email) return false;
    if (types && !types.includes(r.type.toLowerCase())) return false;
    if (input.tag && !r.tags.includes(input.tag)) return false;
    if (input.dueBefore && (!r.due || r.due > input.dueBefore)) return false;
    if (input.dueAfter && (!r.due || r.due < input.dueAfter)) return false;
    if (input.search) {
      const hay = (r.title + " " + JSON.stringify(r.payload || {})).toLowerCase();
      if (!hay.includes(input.search.toLowerCase())) return false;
    }
    return true;
  });

  // Soonest due first; undated last, newest first within ties.
  out.sort((a, b) => {
    if (a.due && b.due) return a.due.localeCompare(b.due);
    if (a.due) return -1;
    if (b.due) return 1;
    return b.createdAt.localeCompare(a.createdAt);
  });

  const limit = input.limit ?? 50;
  return out.slice(0, Math.max(1, Math.min(limit, 200)));
}

export async function updateRecord(
  id: string,
  patch: Partial<Pick<UserRecord, "title" | "payload" | "due" | "tags">>
): Promise<UserRecord | null> {
  const records = await readAll();
  const email = await currentEmail();
  const idx = records.findIndex((r) => r.id === id && (!email || r.email === email));
  if (idx === -1) return null;
  const now = new Date().toISOString();
  const updated: UserRecord = {
    ...records[idx],
    ...patch,
    updatedAt: now,
  };
  records[idx] = updated;
  await writeAll(records);
  notifyMutation("update", updated);
  return updated;
}

export async function deleteRecord(id: string): Promise<boolean> {
  const records = await readAll();
  const email = await currentEmail();
  const idx = records.findIndex((r) => r.id === id && (!email || r.email === email));
  if (idx === -1) return false;
  const [removed] = records.splice(idx, 1);
  await writeAll(records);
  notifyMutation("delete", removed);
  return true;
}

/** Count records grouped by type — quick stats for dashboards/persona. */
export async function countByType(): Promise<Record<string, number>> {
  const records = await readAll();
  const email = await currentEmail();
  const counts: Record<string, number> = {};
  for (const r of records) {
    if (email && r.email !== email) continue;
    counts[r.type] = (counts[r.type] || 0) + 1;
  }
  return counts;
}

/**
 * Patch a record WITHOUT firing mutation listeners.
 * Used by sync engines (calendar sync) to update fields and stamp bookkeeping
 * keys (calendarEventId etc.) — prevents infinite listener loops.
 */
export async function patchRecordSilent(
  id: string,
  patch: Partial<Pick<UserRecord, "title" | "payload" | "due" | "tags">>
): Promise<UserRecord | null> {
  const records = await readAll();
  const email = await currentEmail();
  const idx = records.findIndex((r) => r.id === id && (!email || r.email === email));
  if (idx === -1) return null;
  const updated: UserRecord = {
    ...records[idx],
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  records[idx] = updated;
  await writeAll(records);
  return updated;
}
