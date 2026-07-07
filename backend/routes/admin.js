import { Router } from "express";
import { readdir } from "fs/promises";
import { readJson, writeJson, API_KEYS_FILE, RUNS_DIR } from "../lib/storage.js";
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

/**
 * GET /api/admin/analytics
 * Aggregates speedrun run files into summary metrics for the Admin dashboard.
 * Reads data/runs/*.json (24h TTL). Never exposes raw visitor content —
 * only counts, modes, tokens, and aggregated source URLs.
 */
router.get("/analytics", requireAuth, ash(async (_req, res) => {
  const since24h = Date.now() - 24 * 60 * 60 * 1000;

  let names = [];
  try {
    names = await readdir(RUNS_DIR);
  } catch {
    return res.json(emptyAnalytics());
  }

  const stats = emptyAnalytics();
  const urlCounts = new Map(); // host -> count
  const oracleQuestions = [];  // { q, ts } — capped
  const perDay = new Map();    // YYYY-MM-DD -> count

  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    const record = await readJson(`${RUNS_DIR}/${name}`);
    if (!record) continue;

    // Speedrun-style run files store the run at the top level.
    const run = record.runState || record;
    const tsField = run.startedAt || run.createdAt || record.createdAt;
    const ts = tsField ? new Date(tsField).getTime() : NaN;
    const isRecent = Number.isFinite(ts) && ts >= since24h;

    stats.runsTotal += 1;
    if (isRecent) stats.runsLast24h += 1;

    // Per-day bucket
    if (Number.isFinite(ts)) {
      const day = new Date(ts).toISOString().slice(0, 10);
      perDay.set(day, (perDay.get(day) ?? 0) + 1);
    }

    // Visitor mode (hybrid vs full)
    const mode = run.visitorMode || record.visitorMode || "unknown";
    if (mode === "hybrid") stats.runsHybrid += 1;
    else if (mode === "full") stats.runsFull += 1;
    else stats.runsUnknown += 1;

    // Source URL (for URL-speedrun kind)
    const host = run.sourceHost || record.sourceHost;
    if (host) {
      stats.urlRuns += 1;
      urlCounts.set(host, (urlCounts.get(host) ?? 0) + 1);
    }

    // Token usage
    const usage = run.usage || record.usage;
    if (usage) {
      stats.inputTokens += Number(usage.inputTokens) || 0;
      stats.outputTokens += Number(usage.outputTokens) || 0;
    }
    if (run.status === "complete" || record.status === "complete") stats.runsComplete += 1;
  }

  // Top source hosts (max 10)
  stats.topSourceHosts = [...urlCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([host, count]) => ({ host, count }));

  // Per-day series (last 14 days, oldest first)
  const today = new Date();
  const dayMs = 24 * 60 * 60 * 1000;
  for (let i = 13; i >= 0; i--) {
    const d = new Date(today.getTime() - i * dayMs);
    const key = d.toISOString().slice(0, 10);
    stats.runsPerDay.push({ date: key, count: perDay.get(key) ?? 0 });
  }

  // Rough cost estimate (Hybrid mode only — visitor keys are free for us).
  // Sonnet pricing: ~$3/M input, $15/M output (rounded for dashboard use).
  const inputCost = (stats.inputTokens / 1_000_000) * 3;
  const outputCost = (stats.outputTokens / 1_000_000) * 15;
  stats.estimatedCostUsd = Math.round((inputCost + outputCost) * 100) / 100;

  res.json(stats);
}));

/**
 * Empty analytics shape — used as the baseline accumulator and the fallback
 * when no run files exist yet.
 */
function emptyAnalytics() {
  return {
    runsTotal: 0,
    runsLast24h: 0,
    runsComplete: 0,
    runsHybrid: 0,
    runsFull: 0,
    runsUnknown: 0,
    urlRuns: 0,
    inputTokens: 0,
    outputTokens: 0,
    estimatedCostUsd: 0,
    topSourceHosts: [],
    runsPerDay: [],
  };
}

export default router;
