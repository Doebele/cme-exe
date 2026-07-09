import { useEffect, useRef } from "react";

// ---------------------------------------------------------------------------
// Particle Text Morph hero animation (p5.js).
//
// Hundreds of particles swarm randomly, then converge to form words/shapes.
// They hold, then explode and reform into the next word. Loops forever.
// Uses an offscreen canvas to sample text pixels into target points.
// ---------------------------------------------------------------------------

const MORPH_WORDS = ["CME.exe", "AI × DESIGN", "THE MACHINE"];
const PARTICLE_COUNT = 700;

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  tx: number;
  ty: number;
  size: number;
  hue: number;
}

interface Colors {
  primary: string;
  accent: string;
  bg: string;
}

function readColors(): Colors {
  const cs = getComputedStyle(document.documentElement);
  const read = (n: string, f: string) => cs.getPropertyValue(n).trim() || f;
  return {
    primary: read("--color-text-primary", "#39ff14"),
    accent: read("--color-accent", "#4ECDC4"),
    bg: read("--color-bg", "#0a0e0a"),
  };
}

/** Parse a hex colour to RGB tuple. */
function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export default function ParticleTextHeroCanvas() {
  const containerRef = useRef<HTMLDivElement>(null);
  const p5Ref = useRef<any>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let cancelled = false;
    import("p5").then((p5Mod) => {
      if (cancelled || !container) return;
      const p5 = p5Mod.default;

      const sketch = (p: any) => {
        let particles: Particle[] = [];
        let targets: { x: number; y: number }[] = [];
        let wordIndex = 0;
        let morphTimer = 0;
        const MORPH_HOLD_MS = 3500;
        const MORPH_EXPLODE_MS = 800;
        let phase: "forming" | "holding" | "exploding" = "forming";
        let colors = readColors();
        let primaryRgb: [number, number, number];
        let accentRgb: [number, number, number];
        let canvasW = 0;
        let canvasH = 0;
        let offscreen: HTMLCanvasElement;

        p.setup = () => {
          const rect = container.getBoundingClientRect();
          canvasW = Math.max(320, rect.width);
          canvasH = Math.max(300, rect.height);
          p.createCanvas(canvasW, canvasH);
          primaryRgb = hexToRgb(colors.primary);
          accentRgb = hexToRgb(colors.accent);
          offscreen = document.createElement("canvas");
          initParticles();
          setTargetsForWord(MORPH_WORDS[0]!);
        };

        p.windowResized = () => {
          const rect = container.getBoundingClientRect();
          canvasW = Math.max(320, rect.width);
          canvasH = Math.max(300, rect.height);
          p.resizeCanvas(canvasW, canvasH);
          setTargetsForWord(MORPH_WORDS[wordIndex]!);
        };

        function initParticles() {
          particles = [];
          for (let i = 0; i < PARTICLE_COUNT; i++) {
            particles.push({
              x: p.random(canvasW),
              y: p.random(canvasH),
              vx: p.random(-2, 2),
              vy: p.random(-2, 2),
              tx: canvasW / 2,
              ty: canvasH / 2,
              size: p.random(1.5, 3.5),
              hue: p.random(),
            });
          }
        }

        /** Render text to offscreen canvas, sample dark pixels as targets. */
        function setTargetsForWord(word: string) {
          offscreen.width = canvasW;
          offscreen.height = canvasH;
          const octx = offscreen.getContext("2d")!;
          octx.fillStyle = "#000";
          octx.fillRect(0, 0, canvasW, canvasH);

          // Scale font to fit width
          const baseFontSize = Math.min(canvasW / (word.length * 0.65), canvasH * 0.45);
          octx.fillStyle = "#fff";
          octx.font = `900 ${baseFontSize}px 'Fira Mono', 'Courier New', monospace`;
          octx.textAlign = "center";
          octx.textBaseline = "middle";
          octx.fillText(word, canvasW / 2, canvasH / 2);

          // Sample pixels
          const imgData = octx.getImageData(0, 0, canvasW, canvasH);
          const data = imgData.data;
          const sampleStep = Math.max(3, Math.floor(Math.sqrt(
            (canvasW * canvasH * 0.15) / PARTICLE_COUNT
          )));
          const candidates: { x: number; y: number }[] = [];
          for (let y = 0; y < canvasH; y += sampleStep) {
            for (let x = 0; x < canvasW; x += sampleStep) {
              const idx = (y * canvasW + x) * 4 + 3; // alpha channel
              if (data[idx]! > 128) {
                candidates.push({ x, y });
              }
            }
          }

          // Shuffle and assign
          for (let i = candidates.length - 1; i > 0; i--) {
            const j = Math.floor(p.random(i + 1));
            [candidates[i], candidates[j]] = [candidates[j]!, candidates[i]!];
          }

          targets = candidates;
          // Assign each particle a target (cycling if fewer targets)
          for (let i = 0; i < particles.length; i++) {
            const t = targets[i % Math.max(1, targets.length)];
            if (t) {
              particles[i]!.tx = t.x;
              particles[i]!.ty = t.y;
            }
          }
        }

        p.draw = () => {
          // Trail effect: semi-transparent background
          const bgRgb = hexToRgb(colors.bg);
          p.noStroke();
          p.fill(bgRgb[0], bgRgb[1], bgRgb[2], 40);
          p.rect(0, 0, canvasW, canvasH);

          const now = p.millis();
          // Phase machine
          if (phase === "forming") {
            if (now - morphTimer > 1500) {
              phase = "holding";
              morphTimer = now;
            }
          } else if (phase === "holding") {
            if (now - morphTimer > MORPH_HOLD_MS) {
              phase = "exploding";
              morphTimer = now;
              // Give all particles outward velocity
              for (const part of particles) {
                const ang = p.random(p.TWO_PI);
                const spd = p.random(3, 8);
                part.vx = Math.cos(ang) * spd;
                part.vy = Math.sin(ang) * spd;
              }
            }
          } else {
            if (now - morphTimer > MORPH_EXPLODE_MS) {
              wordIndex = (wordIndex + 1) % MORPH_WORDS.length;
              setTargetsForWord(MORPH_WORDS[wordIndex]!);
              phase = "forming";
              morphTimer = now;
            }
          }

          // Update + draw particles
          for (const part of particles) {
            if (phase !== "exploding") {
              // Spring toward target
              const dx = part.tx - part.x;
              const dy = part.ty - part.y;
              part.vx += dx * 0.04;
              part.vy += dy * 0.04;
              // Damping
              part.vx *= 0.85;
              part.vy *= 0.85;
              // Tiny noise jitter for life
              if (phase === "holding") {
                part.vx += p.random(-0.15, 0.15);
                part.vy += p.random(-0.15, 0.15);
              }
            } else {
              // Explosion: just coast with friction
              part.vx *= 0.96;
              part.vy *= 0.96;
            }

            part.x += part.vx;
            part.y += part.vy;

            // Colour blend: primary when near target, accent when far
            const dist = Math.hypot(part.tx - part.x, part.ty - part.y);
            const closeness = Math.max(0, 1 - dist / 150);
            const r = p.lerp(accentRgb[0], primaryRgb[0], closeness);
            const g = p.lerp(accentRgb[1], primaryRgb[1], closeness);
            const b = p.lerp(accentRgb[2], primaryRgb[2], closeness);

            // Glow when close to target
            if (closeness > 0.6) {
              p.drawingContext.shadowBlur = 8;
              p.drawingContext.shadowColor = colors.primary;
            } else {
              p.drawingContext.shadowBlur = 0;
            }

            p.noStroke();
            p.fill(r, g, b, 220);
            p.circle(part.x, part.y, part.size);
          }
          p.drawingContext.shadowBlur = 0;
        };

        // Theme observer
        const themeObs = new MutationObserver(() => {
          colors = readColors();
          primaryRgb = hexToRgb(colors.primary);
          accentRgb = hexToRgb(colors.accent);
        });
        themeObs.observe(document.documentElement, {
          attributes: true,
          attributeFilter: ["data-theme"],
        });

        p._cleanup = () => themeObs.disconnect();
      };

      p5Ref.current = new p5(sketch, container);
    });

    return () => {
      cancelled = true;
      if (p5Ref.current) {
        try {
          if (p5Ref.current._cleanup) p5Ref.current._cleanup();
          p5Ref.current.remove();
        } catch { /* gone */ }
        p5Ref.current = null;
      }
    };
  }, []);

  return (
    <div ref={containerRef} className="boot-hero-canvas-wrap">
      {/* p5 mounts its own canvas here */}
    </div>
  );
}
