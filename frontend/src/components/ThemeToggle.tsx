import { useTheme } from "../hooks/useTheme";
import { nextTheme, themeLabel } from "../lib/themes";

export default function ThemeToggle() {
  const { theme, setTheme } = useTheme();

  const cycle = () => setTheme(nextTheme(theme));

  return (
    <button
      type="button"
      onClick={cycle}
      title={`Theme: ${themeLabel(theme)} — click to cycle`}
      aria-label={`Theme: ${themeLabel(theme)}`}
      className="font-display text-xs uppercase tracking-[0.1em] text-text-secondary hover:text-text-primary transition-colors whitespace-nowrap"
    >
      ◐ {themeLabel(theme)}
    </button>
  );
}
