import { useEffect, useRef, useState } from "react";
import { useApiKey } from "../hooks/useApiKey";
import type { ProviderId } from "../lib/apiKey";
import {
  AMBIGUOUS_PROVIDERS,
  PROVIDERS,
  providerLabel,
} from "../lib/apiKey";

const PLACEHOLDER_INITIAL = "sk-ant-… / sk-… / AIza… / crsr_…";
const PLACEHOLDER_REPLACE = "(key set — paste to replace)";

/**
 * Tiny inline dropdown shown only when the saved key uses an ambiguous `sk-`
 * prefix (shared by OpenAI/Kimi/Z.AI). Lets the visitor pick which one. For
 * distinctive prefixes (sk-ant-, AIza, crsr_) the provider is locked and this
 * control is hidden.
 */
function ProviderSelect({
  value,
  onChange,
}: {
  value: ProviderId;
  onChange: (id: ProviderId) => void;
}) {
  return (
    <label className="font-display flex items-center gap-1 text-xs text-text-secondary whitespace-nowrap">
      <span className="uppercase tracking-[0.1em]">Provider</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as ProviderId)}
        className="font-display bg-transparent border border-text-secondary/40 focus:border-accent outline-none px-1 py-1 text-xs text-text-primary"
        aria-label="Provider for this key"
      >
        {AMBIGUOUS_PROVIDERS.map((id) => (
          <option key={id} value={id} className="bg-bg-primary text-text-primary">
            {PROVIDERS[id].label}
          </option>
        ))}
      </select>
    </label>
  );
}

export default function ApiKeyWidget() {
  const {
    hasKey,
    provider,
    providerOverride,
    ambiguous,
    save,
    clear,
    setProviderOverride,
  } = useApiKey();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // If a key appears from elsewhere (e.g. another tab), collapse to the badge.
  useEffect(() => {
    if (hasKey) setOpen(false);
  }, [hasKey]);

  useEffect(() => {
    if (open) {
      setValue("");
      inputRef.current?.focus();
    }
  }, [open]);

  const handleSave = () => {
    if (!value.trim()) return;
    save(value);
    setValue("");
    setOpen(false);
  };

  const handleClear = () => {
    clear();
    setValue("");
    setOpen(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleSave();
    } else if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
    }
  };

  // The effective provider id used to drive the dropdown selection. When a key
  // is ambiguous and no override is set, default to OpenAI (most common case).
  const ambiguousProviderId: ProviderId = providerOverride ?? provider ?? "openai";

  // Collapsed: show "Set API key" or "<Provider> ✓".
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="font-display text-xs uppercase tracking-[0.1em] text-text-secondary hover:text-text-primary transition-colors whitespace-nowrap"
        aria-expanded={false}
        aria-haspopup="dialog"
      >
        {hasKey ? `${providerLabel(provider)} ✓` : "Set API key"}
      </button>
    );
  }

  // Expanded: single field + Save + Clear (+ optional provider dropdown).
  return (
    <div
      role="dialog"
      aria-label="API key"
      className="flex flex-wrap items-center gap-2"
    >
      <input
        ref={inputRef}
        type="password"
        value={value}
        placeholder={hasKey ? PLACEHOLDER_REPLACE : PLACEHOLDER_INITIAL}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        autoComplete="off"
        spellCheck={false}
        className="font-display w-44 md:w-56 bg-transparent border border-text-secondary/40 focus:border-accent outline-none px-2 py-1 text-xs text-text-primary placeholder:text-text-secondary/50"
      />
      {/* Only show the disambiguation dropdown when a key is saved and its
          prefix is ambiguous (sk-). Visible while expanded so the visitor can
          re-pick without re-pasting the key. */}
      {hasKey && ambiguous && (
        <ProviderSelect
          value={ambiguousProviderId}
          onChange={setProviderOverride}
        />
      )}
      <button
        type="button"
        onClick={handleSave}
        disabled={!value.trim()}
        className="font-display text-xs uppercase tracking-[0.1em] px-2 py-1 border border-accent text-accent hover:bg-accent/10 disabled:opacity-40 disabled:hover:bg-transparent transition-colors whitespace-nowrap"
      >
        Save
      </button>
      {hasKey && (
        <button
          type="button"
          onClick={handleClear}
          className="font-display text-xs text-text-secondary/70 hover:text-text-primary underline underline-offset-2 whitespace-nowrap"
        >
          Clear key
        </button>
      )}
      <button
        type="button"
        onClick={() => setOpen(false)}
        aria-label="Close API key"
        className="font-display text-xs text-text-secondary/60 hover:text-text-primary px-1"
      >
        ✕
      </button>
    </div>
  );
}
