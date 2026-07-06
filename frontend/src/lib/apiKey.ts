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
    label: "Kimi",
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
 * Providers that share the generic `sk-` prefix and therefore cannot be
 * distinguished by key alone. Used by the widget to decide whether to show
 * the disambiguation dropdown.
 */
export const AMBIGUOUS_PROVIDERS: ProviderId[] = ["openai", "kimi", "zai"];

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
 * Detect provider purely from the key prefix. Distinctive prefixes are checked
 * before the generic `sk-`. Kimi and Z.AI both use `sk-` and are therefore not
 * distinguishable from OpenAI by key alone — they resolve to "openai" here and
 * require a manual override via {@link setProviderOverride}.
 *
 * Order: sk-ant- → anthropic, AIza → gemini, crsr_/cursor- → cursor,
 *        sk- → openai (default fallback for ambiguous keys).
 */
export function detectProvider(key: string): ProviderId | null {
  const trimmed = key.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("sk-ant-")) return "anthropic";
  if (trimmed.startsWith("AIza")) return "gemini";
  if (trimmed.startsWith("crsr_") || trimmed.startsWith("cursor-")) return "cursor";
  if (trimmed.startsWith("sk-")) return "openai";
  return null;
}

/**
 * Returns true when the key's prefix is shared by multiple providers
 * (OpenAI/Kimi/Z.AI all use `sk-`), meaning the user may need to disambiguate.
 */
export function isAmbiguousKey(key: string): boolean {
  return detectProvider(key) === "openai";
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
