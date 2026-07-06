import { useEffect, useMemo, useState } from "react";
import { useSettings } from "../../../hooks/useAdminData";
import type { AudioBlock } from "../AdminShared";
import {
  AdminCard,
  ErrorBanner,
  RangeField,
  RadioGroup,
  SaveRow,
} from "../AdminShared";

const DEFAULT_TRACKS: Record<string, number> = {
  "boot-glitch": 0.8,
  "oracle-drone": 0.5,
  "speedrun-base": 0.6,
  "discovery-sting": 0.9,
  "sketch-glitter": 0.7,
  "game-bgm": 0.6,
  "ambient-pad": 0.4,
};

const TRACK_LABELS: Record<string, string> = {
  "boot-glitch": "Boot glitch",
  "oracle-drone": "Oracle drone",
  "speedrun-base": "Speedrun base",
  "discovery-sting": "Discovery sting",
  "sketch-glitter": "Sketch glitter",
  "game-bgm": "Game BGM",
  "ambient-pad": "Ambient pad",
};

const DEFAULT_BLOCK: AudioBlock = {
  soundDefaultOn: true,
  masterVolume: 0.7,
  tracks: { ...DEFAULT_TRACKS },
};

export default function AudioTab() {
  const { data, isLoading, isSaving, error, save } = useSettings();
  const [block, setBlock] = useState<AudioBlock | null>(null);

  useEffect(() => {
    if (data?.audio) {
      setBlock({
        ...DEFAULT_BLOCK,
        ...data.audio,
        tracks: { ...DEFAULT_TRACKS, ...(data.audio.tracks ?? {}) },
      });
    }
  }, [data?.audio]);

  const dirty = useMemo(() => {
    if (!block || !data?.audio) return false;
    return JSON.stringify(block) !== JSON.stringify(data.audio);
  }, [block, data?.audio]);

  if (isLoading || !block) {
    return <p className="admin-loading font-display">Loading audio…</p>;
  }

  const trackIds = Object.keys(DEFAULT_TRACKS);

  const setTrack = (id: string, v: number) =>
    setBlock((cur) =>
      cur ? { ...cur, tracks: { ...cur.tracks, [id]: v } } : cur,
    );

  const handleSave = () => {
    if (!data || !block) return;
    void save({ ...data, audio: block });
  };

  return (
    <section className="admin-tab">
      <header className="admin-tab__header">
        <h2 className="admin-tab__heading font-display crt-glow">AUDIO</h2>
        <p className="admin-tab__lede font-display">
          Tracks are synthesized via Tone.js; these values are advisory for when
          real assets replace the synths.
        </p>
      </header>

      {error && <ErrorBanner>{error}</ErrorBanner>}

      <AdminCard title="Sound default">
        <RadioGroup<"off" | "on">
          label="Sound default"
          value={block.soundDefaultOn ? "on" : "off"}
          options={[
            { value: "off", label: "Off" },
            { value: "on", label: "On" },
          ]}
          onChange={(v) => setBlock((cur) => (cur ? { ...cur, soundDefaultOn: v === "on" } : cur))}
          disabled={isSaving}
        />
        <RangeField
          label="Master volume"
          value={block.masterVolume}
          onChange={(v) => setBlock((cur) => (cur ? { ...cur, masterVolume: v } : cur))}
          disabled={isSaving}
        />
      </AdminCard>

      <AdminCard title="Track volumes">
        {trackIds.map((id) => (
          <RangeField
            key={id}
            label={TRACK_LABELS[id] ?? id}
            value={block.tracks[id] ?? DEFAULT_TRACKS[id] ?? 0.5}
            onChange={(v) => setTrack(id, v)}
            disabled={isSaving}
          />
        ))}
      </AdminCard>

      <SaveRow
        onSave={handleSave}
        saveLabel="Save audio settings"
        isSaving={isSaving}
        dirty={dirty}
      />
    </section>
  );
}
