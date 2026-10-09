import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "fs";
import * as path from "path";

const dir = "/tmp/yantri-test-auth";

let auth: typeof import("../src/server/services/auth");
let db: typeof import("../src/server/db");

beforeAll(async () => {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  process.env.YANTRI_DB_FILE = path.join(dir, "test.db");
  db = await import("../src/server/db");
  db.initStorage();
  auth = await import("../src/server/services/auth");
});

afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true });
  delete process.env.YANTRI_DB_FILE;
});

describe("auth service", () => {
  it("hashes and verifies passwords (never stores plaintext)", () => {
    const hash = auth.hashPassword("password123");
    expect(hash).not.toContain("password123");
    expect(hash.startsWith("scrypt$")).toBe(true);
    expect(auth.verifyPassword("password123", hash)).toBe(true);
    expect(auth.verifyPassword("wrong", hash)).toBe(false);
  });

  it("registers a user and authenticates them", () => {
    const result = auth.registerUser({ email: "User@Example.com", password: "password123", name: "User" });
    expect(result.ok).toBe(true);
    expect(result.user?.email).toBe("user@example.com");

    const authed = auth.authenticateUser("user@example.com", "password123");
    expect(authed?.id).toBe(result.user?.id);
    expect(auth.authenticateUser("user@example.com", "wrong-password")).toBeNull();
  });

  it("rejects duplicate emails", () => {
    auth.registerUser({ email: "dup@example.com", password: "password123" });
    const second = auth.registerUser({ email: "dup@example.com", password: "password123" });
    expect(second.ok).toBe(false);
    expect(second.error).toMatch(/exists/i);
  });

  it("rejects short passwords and invalid emails", () => {
    expect(auth.registerUser({ email: "x@y.com", password: "short" }).ok).toBe(false);
    expect(auth.registerUser({ email: "not-an-email", password: "password123" }).ok).toBe(false);
  });

  it("signs a verifiable JWT", () => {
    const result = auth.registerUser({ email: "jwt@example.com", password: "password123" });
    const token = auth.signToken(result.user!);
    expect(typeof token).toBe("string");
    expect(token.split(".").length).toBe(3);
  });

  it("returns a public user by id", () => {
    const result = auth.registerUser({ email: "byid@example.com", password: "password123" });
    const found = auth.getUserById(result.user!.id);
    expect(found?.email).toBe("byid@example.com");
    expect(found).not.toHaveProperty("password_hash");
  });
});
