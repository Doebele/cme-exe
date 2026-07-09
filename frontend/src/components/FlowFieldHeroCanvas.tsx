import { useEffect, useRef } from "react";

// ---------------------------------------------------------------------------
// Flow Field hero animation (p5.js) — interactive.
//
// Thousands of particles follow a slowly-evolving Perlin-noise vector field,
// leaving fading trails. The field never repeats. Theme aware.
//
// Interaction:
//   • Cursor  — repels nearby particles, carving through the streams.
//   • Click   — spawns an expanding burst that scatters particles outward.
//   • Space   — shockwave from the canvas centre.
//   • R       — reseed the noise field for a new pattern.
//   • ↑ / ↓   — speed up / slow down field evolution.
// ---------------------------------------------------------------------------

const PARTICLE_COUNT = 1200;
const NOISE_SCALE = 0.0035;
const FIELD_STRENGTH = 1.8;
const FADE_ALPHA = 12;
const REPEL_RADIUS = 130;
const REPEL_STRENGTH = 2.4;
const MAX_BURSTS = 6;

interface Particle {
  x: number;
  y: number;
  px: number;
  py: number;
  life: number;
  maxLife: number;
}

interface Burst {
  x: number;
  y: number;
  age: number;       // ms since spawn
  maxAge: number;    // ms lifetime
  maxRadius: number;
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
        let bursts: Burst[] = [];
        let colors = readColors();
        let primaryRgb: [number, number, number];
        let accentRgb: [number, number, number];
        let bgRgb: [number, number, number];
        let canvasW = 0;
        let canvasH = 0;
        let zOffset = 0;
        let zSpeed = 0.0008;
        let paletteSwap = 0;
        let noiseSeed = Math.random() * 1000;

        // Cursor state
        let mx = -9999;
        let my = -9999;
        let mouseInside = false;
        let hintAlpha = 1; // hint text fades out after first interaction

        p.setup = () => {
          const rect = container.getBoundingClientRect();
          canvasW = Math.max(320, rect.width);
          canvasH = Math.max(300, rect.height);
          p.createCanvas(canvasW, canvasH);
          primaryRgb = hexToRgb(colors.primary);
          accentRgb = hexToRgb(colors.accent);
          bgRgb = hexToRgb(colors.bg);
          p.background(bgRgb[0], bgRgb[1], bgRgb[2]);
          p.noiseSeed(noiseSeed);
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
            const maxLife = 80 + Math.random() * 120;
            const x = Math.random() * canvasW;
            const y = Math.random() * canvasH;
            particles.push({ x, y, px: x, py: y, life: Math.random() * maxLife, maxLife });
          }
        }

        function spawnBurst(x: number, y: number, radius: number) {
          bursts.push({ x, y, age: 0, maxAge: 700, maxRadius: radius });
          if (bursts.length > MAX_BURSTS) bursts.shift();
          hintAlpha = 0; // dismiss hint on first interaction
        }

        // --- Input handlers ---
        p.mouseMoved = () => {
          mx = p.mouseX;
          my = p.mouseY;
          mouseInside = mx >= 0 && mx <= canvasW && my >= 0 && my <= canvasH;
        };
        p.mouseDragged = () => {
          mx = p.mouseX;
          my = p.mouseY;
          mouseInside = true;
        };
        p.mousePressed = () => {
          if (p.mouseX >= 0 && p.mouseX <= canvasW && p.mouseY >= 0 && p.mouseY <= canvasH) {
            spawnBurst(p.mouseX, p.mouseY, 320);
          }
        };
        p.keyPressed = () => {
          if (p.key === " ") {
            spawnBurst(canvasW / 2, canvasH / 2, 500);
          } else if (p.key === "r" || p.key === "R") {
            noiseSeed = Math.random() * 10000;
            p.noiseSeed(noiseSeed);
          } else if (p.keyCode === p.UP_ARROW) {
            zSpeed = Math.min(0.004, zSpeed * 1.4);
          } else if (p.keyCode === p.DOWN_ARROW) {
            zSpeed = Math.max(0.0001, zSpeed / 1.4);
          }
        };

        p.draw = () => {
          // Fade trails
          p.noStroke();
          p.fill(bgRgb[0], bgRgb[1], bgRgb[2], FADE_ALPHA);
          p.rect(0, 0, canvasW, canvasH);

          zOffset += zSpeed;
          paletteSwap += 0.002;

          // Age bursts
          const dt = p.deltaTime;
          for (let i = bursts.length - 1; i >= 0; i--) {
            bursts[i]!.age += dt;
            if (bursts[i]!.age > bursts[i]!.maxAge) bursts.splice(i, 1);
          }

          for (let i = particles.length - 1; i >= 0; i--) {
            const part = particles[i]!;
            part.life++;
            const lifeRatio = part.life / part.maxLife;

            if (lifeRatio >= 1) {
              part.x = Math.random() * canvasW;
              part.y = Math.random() * canvasH;
              part.px = part.x;
              part.py = part.y;
              part.life = 0;
              part.maxLife = 80 + Math.random() * 120;
              continue;
            }

            // Noise field direction
            const angle = p.noise(
              part.x * NOISE_SCALE,
              part.y * NOISE_SCALE,
              zOffset
            ) * p.TWO_PI * 3;

            let ax = Math.cos(angle) * FIELD_STRENGTH;
            let ay = Math.sin(angle) * FIELD_STRENGTH;

            // Cursor repulsion — carve through the streams
            if (mouseInside) {
              const dx = part.x - mx;
              const dy = part.y - my;
              const distSq = dx * dx + dy * dy;
              if (distSq < REPEL_RADIUS * REPEL_RADIUS && distSq > 0.5) {
                const dist = Math.sqrt(distSq);
                const force = (1 - dist / REPEL_RADIUS) * REPEL_STRENGTH;
                ax += (dx / dist) * force;
                ay += (dy / dist) * force;
              }
            }

            // Burst shockwaves push particles outward
            for (const burst of bursts) {
              const bdx = part.x - burst.x;
              const bdy = part.y - burst.y;
              const bDist = Math.hypot(bdx, bdy);
              const progress = burst.age / burst.maxAge;
              const currentRadius = burst.maxRadius * progress;
              // Ring band: push when particle is near the expanding ring edge
              const bandWidth = 80;
              if (Math.abs(bDist - currentRadius) < bandWidth && bDist > 0.5) {
                const fade = 1 - progress;
                const force = 6 * fade;
                ax += (bdx / bDist) * force;
                ay += (bdy / bDist) * force;
              }
            }

            part.px = part.x;
            part.py = part.y;
            part.x += ax;
            part.y += ay;

            // Wrap edges
            if (part.x < 0) { part.x = canvasW; part.px = part.x; }
            if (part.x > canvasW) { part.x = 0; part.px = part.x; }
            if (part.y < 0) { part.y = canvasH; part.py = part.y; }
            if (part.y > canvasH) { part.y = 0; part.py = part.y; }

            // Colour blend
            const mix = (Math.sin(paletteSwap + part.x * 0.002 + part.y * 0.002) + 1) / 2;
            const r = p.lerp(accentRgb[0], primaryRgb[0], mix);
            const g = p.lerp(accentRgb[1], primaryRgb[1], mix);
            const b = p.lerp(accentRgb[2], primaryRgb[2], mix);

            let lifeAlpha = 1;
            if (lifeRatio < 0.1) lifeAlpha = lifeRatio / 0.1;
            else if (lifeRatio > 0.85) lifeAlpha = (1 - lifeRatio) / 0.15;

            p.stroke(r, g, b, 200 * lifeAlpha);
            p.strokeWeight(1.2);
            p.line(part.px, part.py, part.x, part.y);
          }

          // --- Draw burst rings ---
          p.noFill();
          for (const burst of bursts) {
            const progress = burst.age / burst.maxAge;
            const radius = burst.maxRadius * progress;
            const alpha = (1 - progress) * 180;
            p.stroke(primaryRgb[0], primaryRgb[1], primaryRgb[2], alpha);
            p.strokeWeight(2);
            p.circle(burst.x, burst.y, radius * 2);
            // Inner glow ring
            p.stroke(primaryRgb[0], primaryRgb[1], primaryRgb[2], alpha * 0.4);
            p.strokeWeight(6);
            p.circle(burst.x, burst.y, radius * 2);
          }

          // --- Cursor indicator ---
          if (mouseInside) {
            const pulse = Math.sin(p.frameCount * 0.08) * 0.15 + 0.85;
            p.noFill();
            p.stroke(accentRgb[0], accentRgb[1], accentRgb[2], 120 * pulse);
            p.strokeWeight(1.5);
            p.circle(mx, my, REPEL_RADIUS * 0.8);
            p.stroke(accentRgb[0], accentRgb[1], accentRgb[2], 200);
            p.strokeWeight(2);
            p.circle(mx, my, 8);
            // Crosshair ticks
            p.line(mx - 14, my, mx - 6, my);
            p.line(mx + 6, my, mx + 14, my);
            p.line(mx, my - 14, mx, my - 6);
            p.line(mx, my + 6, mx, my + 14);
          }

          // --- Hint text (fades out after first interaction) ---
          if (hintAlpha > 0.01) {
            hintAlpha = Math.max(0, hintAlpha - 0.0008);
            p.noStroke();
            p.fill(primaryRgb[0], primaryRgb[1], primaryRgb[2], 180 * hintAlpha);
            p.textFont("Fira Mono");
            const fs = Math.max(10, Math.min(14, canvasW / 80));
            p.textSize(fs);
            p.textAlign(p.CENTER);
            p.text("MOVE TO DISTURB · CLICK TO BURST · SPACE = SHOCKWAVE · R = RESEED", canvasW / 2, canvasH - 24);
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
