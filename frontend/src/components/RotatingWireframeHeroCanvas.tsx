import { useEffect, useRef } from "react";

// ---------------------------------------------------------------------------
// Rotating 3D Wireframe hero animation — the letter "C".
//
// A 3D extruded "C" rendered as ASCII characters. The C is modelled as a
// thick arc (270° opening on the right) with front and back faces, outer
// and inner curved walls, and two cap faces at the opening. Points on all
// surfaces are rotated in 3D, projected to 2D with perspective, and mapped
// to ASCII chars by Lambertian brightness. Pure canvas, no p5/three.
// ---------------------------------------------------------------------------

const RAMP = ".,-~:;=!*#$@";

interface Vec3 { x: number; y: number; z: number; }
interface CPoint { pos: Vec3; normal: Vec3; }
interface Colors {
  primary: string;
  accent: string;
  bg: string;
  secondary: string;
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

// --- C geometry constants -------------------------------------------------
const R_OUT = 2.2;       // outer radius
const R_IN = 1.45;       // inner radius (thickness of the stroke)
const DEPTH = 0.85;      // Z extrusion depth
const HALF_D = DEPTH / 2;
// Arc spans 270° with the opening on the right side.
// In standard math angles (0=right, π/2=up): from 45° to 315° counterclockwise.
const ARC_START = Math.PI * 0.25;   // 45°  — upper-right end of the C
const ARC_END = Math.PI * 1.75;     // 315° — lower-right end of the C
const ARC_STEPS = 56;
const RADIAL_STEPS = 4;
const DEPTH_STEPS = 5;

/** Precompute the static point cloud of the 3D "C" (model space, unrotated). */
function buildCPointCloud(): CPoint[] {
  const points: CPoint[] = [];
  const push = (x: number, y: number, z: number, nx: number, ny: number, nz: number) => {
    points.push({ pos: { x, y, z }, normal: { x: nx, y: ny, z: nz } });
  };

  for (let i = 0; i <= ARC_STEPS; i++) {
    const t = i / ARC_STEPS;
    const angle = ARC_START + (ARC_END - ARC_START) * t;
    const ca = Math.cos(angle);
    const sa = Math.sin(angle);

    // --- Front + back flat faces (the two C-rings) ---
    for (let s = 0; s <= 1; s++) {
      const z = s === 0 ? HALF_D : -HALF_D;
      const nz = s === 0 ? 1 : -1;
      for (let r = 0; r <= RADIAL_STEPS; r++) {
        const radius = R_IN + (R_OUT - R_IN) * (r / RADIAL_STEPS);
        push(radius * ca, radius * sa, z, 0, 0, nz);
      }
    }

    // --- Outer curved wall (normal points radially outward) ---
    for (let dz = 0; dz <= DEPTH_STEPS; dz++) {
      const z = -HALF_D + DEPTH * (dz / DEPTH_STEPS);
      push(R_OUT * ca, R_OUT * sa, z, ca, sa, 0);
    }

    // --- Inner curved wall (normal points radially inward) ---
    for (let dz = 0; dz <= DEPTH_STEPS; dz++) {
      const z = -HALF_D + DEPTH * (dz / DEPTH_STEPS);
      push(R_IN * ca, R_IN * sa, z, -ca, -sa, 0);
    }
  }

  // --- Cap faces at the two opening ends (at ARC_START and ARC_END) ---
  // These close the band so the C looks solid at the opening.
  for (const angle of [ARC_START, ARC_END]) {
    const ca = Math.cos(angle);
    const sa = Math.sin(angle);
    // Tangent to the arc at this angle; sign flips for the two caps.
    const tx = -sa;
    const ty = ca;
    const sign = angle === ARC_START ? 1 : -1;
    for (let r = 0; r <= RADIAL_STEPS; r++) {
      const radius = R_IN + (R_OUT - R_IN) * (r / RADIAL_STEPS);
      for (let dz = 0; dz <= DEPTH_STEPS; dz++) {
        const z = -HALF_D + DEPTH * (dz / DEPTH_STEPS);
        push(radius * ca, radius * sa, z, tx * sign, ty * sign, 0);
      }
    }
  }

  return points;
}

const C_POINTS = buildCPointCloud();

/** Rotate a vector around the X axis. */
function rotX(p: Vec3, c: number, s: number): Vec3 {
  return { x: p.x, y: p.y * c - p.z * s, z: p.y * s + p.z * c };
}
/** Rotate a vector around the Y axis. */
function rotY(p: Vec3, c: number, s: number): Vec3 {
  return { x: p.x * c + p.z * s, y: p.y, z: -p.x * s + p.z * c };
}

export default function RotatingWireframeHeroCanvas() {
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

    let aA = 1.0; // rotation around X axis
    let aB = 0.0; // rotation around Y axis

    // Light direction (normalised)
    const light: Vec3 = { x: 0.3, y: 0.8, z: -0.5 };
    const lLen = Math.hypot(light.x, light.y, light.z);
    light.x /= lLen; light.y /= lLen; light.z /= lLen;

    const draw = () => {
      const colors = colorsRef.current;
      const rect = container.getBoundingClientRect();
      const w = rect.width;
      const h = rect.height;

      ctx.fillStyle = colors.bg;
      ctx.fillRect(0, 0, w, h);

      // Perspective projection constants
      const K2 = 7; // viewer distance
      const screenMin = Math.min(w, h);
      const K1 = screenMin * K2 * 3 / (8 * (R_OUT + 0.5));
      const cx = w / 2;
      const cy = h * 0.45;

      // Output buffers: depth (1/z) and brightness per cell
      const cellW = Math.max(6, Math.floor(screenMin / 90));
      const cellH = Math.round(cellW * 1.7);
      const cols = Math.ceil(w / cellW);
      const rows = Math.ceil(h / cellH);
      const depthBuf = new Float32Array(cols * rows);
      const charBuf = new Int8Array(cols * rows).fill(-1);

      const cosA = Math.cos(aA);
      const sinA = Math.sin(aA);
      const cosB = Math.cos(aB);
      const sinB = Math.sin(aB);

      // Rotate + project every point in the C cloud
      for (let i = 0; i < C_POINTS.length; i++) {
        const pt = C_POINTS[i]!;
        // Rotate position
        let p = rotX(pt.pos, cosA, sinA);
        p = rotY(p, cosB, sinB);
        // Rotate normal
        let n = rotX(pt.normal, cosA, sinA);
        n = rotY(n, cosB, sinB);

        const z = K2 + p.z;
        if (z <= 0.1) continue;
        const ooz = 1 / z;

        const xp = cx + K1 * ooz * p.x;
        // Flip Y for screen coords
        const yp = cy - K1 * ooz * p.y;

        const col = Math.floor(xp / cellW);
        const row = Math.floor(yp / cellH);
        if (col < 0 || col >= cols || row < 0 || row >= rows) continue;

        const idx = row * cols + col;
        if (ooz > depthBuf[idx]!) {
          depthBuf[idx] = ooz;
          // Lambertian brightness
          let L = n.x * light.x + n.y * light.y + n.z * light.z;
          L = Math.max(0, Math.min(1, L * 1.4 + 0.25));
          charBuf[idx] = Math.floor(L * (RAMP.length - 1));
        }
      }

      // Render the character buffer
      ctx.font = `${cellH * 0.9}px 'Fira Mono', 'Courier New', monospace`;
      ctx.textBaseline = "top";
      ctx.textAlign = "left";
      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
          const ci = charBuf[row * cols + col]!;
          if (ci < 0) continue;
          const ch = RAMP[ci]!;
          const bright = ci / (RAMP.length - 1);
          if (bright > 0.7) {
            ctx.fillStyle = colors.primary;
            ctx.shadowColor = colors.primary;
            ctx.shadowBlur = bright * 5;
          } else if (bright > 0.35) {
            ctx.fillStyle = colors.accent;
            ctx.shadowBlur = 0;
          } else {
            ctx.fillStyle = colors.secondary;
            ctx.shadowBlur = 0;
          }
          ctx.fillText(ch, col * cellW, row * cellH);
        }
      }
      ctx.shadowBlur = 0;

      // --- "CME.exe" label below the C ---
      const labelY = h * 0.84;
      const labelFont = Math.min(20, w * 0.03);
      ctx.font = `700 ${labelFont}px 'Fira Mono', monospace`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = colors.primary;
      ctx.shadowColor = colors.primary;
      ctx.shadowBlur = 6;
      ctx.fillText("C M E . e x e", w / 2, labelY);
      ctx.shadowBlur = 0;

      const tagFont = Math.min(9, w * 0.012);
      ctx.font = `${tagFont}px 'Fira Mono', monospace`;
      ctx.fillStyle = colors.secondary;
      ctx.globalAlpha = 0.7;
      ctx.fillText("THE LETTER · ROTATING IN HYPERSPACE", w / 2, labelY + labelFont);
      ctx.globalAlpha = 1;
      ctx.textAlign = "left";

      // Corner markers
      const cm = 12;
      const cl = 30;
      ctx.strokeStyle = colors.accent;
      ctx.globalAlpha = 0.12;
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(cm, cm + cl); ctx.lineTo(cm, cm); ctx.lineTo(cm + cl, cm); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(w - cm - cl, cm); ctx.lineTo(w - cm, cm); ctx.lineTo(w - cm, cm + cl); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cm, h - cm - cl); ctx.lineTo(cm, h - cm); ctx.lineTo(cm + cl, h - cm); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(w - cm - cl, h - cm); ctx.lineTo(w - cm, h - cm); ctx.lineTo(w - cm, h - cm - cl); ctx.stroke();
      ctx.globalAlpha = 1;

      aA += 0.008;
      aB += 0.004;

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
