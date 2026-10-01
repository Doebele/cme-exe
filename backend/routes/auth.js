import { Router } from "express";
import bcrypt from "bcryptjs";
import { ADMIN_PASSWORD_HASH } from "../lib/auth.js";
import { rateLimit } from "../lib/rateLimit.js";

const router = Router();

// There's exactly one credential for the whole site and no account lockout
// concept, so an unthrottled login is a direct brute-force enabler
// (security finding). 10 attempts/15min/IP is generous for a real admin
// who mistypes, but shuts down sustained automated guessing.
const LOGIN_LIMIT = 10;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;

/**
 * POST /api/auth/login
 * Body: { password: string }
 */
router.post("/login", async (req, res) => {
  try {
    const rl = rateLimit({ key: `login:${req.ip}`, limit: LOGIN_LIMIT, windowMs: LOGIN_WINDOW_MS });
    if (!rl.allowed) {
      res.set("Retry-After", String(Math.ceil(rl.retryAfterMs / 1000)));
      return res.status(429).json({ error: "Too many login attempts. Try again later." });
    }
    const { password } = req.body || {};
    if (typeof password !== "string" || !password) {
      return res.status(400).json({ error: "Password required" });
    }
    const ok = await bcrypt.compare(password, ADMIN_PASSWORD_HASH);
    if (!ok) return res.status(401).json({ error: "Invalid password" });
    req.session.isAdmin = true;
    return res.json({ success: true });
  } catch (err) {
    console.error("[auth] login error:", err);
    return res.status(500).json({ error: "Login failed" });
  }
});

/**
 * POST /api/auth/logout
 */
router.post("/logout", (req, res) => {
  req.session.destroy(() => {
    res.json({ success: true });
  });
});

/**
 * GET /api/auth/check
 */
router.get("/check", (req, res) => {
  res.json({ isAdmin: !!(req.session && req.session.isAdmin) });
});

export default router;
