/**
 * Speedrun-Agent HTTP routes — implements docs/speedrun-contract.md section 4.
 *
 * Auth model mirrors routes/ai.js: a non-empty `visitorApiKey` opts into Full
 * mode (no rate limit, never logged); absence falls back to Hybrid mode
 * (rate-limited by IP, requires the server's ANTHROPIC_API_KEY).
 */
import { Router } from "express";
import { rateLimit } from "../lib/rateLimit.js";
import { readJson, SETTINGS_FILE } from "../lib/storage.js";
import { startRun, startUrlRun, stepRun, generateManifest, getRun } from "../lib/speedrun.js";
import { pickHybridRecording } from "../lib/recordings.js";
import {
  UrlValidationError,
  BlockedError,
  FetchTimeoutError,
  TooLargeError,
  FetchError,
  RateLimitError,
  hostnameForLog,
} from "../lib/urlFetcher.js";

const router = Router();

const HOUR_MS = 60 * 60 * 1000;
const DEFAULT_HYBRID_LIMIT = 20;
const RUN_ID_RE = /^r-[a-z0-9]{12}$/;
const URL_START_LIMIT_PER_HOUR = 5;
const URL_HOSTNAME_LOG_RE = /^https?:\/\/([^/\s?#]+)/i;

/**
 * Wrap an async route handler so rejected promises reach Express error flow.
 * @param {(req: import('express').Request, res: import('express').Response)=>Promise<any>} fn
 */
const ash = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/**
 * Resolve the per-hour Hybrid limit from settings.json (with a safe default).
 * @returns {Promise<number>}
 */
async function hybridLimit() {
  try {
    const settings = await readJson(SETTINGS_FILE);
    const configured = settings?.experience?.hybridRateLimitPerHour;
    if (typeof configured === "number" && configured > 0) return configured;
  } catch { /* fall back to default */ }
  return DEFAULT_HYBRID_LIMIT;
}

/**
 * Sanitize an error into a key-free message safe for the client.
 * @param {unknown} err
 * @returns {string}
 */
function sanitizeForClient(err) {
  const raw =
    (typeof err === "object" && err && /** @type {any} */ (err).message) || String(err);
  return raw
    .replace(/sk-ant-[A-Za-z0-9_-]+/g, "sk-ant-***")
    .replace(/sk-[A-Za-z0-9_-]+/g, "sk-***");
}

/**
 * Map an internal error to an HTTP status (default 502 upstream).
 * @param {unknown} err
 * @returns {number}
 */
function statusForError(err) {
  const s = /** @type {any} */ (err)?.status;
  if (typeof s === "number" && s >= 400 && s < 600) return s;
  return 502;
}

/**
 * Decide Hybrid vs Full mode for this request.
 *
 * @param {import('express').Request} req
 * @returns {Promise<{mode:'hybrid'|'full', visitorApiKey:string|null, blocked?:{status:number, body:object}}>}
 */
async function resolveMode(req) {
  // Prefer an explicit body field, then the same headers /ai/* understands.
  const fromBody = req.body?.visitorApiKey;
  const fromHeader =
    (req.get("authorization") || "").replace(/^bearer\s+/i, "").trim() ||
    (req.get("x-visitor-key") || "").trim();
  const visitorApiKey =
    typeof fromBody === "string" && fromBody.trim()
      ? fromBody.trim()
      : fromHeader || null;

  if (visitorApiKey) {
    if (!/^sk-/.test(visitorApiKey)) {
      return {
        mode: "full",
        visitorApiKey: null,
        blocked: { status: 400, body: { error: "visitorApiKey must start with 'sk-'." } },
      };
    }
    return { mode: "full", visitorApiKey };
  }

  // Hybrid: rate-limit by IP.
  const limit = await hybridLimit();
  const rl = rateLimit({ key: `speedrun:${req.ip}`, limit, windowMs: HOUR_MS });
  if (!rl.allowed) {
    return {
      mode: "hybrid",
      visitorApiKey: null,
      blocked: {
        status: 429,
        body: {
          error: "Rate limit reached. Try again later or use Full mode with your own key.",
          retryAfterSec: Math.ceil(rl.retryAfterMs / 1000),
        },
      },
    };
  }

  // Hybrid requires the server key.
  if (!process.env.ANTHROPIC_API_KEY) {
    return {
      mode: "hybrid",
      visitorApiKey: null,
      blocked: {
        status: 503,
        body: { error: "Hybrid mode disabled. Add your API key to start.", hybridDisabled: true },
      },
    };
  }
  return { mode: "hybrid", visitorApiKey: null };
}

/**
 * Map a urlFetcher / generic error to a URL-run HTTP status + sanitized body.
 * Never leaks the full URL or content — only the hostname, when relevant.
 * @param {unknown} err
 * @returns {{ status:number, body:object }}
 */
function urlErrorToResponse(err) {
  if (err instanceof UrlValidationError) {
    return { status: 400, body: { error: err.message, code: "INVALID_URL" } };
  }
  if (err instanceof BlockedError) {
    return { status: 403, body: { error: "URL is not publicly reachable", code: "BLOCKED" } };
  }
  if (err instanceof FetchTimeoutError) {
    return { status: 504, body: { error: "URL took too long to respond", code: "TIMEOUT" } };
  }
  if (err instanceof TooLargeError) {
    return { status: 413, body: { error: "URL response too large", code: "TOO_LARGE" } };
  }
  if (err instanceof FetchError) {
    return { status: 502, body: { error: "Could not fetch URL", code: "FETCH_FAILED" } };
  }
  if (err instanceof RateLimitError) {
    return {
      status: 429,
      body: {
        error: "Too many URL speedruns",
        retryAfterSec: err.retryAfterSec,
        code: "RATE_LIMIT",
      },
    };
  }
  return { status: statusForError(err), body: { error: sanitizeForClient(err) } };
}

// =====================================================================
// POST /api/speedrun/start
// =====================================================================
router.post("/start", ash(async (req, res) => {
  const { visitorApiKey, blocked, mode } = await resolveMode(req);
  if (blocked) {
    if (blocked.status === 429) res.set("Retry-After", String(blocked.body.retryAfterSec));
    return res.status(blocked.status).json(blocked.body);
  }

  // HYBRID RECORDING SHORTCUT
  // In hybrid mode (no visitor key), try to serve a pre-recorded session
  // instead of spending tokens on a fresh LLM run. The frontend treats this
  // exactly like a live run — it just plays back the recorded history.
  // Falls through to a normal live run if no recording is available.
  if (mode === "hybrid") {
    try {
      const recording = await pickHybridRecording({ sourceKind: "claus" });
      if (recording) {
        return res.status(201).json({
          runId: null,
          recordingId: recording.id,
          recording: {
            id: recording.id,
            sourceKind: recording.sourceKind,
            sourceUrl: recording.sourceUrl,
            subject: recording.subject,
            sections: recording.sections,
            history: recording.history,
            manifest: recording.manifest,
            recordedAt: recording.recordedAt,
          },
          // Signal to the frontend that this is a recording.
          kind: "recording",
        });
      }
    } catch (err) {
      // Recording lookup failed — fall through to live run. Log hostname only.
      console.error("[speedrun] recording lookup failed:", err?.message);
    }
  }

  try {
    const { runId, initialState } = await startRun({ visitorApiKey });
    return res.status(201).json({ runId, initialState });
  } catch (err) {
    return res.status(statusForError(err)).json({ error: sanitizeForClient(err) });
  }
}));

// =====================================================================
// POST /api/speedrun/step
// =====================================================================
router.post("/step", ash(async (req, res) => {
  const { runId } = req.body || {};
  if (!runId || !RUN_ID_RE.test(runId)) {
    return res.status(400).json({ error: "runId is required and must match r-[a-z0-9]{12}." });
  }

  // IMPORTANT: We do NOT call resolveMode() here. Rate-limiting per step was
  // too aggressive (one run = 10-12 steps = 10-12 hits against the hourly
  // limit). Instead, rate-limit only /start. Step calls are gated by
  // run-id ownership — a visitor can only step runs that exist (and runs
  // expire after 24h). We still need visitorApiKey so the Claude client can
  // use Full mode if the visitor provided a key.
  const fromBody = req.body?.visitorApiKey;
  const fromHeader =
    (req.get("authorization") || "").replace(/^bearer\s+/i, "").trim() ||
    (req.get("x-visitor-key") || "").trim();
  const visitorApiKey =
    typeof fromBody === "string" && fromBody.trim() ? fromBody.trim() : fromHeader || null;
  if (visitorApiKey && !/^sk-/.test(visitorApiKey)) {
    return res.status(400).json({ error: "visitorApiKey must start with 'sk-'." });
  }
  // Server-key presence is checked inside stepRun when it actually needs to
  // call Claude (it does NOT for step 0, which is synthesized).

  try {
    const result = await stepRun({ runId, visitorApiKey });
    if (!result) {
      return res.status(404).json({ error: "Run not found or expired" });
    }
    if (result.complete) {
      return res.status(409).json({
        error: "Run already complete",
        manifest: result.run.manifest,
      });
    }
    return res.status(200).json({
      step: result.step,
      thought: result.thought,
      action: result.action,
      done: result.done,
      latencyMs: result.latencyMs,
    });
  } catch (err) {
    return res.status(statusForError(err)).json({ error: sanitizeForClient(err) });
  }
}));

// =====================================================================
// POST /api/speedrun/manifest
// =====================================================================
router.post("/manifest", ash(async (req, res) => {
  const { runId } = req.body || {};
  if (!runId || !RUN_ID_RE.test(runId)) {
    return res.status(400).json({ error: "runId is required and must match r-[a-z0-9]{12}." });
  }

  // Same rationale as /step: rate-limit only /start. Visitor key still flows
  // through so the manifest generation can use Full mode when applicable.
  const fromBody = req.body?.visitorApiKey;
  const fromHeader =
    (req.get("authorization") || "").replace(/^bearer\s+/i, "").trim() ||
    (req.get("x-visitor-key") || "").trim();
  const visitorApiKey =
    typeof fromBody === "string" && fromBody.trim() ? fromBody.trim() : fromHeader || null;
  if (visitorApiKey && !/^sk-/.test(visitorApiKey)) {
    return res.status(400).json({ error: "visitorApiKey must start with 'sk-'." });
  }

  try {
    const result = await generateManifest({ runId, visitorApiKey });
    if (!result) {
      return res.status(404).json({ error: "Run not found or expired" });
    }
    return res.status(200).json({ manifest: result.manifest });
  } catch (err) {
    return res.status(statusForError(err)).json({ error: sanitizeForClient(err) });
  }
}));


// =====================================================================
// POST /api/speedrun/url/start
// =====================================================================
router.post("/url/start", ash(async (req, res) => {
  const { url } = req.body || {};
  if (!url || typeof url !== "string" || !url.trim()) {
    return res.status(400).json({ error: "url is required", code: "INVALID_URL" });
  }

  // Hybrid-disabled gate only fires when there's no way to make later Claude
  // calls — but URL validation + fetch errors (400/403/502/504) must surface
  // regardless of mode, so the visitor gets meaningful feedback. So: resolve
  // mode first only to know whether to enforce the URL-start rate limit; the
  // 503 "Hybrid disabled" is deferred until after the fetch succeeds.
  const { visitorApiKey, blocked } = await resolveMode(req);
  if (blocked && blocked.status === 429) {
    res.set("Retry-After", String(blocked.body.retryAfterSec));
    return res.status(blocked.status).json(blocked.body);
  }
  if (blocked && blocked.body?.hybridDisabled && visitorApiKey) {
    // Shouldn't happen — Full mode never returns blocked — but be safe.
    return res.status(blocked.status).json(blocked.body);
  }

  // Tighter rate limit for URL-run starts (5/h/IP, Full mode exempt).
  if (!visitorApiKey) {
    const rl = rateLimit({
      key: `speedrun-url-start:${req.ip}`,
      limit: URL_START_LIMIT_PER_HOUR,
      windowMs: HOUR_MS,
    });
    if (!rl.allowed) {
      res.set("Retry-After", String(Math.ceil(rl.retryAfterMs / 1000)));
      return res.status(429).json({
        error: "Too many URL speedruns",
        retryAfterSec: Math.ceil(rl.retryAfterMs / 1000),
        code: "RATE_LIMIT",
      });
    }
  }

  try {
    const { runId, initialState } = await startUrlRun({
      url: url.trim(),
      visitorApiKey,
      ip: req.ip || "",
    });
    // Fetch succeeded. Now enforce the Hybrid-disabled gate: if there's no
    // visitor key AND no server key, later step/manifest calls would fail
    // anyway — tell the visitor up front.
    if (!visitorApiKey && !process.env.ANTHROPIC_API_KEY) {
      return res.status(503).json({
        error: "Hybrid mode disabled. Add your API key to start.",
        hybridDisabled: true,
      });
    }
    return res.status(201).json({ runId, initialState });
  } catch (err) {
    const { status, body } = urlErrorToResponse(err);
    if (status === 429 && body.retryAfterSec) res.set("Retry-After", String(body.retryAfterSec));
    // Hostname-only logging for abuse triage; never log path/query/keys.
    const hostMatch = String(url).match(URL_HOSTNAME_LOG_RE);
    const host = hostMatch ? hostMatch[1] : "(invalid-url)";
    if (status >= 500) {
      console.warn(`[speedrun/url/start] ${status} for host=${host} code=${body.code}`);
    }
    return res.status(status).json(body);
  }
}));

// =====================================================================
// POST /api/speedrun/url/step
// =====================================================================
router.post("/url/step", ash(async (req, res) => {
  const { runId } = req.body || {};
  if (!runId || !RUN_ID_RE.test(runId)) {
    return res.status(400).json({ error: "runId is required and must match r-[a-z0-9]{12}." });
  }

  const { visitorApiKey, blocked } = await resolveMode(req);
  if (blocked) {
    if (blocked.status === 429) res.set("Retry-After", String(blocked.body.retryAfterSec));
    return res.status(blocked.status).json(blocked.body);
  }

  try {
    const result = await stepRun({ runId, visitorApiKey });
    if (!result) return res.status(404).json({ error: "Run not found or expired" });
    if (result.complete) {
      return res.status(409).json({
        error: "Run already complete",
        manifest: result.run.manifest,
      });
    }
    return res.status(200).json({
      step: result.step,
      thought: result.thought,
      action: result.action,
      done: result.done,
      latencyMs: result.latencyMs,
    });
  } catch (err) {
    return res.status(statusForError(err)).json({ error: sanitizeForClient(err) });
  }
}));

// =====================================================================
// POST /api/speedrun/url/manifest
// =====================================================================
router.post("/url/manifest", ash(async (req, res) => {
  const { runId } = req.body || {};
  if (!runId || !RUN_ID_RE.test(runId)) {
    return res.status(400).json({ error: "runId is required and must match r-[a-z0-9]{12}." });
  }

  const { visitorApiKey, blocked } = await resolveMode(req);
  if (blocked) {
    if (blocked.status === 429) res.set("Retry-After", String(blocked.body.retryAfterSec));
    return res.status(blocked.status).json(blocked.body);
  }

  try {
    const result = await generateManifest({ runId, visitorApiKey });
    if (!result) return res.status(404).json({ error: "Run not found or expired" });
    return res.status(200).json({ manifest: result.manifest });
  } catch (err) {
    return res.status(statusForError(err)).json({ error: sanitizeForClient(err) });
  }
}));

export default router;
