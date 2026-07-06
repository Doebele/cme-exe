import { useEffect, useRef, useState } from "react";
import GameCanvas from "../components/quest/GameCanvas";
import InvadersCanvas from "../components/quest/InvadersCanvas";
import { useAsteroids } from "../hooks/useAsteroids";
import type { DesignQuote } from "../types";

// ---------------------------------------------------------------------------
// Designer's Quest — playable Easter egg. Player shoots design problems; a
// fraction of kills surface a designer's micro-quote. The admin can switch
// the play style between Asteroids (free-roaming original) and Space Invaders
// (marching formation homage) via settings.behavior.gameVariant.
// ---------------------------------------------------------------------------

type GameVariant = "asteroids" | "invaders";

let cachedGameVariant: GameVariant | null = null;
let gameVariantPromise: Promise<GameVariant> | null = null;

function fetchGameVariant(): Promise<GameVariant> {
  if (cachedGameVariant) return Promise.resolve(cachedGameVariant);
  if (gameVariantPromise) return gameVariantPromise;
  gameVariantPromise = fetch("/api/content/settings")
    .then((r) => (r.ok ? r.json() : null))
    .then((data: { behavior?: { gameVariant?: GameVariant } } | null) => {
      const v = data?.behavior?.gameVariant ?? "asteroids";
      cachedGameVariant = v;
      return v;
    })
    .catch(() => {
      cachedGameVariant = "asteroids";
      return cachedGameVariant;
    });
  return gameVariantPromise;
}

export default function QuestSection() {
  const game = useAsteroids();
  const { status, score, lives, highScore, level } = game;
  const [quotes, setQuotes] = useState<DesignQuote[]>([]);
  const [quotesError, setQuotesError] = useState(false);
  const [gameVariant, setGameVariant] = useState<GameVariant>("asteroids");
  const sectionRef = useRef<HTMLElement | null>(null);

  // Resolve which game to render from admin settings.
  useEffect(() => {
    let active = true;
    void fetchGameVariant().then((v) => {
      if (active) setGameVariant(v);
    });
    return () => {
      active = false;
    };
  }, []);

  // Fetch the design-quote pool once on mount. GameCanvas caches it via ref.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/content/design-quotes")
      .then((r) => (r.ok ? r.json() : null))
      .then((data: DesignQuote[] | null) => {
        if (cancelled || !Array.isArray(data)) return;
        setQuotes(data);
      })
      .catch(() => {
        if (!cancelled) setQuotesError(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const running = status === "playing";
  const paused = status === "paused";
  const isNewHigh = status === "gameOver" && score > 0 && score >= highScore;

  return (
    <section
      id="quest"
      ref={sectionRef}
      className="relative min-h-screen flex flex-col items-center justify-center px-4 md:px-6 py-20"
    >
      <header className="text-center mb-6 md:mb-8">
        <p className="font-display text-xs uppercase tracking-[0.3em] text-text-secondary">
          THE CURATOR // QUEST
        </p>
        <h2 className="font-display text-[clamp(1.8rem,5vw,3.5rem)] leading-none crt-glow mt-2">
          DESIGNER&apos;S QUEST
        </h2>
        <p className="font-display mt-2 text-[0.6rem] uppercase tracking-[0.2em] text-text-secondary/60">
          Blast design problems. Free the quotes.
        </p>
      </header>

      {/* HUD — visible whenever a run is in flight. */}
      {(status === "playing" ||
        status === "paused" ||
        status === "gameOver") && (
        <div className="w-full max-w-full flex items-center justify-between font-display text-xs uppercase tracking-[0.15em] text-text-secondary mb-2">
          <span>
            SCORE{" "}
            <span className="text-text-primary">{score}</span>
          </span>
          <span>
            LEVEL{" "}
            <span className="text-text-primary">{level}</span>
          </span>
          <span>
            LIVES{" "}
            <span className="text-text-primary">{"◆".repeat(Math.max(0, lives))}</span>
            <span className="text-text-secondary/30">{"◇".repeat(Math.max(0, 3 - lives))}</span>
          </span>
          <span>
            HI{" "}
            <span className="text-text-secondary">{Math.max(highScore, score)}</span>
          </span>
        </div>
      )}

      <div className="w-full max-w-full relative">
        {/* IDLE — start screen. */}
        {status === "idle" && (
          <div className="quest-start">
            <div className="quest-start__inner">
              <pre className="quest-start__ascii" aria-hidden>{"            .--.\n           /    \\\n          |      |\n           \\____/"}</pre>
              <div>
                <p className="font-display text-sm text-text-secondary mb-4 leading-relaxed">
                  {gameVariant === "invaders"
                    ? <>
                        Move with <kbd>A</kbd>/<kbd>D</kbd> or <kbd>←</kbd>/<kbd>→</kbd>.
                        Fire with <kbd>SPACE</kbd>. Pause with <kbd>P</kbd>/<kbd>ESC</kbd>.
                      </>
                    : <>
                        Rotate with <kbd>A</kbd>/<kbd>D</kbd> or <kbd>←</kbd>/<kbd>→</kbd>.
                        Thrust with <kbd>W</kbd>/<kbd>↑</kbd>. Fire with <kbd>SPACE</kbd>.
                        Pause with <kbd>P</kbd>/<kbd>ESC</kbd>.
                      </>}
                </p>
                <p className="font-display text-xs text-text-secondary/70 mb-6 leading-relaxed">
                  Every design problem you pop has a chance to drop a designer's
                  micro-quote. Three lives. No quarters.
                </p>
                <button
                  type="button"
                  onClick={game.startGame}
                  className="quest-btn quest-btn--primary"
                >
                  ▶ Start Quest
                </button>
                {highScore > 0 && (
                  <p className="font-display text-[0.6rem] uppercase tracking-[0.2em] text-text-secondary/60 mt-4">
                    Best run: {highScore}
                  </p>
                )}
                {quotesError && (
                  <p className="font-display text-[0.6rem] uppercase tracking-[0.15em] text-text-secondary/40 mt-3">
                    (quotes unavailable — playing offline)
                  </p>
                )}
              </div>
            </div>
          </div>
        )}

        {/* PLAYING / PAUSED — the live canvas. Variant is admin-selectable. */}
        {(status === "playing" || status === "paused") && (
          <>
            {gameVariant === "invaders" ? (
              <InvadersCanvas
                running={running}
                paused={paused}
                level={level}
                onScore={game.addScore}
                onLoseLife={game.loseLife}
                onGameOver={game.endGame}
                onLevelUp={game.levelUp}
                quotes={quotes}
              />
            ) : (
              <GameCanvas
                running={running}
                paused={paused}
                level={level}
                onScore={game.addScore}
                onLoseLife={game.loseLife}
                onGameOver={game.endGame}
                onLevelUp={game.levelUp}
                quotes={quotes}
              />
            )}
            {status === "paused" && (
              <div className="quest-overlay">
                <p className="font-display text-xs uppercase tracking-[0.3em] text-text-secondary mb-6">
                  Paused
                </p>
                <button
                  type="button"
                  onClick={game.resumeGame}
                  className="quest-btn quest-btn--primary"
                >
                  ▶ Resume
                </button>
                <button
                  type="button"
                  onClick={game.endGame}
                  className="quest-btn quest-btn--ghost mt-3"
                >
                  End run
                </button>
              </div>
            )}
            {status === "playing" && (
              <button
                type="button"
                onClick={game.pauseGame}
                className="quest-pause"
                aria-label="Pause"
                title="Pause (P / ESC)"
              >
                ❚❚
              </button>
            )}
          </>
        )}

        {/* GAME OVER. */}
        {status === "gameOver" && (
          <div className="quest-overlay">
            <p className="font-display text-xs uppercase tracking-[0.3em] text-text-secondary mb-2">
              Run complete
            </p>
            <p className="font-display text-5xl crt-glow mb-1">{score}</p>
            {isNewHigh ? (
              <p className="font-display text-xs uppercase tracking-[0.2em] text-accent mb-6">
                ★ New high score
              </p>
            ) : (
              <p className="font-display text-xs uppercase tracking-[0.15em] text-text-secondary/60 mb-6">
                Best: {highScore}
              </p>
            )}
            <button
              type="button"
              onClick={game.startGame}
              className="quest-btn quest-btn--primary"
            >
              ▶ Play again
            </button>
            <button
              type="button"
              onClick={game.resetToIdle}
              className="quest-btn quest-btn--ghost mt-3"
            >
              Return
            </button>
          </div>
        )}
      </div>

      {/* In-run pause hint (desktop). */}
      {status === "playing" && (
        <p className="mt-4 font-display text-[0.6rem] uppercase tracking-[0.2em] text-text-secondary/50">
          <kbd>P</kbd> / <kbd>ESC</kbd> to pause
        </p>
      )}
    </section>
  );
}
