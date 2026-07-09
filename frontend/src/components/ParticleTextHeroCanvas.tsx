import { useEffect, useRef } from "react";

// ---------------------------------------------------------------------------
// Particle Text Morph hero animation (p5.js).
//
// Particles swarm randomly, then converge to densely fill words/shapes.
// They hold, then explode outward and reform into the next word. Loops.
//
// Tuned for legibility: heavy font weight + stroke for thick strokes, dense
// pixel sampling, strong spring physics with high damping so particles snap
// tightly to their targets, and minimal hold-phase jitter.
// ---------------------------------------------------------------------------

const MORPH_WORDS = ["CME.exe", "AI × DESIGN", "THE MACHINE"];
const PARTICLE_COUNT = 1400;

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  tx: number;
  ty: number;
  size: number;
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
              size: p.random(1.8, 3.2),
            });
          }
        }

        /** Render text to offscreen canvas (heavy + stroked for thickness),
         *  sample opaque pixels densely as target points. */
        function setTargetsForWord(word: string) {
          offscreen.width = canvasW;
          offscreen.height = canvasH;
          const octx = offscreen.getContext("2d")!;
          octx.fillStyle = "#000";
          octx.fillRect(0, 0, canvasW, canvasH);

          // Large font so the word fills the canvas.
          const baseFontSize = Math.min(canvasW / (word.length * 0.62), canvasH * 0.5);
          octx.fillStyle = "#fff";
          octx.textAlign = "center";
          octx.textBaseline = "middle";
          // Heavy weight + thick stroke so the text shape is chunky and
          // produces many target pixels for dense particle coverage.
          octx.font = `900 ${baseFontSize}px 'Fira Mono', 'Courier New', monospace`;
          octx.lineJoin = "round";
          const cx = canvasW / 2;
          const cy = canvasH / 2;
          // Stroke outline to thicken the glyph shape.
          octx.lineWidth = Math.max(2, baseFontSize * 0.04);
          octx.strokeStyle = "#fff";
          octx.strokeText(word, cx, cy);
          octx.fillText(word, cx, cy);

          // Sample opaque pixels. Step scales with font size so sampling
          // density stays proportional regardless of canvas dimensions.
          const sampleStep = Math.max(3, Math.floor(baseFontSize / 38));
          const imgData = octx.getImageData(0, 0, canvasW, canvasH);
          const data = imgData.data;
          const candidates: { x: number; y: number }[] = [];
          for (let y = 0; y < canvasH; y += sampleStep) {
            for (let x = 0; x < canvasW; x += sampleStep) {
              const idx = (y * canvasW + x) * 4;
              // Red channel > threshold = opaque white pixel (text)
              if (data[idx]! > 128) {
                candidates.push({ x, y });
              }
            }
          }

          // Shuffle candidates so particles spread randomly across the word.
          for (let i = candidates.length - 1; i > 0; i--) {
            const j = Math.floor(p.random(i + 1));
            [candidates[i], candidates[j]] = [candidates[j]!, candidates[i]!];
          }

          // Assign each particle a target. If more particles than targets,
          // cycle so extras cluster on existing points. If fewer, some text
          // pixels go uncovered (acceptable — particles are dense enough).
          for (let i = 0; i < particles.length; i++) {
            const t = candidates[i % Math.max(1, candidates.length)];
            if (t) {
              particles[i]!.tx = t.x;
              particles[i]!.ty = t.y;
            }
          }
        }

        p.draw = () => {
          // Trail effect: semi-transparent background each frame.
          const bgRgb = hexToRgb(colors.bg);
          p.noStroke();
          p.fill(bgRgb[0], bgRgb[1], bgRgb[2], 38);
          p.rect(0, 0, canvasW, canvasH);

          const now = p.millis();
          // Phase machine
          if (phase === "forming") {
            if (now - morphTimer > 1600) {
              phase = "holding";
              morphTimer = now;
            }
          } else if (phase === "holding") {
            if (now - morphTimer > MORPH_HOLD_MS) {
              phase = "exploding";
              morphTimer = now;
              for (const part of particles) {
                const ang = p.random(p.TWO_PI);
                const spd = p.random(4, 10);
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

          for (const part of particles) {
            if (phase !== "exploding") {
              const dx = part.tx - part.x;
              const dy = part.ty - part.y;
              // Strong spring + high damping → particles snap tightly.
              part.vx += dx * 0.09;
              part.vy += dy * 0.09;
              part.vx *= 0.80;
              part.vy *= 0.80;
              // Subtle jitter only during hold, kept tiny so the word stays crisp.
              if (phase === "holding") {
                part.vx += p.random(-0.06, 0.06);
                part.vy += p.random(-0.06, 0.06);
              }
            } else {
              part.vx *= 0.96;
              part.vy *= 0.96;
            }

            part.x += part.vx;
            part.y += part.vy;

            // Colour blend: primary when near target, accent when drifting.
            const dist = Math.hypot(part.tx - part.x, part.ty - part.y);
            const closeness = Math.max(0, 1 - dist / 120);
            const r = p.lerp(accentRgb[0], primaryRgb[0], closeness);
            const g = p.lerp(accentRgb[1], primaryRgb[1], closeness);
            const b = p.lerp(accentRgb[2], primaryRgb[2], closeness);

            if (closeness > 0.55) {
              p.drawingContext.shadowBlur = 7;
              p.drawingContext.shadowColor = colors.primary;
            } else {
              p.drawingContext.shadowBlur = 0;
            }

            p.noStroke();
            p.fill(r, g, b, 230);
            p.circle(part.x, part.y, part.size);
          }
          p.drawingContext.shadowBlur = 0;
        };

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
