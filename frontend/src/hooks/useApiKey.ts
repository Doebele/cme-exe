import { useCallback, useEffect, useState } from "react";
import type { AiProvider } from "../types";
import type { ProviderId } from "../lib/apiKey";
import {
  API_KEY_CHANGE_EVENT,
  clearApiKey,
  detectProvider,
  getApiKey,
  getEffectiveProvider,
  getProviderOverride,
  isAmbiguousKey,
  setApiKey,
  setProviderOverride as persistOverride,
} from "../lib/apiKey";

export interface UseApiKey {
  hasKey: boolean;
  /** Effective provider (override ?? detected), or null if no key. */
  provider: ProviderId | null;
  /** Manually-selected override for ambiguous `sk-` keys (OpenAI/Kimi/Z.AI). */
  providerOverride: ProviderId | null;
  /** True when the key uses the generic `sk-` prefix and may need disambiguation. */
  ambiguous: boolean;
  save: (key: string) => ProviderId | null;
  clear: () => void;
  setProviderOverride: (id: ProviderId | null) => void;
}

function readState(): {
  key: string | null;
  provider: ProviderId | null;
  providerOverride: ProviderId | null;
  ambiguous: boolean;
} {
  const key = getApiKey();
  const providerOverride = getProviderOverride();
  const detected = key ? detectProvider(key) : null;
  // An override only matters when the key is ambiguous (sk-). For distinctive
  // prefixes (sk-ant-, AIza, crsr_), detection is authoritative and the
  // override is ignored so the badge always reflects the real provider.
  const effective = key ? (providerOverride ?? detected) : null;
  return {
    key,
    provider: effective,
    providerOverride,
    ambiguous: key ? isAmbiguousKey(key) : false,
  };
}

export function useApiKey(): UseApiKey {
  const [state, setState] = useState(readState);

  // Stay in sync if the key or override changes elsewhere: `storage` covers
  // other tabs/windows (it never fires in the tab that made the write), and
  // API_KEY_CHANGE_EVENT covers other useApiKey() instances in *this* tab
  // (the nav widget, the intro dialog, admin screens — each has its own
  // local state, so a save in one wouldn't otherwise be seen by the others
  // until a reload).
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === "cme_exe_api_key" || e.key === "cme_exe_provider_override") {
        setState(readState());
      }
    };
    const onLocalChange = () => setState(readState());
    window.addEventListener("storage", onStorage);
    window.addEventListener(API_KEY_CHANGE_EVENT, onLocalChange);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(API_KEY_CHANGE_EVENT, onLocalChange);
    };
  }, []);

  const save = useCallback((value: string): ProviderId | null => {
    setApiKey(value);
    // Clear any stale override when a new key with a distinctive prefix is
    // saved — the override only applies to ambiguous `sk-` keys.
    if (!isAmbiguousKey(value)) {
      persistOverride(null);
    }
    setState(readState());
    return getEffectiveProvider();
  }, []);

  const clear = useCallback(() => {
    clearApiKey();
    persistOverride(null);
    setState(readState());
  }, []);

  const setProviderOverride = useCallback((id: ProviderId | null) => {
    persistOverride(id);
    setState(readState());
  }, []);

  return {
    hasKey: Boolean(state.key),
    provider: state.provider,
    providerOverride: state.providerOverride,
    ambiguous: state.ambiguous,
    save,
    clear,
    setProviderOverride,
  };
}

// Re-export for callers that imported the type via this module.
export type { AiProvider };
