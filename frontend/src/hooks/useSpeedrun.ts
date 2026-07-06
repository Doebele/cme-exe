import { useCallback, useEffect, useRef, useState } from "react";
import { getApiKey } from "../lib/apiKey";
import {
  SpeedrunHttpError,
  getManifest,
  getManifestForUrl,
  getRecording,
  getRun,
  startSpeedrun,
  startUrlSpeedrun,
  stepSpeedrun,
  stepUrlSpeedrun,
} from "../lib/speedrunApi";
import type {
  ExternalPageState,
  ExternalSection,
  ExternalSubject,
  HistoryEntry,
  RecordingData,
  RecordingHistoryEntry,
  Section,
  StartSpeedrunResponse,
  SpeedrunAction,
  SpeedrunRun,
  UrlErrorCode,
} from "../lib/speedrunApi";
import { useIsMobile } from "./useIsMobile";
import { playDiscoverySting } from "../lib/audio";

export type SpeedrunStatus =
  | "idle"
  | "starting"
  | "running"
  | "manifest"
  | "replay"
  | "error";

export type SpeedrunMode = "claus" | "url" | "recording";

export interface ThoughtView {
  step: number;
  thought: string;
  action: SpeedrunAction;
  timestamp: string;
}

export interface CurrentLocation {
  section: Section;
  item: string | null;
}

export interface UseSpeedrun {
  status: SpeedrunStatus;
  mode: SpeedrunMode;
  currentStep: number;
  thoughts: ThoughtView[];
  currentLocation: CurrentLocation;
  manifest: string | null;
  runId: string | null;
  hybridDisabled: boolean;
  rateLimited: boolean;
  error: string | null;
  urlSubject: ExternalSubject | null;
  urlSections: ExternalSection[];
  urlSourceUrl: string | null;
  isRecording: boolean;
  recordingId: string | null;
  start: () => Promise<void>;
  startWithUrl: (url: string) => Promise<void>;
  replay: (runId: string) => Promise<void>;
  replayRecording: (recordingId: string) => Promise<void>;
  share: () => Promise<string>;
  reset: () => void;
}

const INITIAL_LOCATION: CurrentLocation = { section: "hero", item: null };

const STEP_PAUSE_MS_DESKTOP = 1800;
const STEP_PAUSE_MS_MOBILE = 1200;
const STEP_PAUSE_MS_DESKTOP_REDUCED = 1200;
const STEP_PAUSE_MS_MOBILE_REDUCED = 800;
const MAX_STEPS_DESKTOP = 13;
const MAX_STEPS_MOBILE = 10;
const MAX_STEPS_DEFENSIVE = 20;
const AHA_PATTERN = /\b(wait|hmm|oh|interesting|actually|but|curious|strange|surprising|fascinating|notable|remarkable|unusual|unexpected)\b/i;
const STING_RATE_LIMIT_MS = 5000;

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

function isAhaMoment(thought: string): boolean {
  return (
    AHA_PATTERN.test(thought) ||
    thought.endsWith("!") ||
    /\?\s*$/.test(thought)
  );
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Resolves the visitor's stored API key at call time (not at hook mount), so
 * keys saved after the section renders still reach the backend.
 */
function resolveVisitorKey(): string | null {
  return getApiKey();
}

/**
 * Maps a SpeedrunHttpError to a user-facing message. Returns null when the
 * caller should supply its own handling.
 */
function messageForError(err: unknown): string {
  if (err instanceof SpeedrunHttpError) {
    if (err.status === 0) return "Connection lost. Check your network and try again.";
    if (err.status === 404) return "This run has expired (24h TTL).";
    if (err.status === 409) return "This run is already complete.";
    if (err.status === 429) {
      const sec = err.body.retryAfterSec;
      const suffix = sec ? ` Try again in ${sec}s.` : "";
      return `Rate limit reached.${suffix} Try Full mode with your own key.`;
    }
    return err.body?.error || err.message || "Something went wrong.";
  }
  return err instanceof Error ? err.message : "Something went wrong.";
}

/**
 * Maps URL-Speedrun error codes to friendly copy. Falls back to messageForError
 * for non-URL errors (network, 503 hybrid, generic 429).
 */
function messageForUrlError(err: unknown): string {
  if (err instanceof SpeedrunHttpError) {
    const code = err.body.code as UrlErrorCode | undefined;
    switch (code) {
      case "INVALID_URL":
        return "That doesn't look like a valid URL. Try a public one (https://...).";
      case "BLOCKED":
        return "The Observer can't reach that URL — it's on a private network.";
      case "TIMEOUT":
        return "The URL took too long to respond.";
      case "TOO_LARGE":
        return "That URL returned too much content. Try a smaller page.";
      case "FETCH_FAILED":
        return "Couldn't fetch that URL. Check it's public and reachable.";
      case "RATE_LIMIT": {
        const sec = err.body.retryAfterSec;
        const mins = sec ? Math.max(1, Math.ceil(sec / 60)) : null;
        return mins
          ? `Too many URL speedruns. Try again in ${mins} min.`
          : "Too many URL speedruns. Try again shortly.";
      }
      default:
        return messageForError(err);
    }
  }
  return messageForError(err);
}

/**
 * Normalize the externalPageState on a run record into the {subject, sections}
 * pair the Stage consumes. Returns null when the record lacks URL data.
 */
function extractUrlState(
  page: ExternalPageState | undefined,
): { subject: ExternalSubject; sections: ExternalSection[] } | null {
  if (!page || !page.subject) return null;
  const sections = Array.isArray(page.sections) ? page.sections : [];
  return { subject: page.subject, sections };
}

/**
 * Coerces a recording history entry's string action target into the Section
 * union. Recording data stores targets as raw strings (they originate from a
 * serialized run); we only accept known section ids and ignore anything else
 * so the Stage never receives an invalid station.
 */
function coerceSection(target: string | undefined): Section | undefined {
  if (!target) return undefined;
  return SECTIONS.has(target as Section) ? (target as Section) : undefined;
}

const SECTIONS = new Set<Section>(["hero", "about", "works", "career", "skills"]);

/**
 * Normalizes a recording's history entries into the ThoughtView[] shape the
 * UI consumes. Recording entries differ only in that action.target is a raw
 * string rather than the Section union — we coerce here.
 */
function recordingHistoryToThoughts(
  history: RecordingHistoryEntry[],
): ThoughtView[] {
  return history.map((entry) => {
    const section = coerceSection(entry.action.target);
    const action: SpeedrunAction = {
      type: entry.action.type,
      ...(section !== undefined ? { target: section } : {}),
      ...(entry.action.item !== undefined ? { item: entry.action.item } : {}),
    };
    return {
      step: entry.step,
      thought: entry.thought,
      action,
      timestamp: entry.timestamp,
    };
  });
}

export function useSpeedrun(): UseSpeedrun {
  const isMobile = useIsMobile();
  const [status, setStatus] = useState<SpeedrunStatus>("idle");
  const [mode, setMode] = useState<SpeedrunMode>("claus");
  const [currentStep, setCurrentStep] = useState(0);
  const [thoughts, setThoughts] = useState<ThoughtView[]>([]);
  const [currentLocation, setCurrentLocation] = useState<CurrentLocation>(INITIAL_LOCATION);
  const [manifest, setManifest] = useState<string | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [recordingId, setRecordingId] = useState<string | null>(null);
  const [hybridDisabled, setHybridDisabled] = useState(false);
  const [rateLimited, setRateLimited] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [urlSubject, setUrlSubject] = useState<ExternalSubject | null>(null);
  const [urlSections, setUrlSections] = useState<ExternalSection[]>([]);
  const [urlSourceUrl, setUrlSourceUrl] = useState<string | null>(null);

  // Cancellation guard: each start()/startWithUrl()/replay() increments this;
  // async work checks it before committing state so a stale loop can't
  // pollute a new run.
  const runTokenRef = useRef(0);
  const activeRunRef = useRef<AbortController | null>(null);

  // Pause between steps, scaled to viewport + reduced-motion preference.
  const reducedMotion = prefersReducedMotion();
  const stepPauseMs = isMobile
    ? reducedMotion
      ? STEP_PAUSE_MS_MOBILE_REDUCED
      : STEP_PAUSE_MS_MOBILE
    : reducedMotion
      ? STEP_PAUSE_MS_DESKTOP_REDUCED
      : STEP_PAUSE_MS_DESKTOP;
  const maxSteps = isMobile ? MAX_STEPS_MOBILE : MAX_STEPS_DESKTOP;
  const lastStingRef = useRef(0);

  useEffect(() => {
    return () => {
      activeRunRef.current?.abort();
    };
  }, []);

  const reset = useCallback(() => {
    runTokenRef.current += 1;
    activeRunRef.current?.abort();
    activeRunRef.current = null;
    setStatus("idle");
    setMode("claus");
    setCurrentStep(0);
    setThoughts([]);
    setCurrentLocation(INITIAL_LOCATION);
    setManifest(null);
    setRunId(null);
    setRecordingId(null);
    setHybridDisabled(false);
    setRateLimited(false);
    setError(null);
    setUrlSubject(null);
    setUrlSections([]);
    setUrlSourceUrl(null);
  }, []);

  /**
   * Shared step-loop. Runs `stepFn` repeatedly until `done` or the step cap,
   * then resolves. Honors the cancellation token between every await.
   */
  const runStepLoop = useCallback(
    async (
      token: number,
      controller: AbortController,
      startedRunId: string,
      visitorApiKey: string | null,
      stepFn: (id: string, key: string | null) => Promise<{
        step: number;
        thought: string;
        action: SpeedrunAction;
        done: boolean;
        latencyMs: number;
      }>,
    ) => {
      for (let i = 0; i < MAX_STEPS_DEFENSIVE; i++) {
        let step;
        try {
          step = await stepFn(startedRunId, visitorApiKey);
        } catch (err) {
          if (runTokenRef.current !== token || controller.signal.aborted) return;
          if (err instanceof SpeedrunHttpError && err.status === 409) {
            if (err.body.manifest) setManifest(err.body.manifest);
            break;
          }
          setError(messageForError(err));
          setStatus("error");
          return;
        }
        if (runTokenRef.current !== token || controller.signal.aborted) return;

        setCurrentStep(step.step);
        setThoughts((prev) => [
          ...prev,
          {
            step: step.step,
            thought: step.thought,
            action: step.action,
            timestamp: new Date().toISOString(),
          },
        ]);
        if (step.action.type === "navigate" && step.action.target) {
          setCurrentLocation({
            section: step.action.target,
            item: step.action.item ?? null,
          });
        }

        if (isAhaMoment(step.thought)) {
          const now = Date.now();
          if (now - lastStingRef.current >= STING_RATE_LIMIT_MS) {
            lastStingRef.current = now;
            playDiscoverySting();
          }
        }

        if (step.done) break;
        if (i + 1 >= maxSteps) break;

        await sleep(stepPauseMs);
        if (runTokenRef.current !== token || controller.signal.aborted) return;
      }
    },
    [maxSteps, stepPauseMs],
  );

  /**
   * Plays back a recording's history step-by-step with the same pacing as a
   * live run. Used by both start() (when /start shortcuts to a recording) and
   * replayRecording() (when a visitor opens #observer/rec-{id}).
   */
  const playRecording = useCallback(
    async (
      token: number,
      controller: AbortController,
      recording: RecordingData,
    ) => {
      setMode("recording");
      setRunId(null);
      setRecordingId(recording.id);

      // URL recordings carry their own subject/sections; claus recordings
      // render against the lab-facts Stage. If a URL recording lacks sections
      // (malformed), fall back to claus-style rendering so the visitor still
      // sees thoughts + manifest.
      const isUrlRecording =
        recording.sourceKind === "url" &&
        recording.subject !== null &&
        Array.isArray(recording.sections);
      if (isUrlRecording) {
        setUrlSubject(recording.subject);
        setUrlSections(recording.sections ?? []);
        setUrlSourceUrl(recording.sourceUrl);
      } else {
        setUrlSubject(null);
        setUrlSections([]);
        setUrlSourceUrl(null);
      }

      setStatus("replay");
      setCurrentLocation(INITIAL_LOCATION);
      setCurrentStep(0);
      setThoughts([]);

      const thoughts = recordingHistoryToThoughts(recording.history);
      for (const t of thoughts) {
        if (runTokenRef.current !== token || controller.signal.aborted) return;
        setCurrentStep(t.step);
        setThoughts((prev) => [...prev, t]);
        if (t.action.type === "navigate" && t.action.target) {
          setCurrentLocation({
            section: t.action.target,
            item: t.action.item ?? null,
          });
        }

        if (isAhaMoment(t.thought)) {
          const now = Date.now();
          if (now - lastStingRef.current >= STING_RATE_LIMIT_MS) {
            lastStingRef.current = now;
            playDiscoverySting();
          }
        }

        await sleep(stepPauseMs);
        if (runTokenRef.current !== token || controller.signal.aborted) return;
      }

      if (runTokenRef.current !== token || controller.signal.aborted) return;
      if (recording.manifest) {
        setManifest(recording.manifest);
        setStatus("manifest");
      } else {
        setStatus("idle");
      }
    },
    [stepPauseMs],
  );

  const start = useCallback(async () => {
    runTokenRef.current += 1;
    const token = runTokenRef.current;
    activeRunRef.current?.abort();
    const controller = new AbortController();
    activeRunRef.current = controller;

    setStatus("starting");
    setMode("claus");
    setError(null);
    setHybridDisabled(false);
    setRateLimited(false);
    setManifest(null);
    setThoughts([]);
    setCurrentLocation(INITIAL_LOCATION);
    setCurrentStep(0);
    setUrlSubject(null);
    setUrlSections([]);
    setUrlSourceUrl(null);

    const visitorApiKey = resolveVisitorKey();

    let startRes: StartSpeedrunResponse;
    try {
      startRes = await startSpeedrun(visitorApiKey);
      if (runTokenRef.current !== token || controller.signal.aborted) return;
    } catch (err) {
      if (runTokenRef.current !== token || controller.signal.aborted) return;
      if (err instanceof SpeedrunHttpError && err.status === 503 && err.body.hybridDisabled) {
        setHybridDisabled(true);
        setError("Hybrid mode disabled. Add your API key (top right) to start.");
      } else if (err instanceof SpeedrunHttpError && err.status === 429) {
        setRateLimited(true);
        setError(messageForError(err));
      } else {
        setError(messageForError(err));
      }
      setStatus("error");
      return;
    }

    // Hybrid-mode recording shortcut: the server returned a pre-recorded
    // session instead of starting a live run. Play it back and skip the
    // step loop + manifest fetch entirely.
    if (startRes.kind === "recording" && startRes.recording) {
      await playRecording(token, controller, startRes.recording);
      return;
    }

    if (!startRes.runId || !startRes.initialState) {
      setError("Unexpected response from server.");
      setStatus("error");
      return;
    }

    const startedRunId = startRes.runId;
    setRunId(startedRunId);
    setCurrentLocation({
      section: startRes.initialState.section,
      item: startRes.initialState.item,
    });

    setStatus("running");

    await runStepLoop(token, controller, startedRunId, visitorApiKey, stepSpeedrun);
    if (runTokenRef.current !== token || controller.signal.aborted) return;

    setStatus("manifest");
    if (controller.signal.aborted) return;
    try {
      const manifestRes = await getManifest(startedRunId, visitorApiKey);
      if (runTokenRef.current !== token || controller.signal.aborted) return;
      setManifest(manifestRes.manifest);
    } catch (err) {
      if (runTokenRef.current !== token || controller.signal.aborted) return;
      if (err instanceof SpeedrunHttpError && err.body.manifest) {
        setManifest(err.body.manifest);
      } else if (err instanceof SpeedrunHttpError && err.status === 404) {
        setError("This run has expired (24h TTL).");
        setStatus("error");
      } else {
        setError(messageForError(err));
        setStatus("error");
      }
    }
  }, [runStepLoop, playRecording]);

  const startWithUrl = useCallback(
    async (url: string) => {
      runTokenRef.current += 1;
      const token = runTokenRef.current;
      activeRunRef.current?.abort();
      const controller = new AbortController();
      activeRunRef.current = controller;

      setStatus("starting");
      setMode("url");
      setError(null);
      setHybridDisabled(false);
      setRateLimited(false);
      setManifest(null);
      setThoughts([]);
      setCurrentLocation(INITIAL_LOCATION);
      setCurrentStep(0);
      setUrlSubject(null);
      setUrlSections([]);
      setUrlSourceUrl(null);

      const visitorApiKey = resolveVisitorKey();

      let startedRunId: string;
      try {
        const startRes = await startUrlSpeedrun(url, visitorApiKey);
        if (runTokenRef.current !== token || controller.signal.aborted) return;
        startedRunId = startRes.runId;
        setRunId(startedRunId);
        setUrlSourceUrl(startRes.initialState.sourceUrl);

        // /url/start returns subject + flat ids; the rich titles/descriptions
        // live on the run record's externalPageState. Fetch it so the Stage
        // can render real content instead of bare ids.
        const run = await getRun(startedRunId);
        if (runTokenRef.current !== token || controller.signal.aborted) return;
        const ext = extractUrlState(run.externalPageState);
        if (ext) {
          setUrlSubject(ext.subject);
          setUrlSections(ext.sections);
        } else {
          setUrlSubject(startRes.initialState.subject);
          setUrlSections([]);
        }
        setCurrentLocation({
          section: startRes.initialState.section,
          item: startRes.initialState.item,
        });
      } catch (err) {
        if (runTokenRef.current !== token || controller.signal.aborted) return;
        const httpErr = err instanceof SpeedrunHttpError ? err : null;
        if (httpErr && httpErr.status === 503 && httpErr.body.hybridDisabled) {
          setHybridDisabled(true);
          setError("Hybrid mode disabled. Add your API key (top right) to start.");
        } else if (httpErr && httpErr.body.code === "RATE_LIMIT") {
          setRateLimited(true);
          setError(messageForUrlError(err));
        } else {
          setError(messageForUrlError(err));
        }
        setStatus("error");
        return;
      }

      setStatus("running");

      await runStepLoop(token, controller, startedRunId, visitorApiKey, stepUrlSpeedrun);
      if (runTokenRef.current !== token || controller.signal.aborted) return;

      setStatus("manifest");
      if (controller.signal.aborted) return;
      try {
        const manifestRes = await getManifestForUrl(startedRunId, visitorApiKey);
        if (runTokenRef.current !== token || controller.signal.aborted) return;
        setManifest(manifestRes.manifest);
      } catch (err) {
        if (runTokenRef.current !== token || controller.signal.aborted) return;
        if (err instanceof SpeedrunHttpError && err.body.manifest) {
          setManifest(err.body.manifest);
        } else if (err instanceof SpeedrunHttpError && err.status === 404) {
          setError("This run has expired (24h TTL).");
          setStatus("error");
        } else {
          setError(messageForError(err));
          setStatus("error");
        }
      }
    },
    [runStepLoop],
  );

  const replay = useCallback(
    async (id: string) => {
      runTokenRef.current += 1;
      const token = runTokenRef.current;
      activeRunRef.current?.abort();
      const controller = new AbortController();
      activeRunRef.current = controller;

      setStatus("starting");
      setError(null);
      setHybridDisabled(false);
      setRateLimited(false);
      setManifest(null);
      setThoughts([]);
      setCurrentLocation(INITIAL_LOCATION);
      setCurrentStep(0);
      setRunId(id);

      let run: SpeedrunRun;
      try {
        run = await getRun(id);
      } catch (err) {
        if (runTokenRef.current !== token || controller.signal.aborted) return;
        setError(messageForError(err));
        setStatus("error");
        return;
      }
      if (runTokenRef.current !== token || controller.signal.aborted) return;

      // Detect URL runs from the record so the Stage renders external data.
      const isUrlRun = run.kind === "url-speedrun" || !!run.externalPageState;
      if (isUrlRun) {
        setMode("url");
        const ext = extractUrlState(run.externalPageState);
        if (ext) {
          setUrlSubject(ext.subject);
          setUrlSections(ext.sections);
        }
        if (run.sourceUrl) setUrlSourceUrl(run.sourceUrl);
      } else {
        setMode("claus");
        setUrlSubject(null);
        setUrlSections([]);
        setUrlSourceUrl(null);
      }

      setStatus("replay");
      setCurrentLocation(run.currentLocation || INITIAL_LOCATION);

      const history: HistoryEntry[] = run.history || [];
      for (const entry of history) {
        if (runTokenRef.current !== token || controller.signal.aborted) return;
        setCurrentStep(entry.step);
        setThoughts((prev) => [
          ...prev,
          {
            step: entry.step,
            thought: entry.thought,
            action: entry.action,
            timestamp: entry.timestamp,
          },
        ]);
        if (entry.action.type === "navigate" && entry.action.target) {
          setCurrentLocation({
            section: entry.action.target,
            item: entry.action.item ?? null,
          });
        }
        await sleep(stepPauseMs);
        if (runTokenRef.current !== token || controller.signal.aborted) return;
      }

      if (runTokenRef.current !== token || controller.signal.aborted) return;
      if (run.manifest) {
        setManifest(run.manifest);
        setStatus("manifest");
      } else {
        setStatus("idle");
      }
    },
    [stepPauseMs],
  );

  const replayRecording = useCallback(
    async (recordingId: string) => {
      runTokenRef.current += 1;
      const token = runTokenRef.current;
      activeRunRef.current?.abort();
      const controller = new AbortController();
      activeRunRef.current = controller;

      setStatus("starting");
      setError(null);
      setHybridDisabled(false);
      setRateLimited(false);
      setManifest(null);
      setThoughts([]);
      setCurrentLocation(INITIAL_LOCATION);
      setCurrentStep(0);
      setRunId(null);
      setRecordingId(recordingId);
      setUrlSubject(null);
      setUrlSections([]);
      setUrlSourceUrl(null);

      let recording: RecordingData;
      try {
        recording = await getRecording(recordingId);
      } catch (err) {
        if (runTokenRef.current !== token || controller.signal.aborted) return;
        setError(messageForError(err));
        setStatus("error");
        return;
      }
      if (runTokenRef.current !== token || controller.signal.aborted) return;

      await playRecording(token, controller, recording);
    },
    [playRecording],
  );

  const share = useCallback(async () => {
    let url: string;
    if (recordingId) {
      url = `${window.location.origin}${window.location.pathname}#observer/${recordingId}`;
    } else {
      const id = runId;
      const bareId = id?.startsWith("r-") ? id.slice(2) : id;
      url = `${window.location.origin}${window.location.pathname}#observer/r-${bareId}`;
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      try {
        await navigator.clipboard.writeText(url);
      } catch {
        /* clipboard may be unavailable (permissions); URL still returned */
      }
    }
    return url;
  }, [runId, recordingId]);

  const isRecording = mode === "recording";

  return {
    status,
    mode,
    isRecording,
    recordingId,
    currentStep,
    thoughts,
    currentLocation,
    manifest,
    runId,
    hybridDisabled,
    rateLimited,
    error,
    urlSubject,
    urlSections,
    urlSourceUrl,
    start,
    startWithUrl,
    replay,
    replayRecording,
    share,
    reset,
  };
}
