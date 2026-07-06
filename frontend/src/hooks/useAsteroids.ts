import { useCallback, useEffect, useState } from "react";

export type QuestStatus = "idle" | "playing" | "paused" | "gameOver";

export const MAX_LEVEL = 6;

export interface GameState {
  status: QuestStatus;
  score: number;
  lives: number;
  highScore: number;
  level: number;
}

export interface UseAsteroids extends GameState {
  startGame: () => void;
  pauseGame: () => void;
  resumeGame: () => void;
  endGame: () => void;
  resetToIdle: () => void;
  addScore: (delta: number) => void;
  loseLife: () => void;
  levelUp: () => void;
  resetHighScore: () => void;
}

const HIGH_SCORE_KEY = "cme_exe_quest_highscore";
const START_LIVES = 3;

function readHighScore(): number {
  try {
    const raw = localStorage.getItem(HIGH_SCORE_KEY);
    if (!raw) return 0;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch {
    return 0;
  }
}

function writeHighScore(score: number): void {
  try {
    localStorage.setItem(HIGH_SCORE_KEY, String(score));
  } catch {
    /* storage unavailable — non-fatal */
  }
}

/**
 * State machine for the Designer's Quest Asteroids game. Owns score / lives /
 * high-score; the GameCanvas drives entity physics and pushes discrete events
 * (score gain, life lost, game over) up through the action callbacks.
 */
export function useAsteroids(): UseAsteroids {
  const [status, setStatus] = useState<QuestStatus>("idle");
  const [score, setScore] = useState(0);
  const [lives, setLives] = useState(START_LIVES);
  const [highScore, setHighScore] = useState<number>(readHighScore);
  const [level, setLevel] = useState(1);

  const startGame = useCallback(() => {
    setScore(0);
    setLives(START_LIVES);
    setLevel(1);
    setStatus("playing");
  }, []);

  const pauseGame = useCallback(() => {
    setStatus((s) => (s === "playing" ? "paused" : s));
  }, []);

  const resumeGame = useCallback(() => {
    setStatus((s) => (s === "paused" ? "playing" : s));
  }, []);

  const endGame = useCallback(() => {
    setStatus((s) => (s === "playing" || s === "paused" ? "gameOver" : s));
  }, []);

  const resetToIdle = useCallback(() => {
    setStatus("idle");
    setScore(0);
    setLives(START_LIVES);
    setLevel(1);
  }, []);

  const addScore = useCallback((delta: number) => {
    setScore((s) => s + delta);
  }, []);

  const loseLife = useCallback(() => {
    setLives((l) => {
      const next = Math.max(0, l - 1);
      if (next === 0) {
        // Defer the gameOver transition so React can flush the 0-lives render
        // before the overlay swaps in.
        window.setTimeout(() => setStatus("gameOver"), 0);
      }
      return next;
    });
  }, []);

  const levelUp = useCallback(() => {
    setLevel((lv) => {
      const next = Math.min(MAX_LEVEL, lv + 1);
      if (next === lv) return lv; // already at max — stay (final wave)
      return next;
    });
  }, []);

  const resetHighScore = useCallback(() => {
    setHighScore(0);
    writeHighScore(0);
  }, []);

  // Persist high score whenever the final score beats it.
  useEffect(() => {
    if (score > highScore) {
      setHighScore(score);
      writeHighScore(score);
    }
  }, [score, highScore]);

  return {
    status,
    score,
    lives,
    highScore,
    level,
    startGame,
    pauseGame,
    resumeGame,
    endGame,
    resetToIdle,
    addScore,
    loseLife,
    levelUp,
    resetHighScore,
  };
}
