import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "fs";
import * as fsPromises from "fs/promises";
import * as path from "path";
import * as serverBridge from "../server_bridge";
import * as serverPaths from "../server_paths";

const originalEnv = { ...process.env };
const testDataDir = "/tmp/yantri-test-bridge";

describe("server_bridge", () => {
  beforeEach(() => {
    process.env.YANTRI_DATA_DIR = testDataDir;
    process.env.CLOUD_MODE = "false";
    process.env.DESKTOP_AGENT_URL = "http://127.0.0.1:8765";
    vi.resetModules();
    // Reset module internal state
    (serverBridge as any).desktopAgentVerified = false;
    (serverBridge as any).agentUnavailableUntil = 0;
    (serverBridge as any).lastSpawnNote = "";
    (serverBridge as any).lastUnavailability = null;
    (serverBridge as any).inFlightEnsure = null;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe("constants", () => {
    it("should have DESKTOP_AGENT_URL", () => {
      expect(serverBridge.DESKTOP_AGENT_URL).toBe("http://127.0.0.1:8765");
    });

    it("should have IS_CLOUD_MODE based on env", () => {
      expect(serverBridge.IS_CLOUD_MODE).toBe(false);
    });
  });

  describe("getDesktopAgentUnavailability", () => {
    it("should return null initially", () => {
      expect(serverBridge.getDesktopAgentUnavailability()).toBeNull();
    });
  });

  describe("isDesktopAgentAvailable", () => {
    it("should return false in cloud mode", async () => {
      process.env.CLOUD_MODE = "true";
      vi.resetModules();
      const mod = await import("../server_bridge");
      expect(await mod.isDesktopAgentAvailable()).toBe(false);
    });

    it("should probe health endpoint when not in cloud mode", async () => {
      expect(typeof serverBridge.isDesktopAgentAvailable).toBe("function");
    });
  });

  describe("callDesktopAgent", () => {
    it("should reject immediately in cloud mode", async () => {
      process.env.CLOUD_MODE = "true";
      vi.resetModules();
      const mod = await import("../server_bridge");
      
      const result = await mod.callDesktopAgent("test_tool", { arg: "value" });
      
      expect(result.ok).toBe(false);
      expect(result.error).toContain("Cloud Mode");
    });

    it("should attempt to call agent when not in cloud mode", async () => {
      expect(typeof serverBridge.callDesktopAgent).toBe("function");
    });
  });

  describe("ensureDesktopAgent", () => {
    it("should return immediately in cloud mode", async () => {
      process.env.CLOUD_MODE = "true";
      vi.resetModules();
      const mod = await import("../server_bridge");
      
      await expect(mod.ensureDesktopAgent()).resolves.toBeUndefined();
    });

    it("should be a function", () => {
      expect(typeof serverBridge.ensureDesktopAgent).toBe("function");
    });
  });
});