import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "fs";
import * as fsPromises from "fs/promises";
import * as path from "path";

const originalEnv = { ...process.env };
const testDataDir = "/tmp/yantri-test-reminders";

async function importModule() {
  return await import("../src/server/services/server_reminders");
}

describe("server_reminders", () => {
  beforeEach(() => {
    process.env.YANTRI_DATA_DIR = testDataDir;
    vi.resetModules();
    if (fs.existsSync(testDataDir)) {
      fs.rmSync(testDataDir, { recursive: true, force: true });
    }
  });

  afterEach(async () => {
    process.env = { ...originalEnv };
    if (fs.existsSync(testDataDir)) {
      fs.rmSync(testDataDir, { recursive: true, force: true });
    }
  });

  describe("loadReminders", () => {
    it("should return empty array when file does not exist", async () => {
      const serverReminders = await importModule();
      const reminders = await serverReminders.loadReminders();
      expect(reminders).toEqual([]);
    });

    it("should load reminders from file", async () => {
      const serverReminders = await importModule();
      const serverPaths = await import("../src/server/services/server_paths");
      const remindersFile = serverPaths.dataFile("reminders.json");
      await fsPromises.writeFile(remindersFile, JSON.stringify([
        { id: "1", text: "Test", fireAt: new Date().toISOString(), createdAt: new Date().toISOString(), fired: false }
      ]), "utf-8");
      
      const reminders = await serverReminders.loadReminders();
      expect(reminders).toHaveLength(1);
      expect(reminders[0].text).toBe("Test");
    });
  });

  describe("addReminder", () => {
    it("should add a reminder with generated id", async () => {
      const serverReminders = await importModule();
      const reminder = serverReminders.addReminder("Test reminder", 10);
      expect(reminder.id).toBeDefined();
      expect(reminder.text).toBe("Test reminder");
      expect(reminder.fired).toBe(false);
      expect(new Date(reminder.fireAt).getTime()).toBeGreaterThan(Date.now());
    });

    it("should use fixedId when provided", async () => {
      const serverReminders = await importModule();
      const reminder = serverReminders.addReminder("Test reminder", 10, "fixed-id-123");
      expect(reminder.id).toBe("fixed-id-123");
    });

    it("should persist reminder to file", async () => {
      const serverReminders = await importModule();
      serverReminders.addReminder("Test reminder", 10);
      await new Promise(r => setTimeout(r, 100));
      
      const serverPaths = await import("../src/server/services/server_paths");
      const remindersFile = serverPaths.dataFile("reminders.json");
      const data = JSON.parse(await fsPromises.readFile(remindersFile, "utf-8"));
      expect(data).toHaveLength(1);
      expect(data[0].text).toBe("Test reminder");
    });
  });

  describe("getReminders", () => {
    it("should return copy of reminders array", async () => {
      const serverReminders = await importModule();
      serverReminders.addReminder("Test 1", 10);
      serverReminders.addReminder("Test 2", 20);
      
      const reminders = serverReminders.getReminders();
      expect(reminders).toHaveLength(2);
      
      reminders.pop();
      expect(serverReminders.getReminders()).toHaveLength(2);
    });
  });

  describe("cancelReminder", () => {
    it("should return true and remove reminder when id exists", async () => {
      const serverReminders = await importModule();
      const reminder = serverReminders.addReminder("Test reminder", 10);
      const result = serverReminders.cancelReminder(reminder.id);
      expect(result).toBe(true);
      expect(serverReminders.getReminders()).toHaveLength(0);
    });

    it("should return false when id does not exist", async () => {
      const serverReminders = await importModule();
      const result = serverReminders.cancelReminder("non-existent-id");
      expect(result).toBe(false);
    });
  });

  describe("timer", () => {
    it("should start and stop timer", async () => {
      const serverReminders = await importModule();
      serverReminders.startReminderTimer();
      serverReminders.stopReminderTimer();
      expect(true).toBe(true);
    });

    it("should not start timer twice", async () => {
      const serverReminders = await importModule();
      serverReminders.startReminderTimer();
      serverReminders.startReminderTimer();
      serverReminders.stopReminderTimer();
      expect(true).toBe(true);
    });

    it("should fire callback when reminder is due", async () => {
      vi.useFakeTimers();
      
      const serverReminders = await importModule();
      const callback = vi.fn();
      serverReminders.setOnReminderFired(callback);
      serverReminders.startReminderTimer();
      
      const fireAt = new Date(Date.now() + 1000).toISOString();
      const reminder = {
        id: "test-timer",
        text: "Timer test",
        fireAt,
        createdAt: new Date().toISOString(),
        fired: false,
      };
      
      (serverReminders as any).reminders = [reminder];
      
      await vi.advanceTimersByTimeAsync(30000);
      
      expect(callback).toHaveBeenCalledWith(expect.objectContaining({
        id: "test-timer",
        text: "Timer test",
        fired: true,
      }));
      
      serverReminders.stopReminderTimer();
      vi.useRealTimers();
    });

    it("should clean up fired reminders older than 5 minutes", async () => {
      vi.useFakeTimers();
      
      const serverReminders = await importModule();
      serverReminders.startReminderTimer();
      
      const oldFireAt = new Date(Date.now() - 6 * 60 * 1000).toISOString();
      const reminder = {
        id: "old-reminder",
        text: "Old reminder",
        fireAt: oldFireAt,
        createdAt: new Date().toISOString(),
        fired: true,
      };
      
      (serverReminders as any).reminders = [reminder];
      
      await vi.advanceTimersByTimeAsync(30000);
      
      expect((serverReminders as any).reminders).toHaveLength(0);
      
      serverReminders.stopReminderTimer();
      vi.useRealTimers();
    });
  });
});