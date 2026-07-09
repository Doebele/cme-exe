import { useEffect, useState, useCallback } from "react";
import BootHeroCanvas from "../components/BootHeroCanvas";
import ConsoleHeroCanvas from "../components/ConsoleHeroCanvas";
import RotatingWireframeHeroCanvas from "../components/RotatingWireframeHeroCanvas";
import ParticleTextHeroCanvas from "../components/ParticleTextHeroCanvas";
import FlowFieldHeroCanvas from "../components/FlowFieldHeroCanvas";
import OutrunHeroCanvas from "../components/OutrunHeroCanvas";

type HeroAnimationId = "ascii-materialize" | "console-boot" | "rotating-wireframe" | "particle-text" | "flow-field" | "outrun";

const HERO_CACHE: { animation?: HeroAnimationId } = {};
let heroPromise: Promise<HeroAnimationId> | null = null;

function fetchHeroAnimation(): Promise<HeroAnimationId> {
  if (HERO_CACHE.animation) return Promise.resolve(HERO_CACHE.animation);
  if (heroPromise) return heroPromise;
  heroPromise = fetch("/api/content/settings")
    .then((r) => (r.ok ? r.json() : null))
    .then((d: { behavior?: { heroAnimation?: HeroAnimationId } } | null) => {
      const id = d?.behavior?.heroAnimation ?? "ascii-materialize";
      HERO_CACHE.animation = id;
      return id;
    })
    .catch(() => {
      HERO_CACHE.animation = "ascii-materialize";
      return HERO_CACHE.animation;
    });
  return heroPromise;
}

export default function BootSection() {
  const [animation, setAnimation] = useState<HeroAnimationId>("ascii-materialize");
  const replay = useCallback(() => {
    window.dispatchEvent(new CustomEvent("cme-exe:replay-boot"));
  }, []);

  useEffect(() => {
    fetchHeroAnimation().then(setAnimation);
    // Re-read when admin saves settings (custom event from admin, or visibility change).
    const onChange = () => {
      HERO_CACHE.animation = undefined;
      heroPromise = null;
      fetchHeroAnimation().then(setAnimation);
    };
    window.addEventListener("cme-exe:settings-updated", onChange);
    return () => window.removeEventListener("cme-exe:settings-updated", onChange);
  }, []);

  return (
    <section id="boot" className="relative min-h-screen flex flex-col">
      {animation === "ascii-materialize" && <BootHeroCanvas />}
      {animation === "console-boot" && <ConsoleHeroCanvas />}
      {animation === "rotating-wireframe" && <RotatingWireframeHeroCanvas />}
      {animation === "particle-text" && <ParticleTextHeroCanvas />}
      {animation === "flow-field" && <FlowFieldHeroCanvas />}
      {animation === "outrun" && <OutrunHeroCanvas />}

      {animation !== "console-boot" && (
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
      )}
    </section>
  );
}
