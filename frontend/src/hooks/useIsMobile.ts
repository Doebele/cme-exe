import { useEffect, useState } from "react";

const MOBILE_BREAKPOINT = 768;

/**
 * Tracks whether the viewport is below the mobile breakpoint.
 * SSR-safe (defaults to false), re-evaluates on resize.
 */
export function useIsMobile(breakpoint = MOBILE_BREAKPOINT): boolean {
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== "undefined" && window.innerWidth < breakpoint,
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onResize = () => setIsMobile(window.innerWidth < breakpoint);
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [breakpoint]);

  return isMobile;
}
