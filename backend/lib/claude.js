import Anthropic from "@anthropic-ai/sdk";
import { readFileSync } from "fs";
import { readJson, PERSONAS_FILE, API_KEYS_FILE } from "./storage.js";
import { detectProvider, callProvider } from "./providers.js";

/**
 * Default model used when no model is passed. Per the spec we try to read it
 * from personas.json on startup; if that fails we fall back to claude-sonnet-4-5.
 */
/**
 * Reset the cached server client. Call this after the admin updates the API
 * key via /api/admin/api-keys so subsequent Hybrid-mode calls use the new key.
 */
export function resetServerClient() {
  _serverClient = null;
}

export const DEFAULT_MODEL = "claude-sonnet-4-5";

let _resolvedDefaultModel = null;

/**
 * Resolve the default model from personas.json (first persona's model field),
 * cached after first lookup. Falls back to DEFAULT_MODEL on any error.
 * @returns {Promise<string>}
 */
export async function resolveDefaultModel() {
  if (_resolvedDefaultModel) return _resolvedDefaultModel;
  try {
    const personas = await readJson(PERSONAS_FILE);
    if (personas && typeof personas === "object") {
      const first = Object.values(personas)[0];
      if (first && typeof first.model === "string") {
        _resolvedDefaultModel = first.model;
        return _resolvedDefaultModel;
      }
    }
  } catch {
    // fall through to default
  }
  _resolvedDefaultModel = DEFAULT_MODEL;
  return _resolvedDefaultModel;
}

/** @type {Anthropic | null} */
let _serverClient = null;

/**
 * Lazily build the server's Anthropic client (Hybrid mode). Throws a clean
 * error if no ANTHROPIC_API_KEY is configured; never throws on import.
 * @returns {Anthropic}
 */
function getServerClient() {
  if (_serverClient) return _serverClient;
  // Prefer admin-set key from data/api-keys.json, fall back to env var.
  let apiKey = process.env.ANTHROPIC_API_KEY;
  try {
    // Synchronous read — the key is needed before any AI call can be made,
    // and we want the resolution to be deterministic at client construction.
    const raw = readFileSync(API_KEYS_FILE, "utf-8");
    const stored = JSON.parse(raw);
    if (stored && typeof stored.anthropic === "string" && stored.anthropic) {
      apiKey = stored.anthropic;
    }
  } catch {
    // File missing / unreadable / invalid JSON — env var remains the source.
  }
  if (!apiKey) {
    throw new Error(
      "Hybrid mode is disabled: ANTHROPIC_API_KEY is not set on the server."
    );
  }
  _serverClient = new Anthropic({ apiKey });
  return _serverClient;
}

/**
 * Build a one-off client using a visitor-supplied key (Full mode). The client
 * is not cached and the key is never logged or persisted.
 * @param {string} apiKey
 * @returns {Anthropic}
 */
function makeVisitorClient(apiKey) {
  return new Anthropic({ apiKey });
}

/**
 * Strip anything that looks like an API key from an error message. Anthropic
 * keys match /^sk-ant-/. We redact broadly to be safe.
 * @param {string} text
 * @returns {string}
 */
function sanitizeText(text) {
  if (typeof text !== "string") return String(text ?? "");
  return text
    .replace(/sk-ant-[A-Za-z0-9_-]+/g, "sk-ant-***")
    .replace(/sk-[A-Za-z0-9_-]+/g, "sk-***");
}

/**
 * Normalize an Anthropic SDK error into a safe, key-free message.
 * @param {unknown} err
 * @returns {{ message: string, status?: number }}
 */
function normalizeError(err) {
  const status = /** @type {any} */ (err)?.status;
  const raw =
    (typeof err === "object" && err && /** @type {any} */ (err).message) ||
    String(err);
  return { message: sanitizeText(raw), status: typeof status === "number" ? status : undefined };
}

/**
 * @typedef {Object} ClaudeCallArgs
 * @property {string} [systemPrompt]
 * @property {Array<{ role: 'user'|'assistant', content: string | Array<any> }>} messages
 * @property {string} [model]
 * @property {number} [maxTokens]
 * @property {string} [visitorApiKey]  If set, use the visitor's key (Full mode).
 */

/**
 * Extract the plain text from an Anthropic message response.
 * @param {import('@anthropic-ai/sdk').Anthropic.Message} msg
 * @returns {string}
 */
function extractText(msg) {
  if (!msg || !Array.isArray(msg.content)) return "";
  return msg.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("");
}

/**
 * Non-streaming Claude call (Hybrid or Full mode).
 * @param {ClaudeCallArgs} args
 * @returns {Promise<{ text: string, usage: any, model: string }>}
 */
export async function callClaude({ systemPrompt, messages, model, maxTokens, visitorApiKey }) {
  // Provider routing: if the visitor's key is for a non-Anthropic provider
  // (OpenAI, Kimi, Z.AI, Gemini, Cursor), delegate to callProvider so we
  // speak the right API format. Hybrid mode (no visitor key) always uses
  // Anthropic since that's what the server is configured with.
  if (visitorApiKey) {
    const detected = detectProvider(visitorApiKey);
    if (detected && detected.id !== "anthropic") {
      try {
        const result = await callProvider({
          provider: detected.id,
          apiKey: visitorApiKey,
          model: model || detected.defaultModel,
          systemPrompt,
          messages,
          maxTokens: maxTokens ?? 1024,
        });
        return {
          text: result.text,
          usage: {
            input_tokens: result.usage.inputTokens,
            output_tokens: result.usage.outputTokens,
          },
          model: result.model,
        };
      } catch (err) {
        const { message, status } = normalizeError(err);
        const e = new Error(message);
        if (status) e.status = status;
        throw e;
      }
    }
  }

  const client = visitorApiKey ? makeVisitorClient(visitorApiKey) : getServerClient();
  const usedModel = model || (await resolveDefaultModel());
  try {
    const msg = await client.messages.create({
      model: usedModel,
      max_tokens: maxTokens ?? 1024,
      ...(systemPrompt ? { system: systemPrompt } : {}),
      messages,
    });
    return { text: extractText(msg), usage: msg.usage, model: msg.model };
  } catch (err) {
    const { message, status } = normalizeError(err);
    const e = new Error(message);
    if (status) e.status = status;
    throw e;
  }
}

/**
 * Streaming Claude call. Invokes onToken with each text delta as it arrives.
 * Returns the accumulated result when the stream finishes.
 *
 * @param {ClaudeCallArgs & { onToken?: (text: string) => void }} args
 * @returns {Promise<{ text: string, usage: any, model: string }>}
 */
export async function streamClaude({ systemPrompt, messages, model, maxTokens, visitorApiKey, onToken }) {
  // Provider routing (same as callClaude): non-Anthropic visitor keys go
  // through callProvider. For now we emit the full response as a single
  // token — true token-by-token streaming across all 6 providers would
  // require per-provider stream implementations. The UX impact is minimal
  // because the typewriter effect on the frontend re-chunks the text anyway.
  if (visitorApiKey) {
    const detected = detectProvider(visitorApiKey);
    if (detected && detected.id !== "anthropic") {
      try {
        const result = await callProvider({
          provider: detected.id,
          apiKey: visitorApiKey,
          model: model || detected.defaultModel,
          systemPrompt,
          messages,
          maxTokens: maxTokens ?? 1024,
        });
        if (onToken && result.text) onToken(result.text);
        return {
          text: result.text,
          usage: {
            input_tokens: result.usage.inputTokens,
            output_tokens: result.usage.outputTokens,
          },
          model: result.model,
        };
      } catch (err) {
        const { message, status } = normalizeError(err);
        const e = new Error(message);
        if (status) e.status = status;
        throw e;
      }
    }
  }

  const client = visitorApiKey ? makeVisitorClient(visitorApiKey) : getServerClient();
  const usedModel = model || (await resolveDefaultModel());
  try {
    const stream = client.messages.stream({
      model: usedModel,
      max_tokens: maxTokens ?? 1024,
      ...(systemPrompt ? { system: systemPrompt } : {}),
      messages,
    });

    let acc = "";
    stream.on("text", (delta) => {
      acc += delta;
      if (typeof onToken === "function") onToken(delta);
    });

    const final = await stream.finalMessage();
    return { text: acc || extractText(final), usage: final.usage, model: final.model };
  } catch (err) {
    const { message, status } = normalizeError(err);
    const e = new Error(message);
    if (status) e.status = status;
    throw e;
  }
}
