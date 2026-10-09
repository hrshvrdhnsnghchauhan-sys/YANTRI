import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as serverEmailDraft from "../server_email_draft";

describe("server_email_draft", () => {
  beforeEach(() => {
    vi.resetModules();
    // Reset module internal state
    (serverEmailDraft as any).drafts = new Map();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("EmailDraft interface", () => {
    it("should have correct structure", () => {
      const draft: serverEmailDraft.EmailDraft = {
        to: "test@example.com",
        cc: "",
        subject: "Test",
        body: "Body",
        request: "Send email",
        createdAt: Date.now(),
        composedBy: "skeleton"
      };
      
      expect(draft.to).toBe("test@example.com");
      expect(draft.composedBy).toBe("skeleton");
    });
  });

  describe("storeDraft", () => {
    it("should store draft with ws key", () => {
      const draft: serverEmailDraft.EmailDraft = {
        to: "test@example.com",
        cc: "",
        subject: "Test",
        body: "Body",
        request: "Send email",
        createdAt: Date.now(),
        composedBy: "skeleton"
      };
      
      serverEmailDraft.storeDraft("ws-1", draft);
      const retrieved = serverEmailDraft.peekDraft("ws-1");
      
      expect(retrieved).not.toBeNull();
      expect(retrieved?.to).toBe("test@example.com");
    });

    it("should set createdAt if not provided", () => {
      const draft: serverEmailDraft.EmailDraft = {
        to: "test@example.com",
        cc: "",
        subject: "Test",
        body: "Body",
        request: "Send email",
        createdAt: 0,
        composedBy: "skeleton"
      };
      
      serverEmailDraft.storeDraft("ws-2", draft);
      const retrieved = serverEmailDraft.peekDraft("ws-2");
      
      expect(retrieved?.createdAt).toBeGreaterThan(0);
    });
  });

  describe("takeDraft", () => {
    it("should return and remove draft", () => {
      const draft: serverEmailDraft.EmailDraft = {
        to: "test@example.com",
        cc: "",
        subject: "Test",
        body: "Body",
        request: "Send email",
        createdAt: Date.now(),
        composedBy: "skeleton"
      };
      
      serverEmailDraft.storeDraft("ws-3", draft);
      const taken = serverEmailDraft.takeDraft("ws-3");
      const peeked = serverEmailDraft.peekDraft("ws-3");
      
      expect(taken).not.toBeNull();
      expect(peeked).toBeNull();
    });

    it("should return null for expired draft", () => {
      const draft: serverEmailDraft.EmailDraft = {
        to: "test@example.com",
        cc: "",
        subject: "Test",
        body: "Body",
        request: "Send email",
        createdAt: Date.now() - 11 * 60 * 1000,
        composedBy: "skeleton"
      };
      
      serverEmailDraft.storeDraft("ws-4", draft);
      const taken = serverEmailDraft.takeDraft("ws-4");
      
      expect(taken).toBeNull();
    });

    it("should return null for non-existent key", () => {
      const result = serverEmailDraft.takeDraft("non-existent");
      expect(result).toBeNull();
    });
  });

  describe("peekDraft", () => {
    it("should return draft without removing", () => {
      const draft: serverEmailDraft.EmailDraft = {
        to: "test@example.com",
        cc: "",
        subject: "Test",
        body: "Body",
        request: "Send email",
        createdAt: Date.now(),
        composedBy: "skeleton"
      };
      
      serverEmailDraft.storeDraft("ws-5", draft);
      const peeked1 = serverEmailDraft.peekDraft("ws-5");
      const peeked2 = serverEmailDraft.peekDraft("ws-5");
      
      expect(peeked1).not.toBeNull();
      expect(peeked2).not.toBeNull();
      expect(peeked1).toBe(peeked2);
    });

    it("should return null for expired draft", () => {
      const draft: serverEmailDraft.EmailDraft = {
        to: "test@example.com",
        cc: "",
        subject: "Test",
        body: "Body",
        request: "Send email",
        createdAt: Date.now() - 11 * 60 * 1000,
        composedBy: "skeleton"
      };
      
      serverEmailDraft.storeDraft("ws-6", draft);
      const peeked = serverEmailDraft.peekDraft("ws-6");
      
      expect(peeked).toBeNull();
    });
  });

  describe("wsKeyFor", () => {
    it("should generate consistent key", () => {
      expect(serverEmailDraft.wsKeyFor(1)).toBe("ws-1");
      expect(serverEmailDraft.wsKeyFor(42)).toBe("ws-42");
    });
  });

  describe("parseRecipients", () => {
    it("should parse standard emails", () => {
      const result = serverEmailDraft.parseRecipients("send to ravi@gmail.com");
      expect(result.to).toEqual(["ravi@gmail.com"]);
    });

    it("should parse spoken form 'dot' and 'at'", () => {
      const result = serverEmailDraft.parseRecipients("ravi dot kumar at gmail dot com");
      expect(result.to).toEqual(["ravi.kumar@gmail.com"]);
    });

    it("should parse multiple emails", () => {
      const result = serverEmailDraft.parseRecipients("send to a@b.com and c@d.com");
      expect(result.to).toEqual(["a@b.com", "c@d.com"]);
    });

    it("should parse cc recipients", () => {
      const result = serverEmailDraft.parseRecipients("send to a@b.com cc c@d.com");
      expect(result.to).toEqual(["a@b.com"]);
      expect(result.cc).toEqual(["c@d.com"]);
    });

    it("should parse 'carbon copy' as cc", () => {
      const result = serverEmailDraft.parseRecipients("send to a@b.com carbon copy c@d.com");
      expect(result.to).toEqual(["a@b.com"]);
      expect(result.cc).toEqual(["c@d.com"]);
    });

    it("should handle underscore spoken form", () => {
      const result = serverEmailDraft.parseRecipients("ravi underscore kumar at gmail dot com");
      expect(result.to).toEqual(["ravi_kumar@gmail.com"]);
    });

    it("should return empty arrays when no emails", () => {
      const result = serverEmailDraft.parseRecipients("email the professor");
      expect(result.to).toEqual([]);
      expect(result.cc).toEqual([]);
    });

    it("should deduplicate emails", () => {
      const result = serverEmailDraft.parseRecipients("send to a@b.com and a@b.com");
      expect(result.to).toEqual(["a@b.com"]);
    });
  });

  describe("normalizeRecipients", () => {
    it("should parse string recipients", () => {
      const result = serverEmailDraft.normalizeRecipients({
        to: "a@b.com, c@d.com",
        cc: "e@f.com"
      });
      
      expect(result.to).toEqual(["a@b.com", "c@d.com"]);
      expect(result.cc).toEqual(["e@f.com"]);
      expect(result.invalid).toEqual([]);
    });

    it("should parse array recipients", () => {
      const result = serverEmailDraft.normalizeRecipients({
        to: ["a@b.com", "c@d.com"],
        cc: ["e@f.com"]
      });
      
      expect(result.to).toEqual(["a@b.com", "c@d.com"]);
      expect(result.cc).toEqual(["e@f.com"]);
    });

    it("should separate invalid emails", () => {
      const result = serverEmailDraft.normalizeRecipients({
        to: "a@b.com, invalid-email",
        cc: "not-an-email"
      });
      
      expect(result.to).toEqual(["a@b.com"]);
      expect(result.invalid).toContain("invalid-email");
      expect(result.invalid).toContain("not-an-email");
    });
  });

  describe("inferSubject", () => {
    it("should infer subject from request patterns", () => {
      expect(serverEmailDraft.inferSubject("request extension for assignment"))
        .toContain("Request for Extension");
      
      expect(serverEmailDraft.inferSubject("leave request"))
        .toBe("Leave Request");
      
      expect(serverEmailDraft.inferSubject("meeting request"))
        .toBe("Meeting Request");
      
      expect(serverEmailDraft.inferSubject("application for internship"))
        .toContain("Application");
    });

    it("should fallback to title-cased first clause", () => {
      const subject = serverEmailDraft.inferSubject("send a quick note to the team about the project");
      expect(subject).toContain("Send A Quick Note");
    });

    it("should return default for empty request", () => {
      expect(serverEmailDraft.inferSubject("")).toBe("Message from Yantri");
      expect(serverEmailDraft.inferSubject("   ")).toBe("Message from Yantri");
    });

    it("should truncate long subjects", () => {
      const longRequest = "a".repeat(100);
      const subject = serverEmailDraft.inferSubject(longRequest);
      expect(subject.length).toBeLessThanOrEqual(70);
    });
  });

  describe("composeEmail", () => {
    it("should compose skeleton email when no api key", async () => {
      const result = await serverEmailDraft.composeEmail({
        request: "Hello there",
        to: ["test@example.com"],
        cc: [],
        tone: "formal"
      });
      
      expect(result.subject).toBeDefined();
      expect(result.body).toContain("Hello");
      expect(result.composedBy).toBe("skeleton");
    });

    it("should include user name in sign-off", async () => {
      const result = await serverEmailDraft.composeEmail({
        request: "Hello",
        to: ["test@example.com"],
        cc: [],
        userName: "John Doe"
      });
      
      expect(result.body).toContain("John Doe");
    });

    it("should use greeting from email handle", async () => {
      const result = await serverEmailDraft.composeEmail({
        request: "Hello",
        to: ["professor.sharma@university.edu"],
        cc: []
      });
      
      expect(result.body).toContain("Dear Professor Sharma");
    });
  });

  describe("mergeDraftWithArgs", () => {
    it("should merge args over draft", () => {
      const draft: serverEmailDraft.EmailDraft = {
        to: "original@example.com",
        cc: "cc@example.com",
        subject: "Original Subject",
        body: "Original body",
        request: "Original request",
        createdAt: Date.now(),
        composedBy: "skeleton"
      };
      
      const merged = serverEmailDraft.mergeDraftWithArgs(draft, {
        to: "new@example.com",
        subject: "New Subject",
        body: "New body",
        cc: "newcc@example.com"
      });
      
      expect(merged.to).toBe("new@example.com");
      expect(merged.subject).toBe("New Subject");
      expect(merged.body).toBe("New body");
      expect(merged.cc).toBe("newcc@example.com");
    });

    it("should fall back to draft when args missing", () => {
      const draft: serverEmailDraft.EmailDraft = {
        to: "original@example.com",
        cc: "cc@example.com",
        subject: "Original Subject",
        body: "Original body",
        request: "Original request",
        createdAt: Date.now(),
        composedBy: "skeleton"
      };
      
      const merged = serverEmailDraft.mergeDraftWithArgs(draft, {});
      
      expect(merged.to).toBe("original@example.com");
      expect(merged.subject).toBe("Original Subject");
      expect(merged.body).toBe("Original body");
      expect(merged.cc).toBe("cc@example.com");
    });

    it("should preserve reply threading fields", () => {
      const draft: serverEmailDraft.EmailDraft = {
        to: "original@example.com",
        cc: "",
        subject: "Re: Original",
        body: "Body",
        request: "Reply",
        createdAt: Date.now(),
        composedBy: "skeleton",
        replyToMessageId: "msg-123",
        threadId: "thread-456"
      };
      
      const merged = serverEmailDraft.mergeDraftWithArgs(draft, {});
      
      expect(merged.inReplyTo).toBe("msg-123");
      expect(merged.threadId).toBe("thread-456");
    });
  });
});