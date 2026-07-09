import { useCallback, useEffect, useState } from "react";
import {
  initAudio,
  isInitialized,
  isEnabled,
  playDiscoverySting,
  setEnabled,
  subscribe,
  subscribeInit,
} from "../lib/audio";

export interface UseAudio {
  enabled: boolean;
  initialized: boolean;
  toggle: () => Promise<void>;
  playDiscoverySting: () => void;
}

/**
 * React binding for the audio module. Mirrors the persisted enabled flag into
 * component state via the module's subscribe channel, and exposes a toggle
 * that initializes Tone.js inside the click gesture before flipping the flag.
 */
export function useAudio(): UseAudio {
  const [enabled, setEnabledState] = useState(isEnabled);
  const [initialized, setInitialized] = useState(isInitialized);

  useEffect(() => {
    const unsub = subscribe((next) => setEnabledState(next));
    return unsub;
  }, []);

  useEffect(() => {
    // If already initialised, reflect immediately.
    if (isInitialized()) setInitialized(true);
    const unsub = subscribeInit(() => setInitialized(true));
    return unsub;
  }, []);

  const toggle = useCallback(async () => {
    const next = !isEnabled();
    // First ON flip boots the audio context within the user gesture.
    if (next) {
      try {
        await initAudio();
      } catch {
        /* Tone.js may reject if the context can't start — toggle still flips */
      }
    }
    setEnabled(next);
  }, []);

  return {
    enabled,
    initialized,
    toggle,
    playDiscoverySting,
  };
}
