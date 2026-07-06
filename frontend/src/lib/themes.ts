import type { ThemeId } from "../types";

export interface ThemeMeta {
  id: ThemeId;
  label: string;
}

export const THEMES: ThemeMeta[] = [
  { id: "vector-green", label: "Vector-Green" },
  { id: "crt-amber", label: "CRT-Amber" },
  { id: "y2k-vaporwave", label: "Y2K-Vaporwave" },
];

export const DEFAULT_THEME: ThemeId = "vector-green";

export function nextTheme(current: ThemeId): ThemeId {
  const idx = THEMES.findIndex((t) => t.id === current);
  const nextIdx = (idx + 1) % THEMES.length;
  return THEMES[nextIdx]!.id;
}

export function themeLabel(id: ThemeId): string {
  return THEMES.find((t) => t.id === id)?.label ?? id;
}

export function isThemeId(value: string | null): value is ThemeId {
  return THEMES.some((t) => t.id === value);
}
