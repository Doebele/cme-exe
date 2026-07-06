import { useCallback, useEffect, useState } from "react";
import type { ThemeId } from "../types";
import { DEFAULT_THEME, isThemeId } from "../lib/themes";

const STORAGE_KEY = "cme_exe_theme";

function readTheme(): ThemeId {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (isThemeId(stored)) return stored;
  } catch {
    /* ignore */
  }
  return DEFAULT_THEME;
}

function applyTheme(theme: ThemeId): void {
  document.documentElement.setAttribute("data-theme", theme);
}

export interface UseTheme {
  theme: ThemeId;
  setTheme: (theme: ThemeId) => void;
}

export function useTheme(): UseTheme {
  const [theme, setThemeState] = useState<ThemeId>(readTheme);

  useEffect(() => {
    applyTheme(theme);
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      /* ignore */
    }
  }, [theme]);

  const setTheme = useCallback((next: ThemeId) => {
    setThemeState(next);
  }, []);

  return { theme, setTheme };
}
