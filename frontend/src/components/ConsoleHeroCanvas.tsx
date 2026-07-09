import { useEffect, useRef, useState, useCallback } from "react";

// ---------------------------------------------------------------------------
// Console Boot hero animation (enhanced).
//
// Two phases:
//   1. BOOT — terminal types out system diagnostics with a progress bar,
//      colour-coded status tags, and a system-info header. Runs once (~5s).
//   2. MENU — interactive cursor-selectable destination list. Arrow keys to
//      move, Enter to confirm. Default: Speedrun. Click also works.
//
// Scales with browser: terminal width ∝ canvas width, font ∝ terminal width.
// Pure canvas, no p5 dependency.
// ---------------------------------------------------------------------------

const BOOT_LINES: { text: string; status: "ok" | "wait" | "info" }[] = [
  { text: "mounting /dev/creativity", status: "ok" },
  { text: "loading design tokens [42 modules]", status: "ok" },
  { text: "probing gpu... vector-green @ 60fps", status: "info" },
  { text: "spawning observer daemon", status: "ok" },
  { text: "spawning oracle service", status: "ok" },
  { text: "handshaking the machine [56000 bps]", status: "wait" },
  { text: "loading design quotes [42 entries]", status: "ok" },
  { text: "cme.exe ready", status: "ok" },
];

interface MenuEntry {
  label: string;
  hint: string;
  action: "reboot" | "navigate";
  target?: string;
}

const MENU_ENTRIES: MenuEntry[] = [
  { label: "REBOOT", hint: "replay the 56k boot sequence", action: "reboot" },
  { label: "SPEEDRUN", hint: "an AI agent visits, live", action: "navigate", target: "observer" },
  { label: "ORACLE", hint: "ask the machine", action: "navigate", target: "oracle" },
  { label: "QUEST", hint: "shoot design problems", action: "navigate", target: "quest" },
];

const DEFAULT_MENU_INDEX = 1; // Speedrun

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

/** Compute layout metrics from canvas dimensions — keeps ratio consistent. */
function computeLayout(w: number, h: number) {
  const padX = Math.max(20, w * 0.06);
  const termW = Math.min(w - padX * 2, w * 0.88);
  const termX = (w - termW) / 2;
  const termY = h * 0.08;
  // Font scales with terminal width (constant ratio ~1:52), clamped readable.
  const fontSize = Math.max(9, Math.min(18, termW / 52));
  const lineH = fontSize * 1.55;
  const titleH = fontSize * 2.4;
  return { padX, termW, termX, termY, fontSize, lineH, titleH };
}

export default function ConsoleHeroCanvas() {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number | null>(null);
  const bootStartRef = useRef(0);
  const colorsRef = useRef<Colors>(readColors());

  const [phase, setPhase] = useState<"boot" | "menu">("boot");
  const [menuIndex, setMenuIndex] = useState(DEFAULT_MENU_INDEX);
  const phaseRef = useRef(phase);
  const menuIndexRef = useRef(menuIndex);

  useEffect(() => { phaseRef.current = phase; }, [phase]);
  useEffect(() => { menuIndexRef.current = menuIndex; }, [menuIndex]);

  const navigate = useCallback((entry: MenuEntry) => {
    if (entry.action === "reboot") {
      window.dispatchEvent(new CustomEvent("cme-exe:replay-boot"));
    } else if (entry.target) {
      const el = document.getElementById(entry.target);
      if (el) el.scrollIntoView({ behavior: "smooth" });
    }
  }, []);

  // Keyboard navigation for menu phase.
  useEffect(() => {
    if (phase !== "menu") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowDown" || e.key === "j") {
        e.preventDefault();
        setMenuIndex((i) => (i + 1) % MENU_ENTRIES.length);
      } else if (e.key === "ArrowUp" || e.key === "k") {
        e.preventDefault();
        setMenuIndex((i) => (i - 1 + MENU_ENTRIES.length) % MENU_ENTRIES.length);
      } else if (e.key === "Enter") {
        e.preventDefault();
        navigate(MENU_ENTRIES[menuIndexRef.current]!);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase, navigate]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    colorsRef.current = readColors();
    bootStartRef.current = performance.now();

    const resize = () => {
      const rect = container.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const cw = Math.max(1, Math.round(rect.width));
      const ch = Math.max(1, Math.round(rect.height));
      canvas.width = cw * dpr;
      canvas.height = ch * dpr;
      canvas.style.width = `${cw}px`;
      canvas.style.height = `${ch}px`;
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

    let hoverIndex = -1;

    const draw = (now: number) => {
      const colors = colorsRef.current;
      const rect = container.getBoundingClientRect();
      const w = rect.width;
      const h = rect.height;
      const L = computeLayout(w, h);

      // Background
      ctx.fillStyle = colors.bg;
      ctx.fillRect(0, 0, w, h);

      // Scanlines
      ctx.fillStyle = "rgba(0,0,0,0.12)";
      for (let y = 0; y < h; y += 3) ctx.fillRect(0, y, w, 1);

      // Ambient chars
      ctx.font = `${L.fontSize}px 'Fira Mono', monospace`;
      ctx.globalAlpha = 0.04;
      ctx.fillStyle = colors.primary;
      const seed = Math.floor(now / 250);
      for (let i = 0; i < 40; i++) {
        const cx = (i * 73 + seed * 17) % w;
        const cy = (i * 41 + seed * 11) % h;
        ctx.fillText(String.fromCharCode(33 + ((i * 7 + seed) % 90)), cx, cy);
      }
      ctx.globalAlpha = 1;

      // Terminal window
      const termH = Math.min(h - L.termY - h * 0.06, 560);
      drawTerminalFrame(ctx, L, termH, colors);

      const contentX = L.termX + L.fontSize * 1.5;
      const contentStartY = L.termY + L.titleH + L.fontSize * 0.6;

      const bootElapsed = now - bootStartRef.current;
      if (phaseRef.current === "boot") {
        drawBootPhase(ctx, contentX, contentStartY, L, bootElapsed, now, colors);
        if (bootElapsed > 5800) setPhase("menu");
      } else {
        drawMenuPhase(ctx, contentX, contentStartY, L, now, colors, hoverIndex, menuIndexRef.current);
      }

      rafRef.current = requestAnimationFrame(draw);
    };

    // Click + hover on canvas → menu select.
    const onCanvasMove = (e: MouseEvent) => {
      if (phaseRef.current !== "menu") { hoverIndex = -1; return; }
      const rect = canvas.getBoundingClientRect();
      const my = e.clientY - rect.top;
      const L = computeLayout(rect.width, rect.height);
      hoverIndex = menuIndexFromY(my, L, L.termY + L.titleH + L.fontSize * 0.6);
      canvas.style.cursor = hoverIndex >= 0 ? "pointer" : "default";
    };
    const onCanvasClick = (e: MouseEvent) => {
      if (phaseRef.current !== "menu") return;
      const rect = canvas.getBoundingClientRect();
      const cy = e.clientY - rect.top;
      const L = computeLayout(rect.width, rect.height);
      const idx = menuIndexFromY(cy, L, L.termY + L.titleH + L.fontSize * 0.6);
      if (idx >= 0) {
        setMenuIndex(idx);
        navigate(MENU_ENTRIES[idx]!);
      }
    };
    canvas.addEventListener("mousemove", onCanvasMove);
    canvas.addEventListener("click", onCanvasClick);

    rafRef.current = requestAnimationFrame(draw);

    return () => {
      ro.disconnect();
      themeObs.disconnect();
      canvas.removeEventListener("mousemove", onCanvasMove);
      canvas.removeEventListener("click", onCanvasClick);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [navigate]);

  return (
    <div ref={containerRef} className="boot-hero-canvas-wrap">
      <canvas ref={canvasRef} className="boot-hero-canvas" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Terminal frame: background, border, title bar with traffic-light dots.
// ---------------------------------------------------------------------------

function drawTerminalFrame(
  ctx: CanvasRenderingContext2D,
  L: ReturnType<typeof computeLayout>,
  termH: number,
  colors: Colors,
) {
  // Background
  ctx.fillStyle = "rgba(0,0,0,0.45)";
  ctx.fillRect(L.termX, L.termY, L.termW, termH);

  // Title bar
  ctx.fillStyle = "rgba(255,255,255,0.03)";
  ctx.fillRect(L.termX, L.termY, L.termW, L.titleH);

  // Border
  ctx.strokeStyle = colors.secondary;
  ctx.globalAlpha = 0.35;
  ctx.lineWidth = 1;
  ctx.strokeRect(L.termX, L.termY, L.termW, termH);
  ctx.globalAlpha = 1;

  // Traffic-light dots
  const dotR = L.fontSize * 0.32;
  const dotY = L.termY + L.titleH / 2;
  const dotStart = L.termX + dotR * 3;
  ctx.globalAlpha = 0.6;
  ctx.fillStyle = colors.accent;
  ctx.beginPath(); ctx.arc(dotStart, dotY, dotR, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = colors.primary;
  ctx.beginPath(); ctx.arc(dotStart + dotR * 3.5, dotY, dotR, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = colors.secondary;
  ctx.beginPath(); ctx.arc(dotStart + dotR * 7, dotY, dotR, 0, Math.PI * 2); ctx.fill();
  ctx.globalAlpha = 1;

  // Title text
  ctx.fillStyle = colors.secondary;
  ctx.globalAlpha = 0.7;
  ctx.font = `${L.fontSize * 0.8}px 'Fira Mono', monospace`;
  ctx.textBaseline = "middle";
  ctx.textAlign = "right";
  ctx.fillText("cme@exe: ~", L.termX + L.termW - L.fontSize, dotY);
  ctx.textAlign = "left";
  ctx.globalAlpha = 1;
}

// ---------------------------------------------------------------------------
// BOOT phase: system header + typed boot lines + progress bar.
// ---------------------------------------------------------------------------

function drawBootPhase(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  L: ReturnType<typeof computeLayout>,
  elapsed: number,
  now: number,
  colors: Colors,
) {
  ctx.textBaseline = "top";
  const contentW = L.termW - L.fontSize * 3;

  // --- System info header (neofetch-style) ---
  ctx.font = `700 ${L.fontSize * 0.95}px 'Fira Mono', monospace`;
  ctx.fillStyle = colors.primary;
  ctx.shadowColor = colors.primary;
  ctx.shadowBlur = 4;
  ctx.fillText("CME.exe", x, y);
  ctx.shadowBlur = 0;

  ctx.font = `${L.fontSize * 0.7}px 'Fira Mono', monospace`;
  ctx.fillStyle = colors.secondary;
  let infoY = y + L.fontSize * 1.3;
  const infoLines = [
    "os:      cme-exe 1.0 (combo-alpha-plus)",
    "host:    the machine as co-author",
    "kernel:  56k-modem-handshake",
    "theme:   vector-green",
  ];
  for (const line of infoLines) {
    ctx.fillText(line, x, infoY);
    infoY += L.fontSize * 0.95;
  }

  // Separator
  const sepY = infoY + L.fontSize * 0.5;
  ctx.strokeStyle = colors.secondary;
  ctx.globalAlpha = 0.3;
  ctx.beginPath();
  ctx.moveTo(x, sepY);
  ctx.lineTo(x + contentW, sepY);
  ctx.stroke();
  ctx.globalAlpha = 1;

  // --- Typed boot lines ---
  let lineY = sepY + L.fontSize * 0.8;
  const lineDelay = 380; // ms between lines
  const typeDuration = 250; // ms to type each line

  for (let i = 0; i < BOOT_LINES.length; i++) {
    const entry = BOOT_LINES[i]!;
    const lineStart = i * lineDelay;
    if (elapsed < lineStart) break;

    const typeProgress = Math.min(1, (elapsed - lineStart) / typeDuration);
    const typedChars = Math.floor(typeProgress * entry.text.length);
    const typed = entry.text.slice(0, typedChars);
    const done = typeProgress >= 1;

    // $ prompt
    ctx.font = `${L.fontSize * 0.85}px 'Fira Mono', monospace`;
    ctx.fillStyle = colors.accent;
    ctx.fillText("$", x, lineY);

    // Command text
    ctx.fillStyle = colors.primary;
    ctx.fillText(typed, x + L.fontSize * 0.7, lineY);

    // Status tag (right-aligned)
    if (done) {
      ctx.textAlign = "right";
      if (entry.status === "ok") {
        ctx.fillStyle = colors.accent;
        ctx.fillText("[ OK ]", x + contentW, lineY);
      } else if (entry.status === "wait") {
        // Spinner
        const spin = "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏";
        const si = Math.floor(now / 80) % spin.length;
        ctx.fillStyle = colors.secondary;
        ctx.fillText(spin[si]!, x + contentW, lineY);
      } else {
        ctx.fillStyle = colors.secondary;
        ctx.fillText("[ .. ]", x + contentW, lineY);
      }
      ctx.textAlign = "left";
    } else if (typedChars < entry.text.length) {
      // Typing cursor
      if (Math.floor(now / 400) % 2 === 0) {
        const tw = ctx.measureText(typed).width;
        ctx.fillStyle = colors.accent;
        ctx.fillText("█", x + L.fontSize * 0.7 + tw, lineY);
      }
    }
    lineY += L.lineH;
  }

  // --- Progress bar ---
  const totalBootMs = BOOT_LINES.length * lineDelay + typeDuration;
  const progress = Math.min(1, elapsed / totalBootMs);
  const barY = lineY + L.fontSize;
  const barW = contentW;
  const barH = L.fontSize * 0.4;

  // Bar background
  ctx.fillStyle = "rgba(255,255,255,0.05)";
  ctx.fillRect(x, barY, barW, barH);

  // Bar fill
  ctx.fillStyle = colors.accent;
  ctx.shadowColor = colors.accent;
  ctx.shadowBlur = 6;
  ctx.fillRect(x, barY, barW * progress, barH);
  ctx.shadowBlur = 0;

  // Bar percentage
  ctx.font = `${L.fontSize * 0.65}px 'Fira Mono', monospace`;
  ctx.fillStyle = colors.secondary;
  ctx.fillText(`${Math.round(progress * 100)}%`, x, barY + barH + L.fontSize * 0.3);

  // --- READY indicator ---
  if (progress >= 1) {
    const readyY = barY + barH + L.fontSize * 1.8;
    const flash = Math.sin(now / 200) * 0.3 + 0.7;
    ctx.globalAlpha = flash;
    ctx.font = `700 ${L.fontSize}px 'Fira Mono', monospace`;
    ctx.fillStyle = colors.accent;
    ctx.shadowColor = colors.accent;
    ctx.shadowBlur = 8;
    ctx.fillText(">> SYSTEM READY", x, readyY);
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1;
  }
}

// ---------------------------------------------------------------------------
// MENU phase: destination selection with cursor.
// ---------------------------------------------------------------------------

/** Inverse: which menu entry is at canvas Y? Returns -1 if none. */
function menuIndexFromY(
  cy: number,
  L: ReturnType<typeof computeLayout>,
  contentStartY: number,
): number {
  const headerBlock = L.fontSize * 0.95 + L.lineH;
  const entryH = L.lineH * 1.7;
  for (let i = 0; i < MENU_ENTRIES.length; i++) {
    const entryY = contentStartY + headerBlock + i * entryH;
    if (cy >= entryY && cy < entryY + entryH) return i;
  }
  return -1;
}

function drawMenuPhase(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  L: ReturnType<typeof computeLayout>,
  now: number,
  colors: Colors,
  hoverIndex: number,
  selectedIndex: number,
) {
  ctx.textBaseline = "top";
  const contentW = L.termW - L.fontSize * 3;

  // --- Header ---
  ctx.font = `700 ${L.fontSize * 0.95}px 'Fira Mono', monospace`;
  ctx.fillStyle = colors.primary;
  ctx.shadowColor = colors.primary;
  ctx.shadowBlur = 4;
  ctx.fillText(">> SELECT DESTINATION", x, y);
  ctx.shadowBlur = 0;

  // Subtle prompt hint
  ctx.font = `${L.fontSize * 0.65}px 'Fira Mono', monospace`;
  ctx.fillStyle = colors.secondary;
  ctx.globalAlpha = 0.7;
  ctx.fillText("use ↑↓ to navigate · ENTER to confirm · or click", x, y + L.fontSize * 1.1);
  ctx.globalAlpha = 1;

  const headerBlock = L.fontSize * 0.95 + L.lineH;
  const entryH = L.lineH * 1.7;

  // --- Menu entries ---
  for (let i = 0; i < MENU_ENTRIES.length; i++) {
    const entry = MENU_ENTRIES[i]!;
    const entryY = y + headerBlock + i * entryH;
    const isSelected = i === selectedIndex;
    const isHover = i === hoverIndex;

    // Highlight bar for selected entry
    if (isSelected) {
      ctx.fillStyle = colors.accent;
      ctx.globalAlpha = 0.12;
      ctx.fillRect(x - L.fontSize * 0.5, entryY, contentW + L.fontSize, entryH * 0.85);
      ctx.globalAlpha = 1;
      // Left border accent
      ctx.fillStyle = colors.accent;
      ctx.fillRect(x - L.fontSize * 0.5, entryY, 3, entryH * 0.85);
    } else if (isHover) {
      ctx.fillStyle = colors.secondary;
      ctx.globalAlpha = 0.08;
      ctx.fillRect(x - L.fontSize * 0.5, entryY, contentW + L.fontSize, entryH * 0.85);
      ctx.globalAlpha = 1;
    }

    // Cursor indicator (► for selected, space otherwise)
    ctx.font = `${L.fontSize * 0.9}px 'Fira Mono', monospace`;
    if (isSelected) {
      ctx.fillStyle = colors.accent;
      // Blinking cursor
      if (Math.floor(now / 500) % 2 === 0) {
        ctx.fillText("►", x, entryY + L.fontSize * 0.15);
      }
    } else {
      ctx.fillStyle = colors.secondary;
      ctx.globalAlpha = 0.3;
      ctx.fillText(" ", x, entryY + L.fontSize * 0.15);
      ctx.globalAlpha = 1;
    }

    const labelX = x + L.fontSize * 1.5;

    // Label
    ctx.font = `700 ${L.fontSize}px 'Fira Mono', monospace`;
    if (isSelected) {
      ctx.fillStyle = colors.primary;
      ctx.shadowColor = colors.primary;
      ctx.shadowBlur = 5;
    } else {
      ctx.fillStyle = colors.secondary;
      ctx.globalAlpha = 0.8;
    }
    ctx.fillText(entry.label, labelX, entryY + L.fontSize * 0.15);
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1;

    // Hint (right-aligned)
    ctx.font = `${L.fontSize * 0.7}px 'Fira Mono', monospace`;
    ctx.fillStyle = colors.secondary;
    ctx.globalAlpha = isSelected ? 0.7 : 0.4;
    ctx.textAlign = "right";
    ctx.fillText(entry.hint, x + contentW, entryY + L.fontSize * 0.3);
    ctx.textAlign = "left";
    ctx.globalAlpha = 1;

    // Default marker
    if (i === DEFAULT_MENU_INDEX) {
      ctx.font = `${L.fontSize * 0.55}px 'Fira Mono', monospace`;
      ctx.fillStyle = colors.accent;
      ctx.globalAlpha = 0.6;
      ctx.fillText("DEFAULT", labelX, entryY + L.fontSize * 1.15);
      ctx.globalAlpha = 1;
    }
  }

  // --- Footer hint ---
  const footerY = y + headerBlock + MENU_ENTRIES.length * entryH + L.fontSize;
  ctx.font = `${L.fontSize * 0.6}px 'Fira Mono', monospace`;
  ctx.fillStyle = colors.secondary;
  ctx.globalAlpha = 0.5;
  ctx.fillText("// THE MACHINE IS WAITING", x, footerY);
  ctx.globalAlpha = 1;
}
