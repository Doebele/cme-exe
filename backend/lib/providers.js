/**
 * AI provider registry — supports Anthropic, OpenAI, Kimi (Moonshot), Z.AI
 * (Zhipu BigModel), Gemini (Google), and Cursor (which proxies OpenAI-compat).
 *
 * Most providers speak the OpenAI Chat Completions format. Anthropic and
 * Gemini have their own SDKs. This module centralizes the per-provider
 * config (base URLs, default models, key-prefix detection) and exposes a
 * unified `callProvider()` that routes to the right client.
 */

import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenerativeAI } from "@google/generative-ai";

/**
 * @typedef {"anthropic" | "openai" | "kimi" | "zai" | "gemini" | "cursor"} ProviderId
 */

/**
 * @typedef {Object} ProviderConfig
 * @property {ProviderId} id
 * @property {string} label             Human-readable name for UIs.
 * @property {string[]} keyPrefixes     Substrings that identify a key for this provider.
 * @property {string} baseUrl           OpenAI-compat base URL (where applicable).
 * @property {string} defaultModel      Fallback model id.
 * @property {"openai" | "anthropic" | "gemini"} apiFormat   Which client to use.
 * @property {string} [envVar]          Environment variable for server-configured key.
 * @property {boolean} supportsSystemPrompt   Whether the API accepts system prompts.
 */

/** @type {Record<ProviderId, ProviderConfig>} */
export const PROVIDERS = {
  anthropic: {
    id: "anthropic",
    label: "Anthropic (Claude)",
    keyPrefixes: ["sk-ant-"],
    baseUrl: "https://api.anthropic.com",
    defaultModel: "claude-sonnet-4-5",
    apiFormat: "anthropic",
    envVar: "ANTHROPIC_API_KEY",
    supportsSystemPrompt: true,
  },
  openai: {
    id: "openai",
    label: "OpenAI (GPT)",
    keyPrefixes: ["sk-"],
    baseUrl: "https://api.openai.com/v1",
    defaultModel: "gpt-4o",
    apiFormat: "openai",
    envVar: "OPENAI_API_KEY",
    supportsSystemPrompt: true,
  },
  kimi: {
    id: "kimi",
    label: "Kimi (Moonshot AI)",
    keyPrefixes: ["sk-"],
    baseUrl: "https://api.moonshot.cn/v1",
    defaultModel: "moonshot-v1-32k",
    apiFormat: "openai",
    envVar: "KIMI_API_KEY",
    supportsSystemPrompt: true,
  },
  zai: {
    id: "zai",
    label: "Z.AI (Zhipu GLM)",
    keyPrefixes: ["sk-"],
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    defaultModel: "glm-4-plus",
    apiFormat: "openai",
    envVar: "ZAI_API_KEY",
    supportsSystemPrompt: true,
  },
  gemini: {
    id: "gemini",
    label: "Google Gemini",
    keyPrefixes: ["AIza"],
    baseUrl: "https://generativelanguage.googleapis.com",
    defaultModel: "gemini-1.5-flash",
    apiFormat: "gemini",
    envVar: "GEMINI_API_KEY",
    supportsSystemPrompt: true,
  },
  cursor: {
    id: "cursor",
    label: "Cursor",
    keyPrefixes: ["crsr_", "cursor-"],
    baseUrl: "https://api2.cursor.sh/openai",
    defaultModel: "gpt-4o",
    apiFormat: "openai",
    envVar: "CURSOR_API_KEY",
    supportsSystemPrompt: true,
  },
};

export const PROVIDER_IDS = Object.keys(PROVIDERS);

/**
 * Detect which provider a given API key belongs to. Returns null if unknown.
 * Detection order matters: more specific prefixes (sk-ant-, AIza, crsr_)
 * must be tested before generic ones (sk-).
 *
 * @param {string} apiKey
 * @returns {ProviderConfig | null}
 */
export function detectProvider(apiKey) {
  if (!apiKey || typeof apiKey !== "string") return null;
  // Order matters — check distinctive prefixes first.
  const order = ["anthropic", "gemini", "cursor", "kimi", "zai", "openai"];
  for (const id of order) {
    const cfg = PROVIDERS[id];
    if (cfg.keyPrefixes.some((p) => apiKey.startsWith(p))) {
      return cfg;
    }
  }
  return null;
}

/**
 * Get a provider config by id.
 * @param {string} id
 * @returns {ProviderConfig | null}
 */
export function getProvider(id) {
  return PROVIDERS[id] || null;
}

/**
 * Unified AI call. Routes to the right SDK based on the provider's apiFormat.
 *
 * @param {Object} opts
 * @param {ProviderId} opts.provider
 * @param {string} opts.apiKey
 * @param {string} [opts.model]
 * @param {string} [opts.systemPrompt]
 * @param {Array<{role:"user"|"assistant", content:string}>} opts.messages
 * @param {number} [opts.maxTokens=1024]
 * @param {AbortSignal} [opts.signal]
 * @returns {Promise<{text:string, usage:{inputTokens:number, outputTokens:number}, model:string, provider:ProviderId}>}
 */
export async function callProvider(opts) {
  const { provider: providerId, apiKey, systemPrompt, messages, maxTokens = 1024, signal } = opts;
  const cfg = PROVIDERS[providerId];
  if (!cfg) throw new Error(`Unknown provider: ${providerId}`);
  if (!apiKey) throw new Error(`No API key for provider: ${providerId}`);

  const model = opts.model || cfg.defaultModel;

  if (cfg.apiFormat === "openai") {
    return callOpenAICompat({ cfg, apiKey, model, systemPrompt, messages, maxTokens, signal });
  }
  if (cfg.apiFormat === "anthropic") {
    return callAnthropic({ cfg, apiKey, model, systemPrompt, messages, maxTokens, signal });
  }
  if (cfg.apiFormat === "gemini") {
    return callGemini({ cfg, apiKey, model, systemPrompt, messages, maxTokens, signal });
  }
  throw new Error(`Unsupported apiFormat: ${cfg.apiFormat}`);
}

async function callOpenAICompat({ cfg, apiKey, model, systemPrompt, messages, maxTokens, signal }) {
  const client = new OpenAI({
    apiKey,
    baseURL: cfg.baseUrl,
    signal,
  });
  // Cursor's API expects a custom header for auth sometimes; pass through if needed.
  const finalMessages = [];
  if (systemPrompt && cfg.supportsSystemPrompt) {
    finalMessages.push({ role: "system", content: systemPrompt });
  }
  for (const m of messages) finalMessages.push({ role: m.role, content: m.content });

  const completion = await client.chat.completions.create({
    model,
    messages: finalMessages,
    max_tokens: maxTokens,
  });
  const choice = completion.choices?.[0]?.message;
  return {
    text: choice?.content || "",
    usage: {
      inputTokens: completion.usage?.prompt_tokens ?? 0,
      outputTokens: completion.usage?.completion_tokens ?? 0,
    },
    model: completion.model || model,
    provider: cfg.id,
  };
}

async function callAnthropic({ cfg, apiKey, model, systemPrompt, messages, maxTokens, signal }) {
  const client = new Anthropic({ apiKey, signal });
  const completion = await client.messages.create({
    model,
    max_tokens: maxTokens,
    system: systemPrompt || undefined,
    messages: messages.map((m) => ({ role: m.role, content: m.content })),
  });
  const text = completion.content
    ?.filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("") || "";
  return {
    text,
    usage: {
      inputTokens: completion.usage?.input_tokens ?? 0,
      outputTokens: completion.usage?.output_tokens ?? 0,
    },
    model: completion.model || model,
    provider: cfg.id,
  };
}

async function callGemini({ cfg, apiKey, model, systemPrompt, messages, maxTokens, signal }) {
  const genAI = new GoogleGenerativeAI(apiKey);
  const generationConfig = { maxOutputTokens: maxTokens };
  const safetySettings = [
    { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
    { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
    { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
    { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" },
  ];
  const gmodel = genAI.getGenerativeModel({
    model,
    systemInstruction: systemPrompt || undefined,
    generationConfig,
    safetySettings,
  });
  // Convert chat messages to Gemini format.
  const history = messages.slice(0, -1).map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));
  const last = messages[messages.length - 1];
  const chat = gmodel.startChat({ history });
  const result = await chat.sendMessage(last?.content || "");
  // @ts-ignore — signal is supported but types lag.
  if (signal) { /* no-op: Gemini SDK doesn't support AbortSignal directly */ }
  const response = await result.response;
  const text = response.text();
  const usage = response.usageMetadata || {};
  return {
    text,
    usage: {
      inputTokens: usage.promptTokenCount ?? 0,
      outputTokens: usage.candidatesTokenCount ?? 0,
    },
    model,
    provider: cfg.id,
  };
}

/**
 * Mask an API key for safe display.
 * @param {string} key
 * @returns {string}
 */
export function maskKey(key) {
  if (!key || typeof key !== "string") return "";
  if (key.length <= 12) return "•".repeat(key.length);
  return key.slice(0, 8) + "…" + "•".repeat(8) + key.slice(-4);
}
