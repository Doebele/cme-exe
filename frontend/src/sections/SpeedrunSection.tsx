import { useEffect, useMemo, useRef, useState } from "react";
import { useIsMobile } from "../hooks/useIsMobile";
import { useSpeedrun } from "../hooks/useSpeedrun";
import { useApiKey } from "../hooks/useApiKey";
import Marginalia from "../components/speedrun/Marginalia";
import Stage, {
  FALLBACK_CAREER,
  FALLBACK_SKILLS,
  FALLBACK_WORKS,
  type CareerFact,
  type SkillFact,
  type WorkFact,
} from "../components/speedrun/Stage";
import VirtualCursor from "../components/speedrun/VirtualCursor";
import ThoughtStream from "../components/speedrun/ThoughtStream";
import ManifestCard from "../components/speedrun/ManifestCard";

const RUN_ID_HASH_RE = /^#observer\/r-([a-z0-9]{12})$/i;
const RECORDING_ID_HASH_RE = /^#observer\/rec-([a-z0-9]{12})$/i;
const URL_PATTERN = /^https?:\/\/.+/i;

function parseRunIdFromHash(hash: string): string | null {
  const m = RUN_ID_HASH_RE.exec(hash);
  if (!m) return null;
  return `r-${m[1]!.toLowerCase()}`;
}

function parseRecordingIdFromHash(hash: string): string | null {
  const m = RECORDING_ID_HASH_RE.exec(hash);
  if (!m) return null;
  return `rec-${m[1]!.toLowerCase()}`;
}

export default function SpeedrunSection() {
  const speedrun = useSpeedrun();
  const isMobile = useIsMobile();
  const { hasKey } = useApiKey();
  const {
    status,
    mode,
    isRecording,
    recordingId,
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
  } = speedrun;

  const stageRef = useRef<HTMLDivElement | null>(null);

  // --- local UI state for the URL input in idle mode ---
  const [urlInput, setUrlInput] = useState("");
  const urlValid = URL_PATTERN.test(urlInput.trim());

  // --- lab-facts for the Stage (with static fallback) ---
  const [works, setWorks] = useState<WorkFact[]>(FALLBACK_WORKS);
  const [career, setCareer] = useState<CareerFact[]>(FALLBACK_CAREER);
  const [skills, setSkills] = useState<SkillFact[]>(FALLBACK_SKILLS);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/content/lab-facts")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled || !data) return;
        if (Array.isArray(data.works)) {
          setWorks(
            data.works.map((w: Record<string, unknown>) => ({
              id: String(w.id),
              title: String(w.title),
              category: String(w.category ?? ""),
              year: String(w.year ?? ""),
            })),
          );
        }
        if (Array.isArray(data.career)) {
          setCareer(
            data.career.map((c: Record<string, unknown>) => ({
              year: String(c.year ?? ""),
              title: String(c.title ?? ""),
              company: String(c.company ?? ""),
            })),
          );
        }
        if (Array.isArray(data.skills)) {
          setSkills(
            data.skills.map(
              (s: Record<string, unknown> | string) =>
                typeof s === "string"
                  ? { name: s }
                  : { name: String(s.name ?? "") },
            ),
          );
        }
      })
      .catch(() => {
        /* keep fallbacks */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // --- hash-based replay wiring ---
  // On mount and on hashchange, if the hash is #observer/r-{id}, scroll to
  // this section and kick off a replay.
  const replayedRef = useRef<string | null>(null);
  useEffect(() => {
    const tryReplay = () => {
      const runId = parseRunIdFromHash(window.location.hash);
      const recordingId = parseRecordingIdFromHash(window.location.hash);
      if (!runId && !recordingId) return;
      const el = document.getElementById("observer");
      if (el) el.scrollIntoView({ behavior: "smooth" });
      const id = runId ?? recordingId;
      if (!id || replayedRef.current === id) return;
      replayedRef.current = id;
      if (runId) void replay(runId);
      else if (recordingId) void replayRecording(recordingId);
    };
    tryReplay();
    window.addEventListener("hashchange", tryReplay);
    return () => window.removeEventListener("hashchange", tryReplay);
  }, [replay, replayRecording]);

  // Visited stations derived from thoughts (navigate actions).
  const visited = useMemo(() => {
    const list: { section: typeof currentLocation.section; item: string | null }[] = [];
    list.push({ section: "hero", item: null });
    for (const t of thoughts) {
      if (t.action.type === "navigate" && t.action.target) {
        list.push({ section: t.action.target, item: t.action.item ?? null });
      } else {
        list.push({ section: currentLocation.section, item: currentLocation.item });
      }
    }
    return list;
  }, [thoughts, currentLocation]);

  const cursorVisible =
    status === "running" || status === "replay" || status === "manifest";
  // Stage stays visible across running → manifest so there's no empty gap
  // while the manifest is being fetched. The manifest overlays once landed.
  const showStage =
    status === "running" ||
    status === "replay" ||
    status === "starting" ||
    status === "manifest";
  const showManifest = status === "manifest" && !!manifest;
  const manifestLoading = status === "manifest" && !manifest;
  const isReplayRun = status === "replay";
  const isUrlRun = mode === "url";
  // A recording with URL data renders the URL stage; claus recordings fall
  // back to the lab-facts stage.
  const isUrlStage = isUrlRun || (isRecording && !!urlSubject);
  const startingUrl = isUrlRun && status === "starting";

  return (
    <section
      id="observer"
      className="relative min-h-screen flex flex-col items-center justify-center px-4 md:px-6 py-20"
    >
      <header className="text-center mb-6 md:mb-10">
        <p className="font-display text-xs uppercase tracking-[0.3em] text-text-secondary">
          THE OBSERVER // SPEEDRUN
        </p>
        <h2 className="font-display text-[clamp(1.8rem,5vw,3.5rem)] leading-none crt-glow mt-2">
          AN AI AGENT VISITS, LIVE
        </h2>
      </header>

      {/* IDLE */}
      {status === "idle" && (
        <div className="w-full max-w-md flex flex-col items-center gap-5">
          <button
            type="button"
            onClick={() => void start()}
            className="font-display text-sm uppercase tracking-[0.2em] px-6 py-3 border-2"
            style={{
              borderColor: "var(--color-accent)",
              color: "var(--color-accent)",
              boxShadow: `0 0 calc(14px * var(--glow-strength)) color-mix(in srgb, var(--color-accent) 50%, transparent)`,
            }}
          >
            ▶ Start Speedrun
          </button>
          <p className="font-display text-[0.6rem] uppercase tracking-[0.15em] text-text-secondary/50 text-center">
            ~60s · Claus' work · runs server-side · shareable after
          </p>
          {!hasKey && (
            <p className="font-display text-[0.55rem] uppercase tracking-[0.12em] text-text-secondary/40 text-center leading-relaxed max-w-xs">
              Hybrid mode plays a pre-recorded session. Add your API key (top right)
              for a fresh live run.
            </p>
          )}

          {/* Divider */}
          <div className="flex items-center gap-3 w-full my-1">
            <span
              className="flex-1 h-px"
              style={{
                background:
                  "color-mix(in srgb, var(--color-text-secondary) 25%, transparent)",
              }}
            />
            <span className="font-display text-[0.6rem] uppercase tracking-[0.2em] text-text-secondary/50">
              or
            </span>
            <span
              className="flex-1 h-px"
              style={{
                background:
                  "color-mix(in srgb, var(--color-text-secondary) 25%, transparent)",
              }}
            />
          </div>

          {/* URL speedrun */}
          <div className="w-full flex flex-col items-center gap-3">
            <p className="font-display text-[0.7rem] uppercase tracking-[0.2em] text-text-secondary text-center">
              Speedrun any URL
            </p>
            <form
              className="w-full flex flex-col sm:flex-row gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (urlValid) void startWithUrl(urlInput.trim());
              }}
            >
              <input
                type="url"
                inputMode="url"
                autoComplete="off"
                spellCheck={false}
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                placeholder="https://www.linkedin.com/in/… or any public URL"
                className="flex-1 min-w-0 px-3 py-2 border bg-transparent outline-none font-display text-xs text-text-primary"
                style={{
                  borderColor:
                    "color-mix(in srgb, var(--color-text-secondary) 30%, transparent)",
                  caretColor: "var(--color-accent)",
                }}
                aria-label="URL to speedrun"
              />
              <button
                type="submit"
                disabled={!urlValid}
                className="font-display text-xs uppercase tracking-[0.15em] px-4 py-2 border whitespace-nowrap transition-opacity"
                style={{
                  borderColor: "var(--color-accent)",
                  color: "var(--color-accent)",
                  opacity: urlValid ? 1 : 0.4,
                  cursor: urlValid ? "pointer" : "not-allowed",
                }}
              >
                ▶ Visit URL
              </button>
            </form>
            <p className="font-display text-[0.6rem] uppercase tracking-[0.15em] text-text-secondary/50 text-center leading-relaxed">
              The Observer fetches the URL server-side and explores it. ~60–75s.
              <br />
              No tracking pixels or JS from the target site run.
            </p>
          </div>
        </div>
      )}

      {/* STARTING */}
      {status === "starting" && (
        <div className="max-w-md text-center flex flex-col items-center gap-3 px-4">
          <span
            className="speedrun-spinner"
            aria-hidden
            style={{
              width: 28,
              height: 28,
              borderRadius: "9999px",
              border: "2px solid color-mix(in srgb, var(--color-accent) 25%, transparent)",
              borderTopColor: "var(--color-accent)",
            }}
          />
          <p className="font-display text-xs uppercase tracking-[0.2em] text-text-secondary break-all">
            {startingUrl && urlSourceUrl
              ? `Fetching ${urlSourceUrl}…`
              : "Booting observer…"}
          </p>
        </div>
      )}

      {/* ERROR */}
      {status === "error" && (
        <div className="max-w-md text-center flex flex-col items-center gap-4 px-4">
          <p
            className="font-display text-sm uppercase tracking-[0.1em]"
            style={{ color: "var(--color-accent-secondary)" }}
          >
            ⚠ {error ?? "Something went wrong."}
          </p>
          {hybridDisabled && (
            <p className="text-xs text-text-secondary/80 leading-relaxed">
              Hybrid mode is disabled on the server right now. Add your own
              Anthropic or OpenAI key (top-right) to run the agent in Full mode.
            </p>
          )}
          {rateLimited && (
            <p className="text-xs text-text-secondary/80 leading-relaxed">
              The shared server key is busy. Add your own key (top-right) for
              Full mode, or try again shortly.
            </p>
          )}
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() =>
                isUrlRun && urlSourceUrl
                  ? void startWithUrl(urlSourceUrl)
                  : void start()
              }
              className="font-display text-xs uppercase tracking-[0.15em] px-4 py-2 border"
              style={{
                borderColor: "var(--color-accent)",
                color: "var(--color-accent)",
              }}
            >
              Try again
            </button>
            <button
              type="button"
              onClick={reset}
              className="font-display text-xs uppercase tracking-[0.15em] px-4 py-2 border"
              style={{
                borderColor:
                  "color-mix(in srgb, var(--color-text-secondary) 40%, transparent)",
                color: "var(--color-text-secondary)",
              }}
            >
              Reset
            </button>
          </div>
        </div>
      )}

      {/* RUNNING / REPLAY layout */}
      {(showStage || showManifest) && (
        <div className="w-full max-w-[1400px]">
          {/* Single full-width stage container */}
          <div
            className="relative rounded-sm border overflow-hidden w-full"
            style={{
              height: isMobile ? "70vh" : "70vh",
              minHeight: "70vh",
              borderColor: "color-mix(in srgb, var(--color-text-secondary) 20%, transparent)",
            }}
          >
            {/* Stage — always full-width, always full opacity */}
            <div ref={stageRef} className="absolute inset-0">
              {isUrlStage && urlSubject ? (
                <Stage
                  mode="url"
                  currentLocation={currentLocation}
                  visited={visited}
                  subject={urlSubject}
                  sections={urlSections}
                  sourceUrl={urlSourceUrl ?? ""}
                  compact={isMobile}
                />
              ) : (
                <Stage
                  mode="claus"
                  currentLocation={currentLocation}
                  visited={visited}
                  works={works}
                  career={career}
                  skills={skills}
                  compact={isMobile}
                />
              )}
            </div>
            <VirtualCursor
              containerRef={stageRef}
              currentLocation={currentLocation}
              visible={cursorVisible && !showManifest}
              compact={isMobile}
            />
            {thoughts.length > 0 && !isMobile && !showManifest && (
              <Marginalia
                thought={thoughts[thoughts.length - 1].thought}
                activeStation={currentLocation}
                containerRef={stageRef}
              />
            )}
            {(isReplayRun || isRecording) && (
              <div
                className="absolute top-2 left-2 font-display text-[0.55rem] uppercase tracking-[0.2em] px-2 py-0.5 border z-30"
                style={{
                  borderColor: isRecording
                    ? "color-mix(in srgb, var(--color-accent-secondary) 40%, transparent)"
                    : "color-mix(in srgb, var(--color-accent) 40%, transparent)",
                  color: isRecording
                    ? "var(--color-accent-secondary)"
                    : "var(--color-accent)",
                }}
              >
                {isRecording ? "\u23FA pre-recorded" : "\u25B6 replay"}
              </div>
            )}

            {/* ThoughtStream — floating mini-console (desktop) */}
            {!isMobile && (
              <div
                className="absolute bottom-3 left-3 right-3 z-10"
                style={{
                  opacity: showManifest ? 0.5 : 1,
                  transition: "opacity 300ms ease",
                }}
              >
                <ThoughtStream thoughts={thoughts} status={status} variant="mini" isRecording={isRecording} />
              </div>
            )}

            {/* Mobile caption overlay (TikTok style) */}
            {isMobile && (
              <div
                className="absolute inset-x-0 bottom-0 z-20 pointer-events-none"
                style={{ opacity: showManifest ? 0.5 : 1 }}
              >
                <ThoughtStream
                  thoughts={thoughts}
                  status={status}
                  caption
                  isRecording={isRecording}
                />
              </div>
            )}

            {/* "Writing manifest..." loading state — fills the gap between the last
                step and the loaded manifest so the stage never disappears. */}
            {manifestLoading && (
              <div
                className="absolute inset-0 z-30 flex items-center justify-center pointer-events-none"
                aria-live="polite"
              >
                <div
                  className="flex flex-col items-center gap-3 px-6 py-4 rounded-sm border"
                  style={{
                    backgroundColor: "color-mix(in srgb, var(--color-bg) 88%, transparent)",
                    borderColor: "color-mix(in srgb, var(--color-accent) 45%, transparent)",
                    backdropFilter: "blur(4px)",
                    WebkitBackdropFilter: "blur(4px)",
                  }}
                >
                  <div className="speedrun-pulse-dot" aria-hidden style={{
                    width: 10,
                    height: 10,
                    borderRadius: "9999px",
                    backgroundColor: "var(--color-accent)",
                    boxShadow: "0 0 calc(8px * var(--glow-strength)) var(--color-accent)",
                  }} />
                  <p
                    className="font-display text-[0.65rem] uppercase tracking-[0.25em] crt-glow m-0"
                    style={{ color: "var(--color-text-primary)" }}
                  >
                    THE CURATOR IS WRITING
                  </p>
                  <p
                    className="font-display text-[0.55rem] uppercase tracking-[0.2em] m-0"
                    style={{ color: "var(--color-text-secondary)", opacity: 0.7 }}
                  >
                    manifest synthesizing…
                  </p>
                </div>
              </div>
            )}

            {/* Manifest overlay — centered floating card over the stage */}
            {showManifest && manifest && (
              <div
                className="fixed inset-0 z-40 flex items-stretch md:items-center justify-center"
                aria-modal="true"
              >
                {/* Desktop: backdrop blur (stage visible but blurred behind) */}
                <div
                  className="absolute inset-0 hidden md:block"
                  style={{
                    backdropFilter: "blur(8px)",
                    WebkitBackdropFilter: "blur(8px)",
                    backgroundColor: "color-mix(in srgb, var(--color-bg) 25%, transparent)",
                  }}
                />
                {/* Mobile: solid backdrop (fullscreen manifest) */}
                <div
                  className="absolute inset-0 md:hidden"
                  style={{ backgroundColor: "var(--color-bg)" }}
                />
                <div
                  className="relative z-10 w-full md:max-w-2xl md:max-h-[88vh] md:h-auto h-full overflow-y-auto p-0 md:p-6"
                >
                  <ManifestCard
                    manifest={manifest}
                    isReplay={isReplayRun || replayedRef.current !== null}
                    fullscreen={isMobile}
                    onReplay={() => {
                      replayedRef.current = null;
                      const hash = window.location.hash;
                      if (hash && (RUN_ID_HASH_RE.exec(hash) || RECORDING_ID_HASH_RE.exec(hash))) {
                        history.replaceState(null, "", window.location.pathname + window.location.search);
                      }
                      if (isRecording && recordingId) {
                        void replayRecording(recordingId);
                      } else if (isUrlRun && urlSourceUrl) {
                        void startWithUrl(urlSourceUrl);
                      } else {
                        void start();
                      }
                    }}
                    onShare={share}
                    onClose={reset}
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Step counter footer during active runs */}
      {(status === "running" || status === "replay") && (
        <p className="mt-4 font-display text-[0.6rem] uppercase tracking-[0.2em] text-text-secondary/60">
          {(runId || recordingId) ? `${runId ?? recordingId} · ` : ""}step {speedrun.currentStep}
        </p>
      )}
    </section>
  );
}
