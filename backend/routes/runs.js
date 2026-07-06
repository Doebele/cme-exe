import { Router } from "express";
import { v4 as uuidv4 } from "uuid";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { unlink } from "fs/promises";
import { readJson, writeJson, RUNS_DIR } from "../lib/storage.js";
import { rateLimit } from "../lib/rateLimit.js";

const router = Router();

const RUN_TTL_MS = 24 * 60 * 60 * 1000; // 24h
const CREATE_LIMIT_PER_HOUR = 30;
const HOUR_MS = 60 * 60 * 1000;

const ash = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/**
 * POST /api/runs
 * Body: { runState: any }
 * Public (visitors share their own runs), but creation is rate-limited per IP.
 */
router.post("/", ash(async (req, res) => {
  const rl = rateLimit({
    key: `run-create:${req.ip}`,
    limit: CREATE_LIMIT_PER_HOUR,
    windowMs: HOUR_MS,
  });
  if (!rl.allowed) {
    res.set("Retry-After", String(Math.ceil(rl.retryAfterMs / 1000)));
    return res.status(429).json({ error: "Too many runs created. Try again later." });
  }

  const { runState } = req.body || {};
  if (runState === undefined || runState === null) {
    return res.status(400).json({ error: "runState is required" });
  }

  const id = uuidv4();
  const record = {
    id,
    runState,
    createdAt: new Date().toISOString(),
  };
  await writeJson(join(RUNS_DIR, `${id}.json`), record);
  return res.status(201).json({ id });
}));

/**
 * GET /api/runs/:id
 * Public read. Lazy-deletes files older than the TTL.
 */
router.get("/:id", ash(async (req, res) => {
  const id = req.params.id;
  // Accept both legacy UUID runs and speedrun ids (r-[a-z0-9]{12}).
  if (!/^[0-9a-fA-F-]{36}$/.test(id) && !/^r-[a-z0-9]{12}$/.test(id)) {
    return res.status(404).json({ error: "Run not found" });
  }
  const file = join(RUNS_DIR, `${id}.json`);
  const record = await readJson(file);
  if (!record) return res.status(404).json({ error: "Run not found or expired" });

  const ts = record.startedAt || record.createdAt;
  const age = Date.now() - new Date(ts).getTime();
  if (Number.isNaN(age) || age > RUN_TTL_MS) {
    try { await unlink(file); } catch { /* already gone */ }
    return res.status(404).json({ error: "Run not found or expired" });
  }

  return res.json(record);
}));

export default router;
