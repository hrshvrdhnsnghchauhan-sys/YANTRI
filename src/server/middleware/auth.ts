/**
 * Authentication middleware.
 *
 * `authenticate` is permissive: if a valid bearer token (or ?token= query for
 * WebSocket handshakes) is present it attaches req.user; otherwise it continues
 * anonymously. `requireAuth` enforces authentication only when AUTH_REQUIRED is
 * true, so local development and test runs stay friction-free.
 */
import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { AUTH_REQUIRED, JWT_SECRET } from "../config";
import { logSecurityEvent } from "../utils/logger";

export interface AuthUser {
  id: string;
  email: string;
}

export interface AuthedRequest extends Request {
  user?: AuthUser;
}

export function extractToken(req: Request | { headers: any; query?: any; url?: string }): string | null {
  const header = (req as any).headers?.authorization;
  if (typeof header === "string" && header.startsWith("Bearer ")) {
    return header.slice(7).trim() || null;
  }
  const q = (req as any).query?.token;
  if (typeof q === "string" && q) return q;
  return null;
}

export function verifyToken(token: string): AuthUser | null {
  try {
    const payload = jwt.verify(token, JWT_SECRET) as jwt.JwtPayload;
    const id = typeof payload.sub === "string" ? payload.sub : (payload as any).id;
    if (!id) return null;
    return { id: String(id), email: String(payload.email || "") };
  } catch {
    return null;
  }
}

export function authenticate(req: Request, _res: Response, next: NextFunction): void {
  const token = extractToken(req);
  if (token) {
    const user = verifyToken(token);
    if (user) {
      (req as AuthedRequest).user = user;
    } else {
      logSecurityEvent("auth_failure", { path: req.path, ip: req.ip });
    }
  }
  next();
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!AUTH_REQUIRED) return next();
  if ((req as AuthedRequest).user) return next();
  res.status(401).json({ error: "Unauthorized" });
}
