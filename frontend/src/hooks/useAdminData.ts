import { useCallback, useEffect, useRef, useState } from "react";
import type {
  AdminSettings,
  ApiKeysPutBody,
  ApiKeysResponse,
  NavSection,
  PersonaMap,
} from "../components/admin/AdminShared";
import type { ProviderId } from "../lib/apiKey";

// ---------------------------------------------------------------------------
// Generic read+save primitive. Loads via GET on mount, exposes a save() that
// PUTs the new value and updates local state on success.
// ---------------------------------------------------------------------------

export interface AdminResource<T> {
  data: T | null;
  isLoading: boolean;
  isSaving: boolean;
  error: string | null;
  save: (next: T) => Promise<boolean>;
  setData: (next: T | null) => void;
}

async function putJson(url: string, body: unknown): Promise<boolean> {
  const r = await fetch(url, {
    method: "PUT",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    let msg = `Save failed (${r.status})`;
    try {
      const data = (await r.json()) as { error?: string };
      if (data.error) msg = data.error;
    } catch {
      /* keep status-based message */
    }
    throw new Error(msg);
  }
  return true;
}

function useAdminResource<T>(url: string): AdminResource<T> {
  const [data, setData] = useState<T | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loadedRef = useRef(false);

  useEffect(() => {
    let active = true;
    loadedRef.current = true;
    fetch(url, { credentials: "same-origin" })
      .then(async (r) => {
        if (!active) return;
        if (!r.ok) throw new Error(`Load failed (${r.status})`);
        setData(await r.json());
      })
      .catch((e: unknown) => {
        if (active) {
          setError(e instanceof Error ? e.message : "Load failed");
        }
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [url]);

  const save = useCallback(
    async (next: T): Promise<boolean> => {
      setIsSaving(true);
      setError(null);
      try {
        await putJson(url, next);
        setData(next);
        return true;
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : "Save failed");
        return false;
      } finally {
        setIsSaving(false);
      }
    },
    [url],
  );

  return { data, isLoading, isSaving, error, save, setData };
}

// ---------------------------------------------------------------------------
// Specialized hooks for each admin-editable resource.
// ---------------------------------------------------------------------------

export function useSections(): AdminResource<NavSection[]> {
  return useAdminResource<NavSection[]>("/api/content/sections");
}

export function useSettings(): AdminResource<AdminSettings> {
  return useAdminResource<AdminSettings>("/api/content/settings");
}

export function usePersonas(): AdminResource<PersonaMap> {
  return useAdminResource<PersonaMap>("/api/content/personas");
}

// API keys differ: GET returns masked previews; PUT accepts partial updates
// with raw values. Save targets a single field at a time and refreshes the
// masked preview from the server. Supports all 6 providers plus a
// `defaultProvider` used by Hybrid mode when no visitor key is present.
export interface UseApiKeys {
  data: ApiKeysResponse | null;
  isLoading: boolean;
  isSaving: boolean;
  error: string | null;
  saveKey: (provider: ProviderId, value: string) => Promise<boolean>;
  clearKey: (provider: ProviderId) => Promise<boolean>;
  setDefaultProvider: (id: ProviderId) => Promise<boolean>;
}

const API_KEYS_URL = "/api/admin/api-keys";

function useApiKeysState() {
  const [data, setData] = useState<ApiKeysResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return { data, setData, isLoading, setIsLoading, isSaving, setIsSaving, error, setError };
}

export function useApiKeys(): UseApiKeys {
  const state = useApiKeysState();

  useEffect(() => {
    let active = true;
    fetch(API_KEYS_URL, { credentials: "same-origin" })
      .then(async (r) => {
        if (!active) return;
        if (r.status === 401) {
          // Not authenticated — leave data null; auth gate handles routing.
          return;
        }
        if (!r.ok) throw new Error(`Load failed (${r.status})`);
        state.setData(await r.json());
      })
      .catch((e: unknown) => {
        if (active) state.setError(e instanceof Error ? e.message : "Load failed");
      })
      .finally(() => {
        if (active) state.setIsLoading(false);
      });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refresh = useCallback(async (): Promise<void> => {
    const r = await fetch(API_KEYS_URL, { credentials: "same-origin" });
    if (!r.ok) return;
    state.setData(await r.json());
  }, [state]);

  const writeKey = useCallback(
    async (body: ApiKeysPutBody): Promise<boolean> => {
      state.setIsSaving(true);
      state.setError(null);
      try {
        await putJson(API_KEYS_URL, body);
        await refresh();
        return true;
      } catch (e: unknown) {
        state.setError(e instanceof Error ? e.message : "Save failed");
        return false;
      } finally {
        state.setIsSaving(false);
      }
    },
    [refresh, state],
  );

  const saveKey = useCallback(
    (provider: ProviderId, value: string) =>
      writeKey({ [provider]: value } as ApiKeysPutBody),
    [writeKey],
  );

  const clearKey = useCallback(
    (provider: ProviderId) =>
      writeKey({ [provider]: "" } as ApiKeysPutBody),
    [writeKey],
  );

  const setDefaultProvider = useCallback(
    (id: ProviderId) => writeKey({ defaultProvider: id }),
    [writeKey],
  );

  return {
    data: state.data,
    isLoading: state.isLoading,
    isSaving: state.isSaving,
    error: state.error,
    saveKey,
    clearKey,
    setDefaultProvider,
  };
}
