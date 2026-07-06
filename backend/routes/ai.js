import { Router } from "express";
import crypto from "crypto";
import { callClaude, streamClaude } from "../lib/claude.js";
import { rateLimit } from "../lib/rateLimit.js";
import { readJson, SETTINGS_FILE } from "../lib/storage.js";

const router = Router();

const HOUR_MS = 60 * 60 * 1000;
const DEFAULT_HYBRID_LIMIT = 20;
const MAX_SYSTEM_PROMPT = 32_000;
const MAX_MESSAGES = 200;
const MAX_TOKENS_CAP = 8192;

const ash = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/**
 * Hash an IP with the session secret so logs are anonymized but stable.
 * @param {string} ip
 * @returns {string}
 */
function hashIp(ip) {
  const salt = process.env.SESSION_SECRET || "cme-exe-ip-salt";
  return crypto.createHash("sha256").update(`${salt}:${ip}`).digest("hex").slice(0, 16);
}

/**
 * Validate a Claude request body shared by both endpoints.
 * @param {any} body
 * @returns {string | null} error message, or null when valid
 */
function validateBody(body) {
  if (!body || typeof body !== "object") return "Request body required";
  const { systemPrompt, messages, model, maxTokens, stream } = body;

  if (systemPrompt !== undefined) {
    if (typeof systemPrompt !== "string") return "systemPrompt must be a string";
    if (systemPrompt.length > MAX_SYSTEM_PROMPT) return "systemPrompt too long";
  }
  if (!Array.isArray(messages)) return "messages must be an array";
  if (messages.length === 0) return "messages must not be empty";
  if (messages.length > MAX_MESSAGES) return "too many messages";
  for (const m of messages) {
    if (!m || (m.role !== "user" && m.role !== "assistant")) return "invalid message role";
    if (typeof m.content !== "string" && !Array.isArray(m.content)) {
      return "invalid message content";
    }
  }
  if (model !== undefined && typeof model !== "string") return "model must be a string";
  if (maxTokens !== undefined) {
    if (typeof maxTokens !== "number" || !Number.isInteger(maxTokens) || maxTokens <= 0) {
      return "maxTokens must be a positive integer";
    }
    if (maxTokens > MAX_TOKENS_CAP) return `maxTokens must be <= ${MAX_TOKENS_CAP}`;
  }
  if (stream !== undefined && typeof stream !== "boolean") return "stream must be a boolean";
  return null;
}

/**
 * Extract a visitor-supplied API key from request headers (Full mode).
 * @param {import('express').Request} req
 * @returns {string | null}
 */
function extractVisitorKey(req) {
  const auth = req.get("authorization");
  if (auth && /^bearer\s+/i.test(auth)) {
    const key = auth.replace(/^bearer\s+/i, "").trim();
    if (key) return key;
  }
  const xKey = req.get("x-visitor-key");
  if (xKey && xKey.trim()) return xKey.trim();
  return null;
}

/**
 * Write one Server-Sent-Event frame.
 * @param {import('express').Response} res
 * @param {string} type
 * @param {Record<string, any>} [extra]
 */
function sse(res, type, extra) {
  res.write(`data: ${JSON.stringify({ type, ...(extra || {}) })}\n\n`);
}

/**
 * Run a Claude call in streaming mode over SSE. Emits:
 *   data: { type: "token", text }
 *   data: { type: "done", usage, model }
 *   data: { type: "error", message }  (on failure)
 *
 * @param {Object} opts
 * @param {import('express').Response} opts.res
 * @param {import('express').Request} opts.req
 * @param {string} [opts.systemPrompt]
 * @param {any[]} opts.messages
 * @param {string} [opts.model]
 * @param {number} [opts.maxTokens]
 * @param {string} [opts.visitorApiKey]
 * @param {((info: { model: string, usage: any }) => void) | null} [opts.onDone] Optional anonymized logging hook.
 */
async function runStream({ res, req, systemPrompt, messages, model, maxTokens, visitorApiKey, onDone }) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });

  let aborted = false;
  const onClose = () => { aborted = true; };
  req.on("close", onClose);

  try {
    const result = await streamClaude({
      systemPrompt,
      messages,
      model,
      maxTokens,
      visitorApiKey,
      onToken: (text) => {
        if (!aborted) sse(res, "token", { text });
      },
    });
    if (!aborted) {
      sse(res, "done", { usage: result.usage, model: result.model });
      if (onDone) onDone({ model: result.model, usage: result.usage });
    }
  } catch (err) {
    const message = sanitizeForClient(err);
    if (!aborted) sse(res, "error", { message });
  } finally {
    req.off("close", onClose);
    try { res.end(); } catch { /* already closed */ }
  }
}

/**
 * Produce a safe, key-free error message for the client.
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
 * Map an internal error to an HTTP status code for the non-stream path.
 * @param {unknown} err
 * @returns {number}
 */
function statusForError(err) {
  const s = /** @type {any} */ (err)?.status;
  if (typeof s === "number") return s >= 400 && s < 600 ? s : 502;
  return 502;
}

// =====================================================================
// POST /api/ai/claude — Hybrid mode (server's own key, rate-limited).
// =====================================================================
router.post("/claude", ash(async (req, res) => {
  const validationError = validateBody(req.body);
  if (validationError) return res.status(400).json({ error: validationError });

  const { systemPrompt, messages, model, maxTokens, stream } = req.body;

  const isAdmin = !!(req.session && req.session.isAdmin);

  // Non-admin visitors are rate-limited per IP; admins bypass the limiter.
  if (!isAdmin) {
    let limit = DEFAULT_HYBRID_LIMIT;
    try {
      const settings = await readJson(SETTINGS_FILE);
      const configured = settings?.experience?.hybridRateLimitPerHour;
      if (typeof configured === "number" && configured > 0) limit = configured;
    } catch { /* fall back to default */ }

    const rl = rateLimit({ key: `hybrid:${req.ip}`, limit, windowMs: HOUR_MS });
    if (!rl.allowed) {
      res.set("Retry-After", String(Math.ceil(rl.retryAfterMs / 1000)));
      return res.status(429).json({ error: "Rate limit reached. Try again later or use Full mode with your own key." });
    }
  }

  // Anonymized cost/usage logging. NEVER logs prompts or any user content.
  const logUsage = ({ model: m, usage }) => {
    const ts = new Date().toISOString();
    const ip = hashIp(req.ip || "unknown");
    console.log(
      `[ai/claude] ts=${ts} ip=${ip} admin=${isAdmin} model=${m} ` +
      `in=${usage?.input_tokens ?? "?"} out=${usage?.output_tokens ?? "?"} stream=${!!stream}`
    );
  };

  try {
    if (stream) {
      return await runStream({
        res, req, systemPrompt, messages, model, maxTokens,
        visitorApiKey: undefined,
        onDone: logUsage,
      });
    }
    const result = await callClaude({ systemPrompt, messages, model, maxTokens });
    logUsage({ model: result.model, usage: result.usage });
    return res.json({ text: result.text, usage: result.usage, model: result.model });
  } catch (err) {
    return res.status(statusForError(err)).json({ error: sanitizeForClient(err) });
  }
}));

// =====================================================================
// POST /api/ai/proxy — Full mode (visitor's own key, NO logging).
// =====================================================================
router.post("/proxy", ash(async (req, res) => {
  const validationError = validateBody(req.body);
  if (validationError) return res.status(400).json({ error: validationError });

  const visitorApiKey = extractVisitorKey(req);
  if (!visitorApiKey) {
    return res.status(401).json({
      error: "Visitor API key required. Send it via 'Authorization: Bearer <key>' or 'X-Visitor-Key: <key>'.",
    });
  }

  const { systemPrompt, messages, model, maxTokens, stream } = req.body;

  try {
    if (stream) {
      return await runStream({
        res, req, systemPrompt, messages, model, maxTokens,
        visitorApiKey,
        onDone: null, // intentionally no logging in Full mode
      });
    }
    const result = await callClaude({ systemPrompt, messages, model, maxTokens, visitorApiKey });
    return res.json({ text: result.text, usage: result.usage, model: result.model });
  } catch (err) {
    // Full mode: no logging of any kind — even sanitized errors stay client-side only.
    return res.status(statusForError(err)).json({ error: sanitizeForClient(err) });
  }
}));

export default router;
