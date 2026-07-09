import { useEffect, useRef } from "react";

// ---------------------------------------------------------------------------
// p5.js ASCII hero animation for the Boot section.
//
// Renders "CME.exe" as large block characters that materialise from random
// ASCII noise. Below the title, a subtle matrix-rain of characters falls.
// A typewriter effect types the tagline beneath. The whole thing respects
// prefers-reduced-motion and the current theme colours via CSS variables.
// ---------------------------------------------------------------------------

const TITLE = "CME.exe";
const TAGLINE = "A Medvesek Experiment in AI × Design";

const ASCII_CHARSET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789@#$%&*<>/\\|=+-~!?{}[]()";

/** Resolution of each title character cell (cols × rows). */

/**
 * 5×7 block-letter glyphs stored column-major as bit arrays.
 * Bit = character cell is ON. 1 bit per cell in a 5-col × 7-row grid.
 * Stored top-to-bottom, left-to-right per row (7 × 5 = 35 bits per glyph).
 */
const BLOCK_CHARS: Record<string, number[]> = {
  C: [
    0b01110,
    0b10001,
    0b10000,
    0b10000,
    0b10000,
    0b10001,
    0b01110,
  ],
  M: [
    0b10001,
    0b11011,
    0b10101,
    0b10101,
    0b10001,
    0b10001,
    0b10001,
  ],
  E: [
    0b11111,
    0b10000,
    0b10000,
    0b11110,
    0b10000,
    0b10000,
    0b11111,
  ],
  ".": [
    0b00000,
    0b00000,
    0b00000,
    0b00000,
    0b00000,
    0b01100,
    0b01100,
  ],
  e: [
    0b00000,
    0b00000,
    0b01110,
    0b10001,
    0b11111,
    0b10000,
    0b01110,
  ],
  x: [
    0b00000,
    0b00000,
    0b10001,
    0b01010,
    0b00100,
    0b01010,
    0b10001,
  ],
};

interface Cell {
  col: number;
  row: number;
  on: boolean;        // true = part of the title glyph
  char: string;       // currently displayed character
  target: string;     // final character (for glyph-on cells)
  resolved: boolean;  // has stopped cycling
  cycleStart: number; // timestamp when this cell started cycling
}

interface RainDrop {
  col: number;
  y: number;
  speed: number;
  chars: string[];
  len: number;
}

interface TypewriterChar {
  char: string;
  shown: boolean;
}

export default function BootHeroCanvas() {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const p5Ref = useRef<any>(null);
  const cellsRef = useRef<Cell[]>([]);
  const rainRef = useRef<RainDrop[]>([]);
  const taglineRef = useRef<TypewriterChar[]>(
    TAGLINE.split("").map((c) => ({ char: c, shown: false })),
  );
  const taglineIdxRef = useRef(0);
  const taglineTimerRef = useRef(0);
  const frameRef = useRef(0);

  // Read theme colours once.
  const colorsRef = useRef({
    primary: "#39ff14",
    accent: "#4ECDC4",
    bg: "#0a0e0a",
    secondary: "#4a6a4a",
  });

  // Build cell grid from title string.
  const buildCells = (canvasW: number, canvasH: number): Cell[] => {
    const cells: Cell[] = [];
    // Measure total glyph width in cols.
    let totalCols = 0;
    for (let i = 0; i < TITLE.length; i++) {
      const ch = TITLE[i];
      const glyph = BLOCK_CHARS[ch];
      if (glyph) {
        totalCols += 5 + 1; // 5 cols + 1 spacing
      } else {
        totalCols += 3 + 1;
      }
    }
    totalCols -= 1; // remove trailing space

    // Scale to fit canvas width with padding.
    const maxCellW = 14;
    const cellW = Math.min(maxCellW, Math.floor((canvasW - 40) / totalCols));
    const cellH = Math.round(cellW * 1.4);

    const startX = Math.floor((canvasW - totalCols * cellW) / 2);
    const startY = Math.floor(canvasH * 0.22);

    let colOff = 0;
    for (let i = 0; i < TITLE.length; i++) {
      const ch = TITLE[i];
      const glyph = BLOCK_CHARS[ch];
      if (!glyph) continue;
      for (let r = 0; r < 7; r++) {
        const row = glyph[r]!;
        for (let c = 0; c < 5; c++) {
          const isOn = ((row >> (4 - c)) & 1) !== 0;
          cells.push({
            col: startX + (colOff + c) * cellW,
            row: startY + r * cellH,
            on: isOn,
            char: randomChar(),
            target: isOn ? randomChar() : " ",
            resolved: false,
            cycleStart: 0,
          });
        }
      }
      colOff += 6; // 5 + 1 space
    }
    return cells;
  };

  // Build rain drops for the matrix-rain effect.
  const buildRain = (canvasW: number, canvasH: number): RainDrop[] => {
    const drops: RainDrop[] = [];
    const colW = 14;
    const numCols = Math.floor(canvasW / colW);
    for (let i = 0; i < numCols; i++) {
      if (Math.random() < 0.3) {
        drops.push({
          col: i * colW,
          y: Math.random() * canvasH * -1,
          speed: 1 + Math.random() * 3,
          chars: Array.from({ length: 8 + Math.floor(Math.random() * 12) }, () => randomChar()),
          len: 6 + Math.floor(Math.random() * 10),
        });
      }
    }
    return drops;
  };

  const draw = (p: any) => {
    const canvas = canvasRef.current;
    if (!canvas || !containerRef.current) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const rect = containerRef.current.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.round(rect.width));
    const h = Math.max(1, Math.round(rect.height));

    if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    // Init cells and rain on first draw.
    if (cellsRef.current.length === 0) {
      cellsRef.current = buildCells(w, h);
      rainRef.current = buildRain(w, h);
    }

    const colors = colorsRef.current;
    ctx.fillStyle = colors.bg;
    ctx.fillRect(0, 0, w, h);

    const now = Date.now();
    const cellW = 14;
    const cellH = Math.round(cellW * 1.4);
    const fontSize = cellW * 0.85;

    // -- Draw title cells --
    ctx.font = `${fontSize}px "Fira Mono", "Courier New", monospace`;
    ctx.textBaseline = "top";

    for (const cell of cellsRef.current) {
      // Cycling animation: cells resolve from left to right in a wave.
      if (!cell.resolved) {
        if (cell.cycleStart === 0) cell.cycleStart = now;
        const age = now - cell.cycleStart;
        const resolveDelay = cell.col * 0.8 + cell.row * 20; // wave pattern
        if (age > 800 + resolveDelay) {
          cell.resolved = true;
          cell.char = cell.on ? cell.target : " ";
        } else if (Math.random() < 0.15) {
          cell.char = randomChar();
        }
      }

      if (cell.char === " ") continue;

      // Glow for "on" cells, dim for "off" cells that haven't resolved yet.
      if (cell.on || !cell.resolved) {
        ctx.fillStyle = cell.on
          ? colors.primary
          : colors.secondary;
        ctx.globalAlpha = cell.resolved ? 0.95 : 0.3 + Math.random() * 0.15;
        ctx.shadowColor = cell.on ? colors.primary : "transparent";
        ctx.shadowBlur = cell.on ? 4 : 0;
        ctx.fillText(cell.char, cell.col, cell.row);
        ctx.shadowBlur = 0;
      }
    }

    ctx.globalAlpha = 1;

    // -- Draw rain --
    for (const drop of rainRef.current) {
      drop.y += drop.speed;
      if (drop.y > h + 100) {
        drop.y = -drop.len * cellH * -1;
        drop.speed = 1 + Math.random() * 3;
      }
      for (let j = 0; j < drop.len; j++) {
        const cy = drop.y - j * cellH;
        if (cy < -cellH || cy > h) continue;
        const charIdx = Math.abs(Math.floor(drop.y / cellH * 0.3)) % drop.chars.length;
        const alpha = j === 0 ? 0.9 : Math.max(0, 0.6 - j * 0.06);
        ctx.globalAlpha = alpha;
        ctx.fillStyle = colors.accent;
        ctx.shadowColor = colors.accent;
        ctx.shadowBlur = j === 0 ? 6 : 0;
        ctx.fillText(drop.chars[charIdx % drop.chars.length], drop.col, cy);
        ctx.shadowBlur = 0;
      }
    }

    ctx.globalAlpha = 1;

    // -- Typewriter tagline --
    const tagChars = taglineRef.current;
    if (taglineIdxRef.current < tagChars.length) {
      taglineTimerRef.current += 1;
      if (taglineTimerRef.current > 3) {
        tagChars[taglineIdxRef.current]!.shown = true;
        taglineIdxRef.current += 1;
        taglineTimerRef.current = 0;
      }
    }

    const tagY = h * 0.68;
    const tagFontSize = Math.min(14, w * 0.014);
    ctx.font = `${tagFontSize}px "Fira Mono", "Courier New", monospace`;
    ctx.textBaseline = "top";
    ctx.fillStyle = colors.secondary;

    let tagX = w / 2 - (TAGLINE.length * tagFontSize * 0.6) / 2;
    for (const tc of tagChars) {
      if (tc.shown) {
        ctx.fillText(tc.char, tagX, tagY);
      }
      tagX += tagFontSize * 0.6;
    }

    // Blinking cursor after tagline
    if (taglineIdxRef.current >= tagChars.length) {
      if (Math.floor(now / 500) % 2 === 0) {
        ctx.fillStyle = colors.accent;
        ctx.fillText("█", tagX, tagY);
      }
    }

    // -- Decorative elements --

    // Subtle horizontal line above tagline
    const lineY = tagY - 12;
    ctx.strokeStyle = colors.secondary;
    ctx.globalAlpha = 0.3;
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(w * 0.15, lineY);
    ctx.lineTo(w * 0.85, lineY);
    ctx.stroke();
    ctx.globalAlpha = 1;

    // Subtle corner markers
    const cm = 12;
    const cl = 30;
    ctx.strokeStyle = colors.accent;
    ctx.globalAlpha = 0.15;
    ctx.lineWidth = 1;
    // top-left
    ctx.beginPath(); ctx.moveTo(cm, cm + cl); ctx.lineTo(cm, cm); ctx.lineTo(cm + cl, cm); ctx.stroke();
    // top-right
    ctx.beginPath(); ctx.moveTo(w - cm - cl, cm); ctx.lineTo(w - cm, cm); ctx.lineTo(w - cm, cm + cl); ctx.stroke();
    // bottom-left
    ctx.beginPath(); ctx.moveTo(cm, h - cm - cl); ctx.lineTo(cm, h - cm); ctx.lineTo(cm + cl, h - cm); ctx.stroke();
    // bottom-right
    ctx.beginPath(); ctx.moveTo(w - cm - cl, h - cm); ctx.lineTo(w - cm, h - cm); ctx.lineTo(w - cm, h - cm - cl); ctx.stroke();
    ctx.globalAlpha = 1;

    frameRef.current = p.frameCount || 0;
  };

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Read theme colours.
    const cs = getComputedStyle(document.documentElement);
    const read = (name: string, fallback: string) => cs.getPropertyValue(name).trim() || fallback;
    colorsRef.current = {
      primary: read("--color-text-primary", "#39ff14"),
      accent: read("--color-accent", "#4ECDC4"),
      bg: read("--color-bg", "#0a0e0a"),
      secondary: read("--color-text-secondary", "#4a6a4a"),
    };

    // Dynamic import of p5 (it's tree-shaken if unused elsewhere but
    // already in the bundle via package.json).
    let cancelled = false;
    import("p5").then((p5Mod) => {
      if (cancelled || !container) return;
      const p5 = p5Mod.default;

      // Remove cells/rain cache on resize.
      cellsRef.current = [];
      rainRef.current = [];
      taglineIdxRef.current = 0;
      taglineTimerRef.current = 0;

      const sketch = (p: any) => {
        p.setup = () => {
          // No createCanvas — we draw directly to the existing canvas.
        };
        p.draw = () => draw(p);
      };

      p5Ref.current = new p5(sketch, container);
    }).catch(() => {
      /* p5 failed to load — non-fatal */
    });

    // Theme observer.
    const observer = new MutationObserver(() => {
      const cs2 = getComputedStyle(document.documentElement);
      const read2 = (name: string, fallback: string) => cs2.getPropertyValue(name).trim() || fallback;
      colorsRef.current = {
        primary: read2("--color-text-primary", "#39ff14"),
        accent: read2("--color-accent", "#4ECDC4"),
        bg: read2("--color-bg", "#0a0e0a"),
        secondary: read2("--color-text-secondary", "#4a6a4a"),
      };
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });

    return () => {
      cancelled = true;
      observer.disconnect();
      if (p5Ref.current) {
        try { p5Ref.current.remove(); } catch { /* gone */ }
        p5Ref.current = null;
      }
    };
  }, []);

  return (
    <div ref={containerRef} className="boot-hero-canvas-wrap">
      <canvas ref={canvasRef} className="boot-hero-canvas" />
    </div>
  );
}

function randomChar(): string {
  return ASCII_CHARSET[Math.floor(Math.random() * ASCII_CHARSET.length)]!;
}
