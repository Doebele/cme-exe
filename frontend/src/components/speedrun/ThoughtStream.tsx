import { useEffect, useRef } from "react";
import { useTypewriter } from "../../hooks/useTypewriter";
import {
  playTypewriterClick,
  playRandomBlip,
  startAnalysisNoise,
  stopAnalysisNoise,
} from "../../lib/audio";
import type { ThoughtView } from "../../hooks/useSpeedrun";

type ThoughtStreamVariant = "panel" | "caption" | "mini";

interface ThoughtStreamProps {
  thoughts: ThoughtView[];
  status: "running" | "replay" | "starting" | "idle" | "manifest" | "error";
  /** Render as a bottom-overlay caption (mobile TikTok format). @deprecated use variant */
  caption?: boolean;
  variant?: ThoughtStreamVariant;
  /** When true, renders a "PRE-RECORDED SESSION" badge near the header. */
  isRecording?: boolean;
}

function RecordingBadge() {
  return (
    <span
      className="font-display"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "0.3rem",
        fontSize: "0.5rem",
        textTransform: "uppercase",
        letterSpacing: "0.15em",
        color: "var(--color-accent-secondary)",
        padding: "0.1rem 0.35rem",
        border: "1px solid color-mix(in srgb, var(--color-accent-secondary) 40%, transparent)",
        backgroundColor: "color-mix(in srgb, var(--color-accent-secondary) 8%, transparent)",
      }}
    >
      <span
        className="speedrun-pulse-dot"
        style={{
          width: 4,
          height: 4,
          borderRadius: "9999px",
          display: "inline-block",
          backgroundColor: "var(--color-accent-secondary)",
          boxShadow: "0 0 calc(4px * var(--glow-strength)) var(--color-accent-secondary)",
        }}
      />
      Pre-recorded
    </span>
  );
}

export default function ThoughtStream({
  thoughts,
  status,
  caption = false,
  variant,
  isRecording = false,
}: ThoughtStreamProps) {
  const historyRef = useRef<HTMLDivElement | null>(null);
  const current = thoughts[thoughts.length - 1];
  const previous = thoughts.length > 1 ? thoughts.slice(0, -1) : [];

  const resolvedVariant: ThoughtStreamVariant = variant ?? (caption ? "caption" : "panel");

  const isLive = status === "running";
  const isReplay = status === "replay";

  const speed = resolvedVariant === "mini" ? 25 : resolvedVariant === "caption" ? 32 : 40;
  const { displayed, isTyping } = useTypewriter(current?.thought ?? "", speed);
  const displayedLen = displayed.length;

  // Typewriter click on each new character. Only when actively typing.
  useEffect(() => {
    if (!isTyping) return;
    playTypewriterClick();
  }, [displayedLen, isTyping]);

  // Random electronic blip layered over the stream while the observer is live.
  useEffect(() => {
    if (!isLive || !isTyping) return;
    const id = window.setInterval(() => {
      if (Math.random() < 0.35) playRandomBlip();
    }, 280);
    return () => window.clearInterval(id);
  }, [isLive, isTyping]);

  // Continuous analysis hum while the observer is live.
  useEffect(() => {
    if (isLive) startAnalysisNoise();
    return () => stopAnalysisNoise();
  }, [isLive]);

  useEffect(() => {
    const el = historyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [thoughts.length]);

  const label = isRecording
    ? "THE OBSERVER (RECORDING)"
    : isReplay
      ? "THE OBSERVER (REPLAY)"
      : "THE OBSERVER";

  // ---- Mini (floating) variant ----
  if (resolvedVariant === "mini") {
    return (
      <div
        className="flex flex-col rounded-sm border overflow-hidden"
        style={{
          backgroundColor: "color-mix(in srgb, var(--color-bg) 80%, transparent)",
          borderColor: "color-mix(in srgb, var(--color-text-secondary) 25%, transparent)",
          backdropFilter: "blur(4px)",
          WebkitBackdropFilter: "blur(4px)",
        }}
      >
        <div
          className="flex items-center justify-between gap-2 px-2.5 py-1 border-b"
          style={{ borderColor: "color-mix(in srgb, var(--color-text-secondary) 20%, transparent)" }}
        >
          <div className="flex items-center gap-1.5">
            <h3
              className="font-display text-[0.55rem] uppercase tracking-[0.2em] crt-glow"
              style={{ color: "var(--color-text-primary)" }}
            >
              {label}
            </h3>
            {isRecording && <RecordingBadge />}
          </div>
          {isLive && (
            <span className="flex items-center gap-1 font-display text-[0.5rem] uppercase tracking-[0.15em] text-text-secondary">
              <span
                className="speedrun-pulse-dot"
                style={{
                  width: 5,
                  height: 5,
                  borderRadius: "9999px",
                  display: "inline-block",
                  backgroundColor: "var(--color-accent)",
                  boxShadow: "0 0 calc(6px * var(--glow-strength)) var(--color-accent)",
                }}
              />
              live
            </span>
          )}
        </div>
        <div className="px-2.5 pb-2 flex flex-col gap-0.5 overflow-hidden" style={{ maxHeight: "12rem" }}>
          {thoughts.length === 0 ? (
            <p className="font-display text-[0.7rem] text-text-secondary/60 italic">
              {status === "starting" ? "Booting observer..." : "Awaiting signal..."}
            </p>
          ) : (
            <>
              {thoughts.slice(-8, -1).map((t) => (
                <p key={t.step} className="font-display text-[0.7rem] leading-tight text-text-secondary/55 truncate">
                  <span className="text-text-secondary/40 mr-1">{String(t.step).padStart(2, "0")}</span>
                  {t.thought}
                </p>
              ))}
              {current ? (
                <p className="font-display text-[0.7rem] leading-tight text-text-primary truncate">
                  <span className="text-text-secondary/50 mr-1">{String(current.step).padStart(2, "0")}</span>
                  {displayed}
                  {isTyping && (
                    <span
                      className="speedrun-caret-blink"
                      style={{ color: "var(--color-accent)" }}
                    >
                      {'\u258B'}
                    </span>
                  )}
                </p>
              ) : null}
            </>
          )}
        </div>
      </div>
    );
  }

  // ---- Caption (mobile overlay) variant ----
  if (resolvedVariant === "caption") {
    return (
      <div className="flex h-full w-full flex-col justify-end">
        <div
          className="flex flex-col gap-2 px-4 pb-4 pt-10"
          style={{
            background:
              "linear-gradient(to top, color-mix(in srgb, var(--color-bg) 92%, transparent) 30%, color-mix(in srgb, var(--color-bg) 55%, transparent) 70%, transparent)",
          }}
        >
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5">
              <h3
                className="font-display text-[0.6rem] uppercase tracking-[0.2em] crt-glow"
                style={{ color: "var(--color-text-primary)" }}
              >
                {label}
              </h3>
              {isRecording && <RecordingBadge />}
            </div>
            {isLive && (
              <span className="flex items-center gap-1.5 font-display text-[0.55rem] uppercase tracking-[0.15em] text-text-secondary">
                <span
                  className="speedrun-pulse-dot"
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: "9999px",
                    display: "inline-block",
                    backgroundColor: "var(--color-accent)",
                    boxShadow: "0 0 calc(6px * var(--glow-strength)) var(--color-accent)",
                  }}
                />
                live
              </span>
            )}
          </div>
          {current ? (
            <p
              className="text-text-primary leading-snug"
              style={{ fontSize: "1rem", minHeight: "1.5rem" }}
            >
              {displayed}
              {isTyping && (
                <span
                  className="speedrun-caret-blink"
                  style={{ color: "var(--color-accent)" }}
                >
                  {'\u258B'}
                </span>
              )}
            </p>
          ) : (
            <p className="text-text-secondary/70 italic" style={{ fontSize: "0.9rem" }}>
              {status === "starting" ? "Booting observer..." : "Awaiting signal..."}
            </p>
          )}
          {current && (
            <p className="font-display text-[0.55rem] uppercase tracking-[0.2em] text-text-secondary/60">
              step {current.step} · {current.action.type}
              {current.action.target ? ` → ${current.action.target}` : ""}
            </p>
          )}
        </div>
      </div>
    );
  }

  // ---- Side panel (desktop) variant ----
  return (
    <div className="flex h-full flex-col gap-3 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h3
            className="font-display text-xs uppercase tracking-[0.2em] crt-glow"
            style={{ color: "var(--color-text-primary)" }}
          >
            {label}
          </h3>
          {isRecording && <RecordingBadge />}
        </div>
        {isLive && (
          <span className="flex items-center gap-1.5 font-display text-[0.6rem] uppercase tracking-[0.15em] text-text-secondary">
            <span
              className="speedrun-pulse-dot"
              style={{
                width: 7,
                height: 7,
                borderRadius: "9999px",
                display: "inline-block",
                backgroundColor: "var(--color-accent)",
                boxShadow: "0 0 calc(6px * var(--glow-strength)) var(--color-accent)",
              }}
            />
            live
          </span>
        )}
      </div>

      {/* Current thought */}
      <div
        className="rounded-sm border p-3 md:p-4 min-h-[5rem]"
        style={{
          borderColor: "color-mix(in srgb, var(--color-accent) 40%, transparent)",
          backgroundColor: "color-mix(in srgb, var(--color-accent) 6%, transparent)",
        }}
      >
        {current ? (
          <p className="text-sm md:text-base leading-relaxed text-text-primary">
            {displayed}
            {isTyping && (
              <span
                className="speedrun-caret-blink"
                style={{ color: "var(--color-accent)" }}
              >
                {'\u258B'}
              </span>
            )}
          </p>
        ) : (
          <p className="text-sm text-text-secondary/60 italic">
            {status === "starting" ? "Booting observer..." : "Awaiting signal..."}
          </p>
        )}
        {current && (
          <p className="mt-2 font-display text-[0.6rem] uppercase tracking-[0.2em] text-text-secondary/60">
            step {current.step} · {current.action.type}
            {current.action.target ? ` → ${current.action.target}` : ""}
            {current.action.item ? ` · ${current.action.item}` : ""}
          </p>
        )}
      </div>

      {/* History */}
      <div
        ref={historyRef}
        className="flex-1 min-h-0 overflow-y-auto pr-1 flex flex-col gap-2"
      >
        {previous
          .slice()
          .reverse()
          .map((t) => (
            <div
              key={t.step}
              className="border-l-2 pl-2 py-0.5"
              style={{
                borderColor:
                  "color-mix(in srgb, var(--color-text-secondary) 30%, transparent)",
              }}
            >
              <p className="text-[0.85em] leading-snug text-text-secondary/70">
                {t.thought}
              </p>
              <p className="mt-0.5 font-display text-[0.55rem] uppercase tracking-[0.15em] text-text-secondary/40">
                step {t.step}
              </p>
            </div>
          ))}
      </div>
    </div>
  );
}
