import { describe, it, expect } from "vitest";
import {
  memoryCreateSchema,
  reminderCreateSchema,
  registerSchema,
  recordCreateSchema,
} from "../src/server/utils/validation";
import { validateBody, validateQuery } from "../src/server/middleware/validate";

function mockRes() {
  const res: any = {
    statusCode: 0,
    body: null as any,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: any) {
      this.body = payload;
      return this;
    },
  };
  return res;
}

describe("validation schemas", () => {
  it("accepts a valid memory and rejects a bad category", () => {
    expect(memoryCreateSchema.safeParse({ category: "identity", text: "hi" }).success).toBe(true);
    expect(memoryCreateSchema.safeParse({ category: "invalid", text: "hi" }).success).toBe(false);
    expect(memoryCreateSchema.safeParse({ category: "identity", text: "" }).success).toBe(false);
  });

  it("enforces positive reminder minutes", () => {
    expect(reminderCreateSchema.safeParse({ text: "t", minutes: 5 }).success).toBe(true);
    expect(reminderCreateSchema.safeParse({ text: "t", minutes: -1 }).success).toBe(false);
  });

  it("requires an 8+ character password at register", () => {
    expect(registerSchema.safeParse({ email: "a@b.com", password: "password123" }).success).toBe(true);
    expect(registerSchema.safeParse({ email: "a@b.com", password: "short" }).success).toBe(false);
  });

  it("requires type + title for records", () => {
    expect(recordCreateSchema.safeParse({ type: "note", title: "N" }).success).toBe(true);
    expect(recordCreateSchema.safeParse({ type: "", title: "N" }).success).toBe(false);
  });
});

describe("validate middleware", () => {
  it("returns 400 and does not call next on invalid body", () => {
    const mw = validateBody(reminderCreateSchema);
    const res = mockRes();
    let called = false;
    mw({ body: { text: "", minutes: -1 } } as any, res, () => {
      called = true;
    });
    expect(called).toBe(false);
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe("Validation failed");
    expect(Array.isArray(res.body.details)).toBe(true);
  });

  it("passes valid body through and strips unknown fields", () => {
    const mw = validateBody(reminderCreateSchema);
    const req: any = { body: { text: "hi", minutes: 5, extra: "x" } };
    const res = mockRes();
    let called = false;
    mw(req, res, () => {
      called = true;
    });
    expect(called).toBe(true);
    expect(req.body.minutes).toBe(5);
    expect(req.body.extra).toBeUndefined();
  });

  it("coerces and validates query params", () => {
    const mw = validateQuery(recordCreateSchema.pick({ type: true }));
    const req: any = { query: { type: "deadline" } };
    const res = mockRes();
    let called = false;
    mw(req, res, () => {
      called = true;
    });
    expect(called).toBe(true);
    expect(req.query.type).toBe("deadline");
  });
});
