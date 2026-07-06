import { useEffect, useState } from "react";
import { useTypewriter } from "../../hooks/useTypewriter";

interface ManifestCardProps {
  manifest: string;
  isReplay: boolean;
  onReplay: () => void;
  onShare: () => Promise<string>;
  onClose: () => void;
  /** Mobile fullscreen mode — the parent applies this wrapper styling. */
  fullscreen?: boolean;
}

export default function ManifestCard({
  manifest,
  isReplay,
  onReplay,
  onShare,
  onClose,
  fullscreen = false,
}: ManifestCardProps) {
  const { displayed, isTyping } = useTypewriter(manifest, 25);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const t = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(t);
  }, [copied]);

  const handleShare = async () => {
    await onShare();
    setCopied(true);
  };

  return (
    <div
      role="dialog"
      aria-label="The Curator manifest"
      className={
        fullscreen
          ? "relative w-full h-full overflow-y-auto"
          : "relative w-full max-w-2xl mx-auto rounded-sm border p-5 md:p-8"
      }
      style={{
        borderColor: "color-mix(in srgb, var(--color-accent) 50%, transparent)",
        backgroundColor: fullscreen
          ? "var(--color-bg)"
          : "color-mix(in srgb, var(--color-bg) 92%, transparent)",
        boxShadow: fullscreen
          ? undefined
          : "0 0 calc(24px * var(--glow-strength)) color-mix(in srgb, var(--color-accent) 40%, transparent)",
      }}
    >
      <button
        type="button"
        onClick={onClose}
        aria-label="Close manifest"
        className="absolute top-2 right-3 font-display text-xs text-text-secondary/60 hover:text-text-primary transition-colors z-10"
      >
        {'\u2715'}
      </button>

      <p
        className="font-display text-[0.65rem] md:text-xs uppercase tracking-[0.3em]"
        style={{ color: "var(--color-accent)" }}
      >
        THE CURATOR // MANIFEST
      </p>

      <div className="mt-4 min-h-[8rem]">
        <p className="text-sm md:text-base leading-relaxed text-text-primary whitespace-pre-wrap">
          {displayed}
          {isTyping && (
            <span
              className="speedrun-caret-blink"
              style={{ color: "var(--color-accent)" }}
            >
              {'\u258B'}
            </span>
          )}
        </p>
      </div>

      {!isTyping && (
        <div className="mt-6 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={onReplay}
            className="font-display text-xs uppercase tracking-[0.15em] px-4 py-2 border"
            style={{
              borderColor: "var(--color-accent)",
              color: "var(--color-accent)",
            }}
          >
            {isReplay ? "Replay again" : "Replay"}
          </button>
          <button
            type="button"
            onClick={handleShare}
            className="font-display text-xs uppercase tracking-[0.15em] px-4 py-2 border"
            style={{
              borderColor: "color-mix(in srgb, var(--color-text-secondary) 40%, transparent)",
              color: "var(--color-text-secondary)",
            }}
          >
            {copied ? "Copied!" : "Share"}
          </button>
        </div>
      )}
    </div>
  );
}
