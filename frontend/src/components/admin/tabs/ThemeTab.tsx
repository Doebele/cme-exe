import { useEffect, useMemo, useState } from "react";
import { useSettings } from "../../../hooks/useAdminData";
import type { ThemeBlock } from "../AdminShared";
import {
  AdminCard,
  CheckboxField,
  ErrorBanner,
  RangeField,
  RadioGroup,
  SaveRow,
} from "../AdminShared";
import type { ThemeId } from "../../../types";
import { THEMES } from "../../../lib/themes";

const DEFAULT_THEME_BLOCK: ThemeBlock = {
  defaultTheme: "vector-green",
  available: ["vector-green", "crt-amber", "y2k-vaporwave"],
  allowVisitorSwitch: true,
  glowStrength: 0.6,
  scanlineOpacity: 0.2,
  noiseOpacity: 0.05,
  crtCurve: 0.1,
};

export default function ThemeTab() {
  const { data, isLoading, isSaving, error, save } = useSettings();
  const [block, setBlock] = useState<ThemeBlock | null>(null);

  useEffect(() => {
    if (data?.theme) setBlock({ ...DEFAULT_THEME_BLOCK, ...data.theme });
  }, [data?.theme]);

  const dirty = useMemo(() => {
    if (!block || !data?.theme) return false;
    return JSON.stringify(block) !== JSON.stringify(data.theme);
  }, [block, data?.theme]);

  if (isLoading || !block) {
    return <p className="admin-loading font-display">Loading theme…</p>;
  }

  const available = block.available.length ? block.available : DEFAULT_THEME_BLOCK.available;
  const themeOptions = THEMES
    .filter((t) => available.includes(t.id))
    .map((t) => ({ value: t.id, label: t.label }));

  const set = <K extends keyof ThemeBlock>(key: K, val: ThemeBlock[K]) =>
    setBlock((cur) => (cur ? { ...cur, [key]: val } : cur));

  const handleSave = () => {
    if (!data || !block) return;
    void save({ ...data, theme: block });
  };

  return (
    <section className="admin-tab">
      <header className="admin-tab__header">
        <h2 className="admin-tab__heading font-display crt-glow">THEME</h2>
        <p className="admin-tab__lede font-display">
          Default theme and CRT intensity applied to new visitors.
        </p>
      </header>

      {error && <ErrorBanner>{error}</ErrorBanner>}

      <AdminCard title="Default theme">
        <RadioGroup<ThemeId>
          label="Default theme"
          value={block.defaultTheme}
          options={themeOptions}
          onChange={(v) => set("defaultTheme", v)}
          disabled={isSaving}
        />
        <div className="admin-check-row">
          <CheckboxField
            label="Allow visitors to switch themes"
            checked={block.allowVisitorSwitch}
            onChange={(v) => set("allowVisitorSwitch", v)}
            disabled={isSaving}
          />
        </div>
      </AdminCard>

      <AdminCard title="CRT intensity">
        <RangeField
          label="Glow intensity"
          value={block.glowStrength}
          onChange={(v) => set("glowStrength", v)}
          disabled={isSaving}
        />
        <RangeField
          label="Scanline opacity"
          value={block.scanlineOpacity}
          onChange={(v) => set("scanlineOpacity", v)}
          disabled={isSaving}
        />
        <RangeField
          label="Noise opacity"
          value={block.noiseOpacity}
          onChange={(v) => set("noiseOpacity", v)}
          disabled={isSaving}
        />
        <RangeField
          label="CRT curve"
          value={block.crtCurve}
          onChange={(v) => set("crtCurve", v)}
          disabled={isSaving}
        />
      </AdminCard>

      <SaveRow
        onSave={handleSave}
        saveLabel="Save theme settings"
        isSaving={isSaving}
        dirty={dirty}
      />
    </section>
  );
}
