import { useEffect, useRef } from "react";

// ---------------------------------------------------------------------------
// Hyperspace / Star-Gate Tunnel hero animation.
//
// Fly through an infinite tunnel of rotating geometric rings (triangles,
// squares, hexagons, octagons) that spawn at the vanishing point and warp
// toward the viewer. Radial speed streaks emanate from the centre. Classic
// demoscene star-gate. Pure canvas, motion-blur trails.
// ---------------------------------------------------------------------------

const FOCAL = 280;
const SPAWN_Z = 30;
const RING_COUNT = 22;
const BASE_RADIUS = 6; // world units

interface Ring {
  z: number;
  sides: number;     // 3 = triangle, 4 = square, 6 = hex, 8 = octagon
  rot: number;
  rotSpeed: number;
  hueShift: number;  // 0..1 colour blend factor
}

interface Streak {
  angle: number;
  radius: number;
  speed: number;
  len: number;
}

interface Colors { primary: string; accent: string; bg: string; secondary: string; }

function readColors(): Colors {
  const cs = getComputedStyle(document.documentElement);
  const read = (n: string, f: string) => cs.getPropertyValue(n).trim() || f;
  return {
    primary: read("--color-text-primary", "#39ff14"),
    accent: read("--color-accent", "#4ECDC4"),
    bg: read("--color-bg", "#0a0e0a"),
    secondary: read("--color-text-secondary", "#4a6a4a"),
  };
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const SIDE_OPTIONS = [3, 4, 6, 8];

export default function HyperspaceHeroCanvas() {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number | null>(null);
  const colorsRef = useRef<Colors>(readColors());

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    colorsRef.current = readColors();

    const resize = () => {
      const rect = container.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.max(1, Math.round(rect.width));
      const h = Math.max(1, Math.round(rect.height));
      canvas.width = w * dpr; canvas.height = h * dpr;
      canvas.style.width = `${w}px`; canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(container);
    const themeObs = new MutationObserver(() => { colorsRef.current = readColors(); });
    themeObs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

    // Init rings staggered along z
    const rings: Ring[] = [];
    for (let i = 0; i < RING_COUNT; i++) {
      rings.push({
        z: (SPAWN_Z / RING_COUNT) * i,
        sides: SIDE_OPTIONS[Math.floor(Math.random() * SIDE_OPTIONS.length)]!,
        rot: Math.random() * Math.PI * 2,
        rotSpeed: (Math.random() - 0.5) * 0.03,
        hueShift: Math.random(),
      });
    }

    // Speed streaks radiating from centre
    const streaks: Streak[] = [];
    for (let i = 0; i < 50; i++) {
      streaks.push({
        angle: Math.random() * Math.PI * 2,
        radius: Math.random() * 400,
        speed: 6 + Math.random() * 10,
        len: 10 + Math.random() * 30,
      });
    }

    const SPEED = 0.35;

    const draw = () => {
      const colors = colorsRef.current;
      const rect = container.getBoundingClientRect();
      const w = rect.width;
      const h = rect.height;
      const cx = w / 2;
      const cy = h / 2;
      const bgRgb = hexToRgb(colors.bg);

      // Motion blur: fade instead of clear
      ctx.fillStyle = `rgba(${bgRgb[0]},${bgRgb[1]},${bgRgb[2]},0.18)`;
      ctx.fillRect(0, 0, w, h);

      // Central glow
      const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.min(w, h) * 0.3);
      glow.addColorStop(0, "rgba(255,255,255,0.05)");
      glow.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, w, h);

      const primaryRgb = hexToRgb(colors.primary);
      const accentRgb = hexToRgb(colors.accent);

      // --- Speed streaks ---
      for (const s of streaks) {
        s.radius += s.speed;
        const x1 = cx + Math.cos(s.angle) * s.radius;
        const y1 = cy + Math.sin(s.angle) * s.radius;
        const x2 = cx + Math.cos(s.angle) * (s.radius + s.len);
        const y2 = cy + Math.sin(s.angle) * (s.radius + s.len);
        const fade = Math.min(1, s.radius / 200);
        ctx.strokeStyle = `rgba(${primaryRgb[0]},${primaryRgb[1]},${primaryRgb[2]},${0.6 * fade})`;
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
        if (s.radius > Math.max(w, h)) {
          s.radius = 0;
          s.angle = Math.random() * Math.PI * 2;
          s.speed = 6 + Math.random() * 10;
        }
      }

      // --- Rings (sorted far → near) ---
      const sorted = rings.slice().sort((a, b) => b.z - a.z);
      for (const ring of sorted) {
        ring.z -= SPEED;
        ring.rot += ring.rotSpeed;
        if (ring.z < 0.3) {
          ring.z = SPAWN_Z;
          ring.sides = SIDE_OPTIONS[Math.floor(Math.random() * SIDE_OPTIONS.length)]!;
          ring.rotSpeed = (Math.random() - 0.5) * 0.03;
          ring.hueShift = Math.random();
        }

        const scale = FOCAL / ring.z;
        const screenR = BASE_RADIUS * scale;
        if (screenR > Math.max(w, h) * 1.5) continue;

        // Colour: blend primary → accent by hueShift, fade by depth
        const r = primaryRgb[0] * (1 - ring.hueShift) + accentRgb[0] * ring.hueShift;
        const g = primaryRgb[1] * (1 - ring.hueShift) + accentRgb[1] * ring.hueShift;
        const b = primaryRgb[2] * (1 - ring.hueShift) + accentRgb[2] * ring.hueShift;
        const depthFade = Math.max(0.15, Math.min(1, 1 - ring.z / SPAWN_Z));

        ctx.strokeStyle = `rgba(${r | 0},${g | 0},${b | 0},${0.85 * depthFade})`;
        ctx.shadowColor = `rgb(${r | 0},${g | 0},${b | 0})`;
        ctx.shadowBlur = 10 * depthFade;
        ctx.lineWidth = Math.max(0.8, 2.5 * depthFade);

        // Draw polygon
        ctx.beginPath();
        for (let i = 0; i <= ring.sides; i++) {
          const a = ring.rot + (i / ring.sides) * Math.PI * 2;
          const px = cx + Math.cos(a) * screenR;
          const py = cy + Math.sin(a) * screenR;
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.stroke();

        // Vertex dots
        ctx.shadowBlur = 0;
        ctx.fillStyle = `rgba(${r | 0},${g | 0},${b | 0},${depthFade})`;
        for (let i = 0; i < ring.sides; i++) {
          const a = ring.rot + (i / ring.sides) * Math.PI * 2;
          ctx.beginPath();
          ctx.arc(cx + Math.cos(a) * screenR, cy + Math.sin(a) * screenR, 2 * depthFade + 0.5, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.shadowBlur = 0;

      // --- Label ---
      ctx.font = `700 ${Math.min(18, w * 0.026)}px 'Fira Mono', monospace`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = colors.primary;
      ctx.shadowColor = colors.primary;
      ctx.shadowBlur = 8;
      ctx.fillText("C M E . e x e", cx, h * 0.92);
      ctx.shadowBlur = 0;
      ctx.font = `${Math.min(9, w * 0.012)}px 'Fira Mono', monospace`;
      ctx.fillStyle = colors.secondary;
      ctx.globalAlpha = 0.7;
      ctx.fillText("HYPERSPACE · WARP DRIVE ENGAGED", cx, h * 0.95);
      ctx.globalAlpha = 1;
      ctx.textAlign = "left";

      rafRef.current = requestAnimationFrame(draw);
    };
    rafRef.current = requestAnimationFrame(draw);

    return () => {
      ro.disconnect();
      themeObs.disconnect();
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  return (
    <div ref={containerRef} className="boot-hero-canvas-wrap">
      <canvas ref={canvasRef} className="boot-hero-canvas" />
    </div>
  );
}
