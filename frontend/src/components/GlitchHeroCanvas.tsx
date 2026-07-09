import { useEffect, useRef } from "react";

// ---------------------------------------------------------------------------
// Glitch Storm hero animation.
//
// The screen looks like a damaged VHS / corrupted data stream. "CME.exe"
// renders with constant RGB channel split, periodically erupting into violent
// glitch bursts: horizontal sync tears, datamosh pixel blocks, scrambled
// phrase fragments, static noise, scanlines. Pure canvas.
// ---------------------------------------------------------------------------

const PHRASES = [
  "CME.exe", "SIGNAL LOST", "RECOMPILING", "01000011", "NO CARRIER",
  "THE MACHINE", "SYS ERROR", "01001101", "DATAMOSH", "OFFLINE",
  "AI × DESIGN", "STACK OVERFLOW", "V.90 CONNECT", "NULL POINTER",
];

const GLITCH_CHARS = "!@#$%&*<>?/\\|=+-~01▓▒░█▌▐";

interface Colors { primary: string; accent: string; bg: string; secondary: string; }

function readColors(): Colors {
  const cs = getComputedStyle(document.documentElement);
  const read = (n: string, f: string) => cs.getPropertyValue(n).trim() || f;
  return {
    primary: read("--color-text-primary", "#39ff14"),
    accent: read("--color-accent", "#ff2e88"),
    bg: read("--color-bg", "#0a0e0a"),
    secondary: read("--color-text-secondary", "#4a6a4a"),
  };
}

export default function GlitchHeroCanvas() {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number | null>(null);
  const offRef = useRef<HTMLCanvasElement | null>(null);
  const colorsRef = useRef<Colors>(readColors());

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    offRef.current = document.createElement("canvas");
    const off = offRef.current;
    const octx = off.getContext("2d")!;

    colorsRef.current = readColors();

    const resize = () => {
      const rect = container.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.max(1, Math.round(rect.width));
      const h = Math.max(1, Math.round(rect.height));
      canvas.width = w * dpr; canvas.height = h * dpr;
      canvas.style.width = `${w}px`; canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      off.width = w; off.height = h;
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(container);
    const themeObs = new MutationObserver(() => { colorsRef.current = readColors(); });
    themeObs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

    // Glitch burst scheduler
    let nextBurst = 1500 + Math.random() * 2500;
    let burstEnd = 0;
    let phraseIdx = 0;
    let phraseFlipAt = 0;

    const draw = (now: number) => {
      const colors = colorsRef.current;
      const rect = container.getBoundingClientRect();
      const w = rect.width;
      const h = rect.height;
      const cx = w / 2;
      const cy = h / 2;

      // Schedule glitch bursts
      if (now > nextBurst) {
        burstEnd = now + 120 + Math.random() * 280;
        nextBurst = now + 1500 + Math.random() * 3000;
      }
      const bursting = now < burstEnd;
      const burstStrength = bursting ? (burstEnd - now) / 400 : 0;

      // Base background
      ctx.fillStyle = colors.bg;
      ctx.fillRect(0, 0, w, h);

      // Static noise (always some, more during burst)
      const noiseCount = bursting ? 600 : 120;
      ctx.fillStyle = colors.primary;
      ctx.globalAlpha = bursting ? 0.12 : 0.04;
      for (let i = 0; i < noiseCount; i++) {
        ctx.fillRect(Math.random() * w, Math.random() * h, 1.5, 1.5);
      }
      ctx.globalAlpha = 1;

      // Rotate phrase periodically
      if (now > phraseFlipAt) {
        phraseIdx = (phraseIdx + 1) % PHRASES.length;
        phraseFlipAt = now + (bursting ? 80 : 2200);
      }
      const phrase = PHRASES[phraseIdx]!;

      // Render text to offscreen (white)
      octx.clearRect(0, 0, w, h);
      const fontSize = Math.min(w / (phrase.length * 0.58), h * 0.42);
      octx.font = `900 ${fontSize}px 'Fira Mono', 'Courier New', monospace`;
      octx.textAlign = "center";
      octx.textBaseline = "middle";
      octx.fillStyle = "#ffffff";
      octx.fillText(phrase, cx, cy);

      // RGB split: draw offscreen 3x with channel tints + offsets
      const baseOff = bursting ? 4 + burstStrength * 14 : 2.5;
      ctx.globalCompositeOperation = "lighter";
      // Red channel — shift left
      ctx.save();
      ctx.translate(-baseOff, bursting ? -1 : 0);
      ctx.globalAlpha = 1;
      ctx.drawImage(tintCanvas(off, "#ff0040", w, h), 0, 0);
      ctx.restore();
      // Green channel — center
      ctx.save();
      ctx.drawImage(tintCanvas(off, "#39ff14", w, h), 0, 0);
      ctx.restore();
      // Blue channel — shift right
      ctx.save();
      ctx.translate(baseOff, bursting ? 1 : 0);
      ctx.drawImage(tintCanvas(off, "#0080ff", w, h), 0, 0);
      ctx.restore();
      ctx.globalCompositeOperation = "source-over";

      // Horizontal sync tears (VHS tracking distortion)
      const tearCount = bursting ? 6 : 1;
      for (let i = 0; i < tearCount; i++) {
        const ty = Math.random() * h;
        const tHeight = 4 + Math.random() * 30;
        const offset = (Math.random() - 0.5) * (bursting ? 80 : 15);
        ctx.drawImage(canvas, 0, ty, w, tHeight, offset, ty, w, tHeight);
      }

      // Datamosh blocks — copy small rects and paste offset
      if (bursting || Math.random() < 0.1) {
        const blockCount = bursting ? 12 : 3;
        for (let i = 0; i < blockCount; i++) {
          const bx = Math.random() * w;
          const by = Math.random() * h;
          const bw = 20 + Math.random() * 80;
          const bh = 8 + Math.random() * 30;
          const dx = bx + (Math.random() - 0.5) * 100;
          const dy = by + (Math.random() - 0.5) * 40;
          ctx.drawImage(canvas, bx, by, bw, bh, dx, dy, bw, bh);
        }
      }

      // Scanlines
      ctx.fillStyle = "rgba(0,0,0,0.18)";
      for (let y = 0; y < h; y += 3) ctx.fillRect(0, y, w, 1);

      // Scrambled glitch chars along the tear lines during bursts
      if (bursting) {
        ctx.font = `${fontSize * 0.18}px 'Fira Mono', monospace`;
        ctx.textAlign = "left";
        ctx.textBaseline = "top";
        ctx.fillStyle = colors.accent;
        for (let i = 0; i < 40; i++) {
          const gx = Math.random() * w;
          const gy = Math.random() * h;
          ctx.fillText(GLITCH_CHARS[Math.floor(Math.random() * GLITCH_CHARS.length)]!, gx, gy);
        }
      }

      // Corner REC indicator + timecode
      ctx.font = `${Math.max(9, w * 0.012)}px 'Fira Mono', monospace`;
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      ctx.fillStyle = bursting ? colors.accent : "rgba(255,46,136,0.6)";
      const recBlink = Math.floor(now / 500) % 2 === 0 ? "● REC" : "○ REC";
      ctx.fillText(recBlink, 14, 14);
      ctx.fillStyle = colors.secondary;
      ctx.globalAlpha = 0.6;
      ctx.fillText(`TC ${String(Math.floor(now / 1000)).padStart(6, "0")}`, 14, 28);
      ctx.globalAlpha = 1;

      // Label
      ctx.textAlign = "center";
      ctx.font = `700 ${Math.min(14, w * 0.02)}px 'Fira Mono', monospace`;
      ctx.fillStyle = colors.primary;
      ctx.fillText("C M E . e x e", cx, h - 28);
      ctx.textAlign = "left";

      // Vignette
      const vig = ctx.createRadialGradient(cx, cy, Math.min(w, h) * 0.25, cx, cy, Math.max(w, h) * 0.7);
      vig.addColorStop(0, "rgba(0,0,0,0)");
      vig.addColorStop(1, "rgba(0,0,0,0.6)");
      ctx.fillStyle = vig;
      ctx.fillRect(0, 0, w, h);

      rafRef.current = requestAnimationFrame(draw);
    };

    // Tint cache to avoid re-tinting every frame unnecessarily.
    const tintCache: Record<string, HTMLCanvasElement> = {};
    function tintCanvas(src: HTMLCanvasElement, color: string, w: number, h: number): HTMLCanvasElement {
      let tint = tintCache[color];
      if (!tint) {
        tint = document.createElement("canvas");
        tintCache[color] = tint;
      }
      if (tint.width !== w || tint.height !== h) {
        tint.width = w; tint.height = h;
      }
      const tctx = tint.getContext("2d")!;
      tctx.clearRect(0, 0, w, h);
      tctx.globalCompositeOperation = "source-over";
      tctx.drawImage(src, 0, 0);
      tctx.globalCompositeOperation = "multiply";
      tctx.fillStyle = color;
      tctx.fillRect(0, 0, w, h);
      tctx.globalCompositeOperation = "source-over";
      return tint;
    }

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
