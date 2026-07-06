import { useCallback, useEffect, useRef, useState } from "react";
import { getApiKey } from "../lib/apiKey";
import { ORACLE_OUTPUT_INSTRUCTION } from "../lib/personaAddons";
import { StreamHttpError, streamChat } from "../lib/sse";

export interface QAPair {
  id: string;
  question: string;
  answer: string;
  timestamp: string;
}

export type OracleStatus = "idle" | "thinking" | "streaming" | "error";

export interface UseOracle {
  history: QAPair[];
  status: OracleStatus;
  partialAnswer: string;
  error: string | null;
  ask: (question: string) => Promise<void>;
  reset: () => void;
}

type PersonaMap = Record<string, { systemPrompt?: string } | undefined>;

// Module-level cache so the persona is fetched at most once per page load.
let personasCache: PersonaMap | null = null;
let personasPromise: Promise<PersonaMap> | null = null;

async function loadMachinePrompt(): Promise<string> {
  if (personasCache) return personasCache.machine?.systemPrompt ?? "";
  if (!personasPromise) {
    personasPromise = fetch("/api/content/personas")
      .then((r) => (r.ok ? (r.json() as Promise<PersonaMap>) : ({} as PersonaMap)))
      .then((data) => {
        personasCache = data;
        return data;
      })
      .catch(() => {
        personasCache = {};
        return {} as PersonaMap;
      });
  }
  const data = await personasPromise;
  return data.machine?.systemPrompt ?? "";
}

function messageForError(err: unknown): string {
  if (err instanceof StreamHttpError) {
    if (err.body.hybridDisabled) {
      return "Hybrid mode disabled. Add your API key (top right) or try a different question.";
    }
    if (err.status === 429) {
      const sec = err.body.retryAfterSec;
      const suffix = sec ? ` Try again in ${sec}s.` : "";
      return `Rate limit reached.${suffix} Try again later or use your own API key.`;
    }
    if (err.status === 401) {
      return "Your API key was rejected. Check it and try again.";
    }
    if (err.status === 0) return "Connection lost. Try again.";
    return err.body.error || err.message || "Something went wrong.";
  }
  return err instanceof Error ? err.message : "Something went wrong.";
}

export function useOracle(): UseOracle {
  const [history, setHistory] = useState<QAPair[]>([]);
  const [status, setStatus] = useState<OracleStatus>("idle");
  const [partialAnswer, setPartialAnswer] = useState("");
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Abort any in-flight stream when the section unmounts.
  useEffect(() => () => abortRef.current?.abort(), []);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setStatus("idle");
    setPartialAnswer("");
    setError(null);
  }, []);

  const ask = useCallback(async (question: string) => {
    const trimmed = question.trim();
    if (!trimmed) return;

    // Cancel any in-flight request before starting a new one.
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const id =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `q-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const entry: QAPair = {
      id,
      question: trimmed,
      answer: "",
      timestamp: new Date().toISOString(),
    };
    setHistory((prev) => [...prev, entry]);
    setStatus("thinking");
    setPartialAnswer("");
    setError(null);

    const visitorApiKey = getApiKey();
    let basePrompt = "";
    try {
      basePrompt = await loadMachinePrompt();
    } catch {
      basePrompt = "";
    }
    const systemPrompt = basePrompt
      ? `${basePrompt}\n\n${ORACLE_OUTPUT_INSTRUCTION}`
      : ORACLE_OUTPUT_INSTRUCTION;

    let acc = "";
    try {
      await streamChat({
        systemPrompt,
        messages: [{ role: "user", content: trimmed }],
        visitorApiKey,
        signal: controller.signal,
        onToken: (text) => {
          acc += text;
          setPartialAnswer(acc);
          setStatus((prev) => (prev === "thinking" ? "streaming" : prev));
        },
      });
      if (controller.signal.aborted) return;
      setHistory((prev) =>
        prev.map((q) => (q.id === id ? { ...q, answer: acc } : q)),
      );
      setStatus("idle");
      setPartialAnswer("");
    } catch (err) {
      if (controller.signal.aborted) {
        // Superseded by a new ask() or reset — keep the partial as the answer.
        setHistory((prev) =>
          prev.map((q) => (q.id === id ? { ...q, answer: acc } : q)),
        );
        return;
      }
      setError(messageForError(err));
      setHistory((prev) =>
        prev.map((q) => (q.id === id ? { ...q, answer: acc } : q)),
      );
      setStatus("error");
    }
  }, []);

  return { history, status, partialAnswer, error, ask, reset };
}
