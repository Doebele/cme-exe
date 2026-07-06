import { Router } from "express";
import {
  listRecordings,
  getRecording,
  promoteRunToRecording,
  updateRecordingMeta,
  deleteRecording,
} from "../lib/recordings.js";
import { getRun } from "../lib/speedrun.js";
import { requireAuth } from "../lib/auth.js";

const router = Router();
const ash = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/**
 * GET /api/recordings
 * Public — list recording metadata. Optional ?featured=true filter.
 */
router.get("/", ash(async (req, res) => {
  const opts = req.query.featured === "true" ? { featuredOnly: true } : {};
  const list = await listRecordings(opts);
  res.json(list);
}));

/**
 * GET /api/recordings/:id
 * Public — full recording record (history + manifest + page-state).
 */
router.get("/:id", ash(async (req, res) => {
  const rec = await getRecording(req.params.id);
  if (!rec) return res.status(404).json({ error: "Recording not found" });
  res.json(rec);
}));

/**
 * POST /api/recordings
 * Admin-only. Body: { runId, title?, featured? }
 * Promotes an ephemeral run to a permanent recording.
 */
router.post("/", requireAuth, ash(async (req, res) => {
  const { runId, title, featured } = req.body || {};
  if (!runId || typeof runId !== "string") {
    return res.status(400).json({ error: "runId is required" });
  }
  const run = await getRun(runId);
  if (!run) {
    return res.status(404).json({ error: "Run not found (may have expired)" });
  }
  if (!run.manifest || run.history.length === 0) {
    return res.status(400).json({ error: "Run is incomplete (no manifest or history)" });
  }
  const meta = await promoteRunToRecording(run, { title, featured });
  res.status(201).json(meta);
}));

/**
 * PATCH /api/recordings/:id
 * Admin-only. Body: { title?, featured? }
 * Update recording metadata.
 */
router.patch("/:id", requireAuth, ash(async (req, res) => {
  const { title, featured } = req.body || {};
  const patch = {};
  if (typeof title === "string") patch.title = title;
  if (typeof featured === "boolean") patch.featured = featured;
  const updated = await updateRecordingMeta(req.params.id, patch);
  if (!updated) return res.status(404).json({ error: "Recording not found" });
  res.json(updated);
}));

/**
 * DELETE /api/recordings/:id
 * Admin-only. Permanently removes a recording.
 */
router.delete("/:id", requireAuth, ash(async (req, res) => {
  const ok = await deleteRecording(req.params.id);
  if (!ok) return res.status(404).json({ error: "Recording not found" });
  res.json({ success: true });
}));

export default router;
