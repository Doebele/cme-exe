import { useEffect, useRef } from "react";

// ---------------------------------------------------------------------------
// Game of Life × ASCII hero animation.
//
// Conway's Game of Life rendered as ASCII characters. Living cells are
// random ASCII glyphs that flicker. The grid is seeded with the letter "C"
// and periodically injected with new life to prevent total die-out. Patterns
// oscillate, glide, and evolve — never the same twice. Pure canvas.
// ---------------------------------------------------------------------------

const CHARSET = "01ABCDEF#$%&*<>/\\|=+-~▓▒░";

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

// 5×7 "C" bitmap for seeding
const C_BITMAP = [
  "01110",
  "10001",
  "10000",
  "10000",
  "10000",
  "10001",
  "01110",
];

export default function GameOfLifeHeroCanvas() {
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

    let cols = 0, rows = 0;
    let cellW = 12, cellH = 16;
    let cur: Uint8Array = new Uint8Array(0);
    let next: Uint8Array = new Uint8Array(0);
    let chars: string[] = [];
    let lastStep = 0;
    const STEP_MS = 110;

    const resize = () => {
      const rect = container.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.max(1, Math.round(rect.width));
      const h = Math.max(1, Math.round(rect.height));
      canvas.width = w * dpr; canvas.height = h * dpr;
      canvas.style.width = `${w}px`; canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      cellW = Math.max(9, Math.floor(w / 100));
      cellH = Math.round(cellW * 1.35);
      cols = Math.floor(w / cellW);
      rows = Math.floor(h / cellH);
      cur = new Uint8Array(cols * rows);
      next = new Uint8Array(cols * rows);
      chars = new Array(cols * rows).fill(" ");
      seedGrid();
    };

    function idx(x: number, y: number) { return y * cols + x; }

    function seedGrid() {
      cur.fill(0);
      // Seed with "C" bitmap, tiled a few times across the grid
      const stamps = 4;
      for (let s = 0; s < stamps; s++) {
        const ox = Math.floor(Math.random() * (cols - 5));
        const oy = Math.floor(Math.random() * (rows - 7));
        for (let y = 0; y < C_BITMAP.length; y++) {
          for (let x = 0; x < C_BITMAP[0]!.length; x++) {
            if (C_BITMAP[y]![x] === "1") cur[idx(ox + x, oy + y)] = 1;
          }
        }
      }
      // Plus random scatter
      for (let i = 0; i < cols * rows * 0.05; i++) {
        cur[Math.floor(Math.random() * cur.length)] = 1;
      }
    }

    function step() {
      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          let n = 0;
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              if (dx === 0 && dy === 0) continue;
              const nx = (x + dx + cols) % cols;
              const ny = (y + dy + rows) % rows;
              n += cur[idx(nx, ny)]!;
            }
          }
          const alive = cur[idx(x, y)]!;
          const i = idx(x, y);
          if (alive) next[i] = (n === 2 || n === 3) ? 1 : 0;
          else next[i] = (n === 3) ? 1 : 0;
        }
      }
      [cur, next] = [next, cur];
    }

    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(container);
    const themeObs = new MutationObserver(() => { colorsRef.current = readColors(); });
    themeObs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

    const draw = (now: number) => {
      const colors = colorsRef.current;
      const rect = container.getBoundingClientRect();
      const w = rect.width;
      const h = rect.height;

      ctx.fillStyle = colors.bg;
      ctx.fillRect(0, 0, w, h);

      // Step the simulation on a fixed cadence
      if (now - lastStep > STEP_MS) {
        step();
        lastStep = now;
        // Count living — if too few, inject life
        let alive = 0;
        for (let i = 0; i < cur.length; i++) alive += cur[i]!;
        if (alive < cols * rows * 0.02) seedGrid();
      }

      ctx.font = `${cellH * 0.85}px 'Fira Mono', 'Courier New', monospace`;
      ctx.textBaseline = "top";
      ctx.textAlign = "left";

      // Render living cells as flickering ASCII chars
      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          const i = idx(x, y);
          if (cur[i]!) {
            // Occasionally cycle the char for visual life
            if (Math.random() < 0.04 || chars[i] === " ") {
              chars[i] = CHARSET[Math.floor(Math.random() * CHARSET.length)]!;
            }
            const bright = Math.random();
            if (bright > 0.92) {
              ctx.fillStyle = colors.accent;
              ctx.shadowColor = colors.accent;
              ctx.shadowBlur = 4;
            } else {
              ctx.fillStyle = colors.primary;
              ctx.shadowBlur = 0;
            }
            ctx.fillText(chars[i]!, x * cellW, y * cellH);
          } else {
            chars[i] = " ";
          }
        }
      }
      ctx.shadowBlur = 0;

      // Scanlines
      ctx.fillStyle = "rgba(0,0,0,0.12)";
      for (let y = 0; y < h; y += 3) ctx.fillRect(0, y, w, 1);

      // Label
      ctx.font = `700 ${Math.min(16, w * 0.024)}px 'Fira Mono', monospace`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = colors.primary;
      ctx.shadowColor = colors.primary;
      ctx.shadowBlur = 6;
      ctx.fillText("C M E . e x e", w / 2, h - 30);
      ctx.shadowBlur = 0;
      ctx.font = `${Math.min(8, w * 0.011)}px 'Fira Mono', monospace`;
      ctx.fillStyle = colors.secondary;
      ctx.globalAlpha = 0.6;
      ctx.fillText("CONWAY'S GAME OF LIFE · GENERATION " + Math.floor(now / STEP_MS), w / 2, h - 14);
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
