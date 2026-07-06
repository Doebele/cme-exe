import { useEffect, useRef, useState } from "react";

interface CodeViewerProps {
  /** Final code to display once generation is complete. */
  code: string;
  /** Partial code while tokens are still streaming in. */
  partial: string;
  /** True while the model is still generating. */
  generating: boolean;
}

/**
 * Collapsible code panel. While generating it stays expanded and streams the
 * incoming tokens; once generation finishes it auto-collapses so the live
 * sketch takes focus, but the visitor can re-expand and copy the source.
 */
export default function CodeViewer({
  code,
  partial,
  generating,
}: CodeViewerProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [copied, setCopied] = useState(false);
  const wasGenerating = useRef(generating);

  // Auto-collapse when generation finishes (true → false).
  useEffect(() => {
    if (wasGenerating.current && !generating) {
      setCollapsed(true);
    }
    wasGenerating.current = generating;
  }, [generating]);

  useEffect(() => {
    if (!copied) return;
    const t = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(t);
  }, [copied]);

  const display = generating ? partial : code;

  const copy = async () => {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
    } catch {
      /* clipboard unavailable — copy silently no-ops */
    }
  };

  if (!generating && !code) return null;

  return (
    <div className="sketch-code">
      <div className="sketch-code__bar">
        <button
          type="button"
          className="sketch-code__toggle"
          onClick={() => setCollapsed((c) => !c)}
          aria-expanded={!collapsed}
        >
          <span className="sketch-code__brackets" aria-hidden>
            {"</>"}
          </span>
          <span className="sketch-code__label">CODE</span>
          <span className="sketch-code__arrow" aria-hidden>
            {collapsed ? "▸" : "▾"}
          </span>
        </button>
        {!generating && code && (
          <button
            type="button"
            className="sketch-code__copy"
            onClick={copy}
          >
            {copied ? "copied" : "copy"}
          </button>
        )}
      </div>
      {!collapsed && (
        <pre className="sketch-code__pre">
          <code>
            {display}
            {generating && (
              <span className="oracle-caret" aria-hidden>
                ▋
              </span>
            )}
          </code>
        </pre>
      )}
    </div>
  );
}
