import { Router } from "express";
import {
  readJson,
  writeJson,
  LAB_FACTS_FILE,
  PERSONAS_FILE,
  DESIGN_QUOTES_FILE,
  SETTINGS_FILE,
  SECTIONS_FILE,
} from "../lib/storage.js";
import { requireAuth } from "../lib/auth.js";

const router = Router();

/** Wrap async handlers so rejected promises reach Express error handling. */
const ash = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// ----- Public reads -----

router.get("/lab-facts", ash(async (_req, res) => {
  const data = (await readJson(LAB_FACTS_FILE)) ?? { version: "0.1.0", subject: {}, career: [], works: [] };
  res.json(data);
}));

router.get("/personas", ash(async (_req, res) => {
  const data = (await readJson(PERSONAS_FILE)) ?? {};
  res.json(data);
}));

router.get("/design-quotes", ash(async (_req, res) => {
  const data = (await readJson(DESIGN_QUOTES_FILE)) ?? [];
  res.json(data);
}));

router.get("/settings", ash(async (_req, res) => {
  // settings.json holds only public-facing config (theme/audio/behavior/experience).
  // No admin secrets live here, so the full object is safe to return.
  const data = (await readJson(SETTINGS_FILE)) ?? {};
  res.json(data);
}));

// ----- Admin writes -----

router.put("/lab-facts", requireAuth, ash(async (req, res) => {
  await writeJson(LAB_FACTS_FILE, req.body);
  res.json(req.body);
}));

router.put("/personas", requireAuth, ash(async (req, res) => {
  await writeJson(PERSONAS_FILE, req.body);
  res.json(req.body);
}));

router.put("/design-quotes", requireAuth, ash(async (req, res) => {
  await writeJson(DESIGN_QUOTES_FILE, req.body);
  res.json(req.body);
}));

router.put("/settings", requireAuth, ash(async (req, res) => {
  await writeJson(SETTINGS_FILE, req.body);
  res.json(req.body);
}));


// ----- Sections (nav order + visibility) -----

router.get("/sections", ash(async (_req, res) => {
  const data = (await readJson(SECTIONS_FILE)) ?? [];
  res.json(data);
}));

router.put("/sections", requireAuth, ash(async (req, res) => {
  await writeJson(SECTIONS_FILE, req.body);
  res.json(req.body);
}));

export default router;
