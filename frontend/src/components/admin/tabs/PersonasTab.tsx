import { useEffect, useMemo, useState } from "react";
import { usePersonas } from "../../../hooks/useAdminData";
import {
  AdminCard,
  AdminTextarea,
  AdminTextInput,
  ErrorBanner,
  RangeField,
  SaveRow,
} from "../AdminShared";
import type { PersonaConfig, PersonaKey, PersonaMap } from "../AdminShared";

const PERSONA_META: Record<PersonaKey, { title: string; subtitle: string }> = {
  observer: { title: "THE OBSERVER", subtitle: "Speedrun agent" },
  machine: { title: "THE MACHINE", subtitle: "Oracle" },
  curator: { title: "THE CURATOR", subtitle: "Manifest writer" },
};

const ORDER: PersonaKey[] = ["observer", "machine", "curator"];

const DEFAULT_PERSONA: PersonaConfig = {
  name: "",
  role: "",
  model: "",
  systemPrompt: "",
  tone: { playfulness: 5, metaAwareness: 5, poeticDensity: 5 },
};

export default function PersonasTab() {
  const { data, isLoading, isSaving, error, save } = usePersonas();
  const [draft, setDraft] = useState<PersonaMap | null>(null);

  useEffect(() => {
    if (data) {
      const merged: PersonaMap = {
        observer: { ...DEFAULT_PERSONA, ...data.observer },
        machine: { ...DEFAULT_PERSONA, ...data.machine },
        curator: { ...DEFAULT_PERSONA, ...data.curator },
      };
      setDraft(merged);
    }
  }, [data]);

  const dirty = useMemo(() => {
    if (!draft || !data) return false;
    return JSON.stringify(draft) !== JSON.stringify(data);
  }, [draft, data]);

  if (isLoading || !draft) {
    return <p className="admin-loading font-display">Loading personas…</p>;
  }

  const update = (key: PersonaKey, patch: Partial<PersonaConfig>) =>
    setDraft((cur) =>
      cur ? { ...cur, [key]: { ...cur[key], ...patch } } : cur,
    );

  const updateTone = (
    key: PersonaKey,
    toneKey: keyof PersonaConfig["tone"],
    v: number,
  ) =>
    setDraft((cur) => {
      if (!cur) return cur;
      const persona = cur[key];
      return {
        ...cur,
        [key]: { ...persona, tone: { ...persona.tone, [toneKey]: v } },
      };
    });

  const handleSave = () => {
    if (!draft) return;
    void save(draft);
  };

  return (
    <section className="admin-tab">
      <header className="admin-tab__header">
        <h2 className="admin-tab__heading font-display crt-glow">PERSONAS</h2>
        <p className="admin-tab__lede font-display">
          System prompts, models, and tone sliders for the three agents.
        </p>
      </header>

      {error && <ErrorBanner>{error}</ErrorBanner>}

      {ORDER.map((key) => {
        const persona = draft[key];
        const meta = PERSONA_META[key];
        return (
          <AdminCard
            key={key}
            title={meta.title}
            actions={<span className="admin-card__sub font-display">{meta.subtitle}</span>}
          >
            <div className="admin-field-row">
              <label className="admin-field-row__label font-display" htmlFor={`persona-model-${key}`}>
                Model
              </label>
              <div className="admin-field-row__control">
                <AdminTextInput
                  id={`persona-model-${key}`}
                  type="text"
                  value={persona.model}
                  onChange={(e) => update(key, { model: e.target.value })}
                  disabled={isSaving}
                  placeholder="claude-sonnet-4-5"
                />
              </div>
            </div>

            <div className="admin-field-row admin-field-row--top">
              <label className="admin-field-row__label font-display" htmlFor={`persona-prompt-${key}`}>
                System prompt
              </label>
              <div className="admin-field-row__control">
                <AdminTextarea
                  id={`persona-prompt-${key}`}
                  rows={10}
                  value={persona.systemPrompt}
                  onChange={(e) => update(key, { systemPrompt: e.target.value })}
                  disabled={isSaving}
                  placeholder="You are…"
                />
              </div>
            </div>

            <RangeField
              label="Tone — Playfulness (0–10)"
              value={persona.tone.playfulness / 10}
              min={0}
              max={1}
              step={0.1}
              onChange={(v) => updateTone(key, "playfulness", Math.round(v * 10))}
              disabled={isSaving}
            />
            <RangeField
              label="Tone — Meta-awareness (0–10)"
              value={persona.tone.metaAwareness / 10}
              min={0}
              max={1}
              step={0.1}
              onChange={(v) => updateTone(key, "metaAwareness", Math.round(v * 10))}
              disabled={isSaving}
            />
            <RangeField
              label="Tone — Poetic density (0–10)"
              value={persona.tone.poeticDensity / 10}
              min={0}
              max={1}
              step={0.1}
              onChange={(v) => updateTone(key, "poeticDensity", Math.round(v * 10))}
              disabled={isSaving}
            />
          </AdminCard>
        );
      })}

      <SaveRow
        onSave={handleSave}
        saveLabel="Save personas"
        isSaving={isSaving}
        dirty={dirty}
      />
    </section>
  );
}
