import type { ReactNode } from "react";
import type { ThemeId, AiProvider } from "../../types";

// ---------------------------------------------------------------------------
// Backend contract types. The settings object is nested (see Lab.tsx which
// reads settings.behavior.bootMode). These mirror the API responses.
// ---------------------------------------------------------------------------

export interface NavSection {
  id: string;
  title: string;
  visible: boolean;
  order: number;
}

export type BootMode = "always" | "first-visit" | "off";

export interface ThemeBlock {
  defaultTheme: ThemeId;
  available: ThemeId[];
  allowVisitorSwitch: boolean;
  glowStrength: number;
  scanlineOpacity: number;
  noiseOpacity: number;
  crtCurve: number;
}

export interface AudioBlock {
  soundDefaultOn: boolean;
  masterVolume: number;
  tracks: Record<string, number>;
}

export type GameVariant = "asteroids" | "invaders";

export type HeroAnimationId =
  | "ascii-materialize"
  | "console-boot"
  | "rotating-wireframe"
  | "particle-text"
  | "flow-field"
  | "outrun";

export interface BehaviorBlock {
  bootMode: BootMode;
  speedrunDurationSeconds: number;
  perRunSharing: boolean;
  mobileTiktokVariant: boolean;
  hybridRateLimitPerHour: number;
  gameVariant: GameVariant;
  heroAnimation: HeroAnimationId;
}

export interface ExperienceBlock {
  allowFullMode: boolean;
  allowedProviders: AiProvider[];
}

export interface AdminSettings {
  theme: ThemeBlock;
  audio: AudioBlock;
  behavior: BehaviorBlock;
  experience: ExperienceBlock;
}

export interface PersonaConfig {
  name: string;
  role: string;
  model: string;
  systemPrompt: string;
  tone: {
    playfulness: number;
    metaAwareness: number;
    poeticDensity: number;
  };
}

export type PersonaMap = {
  observer: PersonaConfig;
  machine: PersonaConfig;
  curator: PersonaConfig;
};

export type PersonaKey = keyof PersonaMap;

export interface ApiKeyStatus {
  present: boolean;
  preview: string;
}

/**
 * Masked view of stored admin keys. GET may historically return only a subset
 * of providers, so each entry is optional and callers should fall back to
 * `{ present: false, preview: "" }` when a slot is missing. `defaultProvider`
 * selects which key Hybrid mode uses when no visitor key is present.
 */
export interface ApiKeysResponse {
  providers: Partial<Record<string, ApiKeyStatus>>;
  defaultProvider?: string;
  updatedAt: string | null;
}

/** PUT accepts partial raw values per provider plus the default selection. */
export interface ApiKeysPutBody {
  anthropic?: string;
  openai?: string;
  kimi?: string;
  zai?: string;
  gemini?: string;
  cursor?: string;
  defaultProvider?: string;
}

// ---------------------------------------------------------------------------
// Analytics shape returned by GET /api/admin/analytics.
// ---------------------------------------------------------------------------

export interface AnalyticsHostCount {
  host: string;
  count: number;
}

export interface AnalyticsDayCount {
  date: string;
  count: number;
}

export interface AnalyticsSummary {
  runsTotal: number;
  runsLast24h: number;
  runsComplete: number;
  runsHybrid: number;
  runsFull: number;
  runsUnknown: number;
  urlRuns: number;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
  topSourceHosts: AnalyticsHostCount[];
  runsPerDay: AnalyticsDayCount[];
}

// ---------------------------------------------------------------------------
// Shared UI primitives. All styled to match ApiKeyWidget/Navigation: dark theme,
// Fira Mono, bordered inputs, accent-colored action buttons.
// ---------------------------------------------------------------------------

export function AdminCard({
  title,
  children,
  actions,
}: {
  title?: string;
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <section className="admin-card">
      {title && (
        <header className="admin-card__header">
          <h3 className="admin-card__title">{title}</h3>
          {actions && <div className="admin-card__actions">{actions}</div>}
        </header>
      )}
      <div className="admin-card__body">{children}</div>
    </section>
  );
}

export function AdminLabel({ children }: { children: ReactNode }) {
  return (
    <span className="admin-label font-display">{children}</span>
  );
}

export function AdminTextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  const { className, ...rest } = props;
  return (
    <input
      {...rest}
      className={`admin-input ${className ?? ""}`}
    />
  );
}

export function AdminTextarea(
  props: React.TextareaHTMLAttributes<HTMLTextAreaElement>,
) {
  const { className, ...rest } = props;
  return (
    <textarea
      {...rest}
      className={`admin-textarea ${className ?? ""}`}
    />
  );
}

export function AdminButton({
  variant = "accent",
  children,
  ...rest
}: {
  variant?: "accent" | "ghost" | "danger";
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const variantClass =
    variant === "accent"
      ? "admin-btn--accent"
      : variant === "danger"
        ? "admin-btn--danger"
        : "admin-btn--ghost";
  return (
    <button
      {...rest}
      className={`admin-btn font-display ${variantClass} ${rest.className ?? ""}`}
    >
      {children}
    </button>
  );
}

export function SaveRow({
  onSave,
  onClear,
  saveLabel,
  isSaving,
  dirty,
  hint,
}: {
  onSave: () => void;
  onClear?: () => void;
  saveLabel: string;
  isSaving: boolean;
  dirty: boolean;
  hint?: string;
}) {
  return (
    <div className="admin-save-row">
      <AdminButton
        type="button"
        variant="accent"
        onClick={onSave}
        disabled={isSaving || !dirty}
      >
        {isSaving ? "Saving…" : saveLabel}
      </AdminButton>
      {onClear && (
        <AdminButton
          type="button"
          variant="ghost"
          onClick={onClear}
          disabled={isSaving}
        >
          Reset
        </AdminButton>
      )}
      {hint && <span className="admin-hint font-display">{hint}</span>}
    </div>
  );
}

export function StatusBadge({
  ok,
  children,
}: {
  ok: boolean;
  children: ReactNode;
}) {
  return (
    <span className={`admin-status ${ok ? "is-ok" : "is-no"}`}>
      <span className="admin-status__mark">{ok ? "✓" : "✗"}</span>
      {children}
    </span>
  );
}

export function FieldRow({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <div className="admin-field-row">
      <label className="admin-field-row__label font-display">{label}</label>
      <div className="admin-field-row__control">{children}</div>
      {hint && <p className="admin-field-row__hint font-display">{hint}</p>}
    </div>
  );
}

export function ErrorBanner({ children }: { children: ReactNode }) {
  return <div className="admin-error">{children}</div>;
}

// ---------------------------------------------------------------------------
// Form primitives for the settings tabs (range sliders, radios, checkboxes).
// ---------------------------------------------------------------------------

export function RangeField({
  label,
  value,
  onChange,
  disabled,
  step = 0.05,
  min = 0,
  max = 1,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  disabled?: boolean;
  step?: number;
  min?: number;
  max?: number;
}) {
  return (
    <div className="admin-range">
      <span className="admin-range__label font-display">{label}</span>
      <input
        type="range"
        className="admin-range__input"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <span className="admin-range__value font-display">
        {value.toFixed(2)}
      </span>
    </div>
  );
}

export function RadioGroup<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled,
  disabledOptions,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  disabled?: boolean;
  /** Per-option disable — e.g. when the option requires a key that isn't set. */
  disabledOptions?: T[];
}) {
  const disabledSet = new Set(disabledOptions ?? []);
  return (
    <div className="admin-radio-group">
      <span className="admin-radio-group__label font-display">{label}</span>
      <div className="admin-radio-group__options">
        {options.map((opt) => {
          const isDisabled = disabled || disabledSet.has(opt.value);
          return (
            <label
              key={opt.value}
              className={`admin-radio font-display ${value === opt.value ? "is-active" : ""} ${isDisabled ? "is-disabled" : ""}`}
            >
              <input
                type="radio"
                checked={value === opt.value}
                disabled={isDisabled}
                onChange={() => onChange(opt.value)}
              />
              <span>{opt.label}</span>
            </label>
          );
        })}
      </div>
    </div>
  );
}

export function CheckboxField({
  label,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className={`admin-check font-display ${checked ? "is-active" : ""}`}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>{label}</span>
    </label>
  );
}
