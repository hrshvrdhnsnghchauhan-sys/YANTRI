/**
 * YANTRI — SQLite persistence (better-sqlite3).
 *
 * Provides:
 *   - `users`          : authentication accounts (issue 3/12).
 *   - `documents`      : transactional mirror of the JSON state files so
 *                        concurrent writers cannot corrupt them (issue 12).
 *
 * The database path is resolved lazily from the environment so tests that reset
 * modules with a fresh YANTRI_DATA_DIR get an isolated database.
 */
import Database from "better-sqlite3";
import * as fs from "fs";
import path from "path";
import { writeJsonAtomic } from "../utils/persist";

export interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  name: string | null;
  role: string | null;
  created_at: string;
  updated_at: string;
}

let _db: Database.Database | null = null;

function resolveDbPath(): string {
  if (process.env.YANTRI_DB_FILE) return process.env.YANTRI_DB_FILE;
  const dir = process.env.YANTRI_DATA_DIR || process.cwd();
  return path.join(dir, "yantri.db");
}

export function getDb(): Database.Database {
  if (_db) return _db;
  const p = resolveDbPath();
  try {
    fs.mkdirSync(path.dirname(p), { recursive: true });
  } catch {
    /* exists */
  }
  const db = new Database(p);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  _db = db;
  return db;
}

let schemaReady = false;

/** Ensure tables exist (idempotent, cheap after the first call). */
export function ensureSchema(): void {
  if (schemaReady) return;
  initStorage();
  schemaReady = true;
}

/** Create tables if they do not exist. Safe to call repeatedly. */
export function initStorage(): void {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id            TEXT PRIMARY KEY,
      email         TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      name          TEXT,
      role          TEXT,
      created_at    TEXT NOT NULL,
      updated_at    TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS documents (
      name       TEXT PRIMARY KEY,
      json       TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
}

// ── Users ─────────────────────────────────────────────────────────────────────

export function findUserByEmail(email: string): UserRow | null {
  const row = getDb()
    .prepare("SELECT * FROM users WHERE email = ?")
    .get(email.toLowerCase()) as UserRow | undefined;
  return row ?? null;
}

export function findUserById(id: string): UserRow | null {
  const row = getDb().prepare("SELECT * FROM users WHERE id = ?").get(id) as UserRow | undefined;
  return row ?? null;
}

export function insertUser(row: UserRow): void {
  getDb()
    .prepare(
      `INSERT INTO users (id, email, password_hash, name, role, created_at, updated_at)
       VALUES (@id, @email, @password_hash, @name, @role, @created_at, @updated_at)`
    )
    .run(row);
}

export function countUsers(): number {
  const row = getDb().prepare("SELECT COUNT(*) AS c FROM users").get() as { c: number };
  return row.c;
}

// ── Documents (JSON state mirror) ─────────────────────────────────────────────

/**
 * Mirror a JSON document into SQLite (synchronous, best-effort). This is the
 * transactional copy that cannot be corrupted by a torn write; the JSON file
 * remains the on-disk compatibility format.
 */
export function mirrorJson(name: string, data: unknown): void {
  try {
    ensureSchema();
    getDb()
      .prepare(
        `INSERT INTO documents (name, json, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(name) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at`
      )
      .run(name, JSON.stringify(data), new Date().toISOString());
  } catch {
    /* mirroring is best-effort; the file write still happens */
  }
}

/** Write a JSON state document atomically AND mirror it into SQLite. */
export async function persistJson(name: string, file: string, data: unknown): Promise<void> {
  mirrorJson(name, data);
  await writeJsonAtomic(file, data);
}

/**
 * Persist the transactional copy, then refresh the JSON mirror atomically.
 * `mirrorFile` is optional so callers that only need durability can skip it.
 */
export async function putDocument(name: string, data: unknown, mirrorFile?: string): Promise<void> {
  const json = JSON.stringify(data);
  getDb()
    .prepare(
      `INSERT INTO documents (name, json, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(name) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at`
    )
    .run(name, json, new Date().toISOString());
  if (mirrorFile) await writeJsonAtomic(mirrorFile, data);
}

export function getDocument<T>(name: string): T | null {
  const row = getDb().prepare("SELECT json FROM documents WHERE name = ?").get(name) as
    | { json: string }
    | undefined;
  if (!row) return null;
  try {
    return JSON.parse(row.json) as T;
  } catch {
    return null;
  }
}
