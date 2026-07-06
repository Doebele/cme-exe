export type ThemeId = "vector-green" | "crt-amber" | "y2k-vaporwave";

export type AiProvider = "anthropic" | "openai" | "kimi" | "zai" | "gemini" | "cursor";

export type PersonaId = "observer" | "machine" | "curator";

export interface Work {
  id: string;
  title: string;
  year: string;
  role: string;
  summary: string;
  tags: string[];
  url?: string;
}

export interface CareerEntry {
  id: string;
  company: string;
  title: string;
  start: string;
  end: string | null;
  location: string;
  highlights: string[];
}

export interface DesignQuote {
  id: string;
  text: string;
  source: string;
  year?: string;
}

export interface Persona {
  id: PersonaId;
  name: string;
  tagline: string;
  systemPrompt: string;
  negativeList: string[];
}

export interface Settings {
  defaultTheme: ThemeId;
  allowVisitorThemeSwitch: boolean;
  soundDefaultOn: boolean;
  masterVolume: number;
  bootMode: "always" | "once" | "skip";
  speedrunDurationSeconds: number;
  perRunSharing: boolean;
  hybridRateLimitPerHour: number;
}
