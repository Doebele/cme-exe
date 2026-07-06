import { useEffect, useMemo, useState } from "react";
import { useSettings } from "../../../hooks/useAdminData";
import type {
  BehaviorBlock,
  ExperienceBlock,
  BootMode,
} from "../AdminShared";
import {
  AdminCard,
  AdminTextInput,
  CheckboxField,
  ErrorBanner,
  RadioGroup,
  SaveRow,
} from "../AdminShared";
import type { AiProvider } from "../../../types";
import { PROVIDER_ORDER, PROVIDERS } from "../../../lib/apiKey";

const DEFAULT_BEHAVIOR: BehaviorBlock = {
  bootMode: "first-visit",
  speedrunDurationSeconds: 60,
  perRunSharing: true,
  mobileTiktokVariant: true,
  hybridRateLimitPerHour: 20,
};

const DEFAULT_EXPERIENCE: ExperienceBlock = {
  allowFullMode: true,
  allowedProviders: [...PROVIDER_ORDER],
};

const ALL_PROVIDERS: AiProvider[] = PROVIDER_ORDER;

export default function BehaviorTab() {
  const { data, isLoading, isSaving, error, save } = useSettings();
  const [behavior, setBehavior] = useState<BehaviorBlock | null>(null);
  const [experience, setExperience] = useState<ExperienceBlock | null>(null);

  useEffect(() => {
    if (data?.behavior) setBehavior({ ...DEFAULT_BEHAVIOR, ...data.behavior });
    if (data?.experience)
      setExperience({ ...DEFAULT_EXPERIENCE, ...data.experience });
  }, [data?.behavior, data?.experience]);

  const dirty = useMemo(() => {
    if (!behavior || !experience || !data) return false;
    return (
      JSON.stringify(behavior) !== JSON.stringify(data.behavior) ||
      JSON.stringify(experience) !== JSON.stringify(data.experience)
    );
  }, [behavior, experience, data]);

  if (isLoading || !behavior || !experience) {
    return <p className="admin-loading font-display">Loading behavior…</p>;
  }

  const setB = <K extends keyof BehaviorBlock>(k: K, v: BehaviorBlock[K]) =>
    setBehavior((cur) => (cur ? { ...cur, [k]: v } : cur));

  const toggleProvider = (p: AiProvider, on: boolean) =>
    setExperience((cur) => {
      if (!cur) return cur;
      const set = new Set(cur.allowedProviders);
      if (on) set.add(p);
      else set.delete(p);
      return { ...cur, allowedProviders: ALL_PROVIDERS.filter((x) => set.has(x)) };
    });

  const handleSave = () => {
    if (!data || !behavior || !experience) return;
    void save({ ...data, behavior, experience });
  };

  return (
    <section className="admin-tab">
      <header className="admin-tab__header">
        <h2 className="admin-tab__heading font-display crt-glow">BEHAVIOR</h2>
        <p className="admin-tab__lede font-display">
          Boot flow, speedrun pacing, sharing, and AI mode access.
        </p>
      </header>

      {error && <ErrorBanner>{error}</ErrorBanner>}

      <AdminCard title="Boot sequence">
        <RadioGroup<BootMode>
          label="Boot sequence"
          value={behavior.bootMode}
          options={[
            { value: "always", label: "Always" },
            { value: "first-visit", label: "First visit only" },
            { value: "off", label: "Off" },
          ]}
          onChange={(v) => setB("bootMode", v)}
          disabled={isSaving}
        />
      </AdminCard>

      <AdminCard title="Speedrun">
        <div className="admin-field-row">
          <label className="admin-field-row__label font-display" htmlFor="behavior-duration">
            Target duration (seconds)
          </label>
          <div className="admin-field-row__control">
            <AdminTextInput
              id="behavior-duration"
              type="number"
              min={10}
              max={600}
              value={String(behavior.speedrunDurationSeconds)}
              onChange={(e) => setB("speedrunDurationSeconds", Number(e.target.value) || 0)}
              disabled={isSaving}
            />
          </div>
        </div>
        <div className="admin-check-row">
          <CheckboxField
            label="Allow per-run sharing (URL)"
            checked={behavior.perRunSharing}
            onChange={(v) => setB("perRunSharing", v)}
            disabled={isSaving}
          />
        </div>
        <div className="admin-check-row">
          <CheckboxField
            label="Enable mobile TikTok variant"
            checked={behavior.mobileTiktokVariant}
            onChange={(v) => setB("mobileTiktokVariant", v)}
            disabled={isSaving}
          />
        </div>
      </AdminCard>

      <AdminCard title="AI modes">
        <div className="admin-field-row">
          <label className="admin-field-row__label font-display" htmlFor="behavior-ratelimit">
            Hybrid mode rate limit (requests/visitor/hour)
          </label>
          <div className="admin-field-row__control">
            <AdminTextInput
              id="behavior-ratelimit"
              type="number"
              min={0}
              value={String(behavior.hybridRateLimitPerHour)}
              onChange={(e) => setB("hybridRateLimitPerHour", Number(e.target.value) || 0)}
              disabled={isSaving}
            />
          </div>
        </div>
        <div className="admin-check-row">
          <CheckboxField
            label="Allow Full mode (visitor keys)"
            checked={experience.allowFullMode}
            onChange={(v) => setExperience((cur) => (cur ? { ...cur, allowFullMode: v } : cur))}
            disabled={isSaving}
          />
        </div>
        <div className="admin-check-row admin-check-row--multi">
          <span className="admin-label font-display">Allowed providers</span>
          {ALL_PROVIDERS.map((p) => (
            <CheckboxField
              key={p}
              label={PROVIDERS[p].label}
              checked={experience.allowedProviders.includes(p)}
              onChange={(v) => toggleProvider(p, v)}
              disabled={isSaving}
            />
          ))}
        </div>
      </AdminCard>

      <SaveRow
        onSave={handleSave}
        saveLabel="Save behavior settings"
        isSaving={isSaving}
        dirty={dirty}
      />
    </section>
  );
}
