import { useAudio } from "../hooks/useAudio";

export default function SoundToggle() {
  const { enabled, toggle } = useAudio();

  return (
    <button
      type="button"
      onClick={() => void toggle()}
      title={`Sound: ${enabled ? "ON" : "OFF"}`}
      aria-pressed={enabled}
      aria-label={`Sound ${enabled ? "ON" : "OFF"}`}
      className="font-display text-xs uppercase tracking-[0.1em] text-text-secondary hover:text-text-primary transition-colors whitespace-nowrap"
    >
      {enabled ? "♪ ON" : "♪ OFF"}
    </button>
  );
}
