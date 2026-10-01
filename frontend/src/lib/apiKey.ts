import type { AiProvider } from "../types";

/**
 * Provider identifier. Mirrors the backend `ProviderId` in
 * backend/lib/providers.js. Co-located alias so callers don't need to import
 * from two places.
 */
export type ProviderId = AiProvider;

const STORAGE_KEY = "cme_exe_api_key";
const OVERRIDE_KEY = "cme_exe_provider_override";

/**
 * Static metadata for each provider, used by the visitor widget and the admin
 * tab. `keyPrefixes` is ordered most-specific-first for display; actual
 * detection lives in {@link detectProvider}.
 */
export interface ProviderMeta {
  id: ProviderId;
  label: string;
  /** Short prefix badge shown in admin, e.g. "sk-ant-", "AIza". */
  prefixBadge: string;
  /** Placeholder fragment used in the visitor widget, e.g. "sk-ant-…". */
  placeholder: string;
  /** Whether the provider can be auto-detected from the key prefix alone. */
  detectable: boolean;
}

export const PROVIDERS: Record<ProviderId, ProviderMeta> = {
  anthropic: {
    id: "anthropic",
    label: "Anthropic",
    prefixBadge: "sk-ant-",
    placeholder: "sk-ant-…",
    detectable: true,
  },
  openai: {
    id: "openai",
    label: "OpenAI",
    prefixBadge: "sk-",
    placeholder: "sk-…",
    detectable: true,
  },
  gemini: {
    id: "gemini",
    label: "Gemini",
    prefixBadge: "AIza",
    placeholder: "AIza…",
    detectable: true,
  },
  kimi: {
    id: "kimi",
    label: "Kimi (Moonshot)",
    prefixBadge: "sk-",
    placeholder: "sk-…",
    detectable: false,
  },
  zai: {
    id: "zai",
    label: "Z.AI",
    prefixBadge: "sk-",
    placeholder: "sk-…",
    detectable: false,
  },
  cursor: {
    id: "cursor",
    label: "Cursor",
    prefixBadge: "crsr_",
    placeholder: "crsr_…",
    detectable: true,
  },
  "xai": {
    id: "xai",
    label: "xAI (Grok)",
    prefixBadge: "xai-",
    placeholder: "xai-…",
    detectable: true,
  },
  "mistral": {
    id: "mistral",
    label: "Mistral",
    prefixBadge: "",
    placeholder: "…",
    detectable: false,
  },
  "deepseek": {
    id: "deepseek",
    label: "DeepSeek",
    prefixBadge: "sk-",
    placeholder: "sk-…",
    detectable: false,
  },
  "qwen": {
    id: "qwen",
    label: "Qwen",
    prefixBadge: "sk-",
    placeholder: "sk-…",
    detectable: false,
  },
  "kimi-code": {
    id: "kimi-code",
    label: "Kimi Code",
    prefixBadge: "sk-kimi-",
    placeholder: "sk-kimi-…",
    detectable: true,
  },
  "zai-cn": {
    id: "zai-cn",
    label: "BigModel (GLM, China)",
    prefixBadge: "",
    placeholder: "…",
    detectable: false,
  },
  "groq": {
    id: "groq",
    label: "Groq",
    prefixBadge: "gsk_",
    placeholder: "gsk_…",
    detectable: true,
  },
  "perplexity": {
    id: "perplexity",
    label: "Perplexity",
    prefixBadge: "pplx-",
    placeholder: "pplx-…",
    detectable: true,
  },
  "openrouter": {
    id: "openrouter",
    label: "OpenRouter",
    prefixBadge: "sk-or-",
    placeholder: "sk-or-…",
    detectable: true,
  },
};

/** Stable display order (matches backend PROVIDER_IDS). */
export const PROVIDER_ORDER: ProviderId[] = [
  "anthropic",
  "openai",
  "gemini",
  "kimi",
  "zai",
  "cursor",
];

/**
 * Providers a visitor can pick in the widget. Admin (hybrid key) screens keep
 * using PROVIDER_ORDER; this is the full Full-mode list. Cursor is detected
 * but not selectable: its keys have no inference API (the backend says so).
 */
export const VISITOR_PROVIDER_ORDER: ProviderId[] = [
  "anthropic",
  "openai",
  "gemini",
  "xai",
  "mistral",
  "deepseek",
  "qwen",
  "kimi",
  "kimi-code",
  "zai",
  "zai-cn",
  "groq",
  "perplexity",
  "openrouter",
];

export function getApiKey(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setApiKey(key: string): void {
  const trimmed = key.trim();
  if (!trimmed) return;
  try {
    localStorage.setItem(STORAGE_KEY, trimmed);
  } catch {
    /* storage unavailable — non-fatal */
  }
}

export function clearApiKey(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* storage unavailable — non-fatal */
  }
}

/**
 * Detect provider from the key prefix (mirrors backend/lib/providers.js).
 * Longest distinctive prefix wins; a bare `sk-` falls back to OpenAI. Keys with
 * no unique prefix (Mistral, DeepSeek, Qwen, Kimi, Z.AI, …) return null or
 * "openai" and need a manual pick via {@link setProviderOverride}.
 */
const PREFIXES: Array<[string, ProviderId]> = [
  ["sk-ant-", "anthropic"],
  ["sk-or-", "openrouter"],
  ["sk-kimi-", "kimi-code"],
  ["xai-", "xai"],
  ["gsk_", "groq"],
  ["pplx-", "perplexity"],
  ["AIza", "gemini"],
  ["crsr_", "cursor"],
  ["cursor-", "cursor"],
  ["sk-", "openai"],
];

export function detectProvider(key: string): ProviderId | null {
  const trimmed = key.trim();
  if (!trimmed) return null;
  return PREFIXES.find(([prefix]) => trimmed.startsWith(prefix))?.[1] ?? null;
}

/**
 * True when the key's prefix doesn't pin down a provider (generic `sk-`, or no
 * recognised prefix at all) so the visitor should confirm it in the dropdown.
 */
export function isAmbiguousKey(key: string): boolean {
  const d = detectProvider(key);
  return d === null || d === "openai";
}

export function getProviderOverride(): ProviderId | null {
  try {
    const v = localStorage.getItem(OVERRIDE_KEY);
    if (v && (PROVIDERS as Record<string, ProviderMeta>)[v]) {
      return v as ProviderId;
    }
    return null;
  } catch {
    return null;
  }
}

export function setProviderOverride(id: ProviderId | null): void {
  try {
    if (id === null) {
      localStorage.removeItem(OVERRIDE_KEY);
    } else {
      localStorage.setItem(OVERRIDE_KEY, id);
    }
  } catch {
    /* storage unavailable — non-fatal */
  }
}

/**
 * The effective provider for the currently stored key. Override wins when set
 * (visitor explicitly picked Kimi/Z.AI); otherwise falls back to prefix
 * detection. Returns null if no key is stored or the key is unrecognized.
 */
export function getEffectiveProvider(): ProviderId | null {
  const key = getApiKey();
  if (!key) return null;
  return getProviderOverride() ?? detectProvider(key);
}

export function providerLabel(provider: ProviderId | null): string {
  if (!provider) return "Unknown";
  return PROVIDERS[provider].label;
}
