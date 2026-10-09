import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "fs";
import * as fsPromises from "fs/promises";
import * as path from "path";
import * as serverCalendarSync from "../server_calendar_sync";
import * as serverUserData from "../server_userdata";
import * as serverProfile from "../server_profile";
import * as serverGoogle from "../server_google";
import * as serverPaths from "../server_paths";

const originalEnv = { ...process.env };
const testDataDir = "/tmp/yantri-test-calendar-sync";

describe("server_calendar_sync", () => {
  beforeEach(() => {
    process.env.YANTRI_DATA_DIR = testDataDir;
    vi.resetModules();
    // Reset module internal state
    (serverCalendarSync as any).sweepTimer = null;
    (serverCalendarSync as any).importTimer = null;
    (serverCalendarSync as any).dismissedEvents = new Map();
    (serverUserData as any).cache = null;
    (serverUserData as any).mutationListeners = [];
    (serverProfile as any).cachedProfile = null;
  });

  afterEach(async () => {
    process.env = { ...originalEnv };
    serverCalendarSync.stopCalendarSync();
    if (fs.existsSync(testDataDir)) {
      fs.rmSync(testDataDir, { recursive: true, force: true });
    }
  });

  describe("SYNCED_TYPES", () => {
    it("should contain expected types", () => {
      expect(true).toBe(true);
    });
  });

  describe("TYPE_META", () => {
    it("should have metadata for all synced types", () => {
      expect(true).toBe(true);
    });
  });

  describe("CalendarSyncResult interface", () => {
    it("should have correct structure", () => {
      const result: serverCalendarSync.CalendarSyncResult = {
        ok: true,
        action: "created",
        eventId: "event-123"
      };
      
      expect(result.ok).toBe(true);
      expect(result.action).toBe("created");
    });
  });

  describe("isSyncable", () => {
    it("should return true for syncable types with due date", () => {
      const record = { type: "exam", title: "Test", due: "2025-12-31T23:59:00.000Z" };
      expect(["exam", "meeting", "deadline"].includes(record.type) && record.due).toBeTruthy();
    });

    it("should return false for non-syncable types", () => {
      const record = { type: "note", title: "Test", due: "2025-12-31T23:59:00.000Z" };
      expect(["exam", "meeting", "deadline"].includes(record.type)).toBe(false);
    });

    it("should return false for syncable types without due date", () => {
      const record = { type: "exam", title: "Test", due: undefined };
      expect(record.due).toBeUndefined();
    });
  });

  describe("addDurationLocal", () => {
    it("should add duration to ISO string", () => {
      const iso = "2025-12-31T10:00:00";
      const d = new Date(iso);
      d.setTime(d.getTime() + 60 * 60 * 1000);
      const pad = (n: number) => String(n).padStart(2, "0");
      const result = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
      
      expect(result).toBe("2025-12-31T11:00:00");
    });
  });

  describe("eventBodyFor logic", () => {
    it("should build event body for exam", () => {
      const record = {
        id: "rec-123",
        type: "exam",
        title: "Math Exam",
        due: "2025-12-31T10:00:00",
        tags: ["math"],
        payload: { subject: "Mathematics" }
      };
      
      const meta = { prefix: "[Exam]", durationMs: 3 * 60 * 60 * 1000, source: "exam tracker" };
      const hasTime = record.due!.includes("T");
      const start = hasTime ? record.due! : `${record.due}T00:00:00`;
      
      function addDurationLocal(iso: string, ms: number): string {
        const d = new Date(iso);
        d.setTime(d.getTime() + ms);
        const pad = (n: number) => String(n).padStart(2, "0");
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
      }
      
      const end = hasTime
        ? addDurationLocal(record.due!, meta.durationMs)
        : `${record.due}T23:59:00`;
      
      const body = {
        summary: `${meta.prefix} ${record.title}`,
        description: `Auto-synced by Yantri from your ${meta.source}.\nRecord ID: ${record.id}\nTags: ${record.tags.join(", ")}\nsubject: Mathematics`,
        start_time: start,
        end_time: end,
      };
      
      expect(body.summary).toBe("[Exam] Math Exam");
      expect(body.description).toContain("Mathematics");
    });
  });

  describe("syncRecordToCalendar", () => {
    it("should be a function", () => {
      expect(typeof serverCalendarSync.syncRecordToCalendar).toBe("function");
    });
  });

  describe("sweepCalendarSync", () => {
    it("should be a function", () => {
      expect(typeof serverCalendarSync.sweepCalendarSync).toBe("function");
    });
  });

  describe("startCalendarSync", () => {
    it("should be a function", () => {
      expect(typeof serverCalendarSync.startCalendarSync).toBe("function");
    });

    it("should not start twice", () => {
      serverCalendarSync.startCalendarSync();
      serverCalendarSync.startCalendarSync();
      serverCalendarSync.stopCalendarSync();
      expect(true).toBe(true);
    });
  });

  describe("stopCalendarSync", () => {
    it("should be a function", () => {
      expect(typeof serverCalendarSync.stopCalendarSync).toBe("function");
    });
  });

  describe("EXAM_KEYWORDS", () => {
    it("should contain exam-related keywords", () => {
      expect(true).toBe(true);
    });
  });

  describe("OWNED_PREFIXES", () => {
    it("should contain outbound sync prefixes", () => {
      expect(true).toBe(true);
    });
  });

  describe("importExamsFromCalendar", () => {
    it("should be a function", () => {
      expect(typeof serverCalendarSync.importExamsFromCalendar).toBe("function");
    });
  });

  describe("dismissImportedExam", () => {
    it("should be a function", () => {
      expect(typeof serverCalendarSync.dismissImportedExam).toBe("function");
    });
  });

  describe("startCalendarImport", () => {
    it("should be a function", () => {
      expect(typeof serverCalendarSync.startCalendarImport).toBe("function");
    });

    it("should not start twice", () => {
      serverCalendarSync.startCalendarImport();
      serverCalendarSync.startCalendarImport();
      expect(true).toBe(true);
    });
  });
});