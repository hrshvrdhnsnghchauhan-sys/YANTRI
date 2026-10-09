import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "fs";
import * as fsPromises from "fs/promises";
import * as path from "path";
import * as serverPaths from "../server_paths";
import * as serverUserData from "../server_userdata";
import * as serverProfile from "../server_profile";
import * as serverStorage from "../server_storage";

const originalEnv = { ...process.env };
const testDataDir = "/tmp/yantri-test-userdata";

describe("server_userdata", () => {
  beforeEach(() => {
    process.env.YANTRI_DATA_DIR = testDataDir;
    vi.resetModules();
    // Reset module internal state
    (serverUserData as any).cache = null;
    (serverUserData as any).mutationListeners = [];
  });

  afterEach(async () => {
    process.env = { ...originalEnv };
    if (fs.existsSync(testDataDir)) {
      fs.rmSync(testDataDir, { recursive: true, force: true });
    }
  });

  describe("saveRecord", () => {
    it("should create a new record with generated id", async () => {
      const record = await serverUserData.saveRecord({
        type: "deadline",
        title: "Assignment due",
        payload: { subject: "Math", marks: 100 },
        due: "2025-12-31T23:59:00.000Z",
        tags: ["urgent", "math"]
      });
      
      expect(record.id).toBeDefined();
      expect(record.type).toBe("deadline");
      expect(record.title).toBe("Assignment due");
      expect(record.payload).toEqual({ subject: "Math", marks: 100 });
      expect(record.due).toBe("2025-12-31T23:59:00.000Z");
      expect(record.tags).toEqual(["urgent", "math"]);
    });

    it("should throw error when type is missing", async () => {
      await expect(serverUserData.saveRecord({
        title: "Test"
      } as any)).rejects.toThrow("type and title are required");
    });

    it("should throw error when title is missing", async () => {
      await expect(serverUserData.saveRecord({
        type: "test"
      } as any)).rejects.toThrow("type and title are required");
    });

    it("should use provided id for update", async () => {
      const created = await serverUserData.saveRecord({
        type: "note",
        title: "Original title"
      });
      
      const updated = await serverUserData.saveRecord({
        id: created.id,
        type: "note",
        title: "Updated title"
      });
      
      expect(updated.id).toBe(created.id);
      expect(updated.title).toBe("Updated title");
    });

    it("should throw error when updating non-existent id", async () => {
      await expect(serverUserData.saveRecord({
        id: "non-existent",
        type: "note",
        title: "Test"
      })).rejects.toThrow("Record not found");
    });

    it("should associate record with current user email", async () => {
      await serverProfile.saveProfile({
        email: "test@example.com",
        name: "Test User",
        role: "student",
        features: []
      });
      
      const record = await serverUserData.saveRecord({
        type: "note",
        title: "Test note"
      });
      
      expect(record.email).toBe("test@example.com");
    });
  });

  describe("queryRecords", () => {
    beforeEach(async () => {
      await serverProfile.saveProfile({
        email: "test@example.com",
        name: "Test User",
        role: "student",
        features: []
      });
      
      await serverUserData.saveRecord({ type: "deadline", title: "Math assignment", due: "2025-12-31T23:59:00.000Z", tags: ["math"] });
      await serverUserData.saveRecord({ type: "deadline", title: "Physics assignment", due: "2025-12-30T23:59:00.000Z", tags: ["physics"] });
      await serverUserData.saveRecord({ type: "note", title: "Study notes", tags: ["math", "review"] });
      await serverUserData.saveRecord({ type: "flashcard", title: "Flashcard 1", payload: { front: "Q", back: "A" } });
    });

    it("should return all records for current user", async () => {
      const records = await serverUserData.queryRecords({});
      expect(records).toHaveLength(4);
    });

    it("should filter by type", async () => {
      const records = await serverUserData.queryRecords({ type: "deadline" });
      expect(records).toHaveLength(2);
      expect(records.every(r => r.type === "deadline")).toBe(true);
    });

    it("should filter by multiple types", async () => {
      const records = await serverUserData.queryRecords({ type: ["deadline", "note"] });
      expect(records).toHaveLength(3);
    });

    it("should filter by tag", async () => {
      const records = await serverUserData.queryRecords({ tag: "math" });
      expect(records).toHaveLength(2);
      expect(records.every(r => r.tags.includes("math"))).toBe(true);
    });

    it("should filter by dueBefore", async () => {
      const records = await serverUserData.queryRecords({ dueBefore: "2025-12-31T00:00:00.000Z" });
      expect(records).toHaveLength(1);
      expect(records[0].title).toBe("Physics assignment");
    });

    it("should filter by dueAfter", async () => {
      const records = await serverUserData.queryRecords({ dueAfter: "2025-12-31T00:00:00.000Z" });
      expect(records).toHaveLength(1);
      expect(records[0].title).toBe("Math assignment");
    });

    it("should search by title and payload", async () => {
      const records = await serverUserData.queryRecords({ search: "Math" });
      expect(records).toHaveLength(2);
    });

    it("should limit results", async () => {
      const records = await serverUserData.queryRecords({ limit: 2 });
      expect(records).toHaveLength(2);
    });

    it("should sort by due date ascending, undated last", async () => {
      const records = await serverUserData.queryRecords({ type: "deadline" });
      expect(records[0].title).toBe("Physics assignment");
      expect(records[1].title).toBe("Math assignment");
    });
  });

  describe("updateRecord", () => {
    it("should update record fields", async () => {
      await serverProfile.saveProfile({
        email: "test@example.com",
        name: "Test User",
        role: "student",
        features: []
      });
      
      const created = await serverUserData.saveRecord({
        type: "note",
        title: "Original",
        payload: { key: "value" }
      });
      
      const updated = await serverUserData.updateRecord(created.id, {
        title: "Updated",
        payload: { key: "new value", extra: "data" }
      });
      
      expect(updated).not.toBeNull();
      expect(updated?.title).toBe("Updated");
      expect(updated?.payload).toEqual({ key: "new value", extra: "data" });
      expect(updated?.updatedAt).not.toBe(created.updatedAt);
    });

    it("should return null for non-existent id", async () => {
      const result = await serverUserData.updateRecord("non-existent", { title: "Test" });
      expect(result).toBeNull();
    });
  });

  describe("deleteRecord", () => {
    it("should delete record and return true", async () => {
      await serverProfile.saveProfile({
        email: "test@example.com",
        name: "Test User",
        role: "student",
        features: []
      });
      
      const created = await serverUserData.saveRecord({
        type: "note",
        title: "To delete"
      });
      
      const result = await serverUserData.deleteRecord(created.id);
      expect(result).toBe(true);
      
      const records = await serverUserData.queryRecords({});
      expect(records).toHaveLength(0);
    });

    it("should return false for non-existent id", async () => {
      const result = await serverUserData.deleteRecord("non-existent");
      expect(result).toBe(false);
    });
  });

  describe("countByType", () => {
    it("should return counts grouped by type", async () => {
      await serverProfile.saveProfile({
        email: "test@example.com",
        name: "Test User",
        role: "student",
        features: []
      });
      
      await serverUserData.saveRecord({ type: "deadline", title: "D1" });
      await serverUserData.saveRecord({ type: "deadline", title: "D2" });
      await serverUserData.saveRecord({ type: "note", title: "N1" });
      await serverUserData.saveRecord({ type: "flashcard", title: "F1" });
      
      const counts = await serverUserData.countByType();
      expect(counts).toEqual({
        deadline: 2,
        note: 1,
        flashcard: 1
      });
    });

    it("should return empty object when no records", async () => {
      await serverProfile.saveProfile({
        email: "test@example.com",
        name: "Test User",
        role: "student",
        features: []
      });
      
      const counts = await serverUserData.countByType();
      expect(counts).toEqual({});
    });
  });

  describe("patchRecordSilent", () => {
    it("should update record without firing mutation listeners", async () => {
      await serverProfile.saveProfile({
        email: "test@example.com",
        name: "Test User",
        role: "student",
        features: []
      });
      
      const created = await serverUserData.saveRecord({
        type: "deadline",
        title: "Exam",
        due: "2025-12-31T23:59:00.000Z"
      });
      
      const updated = await serverUserData.patchRecordSilent(created.id, {
        payload: { calendarEventId: "cal-123" }
      });
      
      expect(updated).not.toBeNull();
      expect(updated?.payload).toEqual({ calendarEventId: "cal-123" });
    });
  });

  describe("setOnRecordMutated", () => {
    it("should call listener on save", async () => {
      await serverProfile.saveProfile({
        email: "test@example.com",
        name: "Test User",
        role: "student",
        features: []
      });
      
      const listener = vi.fn();
      serverUserData.setOnRecordMutated(listener);
      
      await serverUserData.saveRecord({ type: "note", title: "Test" });
      
      expect(listener).toHaveBeenCalledWith("save", expect.any(Object));
    });

    it("should call listener on update", async () => {
      await serverProfile.saveProfile({
        email: "test@example.com",
        name: "Test User",
        role: "student",
        features: []
      });
      
      const created = await serverUserData.saveRecord({ type: "note", title: "Test" });
      
      const listener = vi.fn();
      serverUserData.setOnRecordMutated(listener);
      
      await serverUserData.updateRecord(created.id, { title: "Updated" });
      
      expect(listener).toHaveBeenCalledWith("update", expect.any(Object));
    });

    it("should call listener on delete", async () => {
      await serverProfile.saveProfile({
        email: "test@example.com",
        name: "Test User",
        role: "student",
        features: []
      });
      
      const created = await serverUserData.saveRecord({ type: "note", title: "Test" });
      
      const listener = vi.fn();
      serverUserData.setOnRecordMutated(listener);
      
      await serverUserData.deleteRecord(created.id);
      
      expect(listener).toHaveBeenCalledWith("delete", expect.any(Object));
    });
  });
});