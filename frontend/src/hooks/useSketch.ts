import { useCallback, useEffect, useRef, useState } from "react";
import { getApiKey } from "../lib/apiKey";
import { SKETCH_SYSTEM_PROMPT_ADDON } from "../lib/personaAddons";
import { StreamHttpError, streamChat } from "../lib/sse";

export interface Sketch {
  id: string;
  prompt: string;
  code: string;
  timestamp: string;
}

export type SketchStatus = "idle" | "generating" | "running" | "error";

export interface UseSketch {
  current: Sketch | null;
  gallery: Sketch[];
  status: SketchStatus;
  partialCode: string;
  error: string | null;
  generate: (prompt: string, preset?: string) => Promise<void>;
  rerun: (sketchId: string) => void;
  reset: () => void;
  removeFromGallery: (sketchId: string) => void;
  clearGallery: () => void;
  /** Look up a gallery sketch by id (used by UI to load prompts back into the input). */
  getSketch: (sketchId: string) => Sketch | undefined;
}

const STORAGE_KEY = "cme_exe_sketches";
const MAX_GALLERY = 20;
const REFUSAL_RE =
  /\b(i cannot|i can't|i am unable|i'm unable|i won't|as an ai|i'm not able)\b/i;
const LANG_TAGS = ["js", "javascript", "p5", "ts", "typescript", "code", "ecmascript"];

function isSketch(value: unknown): value is Sketch {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === "string" &&
    typeof v.prompt === "string" &&
    typeof v.code === "string" &&
    typeof v.timestamp === "string"
  );
}

function loadGallery(): Sketch[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isSketch);
  } catch {
    return [];
  }
}

function saveGallery(items: Sketch[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch {
    /* storage unavailable — non-fatal, gallery stays in-memory */
  }
}

function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `s-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Strip markdown code fences. Robust against:
 * - Fences with optional language tags (js, javascript, p5, ts, etc.)
 * - Surrounding prose ("Here's your sketch:```js...```Enjoy!")
 * - Missing closing fence (truncated stream)
 * - Plain code without any fences
 * Returns the inner code, trimmed.
 */
function stripFences(raw: string): string {
  let code = raw.trim();
  if (!code) return "";

  // If there are no backticks at all, the code is already raw.
  if (!code.includes("```")) return code;

  const startIdx = code.indexOf("```");
  const endIdx = code.lastIndexOf("```");

  // Only an opening fence (stream truncated before close): drop the opening
  // and any language tag on its first line.
  if (startIdx === endIdx) {
    let after = code.slice(startIdx + 3);
    const nl = after.indexOf("\n");
    if (nl !== -1) {
      const firstLine = after.slice(0, nl).trim().toLowerCase();
      if (LANG_TAGS.includes(firstLine)) after = after.slice(nl + 1);
    }
    return after.trim();
  }

  // Both fences present: take what's between them.
  let between = code.slice(startIdx + 3, endIdx);
  const nl = between.indexOf("\n");
  if (nl !== -1) {
    const firstLine = between.slice(0, nl).trim().toLowerCase();
    if (LANG_TAGS.includes(firstLine)) between = between.slice(nl + 1);
  }
  return between.trim();
}

type ValidationResult =
  | { ok: true; code: string }
  | { ok: false; reason: string };

function validateCode(raw: string): ValidationResult {
  const code = stripFences(raw);
  // Require at least a minimal body so empty/truncated streams fail cleanly.
  if (code.length < 20) {
    return {
      ok: false,
      reason: "The Machine returned no code. Try a different prompt.",
    };
  }
  if (REFUSAL_RE.test(code)) {
    return {
      ok: false,
      reason: "The Machine declined to draw that. Try a different prompt.",
    };
  }
  // p5 global mode requires at least one function definition. setup/draw are
  // the canonical ones; accept any `function` keyword to stay permissive.
  if (!/\bfunction\s+\w+/.test(code)) {
    return {
      ok: false,
      reason: "The sketch wasn't valid p5.js. Try again.",
    };
  }
  return { ok: true, code };
}

function messageForError(err: unknown): string {
  if (err instanceof StreamHttpError) {
    if (err.body.hybridDisabled) {
      return "Hybrid mode disabled. Add your API key (top right) or try a different prompt.";
    }
    if (err.status === 429) {
      const sec = err.body.retryAfterSec;
      const suffix = sec ? ` Try again in ${sec}s.` : "";
      return `Rate limit reached.${suffix} Try again later or use your own API key.`;
    }
    if (err.status === 0) return "Connection lost. Try again.";
    return err.body.error || err.message || "Something went wrong.";
  }
  return err instanceof Error ? err.message : "Something went wrong.";
}

export function useSketch(): UseSketch {
  const [gallery, setGallery] = useState<Sketch[]>(() => loadGallery());
  const [current, setCurrent] = useState<Sketch | null>(() =>
    gallery.length > 0 ? (gallery[0] ?? null) : null,
  );
  const [status, setStatus] = useState<SketchStatus>(() =>
    gallery.length > 0 ? "running" : "idle",
  );
  const [partialCode, setPartialCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Persist gallery to localStorage whenever it changes.
  useEffect(() => {
    saveGallery(gallery);
  }, [gallery]);

  // Abort any in-flight generation when the section unmounts.
  useEffect(() => () => abortRef.current?.abort(), []);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setStatus("idle");
    setCurrent(null);
    setPartialCode("");
    setError(null);
  }, []);

  const rerun = useCallback(
    (sketchId: string) => {
      const found = gallery.find((s) => s.id === sketchId);
      if (!found) return;
      abortRef.current?.abort();
      abortRef.current = null;
      setError(null);
      setPartialCode("");
      setCurrent(found);
      setStatus("running");
    },
    [gallery],
  );

  const removeFromGallery = useCallback((sketchId: string) => {
    setGallery((prev) => prev.filter((s) => s.id !== sketchId));
    setCurrent((cur) => (cur?.id === sketchId ? null : cur));
    setStatus((s) => (s === "running" ? "idle" : s));
  }, []);

  const clearGallery = useCallback(() => {
    setGallery([]);
    setCurrent(null);
    setStatus("idle");
  }, []);

  const getSketch = useCallback(
    (sketchId: string) => gallery.find((s) => s.id === sketchId),
    [gallery],
  );

  const generate = useCallback(
    async (prompt: string, preset?: string) => {
      const trimmed = prompt.trim();
      if (!trimmed) return;

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setStatus("generating");
      setPartialCode("");
      setError(null);
      setCurrent(null);

      const visitorApiKey = getApiKey();
      const presetHint = preset
        ? `\n\nStyle hint: lean toward ${preset.toLowerCase()}.`
        : "";
      const systemPrompt = `${SKETCH_SYSTEM_PROMPT_ADDON}${presetHint}`;

      let acc = "";
      try {
        await streamChat({
          systemPrompt,
          messages: [{ role: "user", content: trimmed }],
          visitorApiKey,
          signal: controller.signal,
          onToken: (text) => {
            acc += text;
            setPartialCode(acc);
          },
        });
        if (controller.signal.aborted) return;

        const result = validateCode(acc);
        if (!result.ok) {
          setError(result.reason);
          setStatus("error");
          return;
        }

        const sketch: Sketch = {
          id: newId(),
          prompt: trimmed,
          code: result.code,
          timestamp: new Date().toISOString(),
        };
        setCurrent(sketch);
        setGallery((prev) => {
          const next = [sketch, ...prev];
          if (next.length > MAX_GALLERY) next.length = MAX_GALLERY;
          return next;
        });
        setStatus("running");
        setPartialCode("");
      } catch (err) {
        if (controller.signal.aborted) return;
        setError(messageForError(err));
        setStatus("error");
      }
    },
    [],
  );

  return {
    current,
    gallery,
    status,
    partialCode,
    error,
    generate,
    rerun,
    reset,
    removeFromGallery,
    clearGallery,
    getSketch,
  };
}
