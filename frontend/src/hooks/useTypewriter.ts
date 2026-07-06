import { useEffect, useState } from "react";

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia(REDUCED_MOTION_QUERY).matches
  );
}

export interface UseTypewriter {
  displayed: string;
  isTyping: boolean;
}

/**
 * Reveals `text` one character at a time at `speedMs` per character.
 * Resets whenever `text` changes. When the user prefers reduced motion (or
 * `speedMs` is 0), the full text is shown instantly.
 */
export function useTypewriter(text: string, speedMs = 40): UseTypewriter {
  const [displayed, setDisplayed] = useState("");
  const [isTyping, setIsTyping] = useState(false);

  useEffect(() => {
    // Reduced motion or zero speed → instant.
    if (!text || speedMs <= 0 || prefersReducedMotion()) {
      setDisplayed(text);
      setIsTyping(false);
      return;
    }

    setDisplayed("");
    setIsTyping(true);
    let i = 0;
    const interval = window.setInterval(() => {
      i += 1;
      setDisplayed(text.slice(0, i));
      if (i >= text.length) {
        window.clearInterval(interval);
        setIsTyping(false);
      }
    }, speedMs);

    return () => window.clearInterval(interval);
  }, [text, speedMs]);

  return { displayed, isTyping };
}
