import { useEffect, useState, useCallback, useRef } from "react";
import { useAudio } from "../hooks/useAudio";
import { startAmbientBed, stopAmbientBed, setAmbientVolume } from "../lib/audio";
import { AMBIENT_CONFIGS } from "../lib/ambientConfigs";
import BootHeroCanvas from "../components/BootHeroCanvas";
import ConsoleHeroCanvas from "../components/ConsoleHeroCanvas";
import RotatingWireframeHeroCanvas from "../components/RotatingWireframeHeroCanvas";
import ParticleTextHeroCanvas from "../components/ParticleTextHeroCanvas";
import FlowFieldHeroCanvas from "../components/FlowFieldHeroCanvas";
import OutrunHeroCanvas from "../components/OutrunHeroCanvas";
import GlitchHeroCanvas from "../components/GlitchHeroCanvas";
import HyperspaceHeroCanvas from "../components/HyperspaceHeroCanvas";
import GameOfLifeHeroCanvas from "../components/GameOfLifeHeroCanvas";

type HeroAnimationId =
  | "ascii-materialize" | "console-boot" | "rotating-wireframe"
  | "particle-text" | "flow-field" | "outrun"
  | "glitch-storm" | "hyperspace" | "game-of-life";

// Order here defines the 1–9 keyboard shortcut mapping.
const HERO_ORDER: HeroAnimationId[] = [
  "ascii-materialize", "console-boot", "rotating-wireframe",
  "particle-text", "flow-field", "outrun",
  "glitch-storm", "hyperspace", "game-of-life",
];

const HERO_LABELS: Record<HeroAnimationId, string> = {
  "ascii-materialize": "ASCII MATERIALIZE",
  "console-boot": "CONSOLE BOOT",
  "rotating-wireframe": "ROTATING WIREFRAME C",
  "particle-text": "PARTICLE TEXT MORPH",
  "flow-field": "FLOW FIELD",
  "outrun": "OUTRUN DRIVE",
  "glitch-storm": "GLITCH STORM",
  "hyperspace": "HYPERSPACE TUNNEL",
  "game-of-life": "GAME OF LIFE",
};

interface PoolResponse {
  behavior?: { heroAnimationPool?: HeroAnimationId[] };
}

export default function BootSection() {
  const [animation, setAnimation] = useState<HeroAnimationId>("ascii-materialize");
  const [toast, setToast] = useState<string | null>(null);
  const [visibility, setVisibility] = useState(1); // 0..1 intersection ratio
  const sectionRef = useRef<HTMLElement>(null);
  const { enabled, initialized } = useAudio();

  // Track scroll visibility of the boot section → fade ambient bed.
  useEffect(() => {
    const el = sectionRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      (entries) => {
        const r = entries[0]?.intersectionRatio ?? 0;
        setVisibility(r);
      },
      { threshold: [0, 0.05, 0.1, 0.2, 0.35, 0.5, 0.75, 1] },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  // Start/stop the ambient bed based on readiness + visibility threshold.
  const shouldPlay = enabled && initialized && visibility > 0.05;
  useEffect(() => {
    if (shouldPlay) {
      startAmbientBed(AMBIENT_CONFIGS[animation] ?? AMBIENT_CONFIGS["ascii-materialize"]!);
      return () => stopAmbientBed();
    }
  }, [shouldPlay, animation]);

  // Volume tracks visibility (smooth scroll fade).
  useEffect(() => {
    setAmbientVolume(shouldPlay ? visibility : 0);
  }, [visibility, shouldPlay]);

  // Pick a random animation from the pool on mount.
  useEffect(() => {
    let active = true;
    fetch("/api/content/settings")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: PoolResponse | null) => {
        if (!active) return;
        const pool = d?.behavior?.heroAnimationPool?.length
          ? d.behavior.heroAnimationPool
          : HERO_ORDER;
        const pick = pool[Math.floor(Math.random() * pool.length)] ?? "ascii-materialize";
        setAnimation(pick as HeroAnimationId);
      })
      .catch(() => { /* keep default */ });
    return () => { active = false; };
  }, []);

  // Keyboard shortcuts 1–9 (Easter egg): force a specific animation.
  useEffect(() => {
    const flashToast = (id: HeroAnimationId) => {
      setToast(HERO_LABELS[id]);
      window.setTimeout(() => setToast((t) => (t === HERO_LABELS[id] ? null : t)), 1600);
    };
    const onKey = (e: KeyboardEvent) => {
      // Ignore when typing into an input/textarea
      const el = document.activeElement;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA")) return;
      const n = parseInt(e.key, 10);
      if (n >= 1 && n <= 9 && HERO_ORDER[n - 1]) {
        const id = HERO_ORDER[n - 1]!;
        setAnimation(id);
        flashToast(id);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const replay = useCallback(() => {
    window.dispatchEvent(new CustomEvent("cme-exe:replay-boot"));
  }, []);

  return (
    <section id="boot" ref={sectionRef} className="relative min-h-screen flex flex-col">
      {animation === "ascii-materialize" && <BootHeroCanvas />}
      {animation === "console-boot" && <ConsoleHeroCanvas />}
      {animation === "rotating-wireframe" && <RotatingWireframeHeroCanvas />}
      {animation === "particle-text" && <ParticleTextHeroCanvas />}
      {animation === "flow-field" && <FlowFieldHeroCanvas />}
      {animation === "outrun" && <OutrunHeroCanvas />}
      {animation === "glitch-storm" && <GlitchHeroCanvas />}
      {animation === "hyperspace" && <HyperspaceHeroCanvas />}
      {animation === "game-of-life" && <GameOfLifeHeroCanvas />}

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

      {toast && (
        <div className="boot-hero-toast font-display" role="status" aria-live="polite">
          ▶ {toast}
        </div>
      )}
    </section>
  );
}
