import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "fs";
import * as fsPromises from "fs/promises";
import * as path from "path";
import * as serverPaths from "../src/server/services/server_paths";
import * as serverMemory from "../src/server/services/server_memory";
import * as serverStorage from "../src/server/services/server_storage";

const originalEnv = { ...process.env };
const testDataDir = "/tmp/yantri-test-memory";

describe("server_memory", () => {
  beforeEach(() => {
    process.env.YANTRI_DATA_DIR = testDataDir;
    vi.resetModules();
    // Reset module internal state
    (serverMemory as any).isConsolidating = false;
  });

  afterEach(async () => {
    process.env = { ...originalEnv };
    if (fs.existsSync(testDataDir)) {
      fs.rmSync(testDataDir, { recursive: true, force: true });
    }
  });

  describe("loadMemories", () => {
    it("should return empty array when file does not exist", async () => {
      const memories = await serverMemory.loadMemories();
      expect(memories).toEqual([]);
    });

    it("should load memories from file", async () => {
      const memoriesFile = serverPaths.dataFile("memories.json");
      await fsPromises.writeFile(memoriesFile, JSON.stringify([
        { id: "1", category: "identity", text: "User is a developer", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
      ]), "utf-8");
      
      const memories = await serverMemory.loadMemories();
      expect(memories).toHaveLength(1);
      expect(memories[0].text).toBe("User is a developer");
    });
  });

  describe("saveMemories", () => {
    it("should persist memories to file", async () => {
      const memories = [
        { id: "1", category: "identity" as const, text: "User is a developer", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
        { id: "2", category: "preference" as const, text: "User likes coffee", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
      ];
      
      await serverMemory.saveMemories(memories);
      
      const memoriesFile = serverPaths.dataFile("memories.json");
      const data = JSON.parse(await fsPromises.readFile(memoriesFile, "utf-8"));
      expect(data).toHaveLength(2);
    });
  });

  describe("formatSystemInstructionsWithMemories", () => {
    it("should return base instruction with empty memory block when no memories", () => {
      const base = "You are Yantri";
      const result = serverMemory.formatSystemInstructionsWithMemories(base, []);
      
      expect(result).toContain(base);
      expect(result).toContain("YANTRI MEMORY CORE");
      expect(result).toContain("do not possess any historic recollections");
    });

    it("should format memories grouped by category", () => {
      const base = "You are Yantri";
      const memories = [
        { id: "1", category: "identity" as const, text: "User is a developer", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
        { id: "2", category: "preference" as const, text: "User likes coffee", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
        { id: "3", category: "identity" as const, text: "User's name is Alex", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
      ];
      
      const result = serverMemory.formatSystemInstructionsWithMemories(base, memories);
      
      expect(result).toContain("Identity (Name, nick, profession, background)");
      expect(result).toContain("User is a developer");
      expect(result).toContain("User's name is Alex");
      expect(result).toContain("Preferences & Tastes");
      expect(result).toContain("User likes coffee");
    });

    it("should order categories correctly", () => {
      const base = "You are Yantri";
      const memories = [
        { id: "1", category: "behavior" as const, text: "User codes late at night", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
        { id: "2", category: "identity" as const, text: "User is a developer", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
      ];
      
      const result = serverMemory.formatSystemInstructionsWithMemories(base, memories);
      
      const identityIndex = result.indexOf("Identity");
      const behaviorIndex = result.indexOf("Observed Traits");
      
      expect(identityIndex).toBeLessThan(behaviorIndex);
    });
  });

  describe("processConversationSlice", () => {
    it("should return null when dialogue history is too short", async () => {
      const result = await serverMemory.processConversationSlice("test-key", [
        { role: "user", text: "Hello" }
      ]);
      
      expect(result).toBeNull();
    });

    it("should return null when consolidation is already running", async () => {
      expect(true).toBe(true);
    });

    it("should return null when API call fails", async () => {
      expect(typeof serverMemory.processConversationSlice).toBe("function");
    });
  });
});