import { useEffect, useRef } from "react";

// ---------------------------------------------------------------------------
// Console Boot hero animation.
//
// A retro terminal that types out boot/system diagnostics line by line:
// ASCII header, system checks with [OK]/[..] status, a spinner, and a
// blinking READY prompt at the bottom. Loops continuously. Pure canvas,
// no p5 dependency.
// ---------------------------------------------------------------------------

const HEADER = [
  "  ___ ___ ___ ___    ___ ___ ___ ___ ",
  " |_ _| _ \\ __| _ \\  |_ _| _ \\ __| _ \\",
  "  | ||  _/ _||  _/   | ||  _/ _||   /",
  " |___|_| |___|_|    |___|_| |___|_|\\\\",
];

const BOOT_LINES: { text: string; status: "ok" | "wait" | "info" }[] = [
  { text: "initialising kernel modules", status: "ok" },
  { text: "mounting /dev/creativity", status: "ok" },
  { text: "loading design-system tokens", status: "ok" },
  { text: "probing gpu... vector-green detected", status: "info" },
  { text: "starting observer daemon", status: "ok" },
  { text: "starting oracle service", status: "ok" },
  { text: "connecting to the machine", status: "wait" },
  { text: "negotiating handshake 56000 bps", status: "ok" },
  { text: "cme.exe ready", status: "ok" },
];

const ASCII_DIM = "·•∘:;i|m╳";
const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

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

export default function ConsoleHeroCanvas() {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number | null>(null);
  const startRef = useRef(0);
  const colorsRef = useRef<Colors>(readColors());

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    colorsRef.current = readColors();
    startRef.current = performance.now();

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

    // Theme observer
    const themeObs = new MutationObserver(() => {
      colorsRef.current = readColors();
    });
    themeObs.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });

    const draw = (now: number) => {
      const colors = colorsRef.current;
      const rect = container.getBoundingClientRect();
      const w = rect.width;
      const h = rect.height;

      ctx.fillStyle = colors.bg;
      ctx.fillRect(0, 0, w, h);

      // Subtle scanlines
      ctx.fillStyle = "rgba(0,0,0,0.15)";
      for (let y = 0; y < h; y += 3) {
        ctx.fillRect(0, y, w, 1);
      }

      // Terminal window border
      const padX = Math.max(24, w * 0.08);
      const termW = Math.min(w - padX * 2, 640);
      const termX = (w - termW) / 2;
      const termY = h * 0.12;
      const termH = Math.min(h - termY - h * 0.18, 420);

      // Terminal background
      ctx.fillStyle = "rgba(0,0,0,0.4)";
      ctx.fillRect(termX, termY, termW, termH);

      // Border
      ctx.strokeStyle = colors.secondary;
      ctx.globalAlpha = 0.4;
      ctx.lineWidth = 1;
      ctx.strokeRect(termX, termY, termW, termH);
      ctx.globalAlpha = 1;

      // Title bar with dots
      const dotR = 4;
      ctx.fillStyle = colors.accent;
      ctx.globalAlpha = 0.5;
      ctx.beginPath(); ctx.arc(termX + 14, termY + 14, dotR, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = colors.primary;
      ctx.beginPath(); ctx.arc(termX + 14 + dotR * 3, termY + 14, dotR, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = colors.secondary;
      ctx.beginPath(); ctx.arc(termX + 14 + dotR * 6, termY + 14, dotR, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;

      ctx.fillStyle = colors.secondary;
      ctx.globalAlpha = 0.7;
      ctx.font = "10px 'Fira Mono', monospace";
      ctx.textBaseline = "top";
      ctx.fillText("cme@exe: ~/boot", termX + termW - 130, termY + 10);
      ctx.globalAlpha = 1;

      // Content
      const contentX = termX + 16;
      let contentY = termY + 36;
      const fontSize = Math.min(11, termW / 55);
      ctx.font = `${fontSize}px 'Fira Mono', 'Courier New', monospace`;

      const elapsed = now - startRef.current;
      const totalCycle = 12000; // 12s loop
      const t = (elapsed % totalCycle) / totalCycle;

      // ASCII header (fades in)
      const headerAlpha = Math.min(1, t * 8);
      ctx.globalAlpha = headerAlpha * 0.85;
      ctx.fillStyle = colors.primary;
      ctx.shadowColor = colors.primary;
      ctx.shadowBlur = 3;
      const headerFont = Math.min(7, termW / 52);
      ctx.font = `${headerFont}px 'Fira Mono', monospace`;
      for (let i = 0; i < HEADER.length; i++) {
        ctx.fillText(HEADER[i]!, contentX, contentY + i * (headerFont + 2));
      }
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 1;
      contentY += HEADER.length * (headerFont + 2) + 12;

      // Boot lines (typed progressively)
      ctx.font = `${fontSize}px 'Fira Mono', 'Courier New', monospace`;
      const lineDelay = 0.45; // each line appears at 45% into previous
      for (let i = 0; i < BOOT_LINES.length; i++) {
        const lineStart = 0.12 + i * lineDelay * 0.8;
        const lineT = (t - lineStart) / 0.06; // 6% of cycle to type
        if (lineT < 0) break;
        const line = BOOT_LINES[i]!;
        const typedChars = Math.floor(Math.min(1, lineT) * line.text.length);
        const typed = line.text.slice(0, typedChars);
        const done = lineT >= 1;

        ctx.fillStyle = colors.primary;
        ctx.globalAlpha = 0.9;
        ctx.fillText(`$ ${typed}`, contentX, contentY);
        const textWidth = ctx.measureText(`$ ${typed}`).width;

        if (done) {
          // Status tag
          const tagX = contentX + termW - 16 - 50;
          if (line.status === "ok") {
            ctx.fillStyle = colors.accent;
            ctx.fillText("[ OK ]", tagX, contentY);
          } else if (line.status === "wait") {
            const spinIdx = Math.floor(now / 80) % SPINNER.length;
            ctx.fillStyle = colors.secondary;
            ctx.fillText(SPINNER[spinIdx]!, tagX, contentY);
          } else {
            ctx.fillStyle = colors.secondary;
            ctx.fillText("[ .. ]", tagX, contentY);
          }
        } else if (typedChars < line.text.length) {
          // Typing cursor
          if (Math.floor(now / 400) % 2 === 0) {
            ctx.fillStyle = colors.accent;
            ctx.fillText("█", contentX + textWidth, contentY);
          }
        }
        contentY += fontSize + 6;
      }
      ctx.globalAlpha = 1;

      // READY prompt at the bottom of the terminal
      if (t > 0.85) {
        const readyAlpha = Math.min(1, (t - 0.85) * 8);
        ctx.globalAlpha = readyAlpha;
        ctx.fillStyle = colors.accent;
        ctx.shadowColor = colors.accent;
        ctx.shadowBlur = 4;
        ctx.fillText(">> ready_", contentX, termY + termH - 24);
        if (Math.floor(now / 500) % 2 === 0) {
          const rw = ctx.measureText(">> ready_").width;
          ctx.fillText("█", contentX + rw, termY + termH - 24);
        }
        ctx.shadowBlur = 0;
        ctx.globalAlpha = 1;
      }

      // Ambient dim characters in background corners
      ctx.font = `${fontSize}px 'Fira Mono', monospace`;
      ctx.globalAlpha = 0.06;
      ctx.fillStyle = colors.primary;
      const seed = Math.floor(now / 200);
      for (let i = 0; i < 30; i++) {
        const cx = (i * 37 + seed * 13) % w;
        const cy = (i * 53 + seed * 7) % h;
        const ch = ASCII_DIM[(i + seed) % ASCII_DIM.length]!;
        ctx.fillText(ch, cx, cy);
      }
      ctx.globalAlpha = 1;

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
