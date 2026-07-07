import { useCallback, useEffect, useRef, useState } from "react";
import { useIsMobile } from "../../hooks/useIsMobile";
import {
  playExplosionSound,
  playShootSound,
  startGameBgm,
  stopGameBgm,
} from "../../lib/audio";
import { MAX_LEVEL } from "../../hooks/useAsteroids";
import type { DesignQuote } from "../../types";

// ---------------------------------------------------------------------------
// Designer's Quest — Space Invaders variant on a pure <canvas>.
//
// Mirror of GameCanvas.tsx but with classic Invaders mechanics: a marching
// grid of design-problem invaders descends toward the player, who fires
// upward. Difficulty scales with `level` (1–6): tighter formation, faster
// march, more aggressive return-fire.
// ---------------------------------------------------------------------------

const PLAYER_W = 36;
const PLAYER_H = 18;
const PLAYER_Y_OFFSET = 32; // distance from bottom
const PLAYER_SPEED = 340; // px/s
const BULLET_SPEED = 560;
const BOMB_SPEED = 220;
const SHOOT_COOLDOWN_MS = 320;
const INVULN_SEC = 1.5;

const INVADER_W = 28;
const INVADER_H = 18;
const INVADER_GAP_X = 14;
const INVADER_GAP_Y = 16;
const ROWS = 4;
const COLS = 8;
// Horizontal march tempo scales with the play-field width so a formation
// traverses the screen in roughly the same wall-time regardless of how wide
// the browser window is. Reference: 8 px/tick at an 800 px-wide field.
const MARCH_REF_WIDTH = 800;
const MARCH_REF_STEP_X = 8;
function marchStepX(viewWidth: number): number {
  const w = Math.max(1, viewWidth);
  return Math.max(2, (w / MARCH_REF_WIDTH) * MARCH_REF_STEP_X);
}
const MARCH_DESCEND_Y = 14; // px when hitting a wall
const BASE_MARCH_INTERVAL_MS = 720; // tick speed at level 1
const MIN_MARCH_INTERVAL_MS = 180;
const BOMB_CHANCE_BASE = 0.0008; // per invader per frame (~60fps)
const BOMB_CHANCE_PER_LEVEL = 0.0006;
const MAX_BOMBS = 3;

const SCORE_FRONT_ROW = 30;
const SCORE_MID_ROW = 20;
const SCORE_BACK_ROW = 10;
const QUOTE_CHANCE = 0.3;
const LEVEL_ANNOUNCE_MS = 1500;

interface ViewSize {
  w: number;
  h: number;
}

interface Player {
  x: number;
  y: number;
  invulnUntil: number;
}

interface Bullet {
  x: number;
  y: number;
  vy: number;
  bornAt: number;
}

interface Bomb {
  id: number;
  x: number;
  y: number;
  vy: number;
}

interface Invader {
  id: number;
  col: number;
  row: number;
  x: number;
  y: number;
  alive: boolean;
  kind: "front" | "mid" | "back";
  label: string;
  frame: number;
}

interface Barrier {
  x: number;
  y: number;
  cells: boolean[]; // grid of alive cells, row-major
  cols: number;
  rows: number;
  cellW: number;
  cellH: number;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
}

interface ActiveQuote {
  id: number;
  text: string;
  source: string;
  x: number;
  y: number;
  bornAt: number;
  durationMs: number;
}

interface ThemeColors {
  primary: string;
  accent: string;
  bg: string;
  glow: number;
}

const INVADER_LABELS = [
  "Pixelated",
  "Cluttered",
  "Flashy",
  "Inaccessible",
  "Off-Brand",
  "Generic",
  "Trendy",
  "Boring",
] as const;

const BARRIER_COLS = 8;
const BARRIER_ROWS = 5;
const BARRIER_CELL = 6;

function scoreForKind(kind: Invader["kind"]): number {
  if (kind === "front") return SCORE_FRONT_ROW;
  if (kind === "mid") return SCORE_MID_ROW;
  return SCORE_BACK_ROW;
}

const INITIAL_VIEW: ViewSize = { w: 800, h: 480 };

function readThemeColors(): ThemeColors {
  const cs = getComputedStyle(document.documentElement);
  const read = (name: string, fallback: string) => {
    const v = cs.getPropertyValue(name).trim();
    return v || fallback;
  };
  const glowRaw = read("--glow-strength", "0.6");
  const glow = Number(glowRaw);
  return {
    primary: read("--color-text-primary", "#39ff14"),
    accent: read("--color-accent", "#4ecdc4"),
    bg: read("--color-bg", "#0a0e0a"),
    glow: Number.isFinite(glow) ? glow : 0.6,
  };
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

function makeBarriers(view: ViewSize): Barrier[] {
  const count = 4;
  const totalW = count * BARRIER_COLS * BARRIER_CELL + (count - 1) * 60;
  const startX = Math.max(20, (view.w - totalW) / 2);
  const y = view.h - PLAYER_Y_OFFSET - 90;
  const barriers: Barrier[] = [];
  for (let i = 0; i < count; i++) {
    const x = startX + i * (BARRIER_COLS * BARRIER_CELL + 60);
    const cells: boolean[] = [];
    for (let c = 0; c < BARRIER_COLS * BARRIER_ROWS; c++) cells.push(true);
    barriers.push({
      x,
      y,
      cells,
      cols: BARRIER_COLS,
      rows: BARRIER_ROWS,
      cellW: BARRIER_CELL,
      cellH: BARRIER_CELL,
    });
  }
  return barriers;
}

function makeFormation(view: ViewSize, level: number): {
  invaders: Invader[];
  originX: number;
  originY: number;
} {
  const formationW = COLS * (INVADER_W + INVADER_GAP_X) - INVADER_GAP_X;
  const originX = Math.max(20, (view.w - formationW) / 2);
  const originY = Math.max(40, Math.min(110, 40 + level * 6));
  const invaders: Invader[] = [];
  let id = 1;
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const kind: Invader["kind"] = r === ROWS - 1 ? "front" : r === 0 ? "back" : "mid";
      invaders.push({
        id: id++,
        col: c,
        row: r,
        x: originX + c * (INVADER_W + INVADER_GAP_X),
        y: originY + r * (INVADER_H + INVADER_GAP_Y),
        alive: true,
        kind,
        label: INVADER_LABELS[(r * COLS + c) % INVADER_LABELS.length]!,
        frame: 0,
      });
    }
  }
  return { invaders, originX, originY };
}

function marchIntervalMs(level: number): number {
  const v = BASE_MARCH_INTERVAL_MS - (level - 1) * 90;
  return Math.max(MIN_MARCH_INTERVAL_MS, v);
}

function bombChancePerFrame(level: number): number {
  return BOMB_CHANCE_BASE + (level - 1) * BOMB_CHANCE_PER_LEVEL;
}

interface GameCanvasProps {
  running: boolean;
  paused: boolean;
  level: number;
  onScore: (delta: number) => void;
  onLoseLife: () => void;
  onGameOver: () => void;
  onLevelUp: () => void;
  quotes: DesignQuote[];
}

export default function InvadersCanvas({
  running,
  paused,
  level,
  onScore,
  onLoseLife,
  onGameOver,
  onLevelUp,
  quotes,
}: GameCanvasProps) {
  const isMobile = useIsMobile();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const frameRef = useRef<HTMLDivElement | null>(null);

  const viewRef = useRef<ViewSize>(INITIAL_VIEW);
  const [viewSize, setViewSize] = useState<ViewSize>(INITIAL_VIEW);

  const playerRef = useRef<Player>({
    x: INITIAL_VIEW.w / 2,
    y: INITIAL_VIEW.h - PLAYER_Y_OFFSET,
    invulnUntil: 0,
  });
  const bulletsRef = useRef<Bullet[]>([]);
  const bombsRef = useRef<Bomb[]>([]);
  const invadersRef = useRef<Invader[]>([]);
  const barriersRef = useRef<Barrier[]>([]);
  const particlesRef = useRef<Particle[]>([]);
  const keysRef = useRef<Record<string, boolean>>({});
  const lastShotRef = useRef(0);
  const rafRef = useRef<number | null>(null);
  const lastTsRef = useRef(0);
  const idGenRef = useRef({ n: 1 });
  const colorsRef = useRef<ThemeColors>(readThemeColors());
  const quotesPoolRef = useRef<DesignQuote[]>([]);
  const usedQuoteIdsRef = useRef<Set<string>>(new Set());
  const runningRef = useRef(running);
  const pausedRef = useRef(paused);
  const levelRef = useRef(level);
  const marchDirRef = useRef<1 | -1>(1);
  const lastMarchTsRef = useRef(0);
  const descendPendingRef = useRef(false);
  const waveClearedRef = useRef(false);
  const quotePauseUntilRef = useRef(0);
  const onScoreRef = useRef(onScore);
  const onLoseLifeRef = useRef(onLoseLife);
  const onGameOverRef = useRef(onGameOver);
  const onLevelUpRef = useRef(onLevelUp);

  const [activeQuotes, setActiveQuotes] = useState<ActiveQuote[]>([]);
  const [announceLevel, setAnnounceLevel] = useState<number | null>(null);
  const announceTimerRef = useRef<number | null>(null);

  useEffect(() => {
    quotesPoolRef.current = quotes;
  }, [quotes]);
  useEffect(() => {
    runningRef.current = running;
  }, [running]);
  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);
  useEffect(() => {
    onScoreRef.current = onScore;
  }, [onScore]);
  useEffect(() => {
    onLoseLifeRef.current = onLoseLife;
  }, [onLoseLife]);
  useEffect(() => {
    onGameOverRef.current = onGameOver;
  }, [onGameOver]);
  useEffect(() => {
    onLevelUpRef.current = onLevelUp;
  }, [onLevelUp]);

  // Theme observer: re-read CSS variables when [data-theme] changes.
  useEffect(() => {
    const apply = () => {
      colorsRef.current = readThemeColors();
    };
    const observer = new MutationObserver(apply);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    return () => observer.disconnect();
  }, []);

  // Sync the canvas backing-store resolution to the rendered frame size.
  useEffect(() => {
    const canvas = canvasRef.current;
    const frame = frameRef.current;
    if (!canvas || !frame) return;
    const sync = () => {
      const rect = frame.getBoundingClientRect();
      const w = Math.max(1, Math.round(rect.width));
      const h = Math.max(1, Math.round(rect.height));
      if (canvas.width !== w) canvas.width = w;
      if (canvas.height !== h) canvas.height = h;
      viewRef.current = { w, h };
      setViewSize({ w, h });
    };
    sync();
    let timer: number | null = null;
    const schedule = () => {
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(sync, 60);
    };
    const ro = new ResizeObserver(schedule);
    ro.observe(frame);
    window.addEventListener("resize", schedule);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", schedule);
      if (timer !== null) window.clearTimeout(timer);
    };
  }, []);

  // Auto-expire quotes that have outlived their duration.
  useEffect(() => {
    if (activeQuotes.length === 0) return;
    const tick = window.setInterval(() => {
      const now = performance.now();
      const remaining = activeQuotes.filter((q) => now - q.bornAt < q.durationMs);
      if (remaining.length !== activeQuotes.length) {
        setActiveQuotes(remaining);
      }
    }, 200);
    return () => window.clearInterval(tick);
  }, [activeQuotes]);

  // Cmd (macOS) / Ctrl (others) skips any active quote pause.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      if (quotePauseUntilRef.current > 0 || activeQuotes.length > 0) {
        quotePauseUntilRef.current = 0;
        setActiveQuotes((prev) => (prev.length > 0 ? prev.slice(0, -1) : prev));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activeQuotes.length]);

  const spawnQuoteAt = useCallback((x: number, y: number) => {
    const pool = quotesPoolRef.current;
    if (pool.length === 0) return;
    let available = pool.filter((q) => !usedQuoteIdsRef.current.has(q.id));
    if (available.length === 0) {
      usedQuoteIdsRef.current.clear();
      available = pool;
    }
    const pick = available[Math.floor(Math.random() * available.length)]!;
    usedQuoteIdsRef.current.add(pick.id);
    const durationMs = Math.min(10000, Math.max(4000, 2000 + pick.text.length * 70));
    const q: ActiveQuote = {
      id: idGenRef.current.n++,
      text: pick.text,
      source: pick.source,
      x,
      y,
      bornAt: performance.now(),
      durationMs,
    };
    setActiveQuotes((prev) => [...prev, q]);
    quotePauseUntilRef.current = performance.now() + durationMs;
    // Quote stays visible for the full pause duration, then is removed.
    // The setInterval auto-expire (above) also removes at durationMs, so this
    // is belt-and-braces, but they MUST use the same value or the quote
    // vanishes while the world is still paused.
    window.setTimeout(() => {
      setActiveQuotes((prev) => prev.filter((item) => item.id !== q.id));
    }, durationMs);
  }, []);

  const fireBullet = useCallback(() => {
    const player = playerRef.current;
    const now = performance.now();
    if (now - lastShotRef.current < SHOOT_COOLDOWN_MS) return;
    if (bulletsRef.current.length >= 3) return; // classic limit
    lastShotRef.current = now;
    bulletsRef.current.push({
      x: player.x,
      y: player.y - PLAYER_H / 2,
      vy: -BULLET_SPEED,
      bornAt: now,
    });
    playShootSound();
  }, []);

  const showLevelAnnounce = useCallback((lv: number) => {
    setAnnounceLevel(lv);
    if (announceTimerRef.current !== null) {
      window.clearTimeout(announceTimerRef.current);
    }
    announceTimerRef.current = window.setTimeout(() => {
      setAnnounceLevel(null);
      announceTimerRef.current = null;
    }, LEVEL_ANNOUNCE_MS);
  }, []);

  const spawnWave = useCallback((lv: number) => {
    const view = viewRef.current;
    const { invaders } = makeFormation(view, lv);
    invadersRef.current = invaders;
    barriersRef.current = makeBarriers(view);
    marchDirRef.current = 1;
    lastMarchTsRef.current = 0;
    descendPendingRef.current = false;
    waveClearedRef.current = false;
  }, []);

  const resetWorld = useCallback(() => {
    const view = viewRef.current;
    playerRef.current = {
      x: view.w / 2,
      y: view.h - PLAYER_Y_OFFSET,
      invulnUntil: performance.now() / 1000 + INVULN_SEC,
    };
    bulletsRef.current = [];
    bombsRef.current = [];
    particlesRef.current = [];
    spawnWave(1);
  }, [spawnWave]);

  function spawnExplosion(x: number, y: number, radius: number) {
    if (prefersReducedMotion()) return;
    const count = Math.min(18, Math.round(radius * 0.4));
    for (let i = 0; i < count; i++) {
      const ang = Math.random() * Math.PI * 2;
      const spd = 60 + Math.random() * 120;
      particlesRef.current.push({
        x,
        y,
        vx: Math.cos(ang) * spd,
        vy: Math.sin(ang) * spd,
        life: 0.6,
        maxLife: 0.6,
      });
    }
  }

  const step = useCallback(
    (dt: number) => {
      const now = performance.now();
      const nowSec = now / 1000;
      const keys = keysRef.current;
      const player = playerRef.current;
      const view = viewRef.current;
      const lv = levelRef.current;

      // --- player movement ---
      const left = keys["ArrowLeft"] || keys["a"] || keys["A"];
      const right = keys["ArrowRight"] || keys["d"] || keys["D"];
      const fire = keys[" "];
      if (left) player.x -= PLAYER_SPEED * dt;
      if (right) player.x += PLAYER_SPEED * dt;
      player.x = Math.max(PLAYER_W / 2, Math.min(view.w - PLAYER_W / 2, player.x));
      if (fire) fireBullet();

      // --- bullets (player) ---
      const bullets = bulletsRef.current;
      for (let i = bullets.length - 1; i >= 0; i--) {
        const b = bullets[i]!;
        b.y += b.vy * dt;
        if (b.y < -10) bullets.splice(i, 1);
      }

      // --- bombs (invaders) ---
      const bombs = bombsRef.current;
      for (let i = bombs.length - 1; i >= 0; i--) {
        const bomb = bombs[i]!;
        bomb.y += bomb.vy * dt;
        if (bomb.y > view.h + 10) {
          bombs.splice(i, 1);
          continue;
        }
        // hit player?
        if (
          nowSec > player.invulnUntil &&
          Math.abs(bomb.x - player.x) < PLAYER_W / 2 &&
          Math.abs(bomb.y - player.y) < PLAYER_H / 2
        ) {
          bombs.splice(i, 1);
          onLoseLifeRef.current();
          player.invulnUntil = nowSec + INVULN_SEC;
          spawnExplosion(player.x, player.y, PLAYER_W * 0.6);
          continue;
        }
        // hit barrier?
        for (const bar of barriersRef.current) {
          if (hitBarrier(bar, bomb.x, bomb.y)) {
            bombs.splice(i, 1);
            break;
          }
        }
      }

      // --- invader march ---
      const invaders = invadersRef.current;
      const alive = invaders.filter((iv) => iv.alive);
      if (alive.length > 0) {
        const interval = marchIntervalMs(lv);
        if (lastMarchTsRef.current === 0) lastMarchTsRef.current = now;
        if (now - lastMarchTsRef.current >= interval) {
          lastMarchTsRef.current = now;
          // Determine horizontal bounds of alive invaders.
          let minX = Infinity;
          let maxX = -Infinity;
          for (const iv of alive) {
            if (iv.x < minX) minX = iv.x;
            if (iv.x > maxX) maxX = iv.x;
          }
          const stepX = marchStepX(view.w) * marchDirRef.current;
          let needsDescend = false;
          if (marchDirRef.current === 1 && maxX + stepX + INVADER_W > view.w - 8) {
            needsDescend = true;
          } else if (marchDirRef.current === -1 && minX + stepX < 8) {
            needsDescend = true;
          }
          for (const iv of invaders) {
            if (!iv.alive) continue;
            if (needsDescend) {
              iv.y += MARCH_DESCEND_Y;
            } else {
              iv.x += stepX;
            }
            iv.frame = (iv.frame + 1) % 2;
          }
          if (needsDescend) marchDirRef.current = (marchDirRef.current * -1) as 1 | -1;
        }

        // Invader reaching the bottom = game over (player overwhelmed).
        for (const iv of alive) {
          if (iv.y + INVADER_H >= player.y - PLAYER_H / 2) {
            onGameOverRef.current();
            return;
          }
        }

        // Random bombs from the lowest invader in a random column.
        const chance = bombChancePerFrame(lv) * (dt * 60);
        if (bombs.length < MAX_BOMBS) {
          for (const iv of alive) {
            if (Math.random() < chance) {
              // Only drop if this invader is the lowest in its column.
              const isLowest = alive.every(
                (o) => o.col !== iv.col || o.row <= iv.row,
              );
              if (isLowest) {
                bombsRef.current.push({
                  id: idGenRef.current.n++,
                  x: iv.x,
                  y: iv.y + INVADER_H,
                  vy: BOMB_SPEED,
                });
                break;
              }
            }
          }
        }
      }

      // --- bullet × invader ---
      for (let bi = bullets.length - 1; bi >= 0; bi--) {
        const b = bullets[bi]!;
        for (const iv of invaders) {
          if (!iv.alive) continue;
          if (
            b.x >= iv.x &&
            b.x <= iv.x + INVADER_W &&
            b.y >= iv.y &&
            b.y <= iv.y + INVADER_H
          ) {
            bullets.splice(bi, 1);
            iv.alive = false;
            onScoreRef.current(scoreForKind(iv.kind));
            playExplosionSound();
            spawnExplosion(iv.x + INVADER_W / 2, iv.y + INVADER_H / 2, INVADER_W * 0.6);
            if (Math.random() < QUOTE_CHANCE) {
              spawnQuoteAt(iv.x + INVADER_W / 2, iv.y + INVADER_H / 2);
            }
            break;
          }
        }
        if (bi < bullets.length && bullets[bi] == null) continue;
        // bullet × barrier
        if (bullets[bi!]) {
          for (const bar of barriersRef.current) {
            if (hitBarrier(bar, bullets[bi]!.x, bullets[bi]!.y)) {
              bullets.splice(bi!, 1);
              break;
            }
          }
        }
      }

      // --- particles ---
      const particles = particlesRef.current;
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i]!;
        p.life -= dt;
        if (p.life <= 0) {
          particles.splice(i, 1);
          continue;
        }
        p.x += p.vx * dt;
        p.y += p.vy * dt;
      }

      // --- wave clear → advance, or respawn endless wave at MAX_LEVEL ---
      const anyAlive = invaders.some((iv) => iv.alive);
      if (!anyAlive && !waveClearedRef.current && runningRef.current) {
        waveClearedRef.current = true;
        if (lv < MAX_LEVEL) {
          onLevelUpRef.current();
        } else {
          spawnWave(MAX_LEVEL);
        }
      }
    },
    [fireBullet, spawnQuoteAt, spawnWave],
  );

  const render = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const colors = colorsRef.current;
    const player = playerRef.current;
    const now = performance.now();
    const nowSec = now / 1000;
    const view = viewRef.current;

    ctx.clearRect(0, 0, view.w, view.h);
    ctx.fillStyle = colors.bg;
    ctx.globalAlpha = 0.55;
    ctx.fillRect(0, 0, view.w, view.h);
    ctx.globalAlpha = 1;

    const glow = 10 * colors.glow;

    // --- particles ---
    ctx.strokeStyle = colors.primary;
    ctx.lineWidth = 1.5;
    ctx.shadowBlur = glow * 0.5;
    ctx.shadowColor = colors.primary;
    for (const p of particlesRef.current) {
      const alpha = Math.max(0, p.life / p.maxLife);
      ctx.globalAlpha = alpha;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x - p.vx * 0.02, p.y - p.vy * 0.02);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // --- barriers ---
    ctx.fillStyle = colors.primary;
    ctx.shadowBlur = glow * 0.6;
    ctx.shadowColor = colors.primary;
    for (const bar of barriersRef.current) {
      for (let r = 0; r < bar.rows; r++) {
        for (let c = 0; c < bar.cols; c++) {
          if (!bar.cells[r * bar.cols + c]) continue;
          ctx.fillRect(
            bar.x + c * bar.cellW,
            bar.y + r * bar.cellH,
            bar.cellW,
            bar.cellH,
          );
        }
      }
    }

    // --- invaders ---
    ctx.strokeStyle = colors.primary;
    ctx.fillStyle = colors.bg;
    ctx.lineWidth = 2;
    ctx.shadowBlur = glow;
    ctx.shadowColor = colors.primary;
    ctx.font = '9px "Fira Mono", monospace';
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (const iv of invadersRef.current) {
      if (!iv.alive) continue;
      ctx.save();
      ctx.translate(iv.x + INVADER_W / 2, iv.y + INVADER_H / 2);
      // Pixel-art-ish invader shape (two animation frames).
      drawInvaderSprite(ctx, iv.kind, iv.frame);
      ctx.globalAlpha = 0.12;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.stroke();
      ctx.fillStyle = colors.primary;
      ctx.shadowBlur = glow * 0.3;
      ctx.fillText(iv.label, 0, INVADER_H / 2 + 10);
      ctx.restore();
    }

    // --- bombs ---
    ctx.strokeStyle = colors.accent;
    ctx.lineWidth = 2;
    ctx.shadowBlur = glow;
    ctx.shadowColor = colors.accent;
    for (const bomb of bombsRef.current) {
      ctx.beginPath();
      ctx.moveTo(bomb.x, bomb.y);
      ctx.lineTo(bomb.x, bomb.y - bomb.vy * 0.02);
      ctx.stroke();
    }

    // --- bullets ---
    ctx.strokeStyle = colors.accent;
    ctx.lineWidth = 2.5;
    for (const b of bulletsRef.current) {
      ctx.beginPath();
      ctx.moveTo(b.x, b.y);
      ctx.lineTo(b.x, b.y - b.vy * 0.02);
      ctx.stroke();
    }

    // --- player ship ---
    const invuln = nowSec < player.invulnUntil;
    const blink = invuln ? Math.floor(now / 120) % 2 === 0 : true;
    if (blink) {
      ctx.save();
      ctx.translate(player.x, player.y);
      ctx.strokeStyle = colors.primary;
      ctx.fillStyle = colors.bg;
      ctx.lineWidth = 2;
      ctx.shadowBlur = glow;
      ctx.shadowColor = colors.primary;
      ctx.beginPath();
      ctx.moveTo(0, -PLAYER_H / 2);
      ctx.lineTo(PLAYER_W / 2, PLAYER_H / 2);
      ctx.lineTo(PLAYER_W / 4, PLAYER_H / 4);
      ctx.lineTo(-PLAYER_W / 4, PLAYER_H / 4);
      ctx.lineTo(-PLAYER_W / 2, PLAYER_H / 2);
      ctx.closePath();
      ctx.globalAlpha = invuln ? 0.6 : 1;
      ctx.fill();
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.restore();
    }

    ctx.shadowBlur = 0;
  }, []);

  // Main loop.
  const loop = useCallback(
    (ts: number) => {
      const last = lastTsRef.current || ts;
      const dt = Math.min(0.05, (ts - last) / 1000);
      lastTsRef.current = ts;
      if (quotePauseUntilRef.current > 0 && ts >= quotePauseUntilRef.current) {
        quotePauseUntilRef.current = 0;
      }
      const pausedForQuote = quotePauseUntilRef.current > 0;
      if (runningRef.current && !pausedRef.current && !pausedForQuote) {
        step(dt);
      }
      render();
      rafRef.current = requestAnimationFrame(loop);
    },
    [render, step],
  );

  // Start / stop the world + BGM.
  useEffect(() => {
    if (running) {
      resetWorld();
      lastTsRef.current = 0;
      setActiveQuotes([]);
      usedQuoteIdsRef.current.clear();
      startGameBgm();
    } else {
      stopGameBgm();
      if (announceTimerRef.current !== null) {
        window.clearTimeout(announceTimerRef.current);
        announceTimerRef.current = null;
      }
      setAnnounceLevel(null);
    }
    return () => {
      stopGameBgm();
    };
  }, [running, resetWorld]);

  // rAF lifecycle.
  useEffect(() => {
    rafRef.current = requestAnimationFrame(loop);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, [loop]);

  // Level change during a run → spawn the next wave + announce it.
  useEffect(() => {
    levelRef.current = level;
    if (!runningRef.current) return;
    if (level <= 1) return;
    spawnWave(level);
    showLevelAnnounce(level);
  }, [level, spawnWave, showLevelAnnounce]);

  // Keyboard input.
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (
        e.key === " " ||
        e.key === "ArrowLeft" ||
        e.key === "ArrowRight"
      ) {
        e.preventDefault();
      }
      keysRef.current[e.key] = true;
    };
    const up = (e: KeyboardEvent) => {
      keysRef.current[e.key] = false;
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);

  const setTouchKey = useCallback(
    (key: string, value: boolean) => {
      keysRef.current[key] = value;
      if (value && key === " ") fireBullet();
    },
    [fireBullet],
  );

  const touchBtn = (key: string, label: string, extraClass = "") => (
    <button
      type="button"
      aria-label={label}
      className={`quest-touch-btn ${extraClass}`}
      onPointerDown={(e) => {
        e.preventDefault();
        (e.currentTarget as HTMLButtonElement).setPointerCapture(e.pointerId);
        setTouchKey(key, true);
      }}
      onPointerUp={() => setTouchKey(key, false)}
      onPointerCancel={() => setTouchKey(key, false)}
      onPointerLeave={() => setTouchKey(key, false)}
    >
      {label}
    </button>
  );

  return (
    <div className="quest-canvas-wrap">
      <div className="quest-canvas-frame" ref={frameRef}>
        <canvas
          ref={canvasRef}
          width={viewSize.w}
          height={viewSize.h}
          className="quest-canvas"
          aria-label="Designer's Quest — Invaders game canvas"
        />

        {!isMobile && (
          <div className="quest-controls" aria-hidden="true">
            <span className="quest-controls__key">MOVE</span>
            <span className="quest-controls__act">A/D · ←→</span>
            <span className="quest-controls__key">FIRE</span>
            <span className="quest-controls__act">SPACE</span>
            <span className="quest-controls__key">PAUSE</span>
            <span className="quest-controls__act">P · ESC</span>
          </div>
        )}

        {announceLevel !== null && (
          <div className="quest-level-announce" key={announceLevel}>
            <span className="quest-level-announce__label">LEVEL</span>
            <span className="quest-level-announce__num">{announceLevel}</span>
          </div>
        )}

        {activeQuotes.map((q) => {
          const left = `${(q.x / viewSize.w) * 100}%`;
          const top = `${(q.y / viewSize.h) * 100}%`;
          return (
            <div
              key={q.id}
              className="quest-quote-pop quest-quote-pop--paused"
              style={
                {
                  left,
                  top,
                  "--quote-duration": `${q.durationMs}ms`,
                } as React.CSSProperties
              }
              aria-live="polite"
            >
              <p className="quest-quote-pop__text">{q.text}</p>
              <p className="quest-quote-pop__src">— {q.source}</p>
              <div className="quest-quote-pop__progress" aria-hidden>
                <span className="quest-quote-pop__progress-bar" />
              </div>
              <p className="quest-quote-pop__skip">
                <kbd>⌘</kbd> / <kbd>Ctrl</kbd> to resume
              </p>
            </div>
          );
        })}
      </div>

      {isMobile && (
        <div className="quest-touch-pad" aria-label="Touch controls">
          {touchBtn("ArrowLeft", "←")}
          {touchBtn("ArrowRight", "→")}
          {touchBtn(" ", "FIRE")}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function hitBarrier(bar: Barrier, x: number, y: number): boolean {
  if (
    x < bar.x ||
    x > bar.x + bar.cols * bar.cellW ||
    y < bar.y ||
    y > bar.y + bar.rows * bar.cellH
  ) {
    return false;
  }
  const cx = Math.floor((x - bar.x) / bar.cellW);
  const cy = Math.floor((y - bar.y) / bar.cellH);
  const idx = cy * bar.cols + cx;
  if (idx >= 0 && idx < bar.cells.length && bar.cells[idx]) {
    // Damage in a small plus-pattern so hits erode the barrier naturally.
    bar.cells[idx] = false;
    if (cx > 0) bar.cells[cy * bar.cols + (cx - 1)] = false;
    if (cx < bar.cols - 1) bar.cells[cy * bar.cols + (cx + 1)] = false;
    if (cy > 0) bar.cells[(cy - 1) * bar.cols + cx] = false;
    if (cy < bar.rows - 1) bar.cells[(cy + 1) * bar.cols + cx] = false;
    return true;
  }
  return false;
}

/**
 * Draw a pixel-art invader sprite centred at (0,0). Three kinds map to the
 * classic three rows. `frame` toggles the leg/tentacle animation.
 */
function drawInvaderSprite(
  ctx: CanvasRenderingContext2D,
  kind: Invader["kind"],
  frame: number,
) {
  const unit = 3;
  const w = INVADER_W;
  const h = INVADER_H;
  const cols = Math.floor(w / unit);
  const rows = Math.floor(h / unit);
  const ox = -(cols * unit) / 2;
  const oy = -(rows * unit) / 2;

  // Pick a sprite mask based on row kind + frame.
  let mask: string[];
  if (kind === "back") {
    mask = frame === 0 ? SPRITE_BACK_A : SPRITE_BACK_B;
  } else if (kind === "mid") {
    mask = frame === 0 ? SPRITE_MID_A : SPRITE_MID_B;
  } else {
    mask = frame === 0 ? SPRITE_FRONT_A : SPRITE_FRONT_B;
  }

  ctx.beginPath();
  for (let r = 0; r < mask.length && r < rows; r++) {
    const row = mask[r]!;
    for (let c = 0; c < row.length && c < cols; c++) {
      if (row[c] === "X") {
        ctx.rect(ox + c * unit, oy + r * unit, unit, unit);
      }
    }
  }
}

// Pixel-art masks (mirrored horizontally). Each is 8 wide so it tiles cleanly
// into the 28px invader width at unit=3 (8*3=24, centred with 2px pad each side).
const SPRITE_BACK_A = [
  "  XXXX  ",
  " XXXXXX ",
  "XXXXXXXX",
  "XX XX XX",
  "XXXXXXXX",
  " X X X X",
  "X X  X X",
  " X    X ",
];
const SPRITE_BACK_B = [
  "  XXXX  ",
  " XXXXXX ",
  "XXXXXXXX",
  "XX XX XX",
  "XXXXXXXX",
  " X X X X",
  "X  X X X",
  "X X    X",
];
const SPRITE_MID_A = [
  "   XX   ",
  "  XXXX  ",
  " XXXXXX ",
  "XX XX XX",
  "XXXXXXXX",
  " X X X X",
  "  X  X  ",
  " X    X ",
];
const SPRITE_MID_B = [
  "   XX   ",
  "  XXXX  ",
  " XXXXXX ",
  "XX XX XX",
  "XXXXXXXX",
  " X X X X",
  "X X  X X",
  "X      X",
];
const SPRITE_FRONT_A = [
  "  X  X  ",
  "X  XX  X",
  "X XXXX X",
  "XXX XX XX".slice(0, 8),
  "XXXXXXXX",
  " XX  XX ",
  "XX    XX",
  "X      X",
];
const SPRITE_FRONT_B = [
  "  X  X  ",
  "X  XX  X",
  "X XXXX X",
  "XXX XX XX".slice(0, 8),
  "XXXXXXXX",
  "  X  X  ",
  " X XX X ",
  "X X  X X",
];
