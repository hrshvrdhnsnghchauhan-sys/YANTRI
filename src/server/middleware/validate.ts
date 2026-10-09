/**
 * Zod request validation middleware.
 *
 * Validated data REPLACES req.body / req.query so downstream handlers only see
 * schema-conformant data. Failures return a 400 with per-field details.
 */
import type { Request, Response, NextFunction } from "express";
import type { ZodType } from "zod";

function fail(res: Response, issues: readonly { path: PropertyKey[]; message: string }[]) {
  res.status(400).json({
    error: "Validation failed",
    details: issues.map((i) => `${i.path.map(String).join(".") || "(root)"}: ${i.message}`),
  });
}

export function validateBody<T>(schema: ZodType<T>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      fail(res, result.error.issues);
      return;
    }
    req.body = result.data;
    next();
  };
}

export function validateQuery<T>(schema: ZodType<T>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.query);
    if (!result.success) {
      fail(res, result.error.issues);
      return;
    }
    // Express 4 lets us replace the parsed query object.
    (req as any).query = result.data;
    next();
  };
}
