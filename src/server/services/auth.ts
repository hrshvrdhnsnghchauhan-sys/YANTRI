/**
 * Authentication service — scrypt password hashing + JWT issuance, backed by
 * the SQLite users table (db/index.ts).
 */
import crypto from "crypto";
import jwt from "jsonwebtoken";
import { randomUUID } from "crypto";
import { JWT_SECRET, JWT_EXPIRES_IN } from "../config";
import {
  findUserByEmail,
  findUserById,
  insertUser,
  type UserRow,
} from "../db";

export interface PublicUser {
  id: string;
  email: string;
  name: string | null;
  role: string | null;
  createdAt: string;
  updatedAt: string;
}

function toPublic(row: UserRow): PublicUser {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const SCRYPT_KEYLEN = 64;

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, SCRYPT_KEYLEN);
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  const salt = Buffer.from(parts[1], "hex");
  const expected = Buffer.from(parts[2], "hex");
  const actual = crypto.scryptSync(password, salt, SCRYPT_KEYLEN);
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

export function signToken(user: PublicUser): string {
  return jwt.sign({ email: user.email }, JWT_SECRET, {
    subject: user.id,
    expiresIn: JWT_EXPIRES_IN,
  } as jwt.SignOptions);
}

export interface RegisterResult {
  ok: boolean;
  user?: PublicUser;
  error?: string;
}

export function registerUser(input: {
  email: string;
  password: string;
  name?: string;
  role?: string;
}): RegisterResult {
  const email = input.email.trim().toLowerCase();
  if (!email || !email.includes("@")) return { ok: false, error: "A valid email is required." };
  if (!input.password || input.password.length < 8) {
    return { ok: false, error: "Password must be at least 8 characters." };
  }
  if (findUserByEmail(email)) {
    return { ok: false, error: "An account with that email already exists." };
  }
  const now = new Date().toISOString();
  const row: UserRow = {
    id: randomUUID(),
    email,
    password_hash: hashPassword(input.password),
    name: input.name?.trim() || null,
    role: input.role || null,
    created_at: now,
    updated_at: now,
  };
  insertUser(row);
  return { ok: true, user: toPublic(row) };
}

export function authenticateUser(email: string, password: string): PublicUser | null {
  const row = findUserByEmail(email.trim().toLowerCase());
  if (!row) return null;
  if (!verifyPassword(password, row.password_hash)) return null;
  return toPublic(row);
}

export function getUserById(id: string): PublicUser | null {
  const row = findUserById(id);
  return row ? toPublic(row) : null;
}
