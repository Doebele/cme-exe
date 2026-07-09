import { useCallback } from "react";
import BootHeroCanvas from "../components/BootHeroCanvas";

/**
 * Boot section — the landing hero. Replaced the static text description
 * with a p5.js ASCII hero animation that materialises "CME.exe" from
 * cycling random characters, with a subtle matrix-rain backdrop and a
 * typewriter tagline. Minimal UI: replay boot + skip to speedrun links.
 */
export default function BootSection() {
  const replay = useCallback(() => {
    window.dispatchEvent(new CustomEvent("cme-exe:replay-boot"));
  }, []);

  return (
    <section id="boot" className="relative min-h-screen flex flex-col">
      {/* Full-screen ASCII hero animation */}
      <BootHeroCanvas />

      {/* Minimal controls — positioned at the bottom, out of the way */}
      <div className="boot-hero-controls">
        <button
          type="button"
          onClick={replay}
          className="font-display text-xs uppercase tracking-[0.2em] px-5 py-2.5 border boot-hero-btn"
        >
          ▶ Replay boot sequence
        </button>
        <a
          href="#observer"
          className="font-display text-xs uppercase tracking-[0.2em] px-5 py-2.5 border boot-hero-btn boot-hero-btn--muted"
        >
          Skip to speedrun →
        </a>
      </div>
    </section>
  );
}
