import { Router } from "express";
import { readJson, writeJson, API_KEYS_FILE } from "../lib/storage.js";
import { requireAuth } from "../lib/auth.js";
import { resetServerClient } from "../lib/claude.js";
import { maskKey } from "../lib/providers.js";

const router = Router();

const ash = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/**
 * GET /api/admin/api-keys
 * Returns a masked view of stored keys — never the raw values.
 */
router.get("/api-keys", requireAuth, ash(async (_req, res) => {
  const data = (await readJson(API_KEYS_FILE)) ?? {};
  const providerIds = ["anthropic", "openai", "kimi", "zai", "gemini", "cursor"];
  const providers = {};
  for (const id of providerIds) {
    const v = typeof data[id] === "string" ? data[id] : "";
    providers[id] = { present: !!v, preview: maskKey(v) };
  }
  res.json({
    providers,
    defaultProvider: data.defaultProvider || "anthropic",
    updatedAt: data.updatedAt ?? null,
  });
}));

/**
 * PUT /api/admin/api-keys
 * Body: { anthropic?: string, openai?: string }
 * Stores raw keys in data/api-keys.json (gitignored). Empty string clears.
 */
router.put("/api-keys", requireAuth, ash(async (req, res) => {
  const existing = (await readJson(API_KEYS_FILE)) ?? {};
  const validProviders = ["anthropic", "openai", "kimi", "zai", "gemini", "cursor"];
  const next = { ...existing };
  for (const id of validProviders) {
    if (typeof req.body[id] === "string") {
      next[id] = req.body[id].trim();
    } else if (!(id in next)) {
      next[id] = "";
    }
  }
  if (typeof req.body.defaultProvider === "string" && validProviders.includes(req.body.defaultProvider)) {
    next.defaultProvider = req.body.defaultProvider;
  }
  next.updatedAt = new Date().toISOString();
  await writeJson(API_KEYS_FILE, next);

  // Invalidate cached AI clients so subsequent Hybrid-mode calls pick up the new keys.
  try { resetServerClient(); } catch { /* ignore */ }

  // Masked response — same shape as GET (providers nested + meta).
  const providersOut = {};
  for (const id of validProviders) {
    providersOut[id] = { present: !!next[id], preview: maskKey(next[id]) };
  }
  res.json({
    providers: providersOut,
    defaultProvider: next.defaultProvider || "anthropic",
    updatedAt: next.updatedAt,
  });
}));

export default router;
