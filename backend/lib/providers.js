/**
 * AI provider registry — Anthropic, OpenAI, Gemini, xAI (Grok), Mistral,
 * DeepSeek, Qwen, Kimi (Moonshot / Kimi Code), Z.AI (GLM), Groq, Perplexity,
 * OpenRouter, plus Cursor (recognized, but has no inference API).
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
 * @typedef {"anthropic" | "openai" | "gemini" | "xai" | "mistral" | "deepseek" | "qwen" | "kimi" | "kimi-code" | "zai" | "zai-cn" | "groq" | "perplexity" | "openrouter" | "cursor"} ProviderId
 */

/**
 * @typedef {Object} ProviderConfig
 * @property {ProviderId} id
 * @property {string} label             Human-readable name for UIs.
 * @property {string[]} keyPrefixes     Substrings that identify a key for this provider.
 * @property {string} baseUrl           OpenAI-compat base URL (where applicable).
 * @property {string | null} defaultModel  Fallback model id (null → first chat model from /models).
 * @property {"openai" | "anthropic" | "gemini"} apiFormat   Which client to use.
 * @property {string} [envVar]          Environment variable for server-configured key.
 * @property {boolean} supportsSystemPrompt   Whether the API accepts system prompts.
 * @property {string} [unsupported]     If set, the provider is recognized but cannot be called (message for the visitor).
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
  // Generic `sk-` fallback — see detectProvider().
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
  gemini: {
    id: "gemini",
    label: "Google Gemini",
    keyPrefixes: ["AIza"],
    baseUrl: "https://generativelanguage.googleapis.com",
    defaultModel: "gemini-2.5-flash",
    apiFormat: "gemini",
    envVar: "GEMINI_API_KEY",
    supportsSystemPrompt: true,
  },
  "xai": {
    id: "xai",
    label: "xAI (Grok)",
    keyPrefixes: ["xai-"],
    baseUrl: "https://api.x.ai/v1",
    defaultModel: "grok-4",
    apiFormat: "openai",
    envVar: "XAI_API_KEY",
    supportsSystemPrompt: true,
  },
  "mistral": {
    id: "mistral",
    label: "Mistral",
    keyPrefixes: [],
    baseUrl: "https://api.mistral.ai/v1",
    defaultModel: "mistral-large-latest",
    apiFormat: "openai",
    envVar: "MISTRAL_API_KEY",
    supportsSystemPrompt: true,
  },
  "deepseek": {
    id: "deepseek",
    label: "DeepSeek",
    keyPrefixes: [],
    baseUrl: "https://api.deepseek.com/v1",
    defaultModel: "deepseek-chat",
    apiFormat: "openai",
    envVar: "DEEPSEEK_API_KEY",
    supportsSystemPrompt: true,
  },
  "qwen": {
    id: "qwen",
    label: "Alibaba (Qwen)",
    keyPrefixes: [],
    baseUrl: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
    defaultModel: "qwen-plus",
    apiFormat: "openai",
    envVar: "QWEN_API_KEY",
    supportsSystemPrompt: true,
  },
  "kimi": {
    id: "kimi",
    label: "Kimi (Moonshot)",
    keyPrefixes: [],
    baseUrl: "https://api.moonshot.ai/v1",
    defaultModel: "moonshot-v1-32k",
    apiFormat: "openai",
    envVar: "KIMI_API_KEY",
    supportsSystemPrompt: true,
  },
  "kimi-code": {
    id: "kimi-code",
    label: "Kimi Code",
    keyPrefixes: ["sk-kimi-"],
    baseUrl: "https://api.kimi.ai/coding/v1",
    defaultModel: null,
    apiFormat: "openai",
    envVar: "KIMI_CODE_API_KEY",
    supportsSystemPrompt: true,
  },
  "zai": {
    id: "zai",
    label: "Z.AI (GLM)",
    keyPrefixes: [],
    baseUrl: "https://api.z.ai/api/paas/v4",
    defaultModel: "glm-4-plus",
    apiFormat: "openai",
    envVar: "ZAI_API_KEY",
    supportsSystemPrompt: true,
  },
  "zai-cn": {
    id: "zai-cn",
    label: "BigModel (GLM, China)",
    keyPrefixes: [],
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    defaultModel: "glm-4-plus",
    apiFormat: "openai",
    envVar: "ZAI_CN_API_KEY",
    supportsSystemPrompt: true,
  },
  "groq": {
    id: "groq",
    label: "Groq",
    keyPrefixes: ["gsk_"],
    baseUrl: "https://api.groq.com/openai/v1",
    defaultModel: "llama-3.3-70b-versatile",
    apiFormat: "openai",
    envVar: "GROQ_API_KEY",
    supportsSystemPrompt: true,
  },
  "perplexity": {
    id: "perplexity",
    label: "Perplexity",
    keyPrefixes: ["pplx-"],
    baseUrl: "https://api.perplexity.ai",
    defaultModel: "sonar",
    apiFormat: "openai",
    envVar: "PERPLEXITY_API_KEY",
    supportsSystemPrompt: true,
  },
  "openrouter": {
    id: "openrouter",
    label: "OpenRouter",
    keyPrefixes: ["sk-or-"],
    baseUrl: "https://openrouter.ai/api/v1",
    defaultModel: "openrouter/auto",
    apiFormat: "openai",
    envVar: "OPENROUTER_API_KEY",
    supportsSystemPrompt: true,
  },
  // Cursor keys (crsr_…) only unlock the Admin / Cloud Agents API — Cursor
  // documents that it is not a chat-completions or model-inference API.
  cursor: {
    id: "cursor",
    label: "Cursor",
    keyPrefixes: ["crsr_", "cursor-"],
    baseUrl: "https://api.cursor.com",
    defaultModel: null,
    apiFormat: "openai",
    envVar: "CURSOR_API_KEY",
    supportsSystemPrompt: true,
    unsupported:
      "Cursor API keys cannot be used for LLM calls: Cursor only offers a Cloud Agents / Admin API, not a chat-completions API. Use a key from Anthropic, OpenAI, Gemini, xAI, Mistral, DeepSeek, Kimi, Z.AI, Groq or OpenRouter instead.",
  },
};

export const PROVIDER_IDS = Object.keys(PROVIDERS);

/**
 * Detect which provider a given API key belongs to from its prefix alone.
 * Distinctive prefixes win; a bare `sk-` falls back to OpenAI. Providers whose
 * keys carry no unique prefix (Mistral, DeepSeek, Qwen, Kimi, Z.AI …) can only
 * be selected via an explicit hint — see {@link resolveProvider}.
 *
 * @param {string} apiKey
 * @returns {ProviderConfig | null}
 */
export function detectProvider(apiKey) {
  if (!apiKey || typeof apiKey !== "string") return null;
  let best = null;
  let bestLen = 0;
  for (const cfg of Object.values(PROVIDERS)) {
    for (const p of cfg.keyPrefixes) {
      // Longest matching prefix wins: sk-ant- / sk-or- / sk-kimi- beat sk-.
      if (apiKey.startsWith(p) && p.length > bestLen) {
        best = cfg;
        bestLen = p.length;
      }
    }
  }
  return best;
}

/**
 * Provider for a visitor key: an explicit, valid hint (from the widget's
 * provider dropdown) beats prefix detection.
 *
 * @param {string} apiKey
 * @param {string | null | undefined} [hint]
 * @returns {ProviderConfig | null}
 */
export function resolveProvider(apiKey, hint) {
  if (hint && Object.prototype.hasOwnProperty.call(PROVIDERS, hint)) return PROVIDERS[hint];
  return detectProvider(apiKey);
}

/**
 * Validate a visitor key + optional provider hint (Full mode). Replaces the old
 * hard-coded `sk-` check.
 *
 * @param {string} apiKey
 * @param {string | null | undefined} [hint]
 * @returns {{ provider: ProviderConfig } | { error: string }}
 */
export function validateVisitorKey(apiKey, hint) {
  if (typeof apiKey !== "string" || apiKey.length < 8 || /\s/.test(apiKey)) {
    return { error: "Invalid API key format." };
  }
  const provider = resolveProvider(apiKey, hint);
  if (!provider) {
    return {
      error:
        "Could not tell which provider this key belongs to. Pick the provider next to the key field (supported: " +
        Object.values(PROVIDERS).filter((p) => !p.unsupported).map((p) => p.label).join(", ") +
        ").",
    };
  }
  if (provider.unsupported) return { error: provider.unsupported };
  return { provider };
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

  if (cfg.unsupported) throw Object.assign(new Error(cfg.unsupported), { status: 400 });

  // A Claude model id (e.g. from a persona) is meaningless to other providers.
  const requested = providerId !== "anthropic" && /^claude/i.test(opts.model || "") ? null : opts.model;
  const model = requested || cfg.defaultModel;

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

async function callOpenAICompat({ cfg, apiKey, model: modelIn, systemPrompt, messages, maxTokens, signal }) {
  let model = modelIn;
  const client = new OpenAI({
    apiKey,
    baseURL: cfg.baseUrl,
    signal,
  });
  // No static default (Kimi Code): use the first chat model the key can see.
  if (!model) {
    const list = await client.models.list();
    const ids = [];
    for await (const m of list) ids.push(m.id);
    model = ids.find((id) => !/embed|tts|whisper|image|moderation|rerank/i.test(id));
    if (!model) throw Object.assign(new Error(`${cfg.label}: no chat model available for this key.`), { status: 400 });
  }
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
