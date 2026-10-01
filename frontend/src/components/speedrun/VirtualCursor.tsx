import { useCallback, useEffect, useRef, useState } from "react";
import gsap from "gsap";
import type { CurrentLocation } from "../../hooks/useSpeedrun";
import type { Section } from "../../lib/speedrunApi";

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";
const TRAIL_LENGTH = 2;

interface CursorPos {
  left: number;
  top: number;
}

interface VirtualCursorProps {
  /** Container the cursor is positioned within (must be position: relative). */
  containerRef: React.RefObject<HTMLDivElement | null>;
  currentLocation: CurrentLocation;
  /** When false, the cursor hides (idle / manifest / error states). */
  visible: boolean;
  /** Compact (mobile) sizing: ~12px instead of 16px. */
  compact?: boolean;
  /**
   * While true (observer live) the cursor makes quick "glance" darts to
   * nearby visible stations and returns — reads as an operator checking the
   * board between real moves.
   */
  scanning?: boolean;
  /**
   * Bump counter (e.g. thoughts.length). Each increment triggers an
   * immediate scan burst over the stations — new content appearing on the
   * stage gets "inspected".
   */
  pulse?: number;
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia(REDUCED_MOTION_QUERY).matches
  );
}

function findStationElement(
  container: HTMLElement,
  section: Section,
  item: string | null,
): HTMLElement | null {
  const selector = item
    ? `[data-section="${section}"][data-item="${item}"]`
    : `[data-section="${section}"][data-item=""]`;
  return container.querySelector<HTMLElement>(selector);
}

function stationCenter(
  container: HTMLElement,
  el: HTMLElement,
  size: number,
): CursorPos {
  const cRect = container.getBoundingClientRect();
  const eRect = el.getBoundingClientRect();
  // Center the arrow tip on the station center.
  return {
    left: eRect.left - cRect.left + eRect.width / 2 - size / 4,
    top: eRect.top - cRect.top + eRect.height / 2 - size * 0.75,
  };
}

/**
 * Animated vector arrow that travels between stations on the Stage.
 * Uses GSAP for the move (power2.inOut, ~1.2s) and renders 2 ghost echoes
 * as a fading trail. Idles with a subtle sinusoidal float.
 */
export default function VirtualCursor({
  containerRef,
  currentLocation,
  visible,
  compact = false,
  scanning = false,
  pulse = 0,
}: VirtualCursorProps) {
  const arrowRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<CursorPos>({ left: 0, top: 0 });
  const [trail, setTrail] = useState<CursorPos[]>([]);
  const [mounted, setMounted] = useState(false);
  const posRef = useRef<CursorPos>({ left: 0, top: 0 });
  const dartBusyRef = useRef(false);
  const size = compact ? 12 : 16;

  // Shared: move the cursor to a station element (used for real moves and
  // darts alike). Quick darts use a snappier ease/duration.
  const glideTo = useCallback(
    (target: CursorPos, quick: boolean) => {
      const arrow = arrowRef.current;
      if (!arrow) return;
      setTrail((prev) => [...prev, posRef.current].slice(-TRAIL_LENGTH));
      gsap.to(arrow, {
        left: target.left,
        top: target.top,
        duration: quick ? 0.42 : 1.2,
        ease: quick ? "power3.inOut" : "power2.inOut",
        overwrite: "auto",
        onComplete: () => {
          posRef.current = target;
          setPos(target);
        },
      });
    },
    [],
  );

  // Place cursor at the current station whenever location changes (or on resize).
  useEffect(() => {
    const container = containerRef.current;
    const arrow = arrowRef.current;
    if (!container || !arrow) return;

    const moveToCurrent = () => {
      const el = findStationElement(
        container,
        currentLocation.section,
        currentLocation.item,
      );
      if (!el) return;
      const target = stationCenter(container, el, size);
      const reduced = prefersReducedMotion();

      if (reduced) {
        gsap.set(arrow, { x: 0, y: 0, left: target.left, top: target.top });
        setPos(target);
        posRef.current = target;
        setTrail([]);
        return;
      }

      glideTo(target, false);
    };

    // Defer until after the stations have laid out.
    const raf = requestAnimationFrame(moveToCurrent);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentLocation.section, currentLocation.item, containerRef, glideTo]);

  // ---- Scan darts: quick glances at other visible stations -----------------
  // Two triggers: a randomized idle rhythm while `scanning`, and an immediate
  // burst whenever `pulse` increments (new thought / newly revealed content).
  useEffect(() => {
    const container = containerRef.current;
    const arrow = arrowRef.current;
    if (!container || !arrow || !visible) return;
    if (prefersReducedMotion() || !scanning) return;

    const activeEl = () =>
      findStationElement(container, currentLocation.section, currentLocation.item);

    const visibleStations = (): HTMLElement[] => {
      const active = activeEl();
      const out: HTMLElement[] = [];
      for (const el of Array.from(container.querySelectorAll<HTMLElement>(".speedrun-station"))) {
        if (el === active) continue;
        // Hidden stations stay in the layout (progressive reveal) — only
        // dart to ones the visitor can actually see.
        const opacity = Number.parseFloat(window.getComputedStyle(el).opacity || "1");
        if (Number.isFinite(opacity) && opacity > 0.15) out.push(el);
      }
      return out;
    };

    const popArrival = () => {
      if (!arrowRef.current) return;
      gsap.fromTo(
        arrowRef.current,
        { scale: 1.45 },
        { scale: 1, duration: 0.35, ease: "back.out(2)", overwrite: false },
      );
    };

    const dartSequence = (hopCount: number) => {
      if (dartBusyRef.current) return;
      const pool = visibleStations();
      if (pool.length === 0) return;
      dartBusyRef.current = true;
      const hops = pool.slice().sort(() => Math.random() - 0.5).slice(0, hopCount);

      const hop = (i: number) => {
        if (i >= hops.length) {
          // Return to the active station, then release the dart lock.
          const back = activeEl();
          if (back) {
            const target = stationCenter(container, back, size);
            gsap.to(arrow, {
              left: target.left,
              top: target.top,
              duration: 0.55,
              ease: "power2.inOut",
              overwrite: "auto",
              onComplete: () => {
                posRef.current = target;
                setPos(target);
                dartBusyRef.current = false;
              },
            });
          } else {
            dartBusyRef.current = false;
          }
          return;
        }
        const target = stationCenter(container, hops[i]!, size);
        gsap.to(arrow, {
          left: target.left,
          top: target.top,
          duration: 0.4,
          ease: "power3.inOut",
          overwrite: "auto",
          onComplete: () => {
            posRef.current = target;
            setPos(target);
            popArrival();
            window.setTimeout(() => hop(i + 1), 260 + Math.random() * 320);
          },
        });
      };
      hop(0);
    };

    // Idle rhythm: one dart (occasionally two hops) every 1.8–3.2s.
    const id = window.setInterval(() => {
      dartSequence(Math.random() < 0.35 ? 2 : 1);
    }, 1800 + Math.random() * 1400);

    return () => {
      window.clearInterval(id);
      dartBusyRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scanning, visible, containerRef, currentLocation.section, currentLocation.item, size]);

  // Pulse burst: new content arrived → inspect up to 2-3 stations right away.
  useEffect(() => {
    if (pulse <= 0 || !visible || !scanning) return;
    if (prefersReducedMotion()) return;
    const container = containerRef.current;
    if (!container) return;
    // Slight delay so newly revealed stations have laid out first.
    const t = window.setTimeout(() => {
      // Reuse the idle-dart machinery by dispatching a synthetic call —
      // simplest correct approach: replicate a short 2-hop burst.
      const arrow = arrowRef.current;
      if (!arrow) return;
      const active = findStationElement(container, currentLocation.section, currentLocation.item);
      const pool: HTMLElement[] = [];
      for (const el of Array.from(container.querySelectorAll<HTMLElement>(".speedrun-station"))) {
        if (el === active) continue;
        const opacity = Number.parseFloat(window.getComputedStyle(el).opacity || "1");
        if (Number.isFinite(opacity) && opacity > 0.15) pool.push(el);
      }
      if (pool.length === 0 || dartBusyRef.current) return;
      dartBusyRef.current = true;
      const hops = pool.slice().sort(() => Math.random() - 0.5).slice(0, Math.random() < 0.5 ? 2 : 3);
      const hop = (i: number) => {
        if (i >= hops.length) {
          if (active) {
            const target = stationCenter(container, active, size);
            gsap.to(arrow, {
              left: target.left,
              top: target.top,
              duration: 0.55,
              ease: "power2.inOut",
              overwrite: "auto",
              onComplete: () => {
                posRef.current = target;
                setPos(target);
                dartBusyRef.current = false;
              },
            });
          } else dartBusyRef.current = false;
          return;
        }
        const target = stationCenter(container, hops[i]!, size);
        gsap.to(arrow, {
          left: target.left,
          top: target.top,
          duration: 0.38,
          ease: "power3.inOut",
          overwrite: "auto",
          onComplete: () => {
            posRef.current = target;
            setPos(target);
            window.setTimeout(() => hop(i + 1), 200 + Math.random() * 240);
          },
        });
      };
      hop(0);
    }, 240);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pulse]);

  // Recompute on viewport resize (stations reflow).
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onResize = () => {
      const container = containerRef.current;
      const arrow = arrowRef.current;
      if (!container || !arrow) return;
      const el = findStationElement(
        container,
        currentLocation.section,
        currentLocation.item,
      );
      if (!el) return;
      const target = stationCenter(container, el, size);
      gsap.set(arrow, { left: target.left, top: target.top });
      posRef.current = target;
      setPos(target);
      setTrail([]);
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [containerRef, currentLocation.section, currentLocation.item, size]);

  // Reveal once mounted so the initial CSS transition doesn't flash.
  useEffect(() => {
    const raf = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  if (!visible) return null;

  const arrowSvg = (opacity: number, isGhost = false) => (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      style={{
        display: "block",
        opacity,
        filter: isGhost
          ? undefined
          : `drop-shadow(0 0 calc(6px * var(--glow-strength)) var(--color-text-primary))`,
      }}
      aria-hidden
    >
      <path
        d="M2 2 L13 8 L7 9.5 L5 14 Z"
        fill="var(--color-text-primary)"
        stroke="var(--color-bg)"
        strokeWidth="0.5"
      />
    </svg>
  );

  return (
    <>
      {/* Echo trail */}
      {trail.map((t, i) => (
        <div
          key={`trail-${i}-${t.left.toFixed(0)}-${t.top.toFixed(0)}`}
          aria-hidden
          style={{
            position: "absolute",
            left: t.left,
            top: t.top,
            pointerEvents: "none",
            zIndex: 5,
            opacity: mounted ? (i + 1) / (trail.length + 1) * 0.4 : 0,
            transition: "opacity 600ms ease-out",
          }}
        >
          {arrowSvg(0.5, true)}
        </div>
      ))}

      {/* Active cursor */}
      <div
        ref={arrowRef}
        aria-hidden
        className="speedrun-cursor-idle"
        style={{
          position: "absolute",
          left: pos.left,
          top: pos.top,
          pointerEvents: "none",
          zIndex: 20,
          opacity: mounted ? 1 : 0,
        }}
      >
        {arrowSvg(1)}
      </div>
    </>
  );
}
