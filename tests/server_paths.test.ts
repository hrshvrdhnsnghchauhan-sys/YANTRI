import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "fs";
import * as fsPromises from "fs/promises";
import * as path from "path";

const originalEnv = { ...process.env };
const testDataDir = "/tmp/yantri-test-paths";

async function importModule() {
  return await import("../server_paths");
}

describe("server_paths", () => {
  beforeEach(() => {
    process.env.YANTRI_DATA_DIR = testDataDir;
    process.env.GEMINI_API_KEY = undefined;
    vi.resetModules();
    if (fs.existsSync(testDataDir)) {
      fs.rmSync(testDataDir, { recursive: true, force: true });
    }
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    if (fs.existsSync(testDataDir)) {
      fs.rmSync(testDataDir, { recursive: true, force: true });
    }
  });

  describe("DATA_DIR", () => {
    it("should use YANTRI_DATA_DIR env var when set", async () => {
      const serverPaths = await importModule();
      expect(serverPaths.DATA_DIR).toBe(testDataDir);
    });

    it("should fallback to cwd when YANTRI_DATA_DIR is not set", async () => {
      delete process.env.YANTRI_DATA_DIR;
      vi.resetModules();
      const serverPaths = await importModule();
      expect(serverPaths.DATA_DIR).toBe(process.cwd());
    });
  });

  describe("dataFile", () => {
    it("should return absolute path to file in data directory", async () => {
      const serverPaths = await importModule();
      const filePath = serverPaths.dataFile("test.json");
      expect(filePath).toBe(path.join(testDataDir, "test.json"));
    });
  });

  describe("getGeminiApiKey", () => {
    it("should return undefined when no key is set", async () => {
      const serverPaths = await importModule();
      expect(serverPaths.getGeminiApiKey()).toBeUndefined();
    });

    it("should return key from GEMINI_API_KEY env var", async () => {
      process.env.GEMINI_API_KEY = "env-api-key";
      vi.resetModules();
      const serverPaths = await importModule();
      expect(serverPaths.getGeminiApiKey()).toBe("env-api-key");
    });

    it("should return key from secrets.json when env var not set", async () => {
      const secretsFile = path.join(testDataDir, "secrets.json");
      fs.writeFileSync(secretsFile, JSON.stringify({ geminiApiKey: "file-api-key" }), "utf-8");
      vi.resetModules();
      const serverPaths = await importModule();
      expect(serverPaths.getGeminiApiKey()).toBe("file-api-key");
    });

    it("should prefer env var over secrets.json", async () => {
      process.env.GEMINI_API_KEY = "env-api-key";
      const secretsFile = path.join(testDataDir, "secrets.json");
      fs.writeFileSync(secretsFile, JSON.stringify({ geminiApiKey: "file-api-key" }), "utf-8");
      vi.resetModules();
      const serverPaths = await importModule();
      expect(serverPaths.getGeminiApiKey()).toBe("env-api-key");
    });
  });

  describe("hasGeminiApiKey", () => {
    it("should return false when no key is set", async () => {
      const serverPaths = await importModule();
      expect(serverPaths.hasGeminiApiKey()).toBe(false);
    });

    it("should return true when key is set via env", async () => {
      process.env.GEMINI_API_KEY = "test-key";
      vi.resetModules();
      const serverPaths = await importModule();
      expect(serverPaths.hasGeminiApiKey()).toBe(true);
    });

    it("should return true when key is set via secrets.json", async () => {
      const secretsFile = path.join(testDataDir, "secrets.json");
      fs.writeFileSync(secretsFile, JSON.stringify({ geminiApiKey: "test-key" }), "utf-8");
      vi.resetModules();
      const serverPaths = await importModule();
      expect(serverPaths.hasGeminiApiKey()).toBe(true);
    });
  });

  describe("setGeminiApiKey", () => {
    it("should write key to secrets.json", async () => {
      const serverPaths = await importModule();
      serverPaths.setGeminiApiKey("new-api-key");
      const secretsFile = path.join(testDataDir, "secrets.json");
      expect(fs.existsSync(secretsFile)).toBe(true);
      const content = JSON.parse(fs.readFileSync(secretsFile, "utf-8"));
      expect(content.geminiApiKey).toBe("new-api-key");
    });

    it("should throw error for empty key", async () => {
      const serverPaths = await importModule();
      expect(() => serverPaths.setGeminiApiKey("")).toThrow("API key must not be empty");
      expect(() => serverPaths.setGeminiApiKey("   ")).toThrow("API key must not be empty");
    });

    it("should trim whitespace from key", async () => {
      const serverPaths = await importModule();
      serverPaths.setGeminiApiKey("  trimmed-key  ");
      const secretsFile = path.join(testDataDir, "secrets.json");
      const content = JSON.parse(fs.readFileSync(secretsFile, "utf-8"));
      expect(content.geminiApiKey).toBe("trimmed-key");
    });
  });

  describe("clearGeminiApiKey", () => {
    it("should remove key from secrets.json", async () => {
      const serverPaths = await importModule();
      serverPaths.setGeminiApiKey("test-key");
      serverPaths.clearGeminiApiKey();
      const secretsFile = path.join(testDataDir, "secrets.json");
      const content = JSON.parse(fs.readFileSync(secretsFile, "utf-8"));
      expect(content.geminiApiKey).toBeUndefined();
    });

    it("should not throw when secrets.json does not exist", async () => {
      const serverPaths = await importModule();
      expect(() => serverPaths.clearGeminiApiKey()).not.toThrow();
    });
  });
});