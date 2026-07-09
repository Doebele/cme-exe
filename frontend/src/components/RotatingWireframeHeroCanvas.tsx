import { useEffect, useRef } from "react";

// ---------------------------------------------------------------------------
// Rotating 3D Wireframe hero animation.
//
// A torus (donut) rendered as ASCII characters — the classic demoscene
// effect popularised by Andy Sloane's "donut math". Points on the torus
// surface are rotated in 3D, projected to 2D, and mapped to ASCII chars
// by surface brightness (Lambertian shading). Pure canvas, no p5/three.
// ---------------------------------------------------------------------------

// Brightness ramp: dark → bright. Classic ".,-~:;=!*#$@" from the original.
const RAMP = ".,-~:;=!*#$@";

interface Vec3 { x: number; y: number; z: number; }
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
    let aB = 0.0; // rotation around Z axis

    const draw = () => {
      const colors = colorsRef.current;
      const rect = container.getBoundingClientRect();
      const w = rect.width;
      const h = rect.height;

      ctx.fillStyle = colors.bg;
      ctx.fillRect(0, 0, w, h);

      // --- The donut ---
      // Torus parameters
      const R1 = 1.0;   // minor radius
      const R2 = 2.0;   // major radius
      const K2 = 5.0;   // distance from viewer to donut
      // K1 scales the projection; chosen so donut fits the screen.
      const screenMin = Math.min(w, h);
      const K1 = screenMin * K2 * 3 / (8 * (R1 + R2));

      const cx = w / 2;
      const cy = h * 0.45;

      // Output buffer: brightness + character per cell.
      const cellW = Math.max(6, Math.floor(screenMin / 90));
      const cellH = Math.round(cellW * 1.7);
      const cols = Math.ceil(w / cellW);
      const rows = Math.ceil(h / cellH);
      const output: Float32Array = new Float32Array(cols * rows);

      // Theta around the tube, Phi around the ring.
      const thetaStep = 0.07;
      const phiStep = 0.02;

      const cosA = Math.cos(aA);
      const sinA = Math.sin(aA);
      const cosB = Math.cos(aB);
      const sinB = Math.sin(aB);

      const light: Vec3 = { x: 0, y: 1, z: -1 };
      const lightLen = Math.sqrt(light.x * light.x + light.y * light.y + light.z * light.z);
      light.x /= lightLen; light.y /= lightLen; light.z /= lightLen;

      for (let theta = 0; theta < 2 * Math.PI; theta += thetaStep) {
        const cosTheta = Math.cos(theta);
        const sinTheta = Math.sin(theta);

        for (let phi = 0; phi < 2 * Math.PI; phi += phiStep) {
          const cosPhi = Math.cos(phi);
          const sinPhi = Math.sin(phi);

          // Circle in the X-Y plane, centred at (R2, 0, 0), radius R1
          const circleX = R2 + R1 * cosTheta;
          const circleY = R1 * sinTheta;

          // Rotate around Y axis by phi (the ring)
          const x = circleX * (cosB * cosPhi + sinA * sinB * sinPhi) - circleY * cosA * sinB;
          const y = circleX * (sinB * cosPhi - sinA * cosB * sinPhi) + circleY * cosA * cosB;
          const z = K2 + cosA * circleX * sinPhi + circleY * sinA;

          const ooz = 1 / z; // one-over-z

          // Project to screen
          const xp = Math.round(cx + K1 * ooz * x);
          const yp = Math.round(cy - K1 * ooz * y);

          // Surface normal (Lambertian)
          const nx = cosTheta * (cosB * cosPhi + sinA * sinB * sinPhi) - sinTheta * cosA * sinB;
          const ny = cosTheta * (sinB * cosPhi - sinA * cosB * sinPhi) + sinTheta * cosA * cosB;
          const nz = cosA * cosTheta * sinPhi + sinTheta * sinA;

          // L = N · light
          let L = nx * light.x + ny * light.y + nz * light.z;

          const col = Math.floor(xp / cellW);
          const row = Math.floor(yp / cellH);
          if (col < 0 || col >= cols || row < 0 || row >= rows) continue;

          const idx = row * cols + col;
          if (ooz > output[idx]!) {
            output[idx] = ooz;
            // Clamp and map L to ramp
            L = Math.max(0, Math.min(1, L * 1.5 + 0.2));
            const rampIdx = Math.floor(L * (RAMP.length - 1));
            const ch = RAMP[rampIdx]!;

            // Draw the character
            ctx.font = `${cellH * 0.9}px 'Fira Mono', 'Courier New', monospace`;
            ctx.textBaseline = "top";
            const bright = L;
            if (bright > 0.7) {
              ctx.fillStyle = colors.primary;
              ctx.shadowColor = colors.primary;
              ctx.shadowBlur = bright * 4;
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
      }
      ctx.shadowBlur = 0;

      // --- "CME.exe" label below the donut ---
      const labelY = h * 0.82;
      const labelFont = Math.min(20, w * 0.03);
      ctx.font = `700 ${labelFont}px 'Fira Mono', monospace`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = colors.primary;
      ctx.shadowColor = colors.primary;
      ctx.shadowBlur = 6;
      ctx.fillText("C M E . e x e", w / 2, labelY);
      ctx.shadowBlur = 0;

      // Tagline
      const tagFont = Math.min(9, w * 0.012);
      ctx.font = `${tagFont}px 'Fira Mono', monospace`;
      ctx.fillStyle = colors.secondary;
      ctx.globalAlpha = 0.7;
      ctx.fillText("ROTATING IN HYPERSPACE", w / 2, labelY + labelFont);
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

      // Increment rotation — slow drift
      aA += 0.008;
      aB += 0.003;

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
