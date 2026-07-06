import { useEffect, useRef, useState } from "react";
import gsap from "gsap";
import type { CurrentLocation } from "../../hooks/useSpeedrun";
import type { Section } from "../../lib/speedrunApi";
import { useIsMobile } from "../../hooks/useIsMobile";

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";
const DISMISS_MS = 4000;
const FLIP_THRESHOLD = 0.65;

export interface MarginaliaProps {
  /** Full latest thought — shortened for display. */
  thought: string;
  activeStation: CurrentLocation;
  /** Stage container; the note is positioned within it. */
  containerRef: React.RefObject<HTMLElement | null>;
}

interface Placement {
  left: number;
  top: number;
  placeBelow: boolean;
  placeLeft: boolean;
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

/**
 * Shorten a thought to a marginalia-friendly snippet: first sentence if it's
 * short enough, otherwise a soft-truncated 77-char excerpt.
 */
function shortenThought(thought: string): string {
  const trimmed = thought.trim();
  const sentenceEnd = trimmed.search(/[.!?]\s/);
  if (sentenceEnd !== -1 && sentenceEnd < 100) {
    return trimmed.slice(0, sentenceEnd + 1);
  }
  if (trimmed.length <= 80) return trimmed;
  return trimmed.slice(0, 77) + "…";
}

function restingTransform(placement: Placement, isMobile: boolean): string {
  if (placement.placeBelow || isMobile) return "translate(-50%, 0)";
  return "translate(0, -50%)";
}

/**
 * Floating one-line extract of the Observer's latest thought, pinned adjacent
 * to the active station. Auto-dismisses after DISMISS_MS or when the active
 * station changes, whichever comes first. During transitions the outgoing
 * note fades while the incoming one fades in — no harsh swap.
 */
export default function Marginalia({
  thought,
  activeStation,
  containerRef,
}: MarginaliaProps) {
  const isMobile = useIsMobile();
  const noteRef = useRef<HTMLDivElement | null>(null);
  const [placement, setPlacement] = useState<Placement | null>(null);
  const [short, setShort] = useState(() => shortenThought(thought));

  // Compute placement whenever the active station or viewport changes.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const el = findStationElement(
      container,
      activeStation.section,
      activeStation.item,
    );
    if (!el) {
      setPlacement(null);
      return;
    }

    const recompute = () => {
      const cRect = container.getBoundingClientRect();
      const eRect = el.getBoundingClientRect();
      const offset = 8;

      // Defaults: desktop → right of station; mobile → below, centered.
      let left = eRect.left - cRect.left + eRect.width + offset;
      let top = eRect.top - cRect.top + eRect.height / 2;
      let placeLeft = false;
      let placeBelow = false;

      if (isMobile) {
        placeBelow = true;
        top = eRect.top - cRect.top + eRect.height + offset;
        left = eRect.left - cRect.left + eRect.width / 2;
      } else {
        // Flip to the left if the station sits on the right side of the stage.
        if (eRect.right - cRect.left > cRect.width * FLIP_THRESHOLD) {
          placeLeft = true;
          left = eRect.left - cRect.left - offset;
        }
        // Flip to below if near the bottom edge.
        if (eRect.bottom - cRect.top > cRect.height * FLIP_THRESHOLD) {
          placeBelow = true;
          top = eRect.top - cRect.top + eRect.height + offset;
          left = placeLeft
            ? eRect.left - cRect.left + eRect.width / 2
            : eRect.left - cRect.left + eRect.width + offset;
        }
      }

      setPlacement({ left, top, placeBelow, placeLeft });
    };

    recompute();
    // Recompute on resize so the note tracks reflowing stations.
    window.addEventListener("resize", recompute);
    return () => window.removeEventListener("resize", recompute);
  }, [activeStation.section, activeStation.item, containerRef, isMobile]);

  // Update shortened text when thought or station changes.
  useEffect(() => {
    setShort(shortenThought(thought));
  }, [thought, activeStation.section, activeStation.item]);

  // Fade + slide in, then auto-dismiss after DISMISS_MS.
  useEffect(() => {
    const note = noteRef.current;
    if (!note || !placement) return;

    const reduced = prefersReducedMotion();
    const rest = restingTransform(placement, isMobile);

    if (reduced) {
      gsap.set(note, { opacity: 1, transform: rest });
    } else {
      const fromTransform = placement.placeBelow || isMobile
        ? "translate(-50%, -6px) scale(0.96)"
        : "translate(-6px, -50%) scale(0.96)";
      gsap.fromTo(
        note,
        { opacity: 0, transform: fromTransform },
        { opacity: 1, transform: rest, duration: 0.35, ease: "power2.out" },
      );
    }

    const dismiss = window.setTimeout(() => {
      if (reduced) {
        gsap.set(note, { opacity: 0 });
      } else {
        gsap.to(note, {
          opacity: 0,
          duration: 0.3,
          ease: "power2.in",
        });
      }
    }, DISMISS_MS);

    return () => {
      window.clearTimeout(dismiss);
    };
  }, [placement, isMobile]);

  if (!placement) return null;

  const width = isMobile ? 140 : 210;
  const transformOrigin = placement.placeBelow
    ? "left"
    : placement.placeLeft
      ? "right"
      : "left";

  return (
    <div
      aria-hidden
      style={{
        position: "absolute",
        left: placement.left,
        top: placement.top,
        width,
        pointerEvents: "none",
        zIndex: 15,
        transformOrigin,
      }}
    >
      <div
        ref={noteRef}
        style={{
          padding: isMobile ? "4px 8px" : "6px 10px",
          borderRadius: 2,
          border: "1px solid color-mix(in srgb, var(--color-text-primary) 50%, transparent)",
          backgroundColor: "color-mix(in srgb, var(--color-bg) 85%, transparent)",
          color: "var(--color-text-primary)",
          boxShadow:
            "0 0 calc(10px * var(--glow-strength)) color-mix(in srgb, var(--color-text-primary) 25%, transparent)",
          backdropFilter: "blur(2px)",
          fontFamily: "var(--font-display)",
          fontSize: isMobile ? "0.65rem" : "0.7rem",
          lineHeight: 1.35,
          letterSpacing: "0.02em",
          textAlign: "left",
          whiteSpace: "normal",
        }}
      >
        {short}
      </div>
    </div>
  );
}
