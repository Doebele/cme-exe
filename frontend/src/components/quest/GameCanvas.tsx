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
// Designer's Quest — Asteroids on a pure <canvas>.
//
// The canvas resolution tracks the rendered frame size (ResizeObserver), so
// physics operate in CSS-pixel logical units and stay crisp at any viewport.
// Entity state lives in refs (mutated per-frame by the rAF loop); only
// HUD-relevant events (score, lives, game-over, level-up, quote popups) bubble
// up to React state. Difficulty scales with `level` (1–6): more asteroids,
// faster drift, wilder spin each wave.
// ---------------------------------------------------------------------------

const SHIP_RADIUS = 14;
const BULLET_LIFE_SEC = 1.0;
const BULLET_SPEED = 520;
const SHOOT_COOLDOWN_MS = 200;
const INVULN_SEC = 1.5;
const THRUST_FORCE = 320;
const ROTATE_SPEED = 3.4; // rad/s
const FRICTION = 0.99;
const MAX_SPEED = 460;
const LARGE_R = 46;
const MEDIUM_R = 26;
const SMALL_R = 14;
const LARGE_SCORE = 20;
const MEDIUM_SCORE = 50;
const SMALL_SCORE = 100;
const BASE_SPEED = 22;
const LEVEL_ANNOUNCE_MS = 1500;
const QUOTE_CHANCE = 0.3;

type AsteroidSize = "large" | "medium" | "small";

interface ViewSize {
  w: number;
  h: number;
}

interface Ship {
  x: number;
  y: number;
  vx: number;
  vy: number;
  rot: number;
  invulnUntil: number;
}

interface Bullet {
  x: number;
  y: number;
  vx: number;
  vy: number;
  bornAt: number;
}

interface Asteroid {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  rot: number;
  spin: number;
  size: AsteroidSize;
  radius: number;
  verts: number[];
  label: string;
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

const ASTEROID_LABELS = [
  "Stakeholder",
  "Scope Creep",
  "Tech Debt",
  "Legacy Code",
  "Migration Risk",
  "Accessibility Debt",
  "Performance Issue",
  "Browser Compat",
] as const;

// First-paint fallback before the ResizeObserver reports the real frame size.
const INITIAL_VIEW: ViewSize = { w: 800, h: 480 };

function initialCountFor(level: number): number {
  return 1 + level;
}

function maxAsteroidsFor(level: number): number {
  return 2 + level;
}

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

function radiusFor(size: AsteroidSize): number {
  switch (size) {
    case "large":
      return LARGE_R;
    case "medium":
      return MEDIUM_R;
    case "small":
      return SMALL_R;
  }
}

function scoreFor(size: AsteroidSize): number {
  switch (size) {
    case "large":
      return LARGE_SCORE;
    case "medium":
      return MEDIUM_SCORE;
    case "small":
      return SMALL_SCORE;
  }
}

function randomLabel(): string {
  return ASTEROID_LABELS[Math.floor(Math.random() * ASTEROID_LABELS.length)]!;
}

function makeAsteroid(
  idGen: { n: number },
  size: AsteroidSize,
  view: ViewSize,
  level: number,
  x?: number,
  y?: number,
): Asteroid {
  const radius = radiusFor(size);
  // Spawn at a screen edge if no position given, and never on top of the ship.
  let px = x;
  let py = y;
  if (px === undefined || py === undefined) {
    const edge = Math.floor(Math.random() * 4);
    if (edge === 0) {
      px = Math.random() * view.w;
      py = -radius;
    } else if (edge === 1) {
      px = view.w + radius;
      py = Math.random() * view.h;
    } else if (edge === 2) {
      px = Math.random() * view.w;
      py = view.h + radius;
    } else {
      px = -radius;
      py = Math.random() * view.h;
    }
  }

  // Drift roughly toward the center so asteroids actually cross the play area.
  const cx = view.w / 2;
  const cy = view.h / 2;
  const angle = Math.atan2(cy - py!, cx - px!) + (Math.random() - 0.5) * 0.8;
  // Speed floor + ceiling both scale with level: L1 gentle (34–80), L6 fierce.
  const speedMin = BASE_SPEED + level * 12;
  const speedMax = BASE_SPEED + 40 + level * 18;
  const speed = speedMin + Math.random() * (speedMax - speedMin);

  const vertCount = 6 + Math.floor(Math.random() * 5); // 6–10
  const verts: number[] = [];
  for (let i = 0; i < vertCount; i++) {
    verts.push(0.75 + Math.random() * 0.5);
  }

  const reduced = prefersReducedMotion();
  const spinScale = 1 + level * 0.1;
  return {
    id: idGen.n++,
    x: px!,
    y: py!,
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed,
    rot: Math.random() * Math.PI * 2,
    spin: reduced ? 0 : (Math.random() - 0.5) * 1.2 * spinScale,
    size,
    radius,
    verts,
    label: randomLabel(),
  };
}

function wrap(value: number, max: number): number {
  if (value < 0) return value + max;
  if (value >= max) return value - max;
  return value;
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

export default function GameCanvas({
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

  // --- live game state in refs (mutated per-frame) ---
  const shipRef = useRef<Ship>({
    x: INITIAL_VIEW.w / 2,
    y: INITIAL_VIEW.h / 2,
    vx: 0,
    vy: 0,
    rot: -Math.PI / 2,
    invulnUntil: 0,
  });
  const bulletsRef = useRef<Bullet[]>([]);
  const asteroidsRef = useRef<Asteroid[]>([]);
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
  const waveClearedRef = useRef(false);
  // When > 0 (in performance.now() ms), the world is paused while a quote is shown.
  const quotePauseUntilRef = useRef(0);
  const onScoreRef = useRef(onScore);
  const onLoseLifeRef = useRef(onLoseLife);
  const onGameOverRef = useRef(onGameOver);
  const onLevelUpRef = useRef(onLevelUp);

  // --- React state: low-frequency UI only ---
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

  // Sync the canvas backing-store resolution to the rendered frame size so the
  // physics space maps 1:1 to CSS pixels. Debounced on resize.
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

  // Auto-expire quotes that have outlived their duration. Also clears the pause
  // (the loop already does this on its own, but this keeps React state coherent).
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

  // Cmd (macOS) / Ctrl (others) skips any active quote pause + dismisses the
  // oldest quote. Hits during normal play are ignored.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      // Skip the pause + drop the most recent quote.
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
    // Duration scales with quote length: ~70ms per char + 2s base, capped 4-10s.
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
    // Pause world while the quote is on screen.
    quotePauseUntilRef.current = performance.now() + durationMs;
    // Quote stays visible for the full pause duration; the world resumes when
    // the pause ends. The auto-expire interval also uses durationMs.
    window.setTimeout(() => {
      setActiveQuotes((prev) => prev.filter((item) => item.id !== q.id));
    }, durationMs);
  }, []);

  const fireBullet = useCallback(() => {
    const ship = shipRef.current;
    const now = performance.now();
    if (now - lastShotRef.current < SHOOT_COOLDOWN_MS) return;
    lastShotRef.current = now;
    bulletsRef.current.push({
      x: ship.x + Math.cos(ship.rot) * SHIP_RADIUS,
      y: ship.y + Math.sin(ship.rot) * SHIP_RADIUS,
      vx: ship.vx + Math.cos(ship.rot) * BULLET_SPEED,
      vy: ship.vy + Math.sin(ship.rot) * BULLET_SPEED,
      bornAt: now,
    });
    playShootSound();
  }, []);

  const spawnWave = useCallback((lv: number) => {
    const view = viewRef.current;
    asteroidsRef.current = [];
    waveClearedRef.current = false;
    const count = initialCountFor(lv);
    for (let i = 0; i < count; i++) {
      asteroidsRef.current.push(
        makeAsteroid(idGenRef.current, "large", view, lv),
      );
    }
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

  const resetWorld = useCallback(() => {
    const view = viewRef.current;
    shipRef.current = {
      x: view.w / 2,
      y: view.h / 2,
      vx: 0,
      vy: 0,
      rot: -Math.PI / 2,
      invulnUntil: performance.now() / 1000 + INVULN_SEC,
    };
    bulletsRef.current = [];
    particlesRef.current = [];
    spawnWave(1);
  }, [spawnWave]);

  const step = useCallback(
    (dt: number) => {
      const now = performance.now();
      const nowSec = now / 1000;
      const keys = keysRef.current;
      const ship = shipRef.current;
      const view = viewRef.current;
      const reduced = prefersReducedMotion();
      const lv = levelRef.current;

      // --- ship rotation + thrust ---
      const left = keys["ArrowLeft"] || keys["a"] || keys["A"];
      const right = keys["ArrowRight"] || keys["d"] || keys["D"];
      const thrust = keys["ArrowUp"] || keys["w"] || keys["W"];
      const fire = keys[" "];
      if (left) ship.rot -= ROTATE_SPEED * dt;
      if (right) ship.rot += ROTATE_SPEED * dt;
      if (thrust) {
        ship.vx += Math.cos(ship.rot) * THRUST_FORCE * dt;
        ship.vy += Math.sin(ship.rot) * THRUST_FORCE * dt;
        // Thrust particles — skipped under reduced-motion.
        if (!reduced && particlesRef.current.length < 80) {
          const back = ship.rot + Math.PI;
          particlesRef.current.push({
            x: ship.x + Math.cos(back) * SHIP_RADIUS,
            y: ship.y + Math.sin(back) * SHIP_RADIUS,
            vx: Math.cos(back) * 90 + (Math.random() - 0.5) * 30,
            vy: Math.sin(back) * 90 + (Math.random() - 0.5) * 30,
            life: 0.4,
            maxLife: 0.4,
          });
        }
      }
      if (fire) fireBullet();

      // Friction + speed clamp.
      ship.vx *= FRICTION;
      ship.vy *= FRICTION;
      const speed = Math.hypot(ship.vx, ship.vy);
      if (speed > MAX_SPEED) {
        ship.vx = (ship.vx / speed) * MAX_SPEED;
        ship.vy = (ship.vy / speed) * MAX_SPEED;
      }
      ship.x = wrap(ship.x + ship.vx * dt, view.w);
      ship.y = wrap(ship.y + ship.vy * dt, view.h);

      // --- bullets ---
      const bullets = bulletsRef.current;
      for (let i = bullets.length - 1; i >= 0; i--) {
        const b = bullets[i]!;
        b.x = wrap(b.x + b.vx * dt, view.w);
        b.y = wrap(b.y + b.vy * dt, view.h);
        if (nowSec - b.bornAt / 1000 > BULLET_LIFE_SEC) {
          bullets.splice(i, 1);
        }
      }

      // --- asteroids ---
      const asteroids = asteroidsRef.current;
      for (const a of asteroids) {
        a.x = wrap(a.x + a.vx * dt, view.w);
        a.y = wrap(a.y + a.vy * dt, view.h);
        a.rot += a.spin * dt;
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

      // --- bullet × asteroid ---
      // Split children are capped by the level's max-simultaneous budget so the
      // field can't explode past `2 + level`.
      const maxCount = maxAsteroidsFor(lv);
      for (let bi = bullets.length - 1; bi >= 0; bi--) {
        const b = bullets[bi]!;
        for (let ai = asteroids.length - 1; ai >= 0; ai--) {
          const a = asteroids[ai]!;
          const d = Math.hypot(b.x - a.x, b.y - a.y);
          if (d <= a.radius) {
            bullets.splice(bi, 1);
            asteroids.splice(ai, 1);
            onScoreRef.current(scoreFor(a.size));
            playExplosionSound();
            spawnExplosion(a.x, a.y, a.radius);
            if (a.size === "large" || a.size === "medium") {
              const childSize: AsteroidSize =
                a.size === "large" ? "medium" : "small";
              const room = Math.max(0, maxCount - asteroids.length);
              const kids = Math.min(2, room);
              for (let k = 0; k < kids; k++) {
                asteroids.push(
                  makeAsteroid(
                    idGenRef.current,
                    childSize,
                    view,
                    lv,
                    a.x,
                    a.y,
                  ),
                );
              }
            } else if (Math.random() < QUOTE_CHANCE) {
              // small destroyed → maybe drop a designer's note.
              spawnQuoteAt(a.x, a.y);
            }
            break;
          }
        }
      }

      // --- ship × asteroid ---
      if (nowSec > ship.invulnUntil) {
        for (const a of asteroids) {
          const d = Math.hypot(ship.x - a.x, ship.y - a.y);
          if (d <= a.radius + SHIP_RADIUS * 0.7) {
            onLoseLifeRef.current();
            ship.invulnUntil = nowSec + INVULN_SEC;
            spawnExplosion(ship.x, ship.y, SHIP_RADIUS * 1.4);
            break;
          }
        }
      }

      // --- wave clear → advance, or respawn endless wave at MAX_LEVEL ---
      if (
        asteroids.length === 0 &&
        !waveClearedRef.current &&
        runningRef.current
      ) {
        waveClearedRef.current = true;
        if (lv < MAX_LEVEL) {
          onLevelUpRef.current();
        } else {
          spawnWave(MAX_LEVEL);
          waveClearedRef.current = false;
        }
      }
    },
    [fireBullet, spawnQuoteAt, spawnWave],
  );

  // spawnExplosion helper kept outside `step` to avoid re-creating the cb.
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

  const render = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const colors = colorsRef.current;
    const ship = shipRef.current;
    const now = performance.now();
    const nowSec = now / 1000;
    const view = viewRef.current;

    ctx.clearRect(0, 0, view.w, view.h);
    // Subtle backdrop so glow reads against any theme.
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

    // --- asteroids ---
    ctx.strokeStyle = colors.primary;
    ctx.fillStyle = colors.bg;
    ctx.lineWidth = 2;
    ctx.shadowBlur = glow;
    ctx.shadowColor = colors.primary;
    for (const a of asteroidsRef.current) {
      ctx.save();
      ctx.translate(a.x, a.y);
      ctx.rotate(a.rot);
      ctx.beginPath();
      const n = a.verts.length;
      for (let i = 0; i < n; i++) {
        const ang = (i / n) * Math.PI * 2;
        const r = a.radius * a.verts[i]!;
        const px = Math.cos(ang) * r;
        const py = Math.sin(ang) * r;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.globalAlpha = 0.12;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.stroke();
      // Label rotates with the asteroid; counter-spin the text only for medium/
      // large so it stays readable. Contract says rotated with the asteroid.
      ctx.font = `${a.size === "small" ? 9 : 11}px "Fira Mono", monospace`;
      ctx.fillStyle = colors.primary;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.shadowBlur = glow * 0.4;
      ctx.fillText(a.label, 0, 0);
      ctx.restore();
    }

    // --- bullets ---
    ctx.strokeStyle = colors.accent;
    ctx.lineWidth = 2.5;
    ctx.shadowBlur = glow;
    ctx.shadowColor = colors.accent;
    for (const b of bulletsRef.current) {
      ctx.beginPath();
      ctx.moveTo(b.x, b.y);
      ctx.lineTo(b.x - b.vx * 0.02, b.y - b.vy * 0.02);
      ctx.stroke();
    }

    // --- ship (blink during invulnerability) ---
    const invuln = nowSec < ship.invulnUntil;
    const blink = invuln ? Math.floor(now / 120) % 2 === 0 : true;
    if (blink) {
      ctx.save();
      ctx.translate(ship.x, ship.y);
      ctx.rotate(ship.rot);
      ctx.strokeStyle = colors.primary;
      ctx.fillStyle = colors.bg;
      ctx.lineWidth = 2;
      ctx.shadowBlur = glow;
      ctx.shadowColor = colors.primary;
      ctx.beginPath();
      ctx.moveTo(SHIP_RADIUS, 0);
      ctx.lineTo(-SHIP_RADIUS * 0.7, SHIP_RADIUS * 0.7);
      ctx.lineTo(-SHIP_RADIUS * 0.4, 0);
      ctx.lineTo(-SHIP_RADIUS * 0.7, -SHIP_RADIUS * 0.7);
      ctx.closePath();
      ctx.globalAlpha = invuln ? 0.6 : 1;
      ctx.fill();
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.restore();
    }

    ctx.shadowBlur = 0;
  }, []);

  // Main loop — started/stopped by the `running` effect below.
  const loop = useCallback(
    (ts: number) => {
      const last = lastTsRef.current || ts;
      const dt = Math.min(0.05, (ts - last) / 1000);
      lastTsRef.current = ts;
      // Auto-clear expired quote pause so the world resumes seamlessly.
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

  // Start / stop the world + BGM based on `running`.
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

  // rAF lifecycle: run continuously while mounted, physics gated by flags.
  useEffect(() => {
    rafRef.current = requestAnimationFrame(loop);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, [loop]);

  // Level change during a run → spawn the next wave + announce it.
  // Level 1 is skipped: resetWorld already spawned it when the run started.
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
        e.key === "ArrowUp" ||
        e.key === "ArrowDown" ||
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

  // Helper for touch buttons: set/clear logical keys.
  const setTouchKey = useCallback(
    (key: string, value: boolean) => {
      keysRef.current[key] = value;
      if (value && key === " ") fireBullet();
    },
    [fireBullet],
  );

  // Touch button press handlers (press-and-hold via pointer events).
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
          aria-label="Designer's Quest game canvas"
        />

        {!isMobile && (
          <div className="quest-controls" aria-hidden="true">
            <span className="quest-controls__key">ROTATE</span>
            <span className="quest-controls__act">A/D · ←→</span>
            <span className="quest-controls__key">THRUST</span>
            <span className="quest-controls__act">W · ↑</span>
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
          {touchBtn("ArrowUp", "THRUST")}
          {touchBtn(" ", "FIRE")}
        </div>
      )}
    </div>
  );
}
