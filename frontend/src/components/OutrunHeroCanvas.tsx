import { useEffect, useRef } from "react";

// ---------------------------------------------------------------------------
// Outrun Drive hero animation.
//
// A synthwave / retrowave perspective landscape: scrolling grid floor
// converging at the horizon, a sun with horizontal slits sitting on the
// horizon, distant mountain silhouettes, and differently-shaped 3D
// wireframe objects (pyramids, cubes, obelisks, diamonds) spawning at the
// horizon and scaling up as they rush toward the viewer. Pure canvas.
// ---------------------------------------------------------------------------

interface Shape {
  verts: [number, number, number][];
  edges: [number, number][];
}

// Local-space shapes (origin at base centre, Y up). Size ~1 unit.
const SHAPES: Record<string, Shape> = {
  pyramid: {
    verts: [
      [-1, 0, -1], [1, 0, -1], [1, 0, 1], [-1, 0, 1],
      [0, 1.7, 0],
    ],
    edges: [
      [0, 1], [1, 2], [2, 3], [3, 0],
      [0, 4], [1, 4], [2, 4], [3, 4],
    ],
  },
  cube: {
    verts: [
      [-1, 0, -1], [1, 0, -1], [1, 0, 1], [-1, 0, 1],
      [-1, 1, -1], [1, 1, -1], [1, 1, 1], [-1, 1, 1],
    ],
    edges: [
      [0, 1], [1, 2], [2, 3], [3, 0],
      [4, 5], [5, 6], [6, 7], [7, 4],
      [0, 4], [1, 5], [2, 6], [3, 7],
    ],
  },
  obelisk: {
    verts: [
      [-1, 0, -1], [1, 0, -1], [1, 0, 1], [-1, 0, 1],
      [-0.3, 2.2, -0.3], [0.3, 2.2, -0.3], [0.3, 2.2, 0.3], [-0.3, 2.2, 0.3],
    ],
    edges: [
      [0, 1], [1, 2], [2, 3], [3, 0],
      [4, 5], [5, 6], [6, 7], [7, 4],
      [0, 4], [1, 5], [2, 6], [3, 7],
    ],
  },
  diamond: {
    // Floating octahedron, centred at y=1.2
    verts: [
      [0, 2.4, 0],               // top
      [1, 1.2, 0], [0, 1.2, 1], [-1, 1.2, 0], [0, 1.2, -1], // equator
      [0, 0, 0],                 // bottom
    ],
    edges: [
      [0, 1], [0, 2], [0, 3], [0, 4],
      [5, 1], [5, 2], [5, 3], [5, 4],
      [1, 2], [2, 3], [3, 4], [4, 1],
    ],
  },
};
const SHAPE_KEYS = Object.keys(SHAPES);

interface WorldObject {
  shape: string;
  worldX: number;  // left/right of centre
  z: number;       // depth (decreases as it approaches)
  height: number;
  size: number;
  rot: number;     // yaw rotation
}

interface Colors {
  primary: string;
  accent: string;
  bg: string;
  secondary: string;
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function withAlpha(hex: string, alpha: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${alpha})`;
}

/** Linear mix of two hex colours, t in 0..1. */
function mixHex(a: string, b: string, t: number): string {
  const ca = hexToRgb(a);
  const cb = hexToRgb(b);
  const r = Math.round(ca[0] + (cb[0] - ca[0]) * t);
  const g = Math.round(ca[1] + (cb[1] - ca[1]) * t);
  const bl = Math.round(ca[2] + (cb[2] - ca[2]) * t);
  return `rgb(${r},${g},${bl})`;
}

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

export default function OutrunHeroCanvas() {
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
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(container);

    const themeObs = new MutationObserver(() => {
      colorsRef.current = readColors();
    });
    themeObs.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });

    // --- Scene state ---
    const FOCAL = 220;        // perspective focal length
    const VIEWER_H = 4.5;     // camera height above ground (world units)
    const GRID_HALF_W = 16;   // grid extends ±this far left/right
    const MAX_DEPTH = 45;     // far clip / spawn distance
    const SPEED = 0.22;       // world units per frame
    let distance = 0;         // accumulates for grid scroll
    let twinkle = 0;

    // Stars (upper sky)
    const stars: { x: number; y: number; s: number; ph: number }[] = [];
    function regenStars(w: number, horizonY: number) {
      stars.length = 0;
      for (let i = 0; i < 90; i++) {
        stars.push({
          x: Math.random() * w,
          y: Math.random() * horizonY * 0.92,
          s: Math.random() * 1.4 + 0.3,
          ph: Math.random() * Math.PI * 2,
        });
      }
    }

    // Objects pool — staggered initial depths
    const objects: WorldObject[] = [];
    function makeObject(z: number, sideBias: number): WorldObject {
      const shape = SHAPE_KEYS[Math.floor(Math.random() * SHAPE_KEYS.length)]!;
      const side = sideBias >= 0 ? 1 : -1;
      return {
        shape,
        worldX: side * (4 + Math.random() * 7),
        z,
        height: 1.4 + Math.random() * 1.6,
        size: 0.7 + Math.random() * 0.6,
        rot: Math.random() * Math.PI * 2,
      };
    }
    for (let i = 0; i < 9; i++) {
      objects.push(makeObject(6 + i * 4.5, i % 2 === 0 ? 1 : -1));
    }

    function project(wx: number, wy: number, wz: number, cx: number, horizonY: number) {
      const scale = FOCAL / wz;
      return {
        x: cx + wx * scale,
        y: horizonY - (wy - VIEWER_H) * scale,
        scale,
      };
    }

    // Rotate a local vertex around Y axis (yaw) by angle a.
    function rotY(v: [number, number, number], a: number): [number, number, number] {
      const c = Math.cos(a), s = Math.sin(a);
      return [v[0] * c + v[2] * s, v[1], -v[0] * s + v[2] * c];
    }

    const draw = () => {
      const colors = colorsRef.current;
      const rect = container.getBoundingClientRect();
      const w = rect.width;
      const h = rect.height;
      const cx = w / 2;
      const horizonY = h * 0.52;
      if (stars.length === 0 || stars[0]!.x > w) regenStars(w, horizonY);

      distance += SPEED;
      twinkle += 0.05;

      // --- Sky gradient: dark bg → subtle primary tint at horizon (theme) ---
      const skyGrad = ctx.createLinearGradient(0, 0, 0, horizonY);
      skyGrad.addColorStop(0, colors.bg);
      skyGrad.addColorStop(1, mixHex(colors.bg, colors.primary, 0.12));
      ctx.fillStyle = skyGrad;
      ctx.fillRect(0, 0, w, horizonY);

      // --- Stars (white dots, twinkling) ---
      for (const star of stars) {
        const tw = (Math.sin(twinkle + star.ph) + 1) / 2;
        ctx.globalAlpha = 0.4 + tw * 0.6;
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(star.x, star.y, star.s, star.s);
      }
      ctx.globalAlpha = 1;

      // --- Sun as glowing concentric vector rings with horizontal slits ---
      const sunR = Math.min(w, h) * 0.15;
      const sunCx = cx;
      const sunCy = horizonY - sunR * 0.35;
      // Soft halo behind the rings
      const halo = ctx.createRadialGradient(sunCx, sunCy, sunR * 0.4, sunCx, sunCy, sunR * 2.4);
      halo.addColorStop(0, withAlpha(colors.primary, 0.18));
      halo.addColorStop(1, withAlpha(colors.primary, 0));
      ctx.fillStyle = halo;
      ctx.fillRect(0, 0, w, horizonY);
      // Concentric glowing rings in primary colour
      ctx.strokeStyle = colors.primary;
      ctx.shadowColor = colors.primary;
      ctx.lineWidth = 1.5;
      const ringCount = 5;
      for (let r = 0; r < ringCount; r++) {
        const rr = sunR * (1 - r / ringCount * 0.85);
        ctx.shadowBlur = 8;
        ctx.globalAlpha = 0.5 + (r / ringCount) * 0.4;
        ctx.beginPath();
        ctx.arc(sunCx, sunCy, rr, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      ctx.shadowBlur = 0;
      // Horizontal vector slits across the sun (retrowave bars), bg-coloured
      ctx.fillStyle = colors.bg;
      for (let i = 0; i < 7; i++) {
        const t = i / 7;
        const barY = sunCy + sunR * (0.1 + t * 0.9);
        const barH = 1.5 + t * t * 6;
        const dy = barY - sunCy;
        if (Math.abs(dy) > sunR) continue;
        const halfW = Math.sqrt(sunR * sunR - dy * dy);
        ctx.fillRect(sunCx - halfW, barY, halfW * 2, barH);
      }

      // --- Distant mountains as a glowing vector polyline (no warm fill) ---
      ctx.strokeStyle = colors.secondary;
      ctx.shadowColor = colors.secondary;
      ctx.shadowBlur = 5;
      ctx.lineWidth = 1.4;
      ctx.globalAlpha = 0.7;
      ctx.beginPath();
      const mtnPeaks = 16;
      const ridge: { x: number; y: number }[] = [];
      for (let i = 0; i <= mtnPeaks; i++) {
        const mx = (i / mtnPeaks) * w;
        const variation = Math.sin(i * 1.7) * 0.5 + Math.cos(i * 2.3) * 0.5;
        const peakH = (0.03 + Math.abs(variation) * 0.05) * h;
        ridge.push({ x: mx, y: horizonY - peakH });
      }
      ctx.moveTo(ridge[0]!.x, ridge[0]!.y);
      for (const p of ridge) ctx.lineTo(p.x, p.y);
      ctx.stroke();
      // Faint secondary ridge line for depth
      ctx.globalAlpha = 0.3;
      ctx.beginPath();
      ctx.moveTo(0, horizonY);
      for (let i = 0; i <= mtnPeaks; i++) {
        const mx = (i / mtnPeaks) * w + 30;
        const variation = Math.sin(i * 2.1 + 1) * 0.5 + Math.cos(i * 1.6) * 0.5;
        const peakH = (0.02 + Math.abs(variation) * 0.035) * h;
        ctx.lineTo(mx, horizonY - peakH);
      }
      ctx.lineTo(w, horizonY);
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.shadowBlur = 0;

      // --- Floor: base fill in bg with faint primary tint ---
      const floorGrad = ctx.createLinearGradient(0, horizonY, 0, h);
      floorGrad.addColorStop(0, colors.bg);
      floorGrad.addColorStop(1, mixHex(colors.bg, colors.primary, 0.05));
      ctx.fillStyle = floorGrad;
      ctx.fillRect(0, horizonY, w, h - horizonY);

      // --- Floor grid: depth lines (perpendicular to travel, scrolling) ---
      ctx.strokeStyle = colors.primary;
      ctx.lineWidth = 1.2;
      ctx.shadowColor = colors.primary;
      ctx.shadowBlur = 6;
      const scrollFrac = distance % 1;
      const numDepthLines = 36;
      for (let i = 0; i < numDepthLines; i++) {
        const z = 1 + i - scrollFrac;
        if (z < 0.4) continue;
        const left = project(-GRID_HALF_W, 0, z, cx, horizonY);
        const right = project(GRID_HALF_W, 0, z, cx, horizonY);
        const alpha = Math.max(0, 1 - z / MAX_DEPTH);
        ctx.globalAlpha = alpha * 0.8;
        ctx.beginPath();
        ctx.moveTo(left.x, left.y);
        ctx.lineTo(right.x, right.y);
        ctx.stroke();
      }

      // --- Floor grid: side lines (parallel to travel, radiating from VP) ---
      const sideLines = 13;
      for (let i = 0; i <= sideLines; i++) {
        const t = i / sideLines;
        const worldX = -GRID_HALF_W + t * GRID_HALF_W * 2;
        const near = project(worldX, 0, 1, cx, horizonY);
        const far = project(worldX, 0, MAX_DEPTH, cx, horizonY);
        ctx.globalAlpha = 0.45;
        ctx.beginPath();
        ctx.moveTo(near.x, near.y);
        ctx.lineTo(far.x, far.y);
        ctx.stroke();
      }
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 1;

      // --- 3D objects: update + sort far→near + draw ---
      for (const obj of objects) {
        obj.z -= SPEED;
        obj.rot += 0.004;
        if (obj.z < 0.6) {
          const recycled = makeObject(MAX_DEPTH + Math.random() * 4, Math.random() < 0.5 ? 1 : -1);
          Object.assign(obj, recycled);
        }
      }
      const sorted = objects.slice().sort((a, b) => b.z - a.z);

      for (const obj of sorted) {
        const shape = SHAPES[obj.shape]!;
        const proj = shape.verts.map((v) => {
          const rotated = rotY(v, obj.rot);
          const wx = obj.worldX + rotated[0] * obj.size;
          const wy = rotated[1] * obj.height;
          const wz = obj.z + rotated[2] * obj.size;
          if (wz < 0.4) return null;
          return project(wx, wy, wz, cx, horizonY);
        });

        const depthFade = Math.max(0.15, Math.min(1, 1 - obj.z / MAX_DEPTH));
        ctx.strokeStyle = colors.accent;
        ctx.shadowColor = colors.accent;
        ctx.shadowBlur = 8 * depthFade;
        ctx.lineWidth = 1.5 * depthFade + 0.5;
        ctx.globalAlpha = depthFade;

        for (const [a, b] of shape.edges) {
          const pa = proj[a], pb = proj[b];
          if (!pa || !pb) continue;
          ctx.beginPath();
          ctx.moveTo(pa.x, pa.y);
          ctx.lineTo(pb.x, pb.y);
          ctx.stroke();
        }
      }
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 1;

      // --- Horizon glow line (theme primary) ---
      const horGlow = ctx.createLinearGradient(0, horizonY - 2, 0, horizonY + 2);
      horGlow.addColorStop(0, withAlpha(colors.primary, 0));
      horGlow.addColorStop(0.5, withAlpha(colors.primary, 0.6));
      horGlow.addColorStop(1, withAlpha(colors.primary, 0));
      ctx.fillStyle = horGlow;
      ctx.fillRect(0, horizonY - 2, w, 4);

      // --- CRT scanlines + vignette overlay ---
      ctx.fillStyle = "rgba(0,0,0,0.10)";
      for (let y = 0; y < h; y += 3) ctx.fillRect(0, y, w, 1);
      const vig = ctx.createRadialGradient(cx, h / 2, Math.min(w, h) * 0.3, cx, h / 2, Math.max(w, h) * 0.75);
      vig.addColorStop(0, "rgba(0,0,0,0)");
      vig.addColorStop(1, "rgba(0,0,0,0.55)");
      ctx.fillStyle = vig;
      ctx.fillRect(0, 0, w, h);

      // --- Label ---
      const labelFont = Math.min(18, w * 0.026);
      ctx.font = `700 ${labelFont}px 'Fira Mono', monospace`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = colors.primary;
      ctx.shadowColor = colors.primary;
      ctx.shadowBlur = 6;
      ctx.fillText("C M E . e x e", w / 2, h * 0.93);
      ctx.shadowBlur = 0;
      ctx.font = `${labelFont * 0.5}px 'Fira Mono', monospace`;
      ctx.fillStyle = colors.secondary;
      ctx.globalAlpha = 0.7;
      ctx.fillText("OUTRUN DRIVE · INFINITE HYPERSPACE", w / 2, h * 0.96);
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
