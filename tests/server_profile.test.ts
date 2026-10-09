import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "fs";
import * as fsPromises from "fs/promises";
import * as path from "path";
import * as serverPaths from "../src/server/services/server_paths";
import * as serverProfile from "../src/server/services/server_profile";
import * as serverStorage from "../src/server/services/server_storage";

const originalEnv = { ...process.env };
const testDataDir = "/tmp/yantri-test-profile";

describe("server_profile", () => {
  beforeEach(() => {
    process.env.YANTRI_DATA_DIR = testDataDir;
    vi.resetModules();
    // Reset module internal state
    (serverProfile as any).cachedProfile = null;
  });

  afterEach(async () => {
    process.env = { ...originalEnv };
    if (fs.existsSync(testDataDir)) {
      fs.rmSync(testDataDir, { recursive: true, force: true });
    }
  });

  describe("loadProfile", () => {
    it("should return null when file does not exist", async () => {
      const profile = await serverProfile.loadProfile();
      expect(profile).toBeNull();
    });

    it("should load profile from file", async () => {
      const profileFile = serverPaths.dataFile("profile.json");
      await fsPromises.writeFile(profileFile, JSON.stringify({
        email: "test@example.com",
        name: "Test User",
        role: "student",
        features: ["calendar", "tasks"],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }), "utf-8");
      
      const profile = await serverProfile.loadProfile();
      expect(profile).not.toBeNull();
      expect(profile?.email).toBe("test@example.com");
      expect(profile?.role).toBe("student");
    });

    it("should cache profile after first load", async () => {
      const profileFile = serverPaths.dataFile("profile.json");
      await fsPromises.writeFile(profileFile, JSON.stringify({
        email: "test@example.com",
        name: "Test User",
        role: "student",
        features: ["calendar"],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }), "utf-8");
      
      const profile1 = await serverProfile.loadProfile();
      const profile2 = await serverProfile.loadProfile();
      
      expect(profile1).toBe(profile2);
    });
  });

  describe("saveProfile", () => {
    it("should save profile with required fields", async () => {
      const profile = await serverProfile.saveProfile({
        email: "test@example.com",
        name: "Test User",
        role: "student",
        features: ["calendar", "tasks"]
      });
      
      expect(profile.email).toBe("test@example.com");
      expect(profile.name).toBe("Test User");
      expect(profile.role).toBe("student");
      expect(profile.features).toEqual(["calendar", "tasks"]);
    });

    it("should throw error when email is missing", async () => {
      await expect(serverProfile.saveProfile({
        email: "",
        name: "Test User",
        role: "student",
        features: []
      })).rejects.toThrow("Email is required");
    });

    it("should normalize email to lowercase", async () => {
      const profile = await serverProfile.saveProfile({
        email: "TEST@EXAMPLE.COM",
        name: "Test User",
        role: "student",
        features: []
      });
      
      expect(profile.email).toBe("test@example.com");
    });

    it("should update existing profile preserving createdAt", async () => {
      await serverProfile.saveProfile({
        email: "test@example.com",
        name: "Original Name",
        role: "student",
        features: ["calendar"]
      });
      
      const updated = await serverProfile.saveProfile({
        email: "test@example.com",
        name: "Updated Name",
        role: "professional",
        features: ["calendar", "email"]
      });
      
      expect(updated.name).toBe("Updated Name");
      expect(updated.role).toBe("professional");
      expect(updated.features).toEqual(["calendar", "email"]);
      expect(updated.createdAt).not.toBe(updated.updatedAt);
    });

    it("should persist profile to file", async () => {
      await serverProfile.saveProfile({
        email: "test@example.com",
        name: "Test User",
        role: "student",
        features: ["calendar"]
      });
      
      const profileFile = serverPaths.dataFile("profile.json");
      const data = JSON.parse(await fsPromises.readFile(profileFile, "utf-8"));
      expect(data.email).toBe("test@example.com");
    });
  });

  describe("hasProfile", () => {
    it("should return false when no profile exists", async () => {
      expect(await serverProfile.hasProfile()).toBe(false);
    });

    it("should return true when profile exists", async () => {
      await serverProfile.saveProfile({
        email: "test@example.com",
        name: "Test User",
        role: "student",
        features: []
      });
      
      expect(await serverProfile.hasProfile()).toBe(true);
    });
  });

  describe("getAllowedToolNames", () => {
    it("should return null when no profile exists", async () => {
      const tools = await serverProfile.getAllowedToolNames();
      expect(tools).toBeNull();
    });

    it("should return allowed tools for profile", async () => {
      await serverProfile.saveProfile({
        email: "test@example.com",
        name: "Test User",
        role: "student",
        features: ["calendar", "tasks"]
      });
      
      const tools = await serverProfile.getAllowedToolNames();
      expect(tools).not.toBeNull();
      expect(tools).toBeInstanceOf(Set);
    });
  });

  describe("buildPersonaBlock", () => {
    it("should return empty string for null profile", () => {
      expect(serverProfile.buildPersonaBlock(null)).toBe("");
    });

    it("should build persona block for student role", () => {
      const profile = {
        email: "test@example.com",
        name: "Student",
        role: "student" as const,
        features: ["calendar", "tasks"],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      
      const block = serverProfile.buildPersonaBlock(profile);
      
      expect(block).toContain("STUDENT");
      expect(block).toContain("academic companion");
      expect(block).toContain("calendar");
      expect(block).toContain("tasks");
    });

    it("should build persona block for professional role", () => {
      const profile = {
        email: "test@example.com",
        name: "Professional",
        role: "professional" as const,
        features: ["email", "meetings"],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      
      const block = serverProfile.buildPersonaBlock(profile);
      
      expect(block).toContain("WORKING PROFESSIONAL");
      expect(block).toContain("workplace efficiency partner");
      expect(block).toContain("email");
      expect(block).toContain("meetings");
    });

    it("should build persona block for business_owner role", () => {
      const profile = {
        email: "test@example.com",
        name: "Owner",
        role: "business_owner" as const,
        features: ["inventory", "sales"],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      
      const block = serverProfile.buildPersonaBlock(profile);
      
      expect(block).toContain("BUSINESS OWNER");
      expect(block).toContain("business operations assistant");
      expect(block).toContain("inventory");
      expect(block).toContain("sales");
    });

    it("should handle no features selected", () => {
      const profile = {
        email: "test@example.com",
        name: "User",
        role: "student" as const,
        features: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      
      const block = serverProfile.buildPersonaBlock(profile);
      
      expect(block).toContain("(none selected yet");
    });
  });

  describe("buildPersonaBlockAsync", () => {
    it("should return empty string when no profile", async () => {
      const block = await serverProfile.buildPersonaBlockAsync();
      expect(block).toBe("");
    });

    it("should return persona block when profile exists", async () => {
      await serverProfile.saveProfile({
        email: "test@example.com",
        name: "Test User",
        role: "student",
        features: ["calendar"]
      });
      
      const block = await serverProfile.buildPersonaBlockAsync();
      
      expect(block).toContain("STUDENT");
      expect(block).toContain("calendar");
    });
  });
});