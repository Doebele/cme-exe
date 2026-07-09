import { useEffect, useRef } from "react";

// ---------------------------------------------------------------------------
// Flow Field hero animation (p5.js).
//
// Thousands of particles follow a slowly-evolving Perlin-noise vector field,
// leaving fading trails. Hypnotic ambient loop — nothing to click, just watch.
// The noise field shifts over time so patterns never repeat. Theme-aware.
// ---------------------------------------------------------------------------

const PARTICLE_COUNT = 1200;
const NOISE_SCALE = 0.0035;
const FIELD_STRENGTH = 1.8;
const FADE_ALPHA = 12; // lower = longer trails

interface Particle {
  x: number;
  y: number;
  px: number;
  py: number;
  life: number;
  maxLife: number;
  alpha: number;
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

export default function FlowFieldHeroCanvas() {
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
        let colors = readColors();
        let primaryRgb: [number, number, number];
        let accentRgb: [number, number, number];
        let bgRgb: [number, number, number];
        let canvasW = 0;
        let canvasH = 0;
        let zOffset = 0;
        let paletteSwap = 0;

        p.setup = () => {
          const rect = container.getBoundingClientRect();
          canvasW = Math.max(320, rect.width);
          canvasH = Math.max(300, rect.height);
          p.createCanvas(canvasW, canvasH);
          primaryRgb = hexToRgb(colors.primary);
          accentRgb = hexToRgb(colors.accent);
          bgRgb = hexToRgb(colors.bg);
          // Paint initial background solid
          p.background(bgRgb[0], bgRgb[1], bgRgb[2]);
          initParticles();
        };

        p.windowResized = () => {
          const rect = container.getBoundingClientRect();
          canvasW = Math.max(320, rect.width);
          canvasH = Math.max(300, rect.height);
          p.resizeCanvas(canvasW, canvasH);
          p.background(bgRgb[0], bgRgb[1], bgRgb[2]);
          initParticles();
        };

        function initParticles() {
          particles = [];
          for (let i = 0; i < PARTICLE_COUNT; i++) {
            spawnParticle(true);
          }
        }

        function spawnParticle(fresh: boolean) {
          const maxLife = 80 + Math.random() * 120;
          particles.push({
            x: fresh ? Math.random() * canvasW : Math.random() * canvasW,
            y: fresh ? Math.random() * canvasH : Math.random() * canvasH,
            px: 0,
            py: 0,
            life: fresh ? Math.random() * maxLife : 0,
            maxLife,
            alpha: 0,
          });
          const last = particles[particles.length - 1]!;
          last.px = last.x;
          last.py = last.y;
        }

        p.draw = () => {
          // Fade trails (don't fully clear)
          p.noStroke();
          p.fill(bgRgb[0], bgRgb[1], bgRgb[2], FADE_ALPHA);
          p.rect(0, 0, canvasW, canvasH);

          zOffset += 0.0008;
          paletteSwap += 0.002;

          for (let i = particles.length - 1; i >= 0; i--) {
            const part = particles[i]!;
            part.life++;
            const lifeRatio = part.life / part.maxLife;

            // Respawn if dead
            if (lifeRatio >= 1) {
              part.x = Math.random() * canvasW;
              part.y = Math.random() * canvasH;
              part.px = part.x;
              part.py = part.y;
              part.life = 0;
              part.maxLife = 80 + Math.random() * 120;
              continue;
            }

            // Sample the noise field at this position
            const angle = p.noise(
              part.x * NOISE_SCALE,
              part.y * NOISE_SCALE,
              zOffset
            ) * p.TWO_PI * 3; // multiply for more curl

            part.px = part.x;
            part.py = part.y;
            part.x += Math.cos(angle) * FIELD_STRENGTH;
            part.y += Math.sin(angle) * FIELD_STRENGTH;

            // Wrap around edges
            if (part.x < 0) { part.x = canvasW; part.px = part.x; }
            if (part.x > canvasW) { part.x = 0; part.px = part.x; }
            if (part.y < 0) { part.y = canvasH; part.py = part.y; }
            if (part.y > canvasH) { part.y = 0; part.py = part.y; }

            // Colour: blend between accent and primary based on position + time
            const mix = (Math.sin(paletteSwap + part.x * 0.002 + part.y * 0.002) + 1) / 2;
            const r = p.lerp(accentRgb[0], primaryRgb[0], mix);
            const g = p.lerp(accentRgb[1], primaryRgb[1], mix);
            const b = p.lerp(accentRgb[2], primaryRgb[2], mix);

            // Fade in/out over life for smooth trails
            let lifeAlpha = 1;
            if (lifeRatio < 0.1) lifeAlpha = lifeRatio / 0.1;
            else if (lifeRatio > 0.85) lifeAlpha = (1 - lifeRatio) / 0.15;

            p.stroke(r, g, b, 200 * lifeAlpha);
            p.strokeWeight(1.2);
            p.line(part.px, part.py, part.x, part.y);
          }

          // Occasionally add a subtle glow flash for visual interest
          if (p.frameCount % 180 === 0) {
            // Bright pulse dot at a random position
            const fx = Math.random() * canvasW;
            const fy = Math.random() * canvasH;
            p.noStroke();
            for (let r = 30; r > 0; r -= 3) {
              p.fill(primaryRgb[0], primaryRgb[1], primaryRgb[2], 6);
              p.circle(fx, fy, r);
            }
          }
        };

        // Theme observer
        const themeObs = new MutationObserver(() => {
          colors = readColors();
          primaryRgb = hexToRgb(colors.primary);
          accentRgb = hexToRgb(colors.accent);
          bgRgb = hexToRgb(colors.bg);
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
