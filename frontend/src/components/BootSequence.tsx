import { useEffect, useMemo, useRef, useState } from "react";
import { playBootSound, initAudio } from "../lib/audio";
import { themeLabel } from "../lib/themes";
import type { ThemeId } from "../types";

// ---------------------------------------------------------------------------
// ASCII-Boot overlay. Four phases over ~3s: CRT power-on → BIOS POST text →
// ASCII logo decode → fade out. Skippable by key / click / button. Honors
// prefers-reduced-motion (everything static, ~500ms total).
// ---------------------------------------------------------------------------

const BOOTED_KEY = "cme_exe_booted";
const THEME_KEY = "cme_exe_theme";

// BIOS POST lines. The two {var} lines are filled at render time.
// BIOS lines mapped to modem-handshake phases. The `{anthropic}` and `{theme}`
// placeholders are interpolated at render time. Each entry has a `at` offset
// (ms from handshake start) used to sync line reveal with the matching sound.
// Sound phase reference (see playModemHandshake):
//   0.30s ring | 1.30s CED | 3.0s training A | 3.6s noise | 4.0s sweep
//   4.5s burst C | 5.1s final confirm | 5.5s CONNECT
interface BiosLine {
  text: string;
  /** Reveal offset from handshake start (ms). */
  at: number;
}

const BIOS_LINES_BASE: readonly BiosLine[] = [
  { text: "CME.EXE v0.1.0 — AI × DESIGN LAB", at: 0 },
  { text: "(C) 2026 CLAUS MEDVESEK. ALL RIGHTS RESERVED.", at: 200 },
  { text: "", at: 400 },
  { text: "INITIALIZING MODEM........... CME-56K", at: 450 },
  // Ring-back phase (synced to the two 440+480 Hz chords).
  { text: "DIALING 555-2300............. RING", at: 500 },
  { text: "RING......................... 440+480 HZ", at: 1100 },
  // CED answer tone (synced to 2100 Hz at 2.1s).
  { text: "CARRIER DETECTED............. 2100 HZ", at: 2150 },
  // Training plinks phase begins at 3.1s.
  { text: "HANDSHAKE.................... TRAINING", at: 2750 },
  { text: "PROBE A...................... 1850 HZ", at: 3150 },
  { text: "PROBE B...................... 2250 HZ", at: 3350 },
  { text: "PROBE C...................... 2400 HZ", at: 3550 },
  { text: "PROBE D...................... 1650 HZ", at: 3750 },
  // Rate negotiation chirp at 4.5s.
  { text: "RATE NEGOTIATION............. 2600-600", at: 4350 },
  { text: "PROTOCOL..................... V.90", at: 4900 },
  // Final connect at 5.4s.
  { text: "CONNECT...................... 56000 BPS", at: 5400 },
  { text: "", at: 5700 },
  { text: "LOADING THE OBSERVER......... OK", at: 5850 },
  { text: "LOADING THE MACHINE.......... OK", at: 6000 },
  { text: "LOADING THE CURATOR.......... OK", at: 6150 },
  { text: "ANTHROPIC LINK............... {anthropic}", at: 6350 },
  { text: "THEME........................ {theme}", at: 6550 },
  { text: "", at: 6700 },
  { text: "PRESS ANY KEY TO ENTER", at: 6850 },
] as const;

// ASCII wordmark. Decoded Matrix-style in Phase 3.
const LOGO_LINES = [
  "  ____  ____ ___  ____   ___   ____   ___   __   _  ",
  " / ___||  _ \\_ _|  _ \\ / _ \\ / ___| / _ \\ / /  / | ",
  " | |   | |_) | || |_) | | | | |  _ | | | |/ /   | | ",
  " | |___|  __/| ||  _ <| |_| | |_| || |_| / /    | | ",
  " \\____||_|  |___|_| \\_\\\\___/ \\____| \\___/_/     |_| ",
] as const;

const DECODE_CHARS =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789@#$%&*<>/\\|=+-";

const PHASE_DURATIONS = {
  // Power-on flash + pickup before first ring at 0.45s.
  power: 450,
  // BIOS reveal completes at the last line's `at` (~6850ms) + small buffer.
  bios: 7100,
  // ASCII logo decode while "CONNECT 56000" settles in.
  decode: 600,
  fade: 250,
} as const;

const REDUCED_TOTAL_MS = 500;

interface BootSequenceProps {
  onDone: () => void;
}

function readThemeLabel(): string {
  try {
    const stored = localStorage.getItem(THEME_KEY);
    if (stored) return themeLabel(stored as ThemeId).toUpperCase();
  } catch {
    /* ignore */
  }
  return "VECTOR-GREEN";
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

export default function BootSequence({ onDone }: BootSequenceProps) {
  const reduced = useMemo(prefersReducedMotion, []);
  const [phase, setPhase] = useState<1 | 2 | 3 | 4>(reduced ? 2 : 1);
  const [biosVisibleLines, setBiosVisibleLines] = useState<number>(
    reduced ? BIOS_LINES_BASE.length : 0,
  );
  const [anthropic, setAnthropic] = useState<boolean | null>(null);
  const doneCalledRef = useRef(false);

  const themeLabelUpper = useMemo(readThemeLabel, []);

  const biosLines = useMemo(() => {
    const link = anthropic === null ? "..." : anthropic ? "[HYBRID ACTIVE]" : "[VISITOR KEY REQUIRED]";
    return BIOS_LINES_BASE.map((l) =>
      l.text
        .replace("{anthropic}", link)
        .replace("{theme}", themeLabelUpper),
    );
  }, [anthropic, themeLabelUpper]);

  // Probe health once for the ANTHROPIC LINK line.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/health")
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { anthropic?: boolean } | null) => {
        if (cancelled) return;
        setAnthropic(Boolean(data && data.anthropic));
      })
      .catch(() => {
        if (!cancelled) setAnthropic(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Fire the CRT boot sound at phase 1.
  useEffect(() => {
    if (phase === 1 && !reduced) playBootSound();
  }, [phase, reduced]);

  // Phase sequencing.
  useEffect(() => {
    if (reduced) {
      // Reduced-motion: show everything immediately, short hold, fade.
      const t = window.setTimeout(() => setPhase(4), REDUCED_TOTAL_MS - PHASE_DURATIONS.fade);
      return () => window.clearTimeout(t);
    }
    if (phase === 1) {
      const t = window.setTimeout(() => setPhase(2), PHASE_DURATIONS.power);
      return () => window.clearTimeout(t);
    }
    if (phase === 2) {
      // Reveal BIOS lines at their modem-synced `at` offsets. Each line appears
      // in lockstep with the matching handshake phase (ring / CED / training /
      // sweep / connect) so the screen choreography matches the sound.
      const timers: number[] = [];
      BIOS_LINES_BASE.forEach((line, idx) => {
        // Always show at least the first line immediately; others wait.
        const delay = Math.max(0, line.at);
        const tid = window.setTimeout(() => {
          setBiosVisibleLines(idx + 1);
        }, delay);
        timers.push(tid);
      });
      // After the final line appears, hold briefly then advance.
      const finalAt = BIOS_LINES_BASE[BIOS_LINES_BASE.length - 1]!.at;
      const advance = window.setTimeout(
        () => setPhase(3),
        finalAt + 300,
      );
      timers.push(advance);
      return () => {
        timers.forEach((t) => window.clearTimeout(t));
      };
    }
    if (phase === 3) {
      const t = window.setTimeout(() => setPhase(4), PHASE_DURATIONS.decode);
      return () => window.clearTimeout(t);
    }
    // phase === 4
    const t = window.setTimeout(() => {
      if (!doneCalledRef.current) {
        doneCalledRef.current = true;
        onDone();
      }
    }, PHASE_DURATIONS.fade);
    return () => window.clearTimeout(t);
  }, [phase, reduced, onDone]);

  // Skip: any of these drops us straight to phase 4.
  useEffect(() => {
    const skip = () => {
      setBiosVisibleLines(BIOS_LINES_BASE.length);
      setPhase(4);
    };
    const onKey = (e: KeyboardEvent) => {
      // Don't trap the key — just listen.
      e.preventDefault();
      skip();
    };
    const onPointer = () => { initAudio().catch(() => {}); skip(); };
    window.addEventListener("keydown", onKey, { once: true });
    window.addEventListener("pointerdown", onPointer, {
      once: true,
      capture: true,
    });
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onPointer, { capture: true } as AddEventListenerOptions);
    };
  }, []);

  // Persist the booted flag on completion (caller decides bootMode; this flag
  // gates first-visit replay only).
  useEffect(() => {
    if (phase === 4 && !doneCalledRef.current) {
      try {
        localStorage.setItem(BOOTED_KEY, "1");
      } catch {
        /* ignore */
      }
    }
  }, [phase]);

  const overlayClass =
    phase === 4
      ? "boot-overlay boot-overlay--fadeout"
      : phase === 1
        ? "boot-overlay boot-overlay--flash"
        : "boot-overlay";

  return (
    <div className={overlayClass} role="alertdialog" aria-label="Booting CME.exe">
      {/* CRT bezel / scanlines / vignette are part of the overlay so the
          boot reads as a self-contained CRT regardless of theme layering. */}
      <div className="boot-crt" aria-hidden>
        <div className="boot-crt__scanlines" />
        <div className="boot-crt__vignette" />
        {phase === 1 && !reduced && <div className="boot-flash" />}
      </div>

      <div className="boot-content">
        {/* BIOS text — phases 2/3/4. Under reduced-motion we render all lines
            immediately (handled by initial state). */}
        {phase >= 2 && (
          <pre className="boot-bios" aria-live="polite">
            {biosLines.slice(0, biosVisibleLines).join("\n")}
            <span className="boot-bios__caret" aria-hidden>█</span>
          </pre>
        )}

        {/* Logo decode — phase 3 only. Under reduced-motion we skip the
            animated decode and show the final logo statically instead. */}
        {phase === 3 && !reduced && <BootLogo />}
        {reduced && phase >= 2 && <BootLogoStatic />}
      </div>

      <button
        type="button"
        className="boot-skip"
        onClick={() => {
          setBiosVisibleLines(BIOS_LINES_BASE.length);
          setPhase(4);
        }}
      >
        SKIP ▶
      </button>
    </div>
  );
}

/**
 * Static final logo, no decode. Used under prefers-reduced-motion.
 */
function BootLogoStatic() {
  return (
    <pre className="boot-logo" aria-label="CME.exe">
      {LOGO_LINES.map((line, r) => (
        <span key={r} className="boot-logo__char--final">
          {line + "\n"}
        </span>
      ))}
    </pre>
  );
}

/**
 * Matrix-style logo: each character position starts as a random glyph and
 * settles to its final value at a per-position time across ~700ms.
 */
function BootLogo() {
  const [tick, setTick] = useState(0);
  const settle = useMemo(() => {
    // Per-position settle time (0..1 fraction of the decode window).
    const out: number[] = [];
    for (let r = 0; r < LOGO_LINES.length; r++) {
      for (let c = 0; c < LOGO_LINES[0]!.length; c++) {
        out.push(Math.random());
      }
    }
    return out;
  }, []);

  useEffect(() => {
    let raf = 0;
    let start = 0;
    const loop = (ts: number) => {
      if (!start) start = ts;
      setTick(Math.min(1, (ts - start) / PHASE_DURATIONS.decode));
      if (ts - start < PHASE_DURATIONS.decode) {
        raf = requestAnimationFrame(loop);
      }
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  const cols = LOGO_LINES[0]!.length;
  const now = performance.now();

  return (
    <pre className="boot-logo" aria-label="CME.exe">
      {LOGO_LINES.map((line, r) =>
        Array.from(line).map((ch, c) => {
          const idx = r * cols + c;
          const settled = tick >= settle[idx]!;
          // Spaces always render as spaces.
          if (ch === " ") return <span key={`${r}-${c}`}>{" "}</span>;
          if (settled) {
            return (
              <span key={`${r}-${c}`} className="boot-logo__char--final">
                {ch}
              </span>
            );
          }
          const rand = DECODE_CHARS[Math.floor(now / 40 + idx) % DECODE_CHARS.length]!;
          return (
            <span key={`${r}-${c}`} className="boot-logo__char--rand">
              {rand}
            </span>
          );
        }),
      )}
    </pre>
  );
}
