/**
 * Authentication routes (/api/auth/*).
 *
 * Public: config, register, login. Authenticated: refresh, me.
 */
import { Router, type Request, type Response } from "express";
import rateLimit from "express-rate-limit";
import {
  AUTH_REQUIRED,
  ALLOW_REGISTRATION,
  RATE_LIMIT_WINDOW_MS,
  AUTH_RATE_LIMIT_MAX,
} from "../config";
import { registerUser, authenticateUser, signToken, getUserById } from "../services/auth";
import { authenticate, requireAuth, type AuthedRequest } from "../middleware/auth";
import { validateBody } from "../middleware/validate";
import { registerSchema, loginSchema } from "../utils/validation";
import { logSecurityEvent } from "../utils/logger";

export function createAuthRouter(): Router {
  const router = Router();

  // Stricter limiter for credential endpoints.
  const authLimiter = rateLimit({
    windowMs: RATE_LIMIT_WINDOW_MS,
    max: AUTH_RATE_LIMIT_MAX,
    message: { error: "Too many authentication attempts, please try again later" },
    standardHeaders: true,
    legacyHeaders: false,
  });

  /** Public: lets the client know whether it must authenticate. */
  router.get("/config", (_req: Request, res: Response) => {
    res.json({ authRequired: AUTH_REQUIRED, allowRegistration: ALLOW_REGISTRATION });
  });

  router.post("/register", authLimiter, validateBody(registerSchema), (req: Request, res: Response) => {
    if (!ALLOW_REGISTRATION) {
      return res.status(403).json({ error: "Registration is disabled." });
    }
    const result = registerUser(req.body);
    if (!result.ok || !result.user) {
      const message = result.error ?? "Registration failed.";
      logSecurityEvent("auth_failure", { action: "register", reason: message });
      return res.status(409).json({ error: message });
    }
    const user = result.user;
    const token = signToken(user);
    logSecurityEvent("auth_success", { action: "register", email: user.email });
    res.status(201).json({ token, user });
  });

  router.post("/login", authLimiter, validateBody(loginSchema), (req: Request, res: Response) => {
    const { email, password } = req.body;
    const user = authenticateUser(email, password);
    if (!user) {
      logSecurityEvent("auth_failure", { action: "login", email });
      return res.status(401).json({ error: "Invalid email or password." });
    }
    const token = signToken(user);
    logSecurityEvent("auth_success", { action: "login", email: user.email });
    res.json({ token, user });
  });

  router.post("/refresh", authenticate, requireAuth, (req: Request, res: Response) => {
    const authReq = req as AuthedRequest;
    const user = authReq.user ? getUserById(authReq.user.id) : null;
    if (!user) return res.status(401).json({ error: "Unauthorized" });
    res.json({ token: signToken(user), user });
  });

  router.get("/me", authenticate, requireAuth, (req: Request, res: Response) => {
    const authReq = req as AuthedRequest;
    const user = authReq.user ? getUserById(authReq.user.id) : null;
    if (!user) return res.status(401).json({ error: "Unauthorized" });
    res.json({ user });
  });

  return router;
}

export default createAuthRouter;
