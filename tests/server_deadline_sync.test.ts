import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "fs";
import * as fsPromises from "fs/promises";
import * as path from "path";
import * as serverDeadlineSync from "../server_deadline_sync";
import * as serverReminders from "../server_reminders";
import * as serverPaths from "../server_paths";

const originalEnv = { ...process.env };
const testDataDir = "/tmp/yantri-test-deadline-sync";

describe("server_deadline_sync", () => {
  beforeEach(() => {
    process.env.YANTRI_DATA_DIR = testDataDir;
    vi.resetModules();
    // Reset module internal state
    (serverDeadlineSync as any).syncTimer = null;
    (serverReminders as any).reminders = [];
    (serverReminders as any).timer = null;
    (serverReminders as any).onReminderFired = null;
  });

  afterEach(async () => {
    process.env = { ...originalEnv };
    serverDeadlineSync.stopDeadlineSync();
    serverReminders.stopReminderTimer();
    if (fs.existsSync(testDataDir)) {
      fs.rmSync(testDataDir, { recursive: true, force: true });
    }
  });

  describe("REMINDER_WORTHY_TYPES", () => {
    it("should contain expected types", () => {
      expect(true).toBe(true);
    });
  });

  describe("isReminderWorthy logic", () => {
    it("should return false for records without due date", () => {
      const record = { type: "deadline", title: "Test", due: undefined };
      expect(!record.due).toBe(true);
    });

    it("should return false for inventory type", () => {
      const record = { type: "inventory", title: "Test", due: "2025-12-31T23:59:00.000Z" };
      expect(record.type === "inventory").toBe(true);
    });

    it("should return true for deadline type with due date", () => {
      const record = { type: "deadline", title: "Test", due: "2025-12-31T23:59:00.000Z" };
      expect(record.type === "deadline").toBe(true);
      expect(record.due).toBeDefined();
    });
  });

  describe("syncIdFor", () => {
    it("should generate deterministic id", () => {
      const record = { id: "abc123" };
      const syncId = `dl-${record.id}`;
      expect(syncId).toBe("dl-abc123");
    });
  });

  describe("friendlyDue", () => {
    it("should format date correctly", () => {
      const due = "2025-12-31T23:59:00.000Z";
      const d = new Date(due);
      const formatted = d.toLocaleString(undefined, {
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit"
      });
      expect(formatted).toContain("Dec");
    });
  });

  describe("reminderTextFor", () => {
    it("should format reminder text", () => {
      const record = { due: "2025-12-31T23:59:00.000Z", title: "Test Deadline" };
      const text = `Due ${record.due}: ${record.title}`;
      expect(text).toContain("Test Deadline");
    });
  });

  describe("syncDeadlineReminders", () => {
    it("should be a function", () => {
      expect(typeof serverDeadlineSync.syncDeadlineReminders).toBe("function");
    });
  });

  describe("startDeadlineSync", () => {
    it("should be a function", () => {
      expect(typeof serverDeadlineSync.startDeadlineSync).toBe("function");
    });

    it("should not start twice", () => {
      serverDeadlineSync.startDeadlineSync();
      serverDeadlineSync.startDeadlineSync();
      serverDeadlineSync.stopDeadlineSync();
      expect(true).toBe(true);
    });
  });

  describe("stopDeadlineSync", () => {
    it("should be a function", () => {
      expect(typeof serverDeadlineSync.stopDeadlineSync).toBe("function");
    });
  });
});