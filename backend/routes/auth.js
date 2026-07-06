import { Router } from "express";
import bcrypt from "bcryptjs";
import { ADMIN_PASSWORD_HASH } from "../lib/auth.js";

const router = Router();

/**
 * POST /api/auth/login
 * Body: { password: string }
 */
router.post("/login", async (req, res) => {
  try {
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
