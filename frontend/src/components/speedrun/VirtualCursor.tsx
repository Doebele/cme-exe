import { useEffect, useRef, useState } from "react";
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
}: VirtualCursorProps) {
  const arrowRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<CursorPos>({ left: 0, top: 0 });
  const [trail, setTrail] = useState<CursorPos[]>([]);
  const [mounted, setMounted] = useState(false);
  const posRef = useRef<CursorPos>({ left: 0, top: 0 });
  const size = compact ? 12 : 16;

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

      // Push current position onto the trail before moving.
      setTrail((prev) => {
        const next = [...prev, posRef.current];
        return next.slice(-TRAIL_LENGTH);
      });

      gsap.to(arrow, {
        left: target.left,
        top: target.top,
        duration: 1.2,
        ease: "power2.inOut",
        overwrite: "auto",
        onComplete: () => {
          posRef.current = target;
          setPos(target);
        },
      });
    };

    // Defer until after the stations have laid out.
    const raf = requestAnimationFrame(moveToCurrent);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentLocation.section, currentLocation.item, containerRef]);

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
