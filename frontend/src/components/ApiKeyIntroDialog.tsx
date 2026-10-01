import { useEffect, useRef, useState } from "react";
import { useApiKey } from "../hooks/useApiKey";
import type { ProviderId } from "../lib/apiKey";
import {
  VISITOR_PROVIDER_ORDER,
  PROVIDERS,
  detectProvider,
  isAmbiguousKey,
  providerLabel,
} from "../lib/apiKey";

/**
 * Post-intro key prompt. Shown once per session (until a key is saved) after
 * the boot sequence / on first render, explaining that the full experience —
 * live Speedruns, the Oracle, Prompt→Sketch — needs a model API key.
 */

const DISMISSED_KEY = "cme_exe_key_prompt_dismissed";

export function isKeyPromptDismissed(): boolean {
  try {
    return sessionStorage.getItem(DISMISSED_KEY) === "1";
  } catch {
    return false;
  }
}

export function markKeyPromptDismissed(): void {
  try {
    sessionStorage.setItem(DISMISSED_KEY, "1");
  } catch {
    /* storage unavailable — non-fatal */
  }
}

interface ApiKeyIntroDialogProps {
  onClose: () => void;
}

export default function ApiKeyIntroDialog({ onClose }: ApiKeyIntroDialogProps) {
  const { save, setProviderOverride } = useApiKey();
  const [value, setValue] = useState("");
  const [picked, setPicked] = useState<ProviderId | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const trimmed = value.trim();
  // Provider pick only matters for keys whose prefix doesn't pin one down
  // (generic sk-, or no known prefix). Pre-select the detected guess.
  const needsProviderPick = trimmed.length > 0 && isAmbiguousKey(trimmed);
  const detected = trimmed ? detectProvider(trimmed) : null;

  const handleSave = () => {
    if (trimmed.length < 8 || /\s/.test(trimmed)) {
      setError("That doesn't look like an API key — check for typos or line breaks.");
      return;
    }
    save(trimmed);
    // For ambiguous prefixes the visible selection (explicit pick, else the
    // detected guess) becomes the override — same semantics as the widget.
    if (isAmbiguousKey(trimmed)) setProviderOverride(picked ?? detected);
    setSaved(true);
    // Brief confirmation flash, then the Lab unmounts the dialog (hasKey).
    window.setTimeout(onClose, 900);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleSave();
    }
  };

  return (
    <div
      className="key-dialog-overlay"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="key-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="key-dialog-title"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="key-dialog__eyebrow font-display">CME.EXE // SYSTEM LINK</p>
        <h2 id="key-dialog-title" className="key-dialog__title font-display crt-glow">
          {saved ? "LINK ESTABLISHED" : "UNLOCK THE FULL EXPERIENCE"}
        </h2>

        {saved ? (
          <p className="key-dialog__body">
            Your key is stored locally in this browser and is used for your
            requests only. All experiments are now live.
          </p>
        ) : (
          <>
            <p className="key-dialog__body">
              This lab runs its experiments — the Speedrun, <em>Ask the
              Machine</em>, <em>Prompt→Sketch</em> — on live models. The full
              experience is only guaranteed if you connect an API key from one
              of the providers below. Your key never leaves your browser except
              to call the provider.
            </p>

            <div className="key-dialog__field">
              <input
                ref={inputRef}
                type="password"
                value={value}
                onChange={(e) => {
                  setValue(e.target.value);
                  setError(null);
                }}
                onKeyDown={handleKeyDown}
                placeholder="Paste your API key…"
                autoComplete="off"
                spellCheck={false}
                aria-label="API key"
                className="key-dialog__input font-display"
              />
              {needsProviderPick && (
                <label className="key-dialog__provider font-display">
                  <span>PROVIDER</span>
                  <select
                    value={picked ?? detected ?? ""}
                    onChange={(e) => setPicked(e.target.value as ProviderId)}
                    aria-label="Provider for this key"
                    className="key-dialog__select font-display"
                  >
                    <option value="" disabled>
                      Select…
                    </option>
                    {VISITOR_PROVIDER_ORDER.map((id) => (
                      <option key={id} value={id}>
                        {PROVIDERS[id].label}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>

            {error && (
              <p className="key-dialog__error font-display" role="alert">
                ⚠ {error}
              </p>
            )}

            <div className="key-dialog__actions">
              <button
                type="button"
                onClick={handleSave}
                disabled={!trimmed}
                className="key-dialog__primary font-display"
              >
                ACTIVATE KEY
              </button>
              <button
                type="button"
                onClick={onClose}
                className="key-dialog__ghost font-display"
              >
                CONTINUE WITHOUT KEY
              </button>
            </div>

            <p className="key-dialog__hint font-display">
              WORKS WITH: {VISITOR_PROVIDER_ORDER.map((id) => providerLabel(id)).join(" · ")}
            </p>
          </>
        )}
      </div>
    </div>
  );
}
