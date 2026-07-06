import { useEffect, useState } from "react";
import type { Sketch } from "../../hooks/useSketch";

interface SketchPreviewProps {
  sketch: Sketch;
}

interface ThemeVars {
  bg: string;
  primary: string;
  accent: string;
}

const P5_CDN = "https://cdnjs.cloudflare.com/ajax/libs/p5.js/1.11.10/p5.min.js";

function readThemeVars(): ThemeVars {
  const cs = getComputedStyle(document.documentElement);
  const read = (name: string, fallback: string) => {
    const v = cs.getPropertyValue(name).trim();
    return v || fallback;
  };
  return {
    bg: read("--color-bg", "#0a0e0a"),
    primary: read("--color-text-primary", "#39ff14"),
    accent: read("--color-accent", "#4ecdc4"),
  };
}

/**
 * Builds the sandboxed srcdoc. Theme colors are injected both as `:root` CSS
 * variables and as `window.THEME` so generated sketches (directed at
 * `window.THEME` by the system prompt) render in the active theme without any
 * cross-origin access to the real parent. Runtime and load errors are forwarded
 * to the host via postMessage.
 */
function buildSrcDoc(code: string, vars: ThemeVars): string {
  const themeJson = JSON.stringify(vars);
  // The user code is wrapped so a synchronous throw still reaches the host.
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<style>
  :root {
    --color-bg: ${vars.bg};
    --color-text-primary: ${vars.primary};
    --color-accent: ${vars.accent};
  }
  html, body { margin: 0; padding: 0; background: transparent; overflow: hidden; }
  canvas { display: block; }
</style>
<script src="${P5_CDN}"></script>
</head>
<body>
<script>
(function () {
  var realParent = window.parent;
  function report(message) {
    try { realParent.postMessage({ __sketchError: true, message: String(message) }, "*"); } catch (_) {}
  }
  window.__themeVars__ = ${themeJson};
  Object.defineProperty(window, "THEME", {
    value: ${themeJson},
    writable: false,
    configurable: false
  });
  window.addEventListener("error", function (e) {
    report(e.message || "Sketch error");
  });
  window.addEventListener("unhandledrejection", function (e) {
    report((e.reason && (e.reason.message || e.reason)) || "Sketch promise error");
  });
  setTimeout(function () {
    if (typeof window.p5 === "undefined") {
      report("p5.js failed to load (CDN unreachable).");
    }
  }, 2000);
})();
</script>
<script>
try {
${code}
} catch (e) {
  try { window.parent.postMessage({ __sketchError: true, message: String((e && e.message) || e) }, "*"); } catch (_) {}
}
</script>
</body>
</html>`;
}

interface HostError {
  __sketchError: true;
  message: string;
}

function isHostError(data: unknown): data is HostError {
  return (
    typeof data === "object" &&
    data !== null &&
    (data as { __sketchError?: unknown }).__sketchError === true
  );
}

export default function SketchPreview({ sketch }: SketchPreviewProps) {
  // Re-render when the active theme changes so the iframe reloads with the new
  // palette. The ThemeToggle writes data-theme onto <html>; observing that
  // attribute keeps the preview in sync without any shared React state.
  const [themeKey, setThemeKey] = useState(
    () => document.documentElement.getAttribute("data-theme") ?? "",
  );
  useEffect(() => {
    const observer = new MutationObserver(() => {
      setThemeKey(document.documentElement.getAttribute("data-theme") ?? "");
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    return () => observer.disconnect();
  }, []);

  const [runtimeError, setRuntimeError] = useState<string | null>(null);

  // themeKey drives re-render; readThemeVars() picks up the new CSS variables.
  // The iframe reloads only when the resulting srcDoc string actually changes.
  const srcDoc = buildSrcDoc(sketch.code, readThemeVars());

  // Reset the error state whenever the sketch or theme changes.
  useEffect(() => {
    setRuntimeError(null);
  }, [sketch.id, sketch.code, themeKey]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (!isHostError(event.data)) return;
      setRuntimeError(event.data.message || "Sketch failed to run.");
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  if (runtimeError) {
    return (
      <div className="sketch-preview sketch-preview--error" role="alert">
        <p className="sketch-preview__error-title">⚠ sketch failed</p>
        <p className="sketch-preview__error-msg">{runtimeError}</p>
        <p className="sketch-preview__error-hint">
          Try regenerating with a different prompt.
        </p>
      </div>
    );
  }

  return (
    <div className="sketch-preview">
      <div className="sketch-preview__frame">
        <iframe
          title={`Sketch: ${sketch.prompt}`}
          className="sketch-preview__iframe"
          sandbox="allow-scripts"
          srcDoc={srcDoc}
        />
      </div>
    </div>
  );
}
