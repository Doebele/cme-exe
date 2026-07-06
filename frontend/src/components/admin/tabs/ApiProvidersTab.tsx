import { useState } from "react";
import { useApiKeys } from "../../../hooks/useAdminData";
import type { ProviderId } from "../../../lib/apiKey";
import { PROVIDER_ORDER, PROVIDERS } from "../../../lib/apiKey";
import {
  AdminCard,
  AdminButton,
  ErrorBanner,
  RadioGroup,
  StatusBadge,
} from "../AdminShared";

const EMPTY_STATUS = { present: false, preview: "" };

interface ProviderBlockProps {
  provider: ProviderId;
  present: boolean;
  preview: string;
  isSaving: boolean;
  onSave: (value: string) => void | Promise<boolean>;
  onClear: () => void | Promise<boolean>;
}

function ProviderBlock({
  provider,
  present,
  preview,
  isSaving,
  onSave,
  onClear,
}: ProviderBlockProps) {
  const meta = PROVIDERS[provider];
  const [value, setValue] = useState("");
  const [savedFlash, setSavedFlash] = useState(false);
  const placeholder = present
    ? "Paste new key to replace…"
    : meta.placeholder;

  const handleSave = async () => {
    const v = value.trim();
    if (!v) return;
    const ok = await Promise.resolve(onSave(v));
    if (ok !== false) {
      setValue("");
      setSavedFlash(true);
      window.setTimeout(() => setSavedFlash(false), 2200);
    }
  };

  const handleClear = async () => {
    setValue("");
    await Promise.resolve(onClear());
    setSavedFlash(true);
    window.setTimeout(() => setSavedFlash(false), 2200);
  };

  return (
    <AdminCard
      title={meta.label}
      actions={
        <StatusBadge ok={present}>
          {present ? `Key set (${preview})` : "No key set"}
        </StatusBadge>
      }
    >
      <div className="admin-provider">
        <span className="admin-label font-display admin-provider__prefix">
          {meta.prefixBadge}
        </span>
        <label
          className="admin-label font-display"
          htmlFor={`admin-key-${provider}`}
        >
          New key
        </label>
        <input
          id={`admin-key-${provider}`}
          type="password"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={placeholder}
          autoComplete="off"
          spellCheck={false}
          className="admin-input"
        />
        <div className="admin-save-row">
          <AdminButton
            type="button"
            variant="accent"
            onClick={handleSave}
            disabled={isSaving || !value.trim()}
          >
            Save {meta.label} key
          </AdminButton>
          <AdminButton
            type="button"
            variant="ghost"
            onClick={handleClear}
            disabled={isSaving || !present}
          >
            Clear
          </AdminButton>
          {savedFlash && (
            <span
              className="admin-saved-flash font-display"
              role="status"
              aria-live="polite"
              style={{
                color: "var(--color-accent)",
                fontSize: "0.6rem",
                letterSpacing: "0.15em",
                textTransform: "uppercase",
                opacity: 0.9,
              }}
            >
              ✓ Saved
            </span>
          )}
        </div>
      </div>
    </AdminCard>
  );
}

export default function ApiProvidersTab() {
  const {
    data,
    isLoading,
    isSaving,
    error,
    saveKey,
    clearKey,
    setDefaultProvider,
  } = useApiKeys();

  if (isLoading) {
    return <p className="admin-loading font-display">Loading keys…</p>;
  }

  const statuses = data?.providers ?? {};
  const defaultProvider = (data?.defaultProvider ?? "anthropic") as ProviderId;

  return (
    <section className="admin-tab">
      <header className="admin-tab__header">
        <h2 className="admin-tab__heading font-display crt-glow">
          AI PROVIDER KEYS
        </h2>
        <p className="admin-tab__lede font-display">
          These keys power Hybrid mode (server pays). Visitors can still use
          their own keys via the in-page widget for Full mode.
        </p>
      </header>

      {error && <ErrorBanner>{error}</ErrorBanner>}

      <AdminCard title="Default provider for Hybrid mode">
        <RadioGroup<ProviderId>
          label="Provider used when no visitor key is set. Only providers with a stored key are selectable."
          value={defaultProvider}
          options={PROVIDER_ORDER.map((id) => ({
            value: id,
            label: PROVIDERS[id].label,
          }))}
          // Disable providers that have no key set — they can't be used for Hybrid mode.
          disabledOptions={PROVIDER_ORDER.filter((id) => !(statuses[id]?.present))}
          onChange={(v) => void setDefaultProvider(v)}
          disabled={isSaving}
        />
      </AdminCard>

      {PROVIDER_ORDER.map((id) => {
        const status = statuses[id] ?? EMPTY_STATUS;
        return (
          <ProviderBlock
            key={id}
            provider={id}
            present={status.present}
            preview={status.preview}
            isSaving={isSaving}
            onSave={(v) => void saveKey(id, v)}
            onClear={() => void clearKey(id)}
          />
        );
      })}

      {data?.updatedAt && (
        <p className="admin-meta font-display">
          Last updated: {new Date(data.updatedAt).toLocaleString()}
        </p>
      )}
    </section>
  );
}
